import { useEffect, useRef } from 'react';

// Counts up from the last shown value to `to` (from 0 on first show). The DOM
// is written directly, so the data and React state never hold a partial value,
// and a rerender with the same `to` does not restart it.
export default function useCountUp(to, ms = 700) {
  const ref = useRef(null);
  const shown = useRef(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || !Number.isFinite(to)) return undefined;
    const from = shown.current;
    const still = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (still || from === to) { el.textContent = String(to); shown.current = to; return undefined; }
    let raf = 0;
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      const v = Math.round(from + (to - from) * (1 - (1 - k) ** 3));
      el.textContent = String(v); shown.current = v;
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); el.textContent = String(to); shown.current = to; };
  }, [to, ms]);
  return ref;
}
