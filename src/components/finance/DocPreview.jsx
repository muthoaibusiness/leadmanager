import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import Mi from '../Mi.jsx';
import { paginateDoc } from '../../lib/finance.js';
import useMediaQuery from '../../hooks/useMediaQuery.js';

// The in-app frame for a finance document: the editor's live preview, the
// statement view and Print / PDF. The page comes from renderStatement() — the
// renderer behind the public share page too — and is spread over A4 pages by
// paginateDoc(), the same code the share page runs, so what is previewed is
// what prints and what the link shows, page for page.
//
// Sandboxed: nothing in the page runs. allow-same-origin lets this component
// paginate the page, read its size and call print; allow-modals lets the frame
// open the print dialog. Printing prints the frame's own, paginated document.
//
// The frame is always laid out at A4 width and only scaled (a CSS transform on
// the frame, never on the pages), so the pages keep their real layout:
//   fit="height"  (statement view) every page, one under the other, scaled to
//                 the panel's width; the panel scrolls.
//   fit="canvas"  (editor preview) a PDF-viewer canvas: every page, one under
//                 the other, on a scrolling grey sheet, with a toolbar to zoom
//                 (fit to page, fit to width, in / out, 100%; Ctrl+wheel too)
//                 and to step through the pages. On phones and tablets (the
//                 editor's Edit / Preview layout, COMPACT) it is a plain A4
//                 preview: always fit to page, no zoom; only the page
//                 navigation, when there is more than one page; and its grey
//                 frame ends under the last page instead of filling the pane.
const COMPACT = '(max-width: 979px)'; // same breakpoint as the editor's Edit / Preview tabs (finance.css)
const PAGE_W = 794; // A4 width in CSS px (210 mm at 96 dpi)
const PAD = 12; // canvas: room around the pages
const ZOOM_MIN = 0.25, ZOOM_MAX = 4, ZOOM_STEP = 1.25;
const clampZoom = (v) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(v * 100) / 100));

// The paginated document's geometry: page count, full height, one page's
// height and the distance from one page's top to the next.
function measure(d) {
  const pages = d?.querySelectorAll('.pg') || [];
  if (!pages.length) return null;
  const top = (el) => el.getBoundingClientRect().top;
  const pageH = pages[0].getBoundingClientRect().height;
  return {
    pages: pages.length,
    h: Math.ceil(d.documentElement.getBoundingClientRect().height),
    pageH,
    step: pages.length > 1 ? top(pages[1]) - top(pages[0]) : pageH,
  };
}

export default function DocPreview({ html, title, ref, fit = 'height' }) {
  const frame = useRef(null);
  const box = useRef(null); // the panel (height) or the scrolling sheet (canvas)
  const root = useRef(null); // canvas: toolbar + sheet
  const paged = useRef(false); // the loaded document is paginated
  const canvas = fit === 'canvas';
  const [geo, setGeo] = useState(null);
  const [area, setArea] = useState(null); // the box the pages are fitted to
  const [zoom, setZoom] = useState('page'); // canvas: 'page' | 'width' | a scale (1 = 100%)
  const [page, setPage] = useState(0); // canvas: the page at the middle of the view
  const compact = useMediaQuery(COMPACT) && canvas; // canvas on a phone / tablet: fit to page, no zoom

  // Paginate the frame's document. A frame loaded while hidden (the phone's
  // Edit pane) has no layout yet; paginateDoc then returns 0 and this runs
  // again once the box has a size.
  const layout = () => {
    const d = frame.current?.contentDocument;
    if (d && paginateDoc(d)) { paged.current = true; setGeo(measure(d)); }
  };
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    // compact: the canvas hugs its pages (finance.css), so its own height
    // follows them; the room to fit a page in is the pane it sits in.
    const pane = compact ? root.current?.parentElement : null;
    const ro = new ResizeObserver(([entry]) => {
      if (!canvas) setArea({ w: entry.contentRect.width, h: entry.contentRect.height });
      else if (pane) {
        const r = root.current, bar = r.querySelector('.fin-doctb')?.offsetHeight || 0;
        setArea({ w: el.clientWidth, h: pane.clientHeight - bar - (r.offsetHeight - r.clientHeight) });
      } else setArea({ w: el.clientWidth, h: el.clientHeight }); // inside the scrollbar gutter
      if (!paged.current) layout();
    });
    ro.observe(el);
    if (pane) ro.observe(pane);
    return () => ro.disconnect();
  }, [canvas, compact]);

  useImperativeHandle(ref, () => ({
    print: () => {
      const win = frame.current?.contentWindow;
      if (!win) return false;
      win.focus();
      win.print();
      return true;
    },
  }), []);

  const ready = geo && area && area.w > 0;
  const n = geo?.pages || 1;
  const cur = Math.min(page, n - 1);
  // canvas: the scale from the zoom (a fit follows the box's size)
  const fitW = ready ? (area.w - 2 * PAD) / PAGE_W : 0;
  const fitP = ready ? Math.min(fitW, (area.h - 2 * PAD) / geo.pageH) : 0;
  const s = !ready ? 0 : !canvas ? Math.min(area.w / PAGE_W, 1) : compact || zoom === 'page' ? fitP : zoom === 'width' ? fitW : zoom;
  const sRef = useRef(s); // for the wheel listener, which outlives a render
  useEffect(() => { sRef.current = s; }, [s]);

  // canvas: a new scale keeps what was at the middle of the view at the middle
  const prev = useRef(0);
  useLayoutEffect(() => {
    const el = box.current, p = prev.current;
    prev.current = s;
    if (!canvas || !el || !p || !s || p === s) return;
    const k = s / p, cw = el.clientWidth, ch = el.clientHeight;
    const off = (sc) => Math.max(0, (cw - PAGE_W * sc) / 2); // the pages are centred while narrower than the box
    el.scrollTop = (el.scrollTop + ch / 2 - PAD) * k + PAD - ch / 2;
    el.scrollLeft = (el.scrollLeft + cw / 2 - off(p)) * k + off(s) - cw / 2;
  }, [s, canvas]);
  // canvas: Ctrl / ⌘ + wheel zooms the pages instead of the app (not on phones / tablets)
  useEffect(() => {
    const el = box.current;
    if (!canvas || compact || !el) return undefined;
    const onWheel = (e) => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); setZoom(clampZoom(sRef.current * (e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP))); };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [canvas, compact]);

  const frameEl = <iframe ref={frame} className="fin-docframe" title={title} srcDoc={html} onLoad={() => { paged.current = false; layout(); }} sandbox="allow-same-origin allow-modals" style={{ width: PAGE_W, height: geo?.h || 1123, transform: `scale(${s || 1})` }} />;
  const sheet = (
    <div className="fin-docpages-in" style={{ width: Math.floor(PAGE_W * s) || '100%', height: ready ? Math.ceil(geo.h * s) : 1123, visibility: s ? 'visible' : 'hidden' }}>{frameEl}</div>
  );
  if (!canvas) return <div ref={box} className="fin-docpages">{sheet}</div>;

  const stepPx = geo ? geo.step * s : 0;
  const onScroll = () => {
    const el = box.current;
    if (!el || !stepPx) return;
    const k = Math.min(n - 1, Math.max(0, Math.floor((el.scrollTop + el.clientHeight / 2 - PAD) / stepPx)));
    if (k !== page) setPage(k);
  };
  const goTo = (k) => { if (box.current) box.current.scrollTop = k * stepPx; setPage(k); };
  const zoomTo = (v) => setZoom(clampZoom(v));
  const fitBtn = (mode, icon, label) => <button type="button" className={`fin-tb${zoom === mode ? ' on' : ''}`} aria-pressed={zoom === mode} onClick={() => setZoom(mode)} title={label} aria-label={label}><Mi>{icon}</Mi></button>;
  return (
    <div ref={root} className={`fin-doccanvas${compact ? ' compact' : ''}`}>
      {(!compact || n > 1) && <div className="fin-doctb" role="toolbar" aria-label="Preview">
        {!compact && <>
          <div className="g">
            <button type="button" className="fin-tb" onClick={() => zoomTo(s / ZOOM_STEP)} disabled={!ready || s <= ZOOM_MIN} title="Zoom out (Ctrl + wheel)" aria-label="Zoom out"><Mi>zoom_out</Mi></button>
            <span className="pct" aria-live="polite" aria-label="Zoom">{ready ? `${Math.round(s * 100)}%` : '—'}</span>
            <button type="button" className="fin-tb" onClick={() => zoomTo(s * ZOOM_STEP)} disabled={!ready || s >= ZOOM_MAX} title="Zoom in (Ctrl + wheel)" aria-label="Zoom in"><Mi>zoom_in</Mi></button>
          </div>
          <div className="g">
            {fitBtn('page', 'fit_page', 'Fit to page')}
            {fitBtn('width', 'fit_width', 'Fit to width')}
            {fitBtn(1, 'restart_alt', 'Reset zoom (100%)')}
          </div>
        </>}
        {n > 1 && (
          <div className="g nav" role="group" aria-label="Pages">
            <button type="button" className="fin-tb" onClick={() => goTo(cur - 1)} disabled={cur === 0} title="Previous page" aria-label="Previous page"><Mi>chevron_left</Mi></button>
            <span className="pg" aria-live="polite"><b>{cur + 1}</b> / {n}</span>
            <button type="button" className="fin-tb" onClick={() => goTo(cur + 1)} disabled={cur === n - 1} title="Next page" aria-label="Next page"><Mi>chevron_right</Mi></button>
          </div>
        )}
      </div>}
      <div ref={box} className="fin-doccanvas-s" onScroll={onScroll}>{sheet}</div>
    </div>
  );
}
