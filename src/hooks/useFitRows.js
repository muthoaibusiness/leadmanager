import { useLayoutEffect } from 'react';

// Sizes a list's rows so a page of `rows` fills the screen with no page scrolling, whatever the
// layout (sidebar, rail, topbar, dock; phone bottom bar) or design: it measures what really sits
// above the first row and below the last (pager, page padding, the space a bottom bar reserves)
// inside the element that scrolls the page, and sets `--lt-row` on the card to share the rest.
// The CSS values for --lt-row stay as the first-paint fallback.

const px = (v) => parseFloat(v) || 0;

// The nearest ancestor that scrolls vertically, else the document.
function scrollerOf(el) {
  for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
    const o = getComputedStyle(a).overflowY;
    if (o === 'auto' || o === 'scroll' || o === 'overlay') return a;
  }
  return document.scrollingElement || document.documentElement;
}

// Everything laid out after `el` up to the scroller's content edge: the margins, following
// in-flow siblings and bottom padding/borders of each ancestor in between.
function spaceBelow(el, scroller) {
  let total = 0;
  for (let e = el; e && e !== scroller && e !== document.body; e = e.parentElement) {
    const cs = getComputedStyle(e);
    total += px(cs.marginBottom);
    for (let s = e.nextElementSibling; s; s = s.nextElementSibling) {
      const ss = getComputedStyle(s);
      if (ss.position === 'fixed' || ss.position === 'absolute' || ss.display === 'none') continue;
      total += s.getBoundingClientRect().height + px(ss.marginTop) + px(ss.marginBottom);
    }
    const p = e.parentElement;
    if (p && p !== scroller) { const ps = getComputedStyle(p); total += px(ps.paddingBottom) + px(ps.borderBottomWidth); }
  }
  if (scroller !== document.scrollingElement && scroller !== document.documentElement) total += px(getComputedStyle(scroller).paddingBottom);
  else total += px(getComputedStyle(document.body).paddingBottom) + px(getComputedStyle(document.body).marginBottom);
  return total;
}

export default function useFitRows(ref, rows, deps = [], { min = 24, max = 76 } = {}) {
  useLayoutEffect(() => {
    const card = ref.current;
    if (!card) return undefined;
    let raf = 0;
    // the value last set; a layout may pad its rows, so each pass corrects by what a row really measures
    let cur = px(card.style.getPropertyValue('--lt-row')) || null;
    const fit = () => {
      const body = card.querySelector('tbody');
      if (!body || !body.rows.length) return;
      const scroller = scrollerOf(card);
      const doc = scroller === document.scrollingElement || scroller === document.documentElement;
      const top = doc ? 0 : scroller.getBoundingClientRect().top + px(getComputedStyle(scroller).borderTopWidth);
      const view = doc ? window.innerHeight : scroller.clientHeight;
      const r = body.getBoundingClientRect();
      const above = r.top - top + scroller.scrollTop;
      const below = (card.getBoundingClientRect().bottom - r.bottom) + spaceBelow(card, scroller);
      const target = (view - above - below) / rows;       // what one row may take, border and padding included
      const actual = r.height / body.rows.length;          // what one row takes now
      const next = cur == null ? Math.floor(target) - 1 : cur + Math.floor(target - actual);
      const h = Math.max(min, Math.min(max, next));
      if (h !== cur) { cur = h; card.style.setProperty('--lt-row', `${h}px`); }
    };
    const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fit); };
    fit();
    schedule(); // once more after fonts and the rows have settled
    window.addEventListener('resize', schedule);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    // the filters above can wrap to a second line, and the pager can change height
    if (ro) { ro.observe(card); if (card.parentElement) ro.observe(card.parentElement); }
    document.fonts?.ready?.then(schedule).catch(() => {});
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', schedule); ro?.disconnect(); };
  }, [ref, rows, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps -- deps are the caller's re-measure signals
}
