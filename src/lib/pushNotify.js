// Browser push-notification service for real-time CRM notifications.
// Foreground (tab running) notifications via the Notification API — fed by the
// existing Supabase realtime channel (no polling, no extra backend).

const _seen = new Set(); // de-dupe by notification id

// Ask for permission (call on login). Safe no-op if unsupported/denied.
export function requestNotifyPermission() {
  try {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  } catch { /* ignore */ }
}

// Short two-tone ping via WebAudio (no asset file needed).
let _actx;
function ping() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    _actx = _actx || new AC();
    if (_actx.state === 'suspended') _actx.resume();
    const t = _actx.currentTime;
    const o = _actx.createOscillator();
    const g = _actx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(880, t);
    o.frequency.setValueAtTime(1320, t + 0.09);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    o.connect(g); g.connect(_actx.destination);
    o.start(t); o.stop(t + 0.35);
  } catch { /* autoplay may be blocked until first interaction */ }
}

// Show a browser push for a new notification.
// opts.suppress  → user is actively viewing the notifications panel → skip the OS popup
// opts.onClick(n) → invoked when the popup is clicked (after focusing the tab)
export function pushNotify(n, opts = {}) {
  if (!n || n.id == null) return;
  if (_seen.has(n.id)) return;            // prevent duplicates
  _seen.add(n.id);
  if (_seen.size > 500) _seen.clear();

  ping(); // sound on every (non-duplicate) arrival

  if (opts.suppress) return;              // don't pop if already looking at it

  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const notif = new Notification('CRM Notification', {
      body: n.message || 'New notification',
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      tag: String(n.id),                  // collapses repeats of the same id
      renotify: false,
    });
    notif.onclick = () => {
      try { window.focus(); } catch { /* ignore */ }
      notif.close();
      if (opts.onClick) opts.onClick(n);
    };
  } catch { /* ignore */ }
}
