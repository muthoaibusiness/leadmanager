import { lazy } from 'react';

// A deploy replaces the hashed chunk files, so a tab opened before it can ask
// for one that no longer exists. Reload once to pick up the new build; a second
// failure within a minute is a real error and is let through.
const RELOAD_KEY = 'pcrm_chunk_reload';

export function retryChunk(load) {
  return () => load().catch((e) => {
    let last = 0;
    try { last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0; } catch { /* storage blocked */ }
    if (Date.now() - last < 60000) throw e;
    try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { /* storage blocked */ }
    window.location.reload();
    return new Promise(() => {}); // the reload takes over
  });
}

// React.lazy with the reload-once guard above.
export default function lazyChunk(load) {
  return lazy(retryChunk(load));
}
