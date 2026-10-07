import { useLayoutEffect, useRef } from 'react';
import { Mascot } from 'page-mascot';
import useMediaQuery from '../hooks/useMediaQuery.js';

// Header height (--hh) less its 1px bottom border: the fox stands on that line.
const SIZE = 56;

// The fox in the header (page-mascot): it turns its head to follow the cursor
// and reacts when poked. It stands on the header's bottom edge, lined up with
// the left edge of the page content below it. That edge moves with the window
// width, the sidebar (docked / collapsed) and the view (Pipeline and
// Conversations use the full width), so it is measured rather than mirrored in
// CSS, and written straight to the element — no re-render per resize. While
// the show-sidebar button is in the header, the fox keeps clear of it.
// Below 768px the header has no room for it.
export default function HeaderMascot() {
  const ref = useRef(null);
  const show = useMediaQuery('(min-width: 768px)');

  useLayoutEffect(() => {
    if (!show) return;
    const el = ref.current;
    const head = el?.parentElement;
    const body = document.querySelector('.pg-body');
    const inner = document.querySelector('.pg-inner');
    if (!el || !head || !inner) return;
    const place = () => {
      const h = head.getBoundingClientRect();
      let x = inner.getBoundingClientRect().left - h.left;
      const ham = head.querySelector('.ham');
      if (ham && getComputedStyle(ham).display !== 'none') x = Math.max(x, ham.getBoundingClientRect().right - h.left + 12);
      el.style.left = `${Math.round(x)}px`;
      el.style.visibility = 'visible';
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(inner);
    if (body) ro.observe(body);
    window.addEventListener('resize', place);
    return () => { ro.disconnect(); window.removeEventListener('resize', place); };
  }, [show]);

  if (!show) return null;
  return (
    <div ref={ref} className="pg-mascot">
      <Mascot
        directions="/mascots/fox-directions.webp"
        reactions="/mascots/fox-reactions.webp"
        size={SIZE}
        label="fox"
      />
    </div>
  );
}
