import { useEffect, useState } from 'react';
import { onUpdateReady, updateReady, applyUpdate } from '../lib/pwa.js';

// A new version of the app has downloaded but the launch window for switching
// on its own has passed (something was already tapped). Offer the switch
// instead of waiting for the next launch: a browser tab that is only ever
// reloaded, or a phone app kept open for days, would otherwise stay on the old
// version. Reloading is the user's choice, so no half-typed form is lost.
export default function UpdateBar() {
  const [ready, setReady] = useState(updateReady);
  const [busy, setBusy] = useState(false);
  useEffect(() => onUpdateReady(() => setReady(true)), []);
  if (!ready) return null;
  return (
    <div className="upd-bar" role="status">
      <span className="mi">system_update</span>
      <span>A new version of the app is ready.</span>
      <button type="button" className="upd-go" disabled={busy} onClick={() => { setBusy(true); applyUpdate(); }}>
        {busy ? 'Updating…' : 'Reload'}
      </button>
      <button type="button" className="upd-x" aria-label="Later" onClick={() => setReady(false)}>
        <span className="mi">close</span>
      </button>
    </div>
  );
}
