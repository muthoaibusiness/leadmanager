import { useEffect, useState } from 'react';
import { subscribe } from '../lib/netActivity.js';

// One indicator for "the app is fetching something", pinned to the top of the
// viewport. Driven by the in-flight request count (netActivity.js), so it needs
// no cooperation from the view that triggered the request — which is the point:
// nearly every screen fetches now, and threading a flag through all of them is
// not possible without restructuring their hooks.
//
// Two timings keep it from being noise:
//   DELAY  a request that resolves quickly never shows a bar at all. Most cached
//          or counted reads land inside this window, so the UI stays still.
//   MIN    once shown, it stays up briefly even if the request finishes at once,
//          because a bar that flashes for 30ms reads as a glitch.
const DELAY = 180;
const MIN = 320;

export default function GlobalLoadingBar() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let showTimer = null;
    let hideTimer = null;
    let shownAt = 0;

    const unsub = subscribe(n => {
      if (n > 0) {
        clearTimeout(hideTimer);
        hideTimer = null;
        if (!showTimer && !shownAt) {
          showTimer = setTimeout(() => {
            showTimer = null;
            shownAt = Date.now();
            setVisible(true);
          }, DELAY);
        }
        return;
      }
      // Nothing in flight.
      if (showTimer) { clearTimeout(showTimer); showTimer = null; return; } // never shown
      if (!shownAt) return;
      const left = Math.max(0, MIN - (Date.now() - shownAt));
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => { shownAt = 0; setVisible(false); }, left);
    });

    return () => { unsub(); clearTimeout(showTimer); clearTimeout(hideTimer); };
  }, []);

  if (!visible) return null;
  return <span className="spin-bar spin-bar-fixed" role="status" aria-label="Loading" />;
}
