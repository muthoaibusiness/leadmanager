import { useEffect, useRef, useState } from 'react';

// Counts a number up from its previous value (0 on first load) over `ms`, eased.
// Anyone who asked for reduced motion gets the number at once.
export default function useCountUp(value, ms = 700) {
  const target = Number.isFinite(value) ? value : 0;
  const [shown, setShown] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const start = from.current;
    if (reduce || start === target || typeof requestAnimationFrame !== 'function') {
      from.current = target;
      const id = setTimeout(() => setShown(target), 0);
      return () => clearTimeout(id);
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(start + (target - start) * eased));
      if (p < 1) raf = requestAnimationFrame(step);
      else from.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); from.current = target; };
  }, [target, ms]);

  return shown;
}
