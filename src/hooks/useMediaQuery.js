import { useCallback, useSyncExternalStore } from 'react';

// Live answer to a CSS media query, e.g. useMediaQuery('(max-width: 1023px)').
// useSyncExternalStore reads it during render, so the first paint already has
// the right value (no effect that corrects it a frame later), and re-renders
// the caller whenever the query starts or stops matching.
export default function useMediaQuery(query) {
  const subscribe = useCallback((onChange) => {
    const mq = window.matchMedia(query);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}
