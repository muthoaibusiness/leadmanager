import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import Mi from '../Mi.jsx';
import { paginateDoc } from '../../lib/finance.js';

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
//   fit="contain" (editor preview) one whole page, scaled to fit the box, with
//                 Page 1 of n buttons when there are more. Nothing scrolls.
const PAGE_W = 794; // A4 width in CSS px (210 mm at 96 dpi)
const PAGER_H = 40; // room under the page for the pager

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
  const box = useRef(null);
  const contain = fit === 'contain';
  const [geo, setGeo] = useState(null);
  const [area, setArea] = useState(null); // the box the pages are fitted to
  const [at, setAt] = useState(0); // contain: the page shown

  // Paginate the frame's document. A frame loaded while hidden (the phone's
  // Edit pane) has no layout yet; paginateDoc then returns 0 and this runs
  // again once the box has a size.
  const layout = () => {
    const d = frame.current?.contentDocument;
    if (d && paginateDoc(d)) setGeo(measure(d));
  };
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setArea({ w: width, h: height });
      layout();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useImperativeHandle(ref, () => ({
    print: () => {
      const win = frame.current?.contentWindow;
      if (!win) return false;
      win.focus();
      win.print();
      return true;
    },
  }), []);

  const frameEl = (style) => <iframe ref={frame} className="fin-docframe" title={title} srcDoc={html} onLoad={layout} sandbox="allow-same-origin allow-modals" style={style} />;
  const ready = geo && area && area.w > 0;

  if (!contain) {
    const s = ready ? Math.min(area.w / PAGE_W, 1) : 0;
    return (
      <div ref={box} className="fin-docpages">
        <div className="fin-docpages-in" style={{ width: Math.floor(PAGE_W * s) || '100%', height: ready ? Math.ceil(geo.h * s) : 1123, visibility: s ? 'visible' : 'hidden' }}>
          {frameEl({ width: PAGE_W, height: geo?.h || 1123, transform: `scale(${s || 1})` })}
        </div>
      </div>
    );
  }

  // One page at a time: the whole page, scaled down until it fits (never up).
  const n = geo?.pages || 1;
  const k = Math.min(at, n - 1);
  const room = ready ? { w: area.w, h: area.h - (n > 1 ? PAGER_H : 0) } : null;
  const s = room && room.h > 0 ? Math.min(room.w / PAGE_W, room.h / geo.pageH, 1) : 0;
  return (
    <div ref={box} className="fin-docfit">
      <div className="fin-docfit-page" style={{ width: Math.floor(PAGE_W * s), height: Math.floor((geo?.pageH || 1123) * s), visibility: s ? 'visible' : 'hidden' }}>
        {frameEl({ width: PAGE_W, height: geo?.h || 1123, transform: `scale(${s || 0.0001}) translateY(${-k * (geo?.step || 0)}px)` })}
      </div>
      {n > 1 && (
        <div className="fin-pager" role="group" aria-label="Preview pages">
          <button type="button" className="fin-pager-b" onClick={() => setAt(Math.max(0, k - 1))} disabled={k === 0} aria-label="Previous page"><Mi>chevron_left</Mi></button>
          <span aria-live="polite">Page {k + 1} of {n}</span>
          <button type="button" className="fin-pager-b" onClick={() => setAt(Math.min(n - 1, k + 1))} disabled={k === n - 1} aria-label="Next page"><Mi>chevron_right</Mi></button>
        </div>
      )}
    </div>
  );
}
