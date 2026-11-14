// How long a notification is kept. The same rule runs nightly in the database
// (migration 0065, notif_purge) and here on the browser's cached copy: the cache
// has no tombstones, so without this a row the server deleted would stay in a
// browser's bell forever.
export const READ_TTL_DAYS = 30;
export const UNREAD_TTL_DAYS = 90;
// Newest rows kept per user in the cache; the bell shows 50 of them.
export const LOCAL_CAP = 200;

const DAY = 24 * 60 * 60 * 1000;

// A row with no readable time is kept: never drop what can't be dated.
export function keepNotif(n, now = Date.now()) {
  const t = Date.parse(n?.timestamp);
  if (!Number.isFinite(t)) return true;
  return now - t <= (n.read ? READ_TTL_DAYS : UNREAD_TTL_DAYS) * DAY;
}

export function pruneNotifList(list, now = Date.now()) {
  return (list || [])
    .filter((n) => n && keepNotif(n, now))
    .sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0))
    .slice(0, LOCAL_CAP);
}
