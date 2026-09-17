// Browser push-notification service.
//
// Deliberately quiet: individual notifications no longer raise an OS popup —
// they only land in the in-app bell. The single push this app sends is a
// startup summary ("N unread notifications"), fired once per page load after
// the user's data has hydrated.

let _summaryShown = false; // one summary per page load

// Ask for permission (call on login). Safe no-op if unsupported.
// Resolves with the resulting permission string ('granted' | 'denied' | 'default').
export function requestNotifyPermission() {
  try {
    if (typeof Notification === 'undefined') return Promise.resolve('denied');
    if (Notification.permission === 'default') {
      return Notification.requestPermission().catch(() => 'denied');
    }
    return Promise.resolve(Notification.permission);
  } catch {
    return Promise.resolve('denied');
  }
}

// Show a single startup push with the total unread count.
// Silent no-op when the count is zero, when a summary already fired this page
// load, or when permission was never granted.
// opts.onClick() → invoked when the popup is clicked (after focusing the tab)
export async function pushUnreadSummary(count, opts = {}) {
  if (_summaryShown) return;
  if (!count || count < 1) return;

  try {
    if (typeof Notification === 'undefined') return;
    // The login flow requests permission in parallel; wait for the answer so a
    // first-time user still gets their summary once they accept.
    const perm = await requestNotifyPermission();
    if (perm !== 'granted') return;
    if (_summaryShown) return; // a second entry point may have won the race
    _summaryShown = true;

    const notif = new Notification('CRM Notifications', {
      body: `You have ${count} unread notification${count === 1 ? '' : 's'}`,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      tag: 'crm-unread-summary', // collapses if the OS still shows an older one
      renotify: false,
      silent: true, // visual only — no OS notification sound
    });
    notif.onclick = () => {
      try { window.focus(); } catch { /* ignore */ }
      notif.close();
      if (opts.onClick) opts.onClick();
    };
  } catch { /* ignore */ }
}

// ── Instant push for a single inbound chat message ──────────────────────────
// CRM notifications stay quiet (see above), but a WhatsApp message arriving
// while the agent is elsewhere is worth an immediate ping + popup.

const _seen = new Set(); // de-dupe by notification id

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

// opts.suppress   → user is already looking at this thread → sound only, no popup
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
