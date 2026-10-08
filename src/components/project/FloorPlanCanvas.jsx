import { useState, useRef, useEffect, useId } from 'react';
import Mi from '../Mi.jsx';
import useChanged from '../../hooks/useChanged.js';
import { rectFrom, clampMove, resizeRect, HANDLES, handlePoint } from '../../lib/floorPlan.js';

// The floor plan drawing with its unit boxes, shared by the Available Units
// viewer and the floor plan editor. An SVG whose viewBox is the image's own
// pixels, so boxes sit on the drawing at any size; zooming and panning just
// move the viewBox.
//
//   image     { url, width, height }
//   boxes     [{ id, x, y, w, h (image px), label, status, aria, dim }]
//             status: available | hold | sold | unlinked
//   editable  boxes can be drawn (tool 'draw'), moved and resized
//   onSelect(id | null), onHover(id | null)
//   onCreate(rect)           a new box was drawn (image px)
//   onCommit(id, rect)       a move or resize ended (image px)
//
// Ctrl/⌘ + wheel or a pinch zooms; dragging an empty spot pans once zoomed in.

const MAX_ZOOM = 12;
const MIN_DRAW = 8;   // screen px: a smaller drag is a stray click, not a box
const MOVE_SLOP = 3;  // screen px before a press on a box becomes a move
const CURSOR = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };

export default function FloorPlanCanvas({
  image, boxes, selectedId = null, hoverId = null, onSelect, onHover,
  editable = false, tool = 'select', onCreate, onCommit, className = '', label = 'Floor plan',
}) {
  const W = image.width, H = image.height;
  const hatch = useId().replace(/:/g, '');
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const [view, setView] = useState(null); // null = the whole image
  const [size, setSize] = useState({ cw: 0, ch: 0 });
  const [drag, setDrag] = useState(null);
  const pointers = useRef(new Map());
  if (useChanged(`${image.url}|${W}|${H}`)) { setView(null); setDrag(null); }

  const v = view || { x: 0, y: 0, w: W, h: H };
  const zoomed = v.w < W - 0.5;
  // Screen px per image px.
  const k = size.cw && size.ch ? Math.min(size.cw / v.w, size.ch / v.h) : 1;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ cw: e.contentRect.width, ch: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const clampView = (nv) => {
    const w = Math.min(W, Math.max(W / MAX_ZOOM, nv.w));
    const h = w * H / W;
    return { w, h, x: Math.min(Math.max(0, nv.x), W - w), y: Math.min(Math.max(0, nv.y), H - h) };
  };
  // Zoom by `f` keeping image point (cx, cy) where it is on screen.
  const zoomAt = (f, cx, cy, from = v) => {
    const w = Math.min(W, Math.max(W / MAX_ZOOM, from.w / f));
    if (w >= W - 0.5) { setView(null); return; }
    const r = w / from.w;
    setView(clampView({ w, x: cx - (cx - from.x) * r, y: cy - (cy - from.y) * r }));
  };

  const toImg = (clientX, clientY) => {
    const m = svgRef.current?.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };

  // Ctrl/⌘ + wheel (and a trackpad pinch, which arrives as one) zooms. React's
  // wheel listener is passive, so this one is attached by hand.
  const zoomRef = useRef(null);
  useEffect(() => {
    zoomRef.current = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const p = toImg(e.clientX, e.clientY);
      zoomAt(Math.exp(-e.deltaY * 0.0025), p.x, p.y);
    };
  });
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const fn = (e) => zoomRef.current(e);
    el.addEventListener('wheel', fn, { passive: false });
    return () => el.removeEventListener('wheel', fn);
  }, []);

  const pinchState = () => {
    const [a, b] = [...pointers.current.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  };

  const onPointerDown = (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    svgRef.current.setPointerCapture?.(e.pointerId);
    if (pointers.current.size === 2) {
      const s = pinchState();
      setDrag({ kind: 'pinch', d0: s.d, v0: v, mid: toImg(s.mx, s.my) });
      return;
    }
    if (pointers.current.size > 2) return;
    const at = toImg(e.clientX, e.clientY);
    const start = { cx: e.clientX, cy: e.clientY };
    const hd = e.target.closest?.('[data-hd]')?.getAttribute('data-hd');
    const boxEl = e.target.closest?.('[data-box]');
    const id = boxEl?.getAttribute('data-box');
    // Draw tool: a press always starts a box — neighbouring shops share walls,
    // so the corner it starts on is often inside the box next door. A click
    // without a drag still picks the box it landed on.
    if (editable && tool === 'draw') {
      e.preventDefault();
      setDrag({ kind: 'draw', at, start, rect: { x: at.x, y: at.y, w: 0, h: 0 }, tapId: id || null });
      return;
    }
    if (editable && hd && selectedId) {
      const b = boxes.find(x => x.id === selectedId);
      if (b) { e.preventDefault(); setDrag({ kind: 'resize', id: b.id, hd, at, start, rect: b, from: b }); }
      return;
    }
    if (id && editable) {
      onSelect?.(id);
      const b = boxes.find(x => x.id === id);
      if (b) setDrag({ kind: 'move', id, at, start, from: b, rect: b, moved: false });
      return;
    }
    // Viewer: a box is picked on release, so a drag that starts on one still pans.
    if (id) { setDrag({ kind: 'pan', start, v0: v, moved: false, tapId: id }); return; }
    setDrag({ kind: 'pan', start, v0: v, moved: false });
  };

  const onPointerMove = (e) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!drag) return;
    if (drag.kind === 'pinch') {
      if (pointers.current.size < 2) return;
      const s = pinchState();
      zoomAt(s.d / drag.d0, drag.mid.x, drag.mid.y, drag.v0);
      return;
    }
    const sdx = e.clientX - drag.start.cx, sdy = e.clientY - drag.start.cy;
    if (drag.kind === 'pan') {
      if (!drag.moved && Math.hypot(sdx, sdy) < MOVE_SLOP) return;
      if (zoomed) setView(clampView({ ...drag.v0, x: drag.v0.x - sdx / k, y: drag.v0.y - sdy / k }));
      if (!drag.moved) setDrag({ ...drag, moved: true });
      return;
    }
    const at = toImg(e.clientX, e.clientY);
    if (drag.kind === 'draw') setDrag({ ...drag, rect: rectFrom(drag.at, at, W, H) });
    else if (drag.kind === 'move') {
      if (!drag.moved && Math.hypot(sdx, sdy) < MOVE_SLOP) return;
      setDrag({ ...drag, moved: true, rect: clampMove({ ...drag.from, x: drag.from.x + at.x - drag.at.x, y: drag.from.y + at.y - drag.at.y }, W, H) });
    } else if (drag.kind === 'resize') {
      setDrag({ ...drag, rect: resizeRect(drag.from, drag.hd, at.x - drag.at.x, at.y - drag.at.y, W, H, MIN_DRAW / k) });
    }
  };

  const onPointerUp = (e) => {
    pointers.current.delete(e.pointerId);
    if (!drag) return;
    if (drag.kind === 'pinch') { if (pointers.current.size === 0) setDrag(null); return; }
    const d = drag;
    setDrag(null);
    if (d.kind === 'draw') {
      if (d.rect.w * k >= MIN_DRAW && d.rect.h * k >= MIN_DRAW) onCreate?.(d.rect);
      else onSelect?.(d.tapId); // a click: pick the box under it, or clear
    } else if (d.kind === 'move') {
      if (d.moved) onCommit?.(d.id, d.rect);
    } else if (d.kind === 'resize') {
      if (d.rect.w !== d.from.w || d.rect.h !== d.from.h || d.rect.x !== d.from.x || d.rect.y !== d.from.y) onCommit?.(d.id, d.rect);
    } else if (d.kind === 'pan' && !d.moved) {
      if (d.tapId) onSelect?.(d.tapId);
      else if (editable) onSelect?.(null); // a click on an empty spot clears the selection
    }
  };
  const onPointerCancel = (e) => { pointers.current.delete(e.pointerId); setDrag(null); };

  const zoomBy = (f) => zoomAt(f, v.x + v.w / 2, v.y + v.h / 2);
  const fs = 12 / k; // label size: 12 screen px at any zoom
  const live = (b) => (drag && drag.id === b.id && drag.rect ? { ...b, ...pick(drag.rect) } : b);
  const sel = selectedId ? boxes.find(b => b.id === selectedId) : null;
  const selR = sel ? live(sel) : null;
  const hs = 9 / k; // handle size
  const svgCursor = drag?.kind === 'pan' && drag.moved ? 'grabbing' : editable && tool === 'draw' ? 'crosshair' : zoomed ? 'grab' : 'default';

  return (
    <div className={`fp-stage ${className}`} ref={wrapRef} style={{ '--fp-ar': `${W} / ${H}` }}>
      <svg ref={svgRef} className="fp-svg" viewBox={`${v.x} ${v.y} ${v.w} ${v.h}`} preserveAspectRatio="xMidYMid meet"
        role="group" aria-label={label}
        style={{ cursor: svgCursor, touchAction: editable || zoomed ? 'none' : 'pan-y' }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}
        onPointerLeave={() => onHover?.(null)}>
        <defs>
          <pattern id={hatch} width={8 / k} height={8 / k} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line className="fp-hatch-ln" x1="0" y1="0" x2="0" y2={8 / k} strokeWidth={2.5 / k} />
          </pattern>
        </defs>
        <image href={image.url} x="0" y="0" width={W} height={H} preserveAspectRatio="none" />
        {boxes.map(b0 => {
          const b = live(b0);
          const on = b.id === selectedId;
          const showLabel = b.label && b.w * k >= 30 && b.h * k >= 15;
          return (
            <g key={b.id} data-box={b.id}
              className={`fp-box st-${b.status}${on ? ' on' : ''}${b.id === hoverId ? ' hl' : ''}${b.dim ? ' dim' : ''}`}
              role="button" tabIndex={0} aria-label={b.aria || b.label} aria-pressed={on}
              onPointerEnter={() => onHover?.(b.id)} onPointerLeave={() => onHover?.(null)}
              onFocus={() => { if (editable) onSelect?.(b.id); }}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(b.id); } }}>
              <rect className="fp-fill" x={b.x} y={b.y} width={b.w} height={b.h} />
              {b.status === 'sold' && <rect x={b.x} y={b.y} width={b.w} height={b.h} fill={`url(#${hatch})`} className="fp-hatch" />}
              <rect className="fp-edge" x={b.x} y={b.y} width={b.w} height={b.h} vectorEffect="non-scaling-stroke" />
              {showLabel && (
                <text className="fp-lbl" x={b.x + b.w / 2} y={b.y + b.h / 2} fontSize={Math.min(fs, b.h * 0.6)}
                  strokeWidth={3 / k} textAnchor="middle" dominantBaseline="central">{b.label}</text>
              )}
            </g>
          );
        })}
        {drag?.kind === 'draw' && drag.rect.w > 0 && (
          <rect className="fp-draft" x={drag.rect.x} y={drag.rect.y} width={drag.rect.w} height={drag.rect.h} vectorEffect="non-scaling-stroke" />
        )}
        {editable && tool === 'select' && selR && HANDLES.map(hd => {
          const p = handlePoint(selR, hd);
          return <rect key={hd} data-hd={hd} className="fp-hd" x={p.x - hs / 2} y={p.y - hs / 2} width={hs} height={hs}
            vectorEffect="non-scaling-stroke" style={{ cursor: CURSOR[hd] }} />;
        })}
      </svg>
      <div className="fp-zoom" aria-label="Zoom">
        <button type="button" onClick={() => zoomBy(1 / 1.5)} disabled={!zoomed} aria-label="Zoom out" title="Zoom out"><Mi>remove</Mi></button>
        <button type="button" onClick={() => zoomBy(1.5)} disabled={v.w <= W / MAX_ZOOM + 0.5} aria-label="Zoom in" title="Zoom in"><Mi>add</Mi></button>
        <button type="button" onClick={() => setView(null)} disabled={!zoomed} aria-label="Fit to view" title="Fit"><Mi>fit_screen</Mi></button>
      </div>
    </div>
  );
}

const pick = (r) => ({ x: r.x, y: r.y, w: r.w, h: r.h });
