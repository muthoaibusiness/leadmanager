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
