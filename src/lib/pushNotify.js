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

// Show a browser push for a new notification.
// opts.suppress  → user is actively viewing the notifications panel → skip the OS popup
// opts.onClick(n) → invoked when the popup is clicked (after focusing the tab)
export function pushNotify(n, opts = {}) {
  if (!n || n.id == null) return;
  if (_seen.has(n.id)) return;            // prevent duplicates
  _seen.add(n.id);
  if (_seen.size > 500) _seen.clear();

  if (opts.suppress) return;              // don't pop if already looking at it

  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const notif = new Notification('CRM Notification', {
      body: n.message || 'New notification',
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      tag: String(n.id),                  // collapses repeats of the same id
      renotify: false,
      silent: true,                       // visual only — no OS notification sound
    });
    notif.onclick = () => {
      try { window.focus(); } catch { /* ignore */ }
      notif.close();
      if (opts.onClick) opts.onClick(n);
    };
  } catch { /* ignore */ }
}
