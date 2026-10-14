import { useEffect, useImperativeHandle, useRef, useState } from 'react';

// The in-app frame for a finance document: the editor's live preview, the
// statement view and Print / PDF. The page comes from renderStatement() — the
// renderer behind the public share page too — so what is previewed is what
// prints and what the link shows.
//
// Sandboxed: nothing in the page runs. allow-same-origin lets this component
// read the page height and call print; allow-modals lets the frame open the
// print dialog.
//
// Two ways to size it:
//   fit="height"  (statement view) the frame is as tall as its page, so the
//                 surrounding panel scrolls, not the frame.
//   fit="contain" (editor preview) the page is laid out at A4 width and scaled
//                 down, keeping its proportions, until the whole page fits the
//                 box this fills. Nothing scrolls. The scaling is a CSS
//                 transform on the frame, so printing (which prints the frame's
//                 own document) keeps the real page size.
const PAGE_W = 794; // A4 width in CSS px (210 mm at 96 dpi)
const docHeight = (f) => Math.ceil(f?.contentDocument?.documentElement?.getBoundingClientRect().height || 0);
const fitHeight = (f) => { const h = docHeight(f); if (h) f.style.height = `${h}px`; };

export default function DocPreview({ html, title, ref, fit = 'height' }) {
  const frame = useRef(null);
  const box = useRef(null);
  const contain = fit === 'contain';
  const [page, setPage] = useState(0); // the page's own height at PAGE_W (contain)
  const [area, setArea] = useState(null); // the box the page must fit in (contain)

  // height: a new width (window resize, the phone Edit / Preview switch) reflows the page.
  useEffect(() => {
    const f = frame.current;
    if (contain || !f || typeof ResizeObserver === 'undefined') return undefined;
    let w = f.clientWidth;
    const ro = new ResizeObserver(() => { if (f.clientWidth !== w) { w = f.clientWidth; fitHeight(f); } });
    ro.observe(f);
    return () => ro.disconnect();
  }, [contain]);
  // contain: follow the box's size. A frame loaded while hidden (the phone's
  // Edit pane) has no layout yet, so its page is measured again once shown.
  useEffect(() => {
    const el = box.current;
    if (!contain || !el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setArea({ w: width, h: height });
      const h = docHeight(frame.current);
      if (h) setPage(h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [contain]);

  useImperativeHandle(ref, () => ({
    print: () => {
      const win = frame.current?.contentWindow;
      if (!win) return false;
      win.focus();
      win.print();
      return true;
    },
  }), []);

  const onLoad = (e) => {
    if (!contain) { fitHeight(e.currentTarget); return; }
    const h = docHeight(e.currentTarget);
    if (h) setPage(h);
  };
  const frameEl = (style) => <iframe ref={frame} className="fin-docframe" title={title} srcDoc={html} onLoad={onLoad} sandbox="allow-same-origin allow-modals" style={style} />;
  if (!contain) return frameEl(undefined);

  // Fit both ways, never enlarge past the real size.
  const s = area && page && area.w > 0 && area.h > 0 ? Math.min(area.w / PAGE_W, area.h / page, 1) : 0;
  return (
    <div ref={box} className="fin-docfit">
      <div className="fin-docfit-page" style={{ width: Math.floor(PAGE_W * s), height: Math.floor((page || 1) * s), visibility: s ? 'visible' : 'hidden' }}>
        {frameEl({ width: PAGE_W, height: page || 1123, transform: `scale(${s || 0.0001})` })}
      </div>
    </div>
  );
}
