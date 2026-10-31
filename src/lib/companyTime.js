// Wall-clock times in the company's time zone, independent of the browser's.
//
// A customer-requested follow-up ("call me Sunday at 3 PM") is a time in the
// company's zone. A browser elsewhere, or set to another zone, must not shift
// it. companies has no time-zone column yet, so the zone defaults to Dhaka
// (the n8n workflows already run on Asia/Dhaka); a company row that gains a
// `timeZone` later is honoured without a code change.
export const DEFAULT_TZ = 'Asia/Dhaka';

const validZone = (tz) => {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
};

export function companyTimeZone(company) {
  const tz = company?.timeZone;
  return tz && validZone(tz) ? tz : DEFAULT_TZ;
}

// The zone's offset from UTC, in ms, at a given instant.
function offsetMs(instant, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instant));
  const v = Object.fromEntries(parts.map(p => [p.type, p.value]));
  const asUtc = Date.UTC(+v.year, +v.month - 1, +v.day, +v.hour, +v.minute, +v.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

// 'YYYY-MM-DDTHH:MM' (a datetime-local value) read in `tz` → toISOString() form.
export function zonedToUtcIso(local, tz) {
  const m = LOCAL.exec(local || '');
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const check = new Date(guess);
  // Rejects dates that roll over (Feb 31) and out-of-range hours.
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || check.getUTCHours() !== h) return null;
  // Two passes settle the offset across a DST edge; Dhaka and Dubai have none.
  let t = guess - offsetMs(guess, tz);
  t = guess - offsetMs(t, tz);
  return new Date(t).toISOString();
}

// True when the instant is more than a minute in the past (a minute of slack,
// so "In 1 hour" picked at :59 is not refused).
export function isPast(iso, now = Date.now()) {
  const t = Date.parse(iso);
  return Number.isFinite(t) && t < now - 60_000;
}

// An instant → the 'YYYY-MM-DDTHH:MM' wall-clock value in `tz`.
export function utcIsoToZoned(iso, tz) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const local = new Date(t + offsetMs(t, tz));
  return local.toISOString().slice(0, 16);
}
