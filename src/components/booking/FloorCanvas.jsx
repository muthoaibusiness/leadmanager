import { useEffect, useLayoutEffect, useRef } from 'react';
import { shortCode, takaShort, codeKey } from '../../lib/floorText.js';

// The floor plan, redrawn in CSS: every unit a tile at its own position and size, with the lifts,
// stairs and the rest of the building drawn around them. Shared by the Booking page and the
// request pop-up. `focus`: a unit code to point at; the others fade and it pulses.
// A narrow tile gets a smaller type so its number is never cut off: the number
// (mono, about 0.62 em a character) has to fit the tile's width less its padding.
const codeFit = (s) => {
  if (s.w >= 0.3 && s.shape) return { fontSize: 'max(15px, 3.2cqw)' }; // a big tile (an apartment) gets big type
  const em = (s.w * 100 - 1.5) / (0.62 * shortCode(s.code).length); // in cqw
  return em < 1.75 ? { fontSize: `max(6.5px, ${Math.max(em, 0.5).toFixed(2)}cqw)` } : null;
};


// With `onZoom`, the mouse zooms the plan: the wheel zooms about the pointer, and a
// zoomed plan is moved by dragging it. A drag never picks the tile it ends on.
function useMouseZoom(stageRef, planRef, zoom, onZoom) {
  const anchor = useRef(null);   // the plan point under the pointer, kept there across a zoom
  const live = useRef({ zoom, onZoom });
  useEffect(() => { live.current = { zoom, onZoom }; });

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !onZoom) return undefined;
    const wheel = (e) => {
      if (e.deltaY === 0) return;
      e.preventDefault();
      const plan = planRef.current.getBoundingClientRect();
      anchor.current = { fx: (e.clientX - plan.left) / plan.width, fy: (e.clientY - plan.top) / plan.height, cx: e.clientX, cy: e.clientY };
      const step = Math.exp(-Math.max(-120, Math.min(120, e.deltaY)) * 0.0025);
      live.current.onZoom(live.current.zoom * step);
    };
    let drag = null;
    const down = (e) => {
      if (e.button !== 0 || live.current.zoom <= 1) return;
      drag = { x: e.clientX, y: e.clientY, sl: stage.scrollLeft, st: stage.scrollTop, moved: false };
    };
    const move = (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      if (!drag.moved) { drag.moved = true; stage.classList.add('panning'); }
      stage.scrollLeft = drag.sl - dx; stage.scrollTop = drag.st - dy;
    };
    const up = () => {
      if (drag?.moved) {
        // swallow the click that ends a drag
        const stop = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
        stage.addEventListener('click', stop, { capture: true, once: true });
        setTimeout(() => stage.removeEventListener('click', stop, { capture: true }), 0);
      }
      stage.classList.remove('panning');
      drag = null;
    };
    stage.addEventListener('wheel', wheel, { passive: false });
    stage.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      stage.removeEventListener('wheel', wheel);
      stage.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [stageRef, planRef, onZoom ? 1 : 0]); // eslint-disable-line react-hooks/exhaustive-deps -- handlers read the live zoom from a ref

  // after the plan has its new size, scroll so the point under the pointer stays put
  useLayoutEffect(() => {
    const a = anchor.current, stage = stageRef.current, plan = planRef.current;
    if (!a || !stage || !plan) return;
    anchor.current = null;
    const r = plan.getBoundingClientRect();
    stage.scrollLeft += r.left + a.fx * r.width - a.cx;
    stage.scrollTop += r.top + a.fy * r.height - a.cy;
  }, [zoom, stageRef, planRef]);
}

export default function FloorCanvas({ floor, lm, zoom = 1, onZoom = null, shopCode = null, onPick, focus = null }) {
  const stageRef = useRef(null);
  const planRef = useRef(null);
  useMouseZoom(stageRef, planRef, zoom, onZoom);
  const key = codeKey(floor.shops.map(s => s.code));
  return (
    <div className="bk-stagewrap">
    <div ref={stageRef} className={`bk-stage${onZoom && zoom > 1 ? ' can-pan' : ''}`} title={onZoom ? 'Scroll to zoom, drag to move' : undefined}>
      {/* The plan keeps the drawing's shape; every tile sits at its box's
          own position and size, as a percentage of it. */}
      <div ref={planRef} className={`bk-plan${focus ? ' has-focus' : ''}`} style={{ '--asp': floor.aspect, '--z': zoom }}>
        {lm.hull && <div className="bk-hull-wrap" aria-hidden="true"><div className="bk-hull" style={{ clipPath: lm.hull }} /></div>}
        {lm.marks.map((m, i) => (
          <div key={i} className={`bk-mark k-${m.kind}`} aria-hidden="true"
            style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%`, width: `${m.w * 100}%`, height: `${m.h * 100}%`, ...(m.clip ? { clipPath: `polygon(${m.clip.map(([x, y]) => `${x * 100}% ${y * 100}%`).join(', ')})` } : null) }}>
            {m.label && <span>{m.label}</span>}
          </div>
        ))}
        {floor.shops.map(s => {
          // Tile height measured in plan widths, so "room for a second
          // line" does not depend on the drawing's aspect ratio.
          const hw = s.h / floor.aspect;
          return (
            <button key={s.code} type="button" className={`bk-cell s-${s.status}${s.w >= 0.3 && s.shape ? " big" : ""}`} data-unit={s.shape && /^[AB][0-9]/.test(s.code) ? String(s.code).charAt(0) : undefined} aria-pressed={shopCode === s.code} data-custom={s.look.color ? 'true' : undefined} data-focus={focus === s.code ? 'true' : undefined}
              style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%`, width: `${s.w * 100}%`, height: `${s.h * 100}%`, ...(s.look.color ? { '--bk-c': s.look.color } : null), ...codeFit(s), ...(s.shape ? { clipPath: `polygon(${s.shape.map(([x, y]) => `${x * 100}% ${y * 100}%`).join(', ')})` } : null) }}
              onClick={() => onPick?.(s.code)}
              aria-label={`${s.code}, ${s.size} sq ft${s.beds ? `, ${s.beds} beds` : ''}, ${s.look.label}`}>
              {s.shape && <svg className="bk-shape" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon points={s.shape.map(([x, y]) => `${x * 100},${y * 100}`).join(' ')} /></svg>}
              <span className="bk-cell-id">{shortCode(s.code)}</span>
              {hw >= 0.05 && <span className="bk-cell-m">{s.size}{s.w >= 0.075 ? " sft" : ""}</span>}
              {hw >= 0.085 && s.w >= 0.085 && <span className="bk-cell-p">{s.status === 'available' ? (takaShort(s.price) || (s.size ? `${s.size} sft` : '')) : s.look.label}</span>}
            </button>
          );
        })}
      </div>
    </div>
    {/* what the short unit codes on the tiles stand for; stays in the corner while the plan zooms and scrolls */}
    {key.length > 0 && (
      <dl className="bk-codekey" aria-label="Unit codes">
        {key.map(k => <div key={k.code}><dt>{k.code}</dt><dd>= {k.name}</dd></div>)}
      </dl>
    )}
    </div>
  );
}
