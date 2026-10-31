// Prospect contact performance, for Home's tracker card (dashboards/ContactTracker).
//
// Counts updates, not prospects: every status change and every follow-up any
// person logged on a prospect in the window adds 1, so two updates on one
// prospect add 2. Prospects sitting in New now are left out entirely.
//
// The updates are the activities rows db.js writes:
//   STATUS_CHANGE  changeStatus, setMeeting, schedVisit, doneVisit
//   DEAL           closeDealFn, markLostFn (won / lost)
//   FOLLOW_UP      setFollowUpFn, setFollowUpAt, clearFollowup,
//                  rescheduleMeeting, logNoAnswer (its scheduled retry)
// Only rows written by a person count, never the system's.
//
// "No Answer" is not a status: logNoAnswer leaves the lead in New, so a New
// lead's unanswered calls and their follow-ups are not counted.
//
// Updates come from two places, merged by activity id: the tracker's own light
// cloud load (db.js loadLeadUpdates) and whatever db.activities holds (the
// activity window, realtime, this browser's own writes), which keeps it live.

export const COUNTED = new Set(['STATUS_CHANGE', 'DEAL', 'FOLLOW_UP']);
const HOUR = 36e5;
// An update stamped a little ahead of this browser's clock (another device's
// clock) still lands in the latest bucket.
const SKEW = 10 * 60e3;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Default first. `span` names the previous window in the change label.
export const CONTACT_PERIODS = [
  { label: 'Past 24 hours', hours: 24, span: '24 hours' },
  { label: 'Past 7 days', days: 7, span: '7 days' },
  { label: 'Past 14 days', days: 14, span: '14 days' },
  { label: 'Past 30 days', days: 30, span: '30 days' },
];

// [start, end) of each bucket, oldest first: the exact last N hours ending
// now (rolling, so "Past 24 hours" is 24 hours to the minute), or whole local
// days ending today.
function buckets(period, now) {
  const out = [];
  if (period.hours) {
    const s0 = now - period.hours * HOUR;
    for (let i = 0; i < period.hours; i++) out.push([s0 + i * HOUR, s0 + (i + 1) * HOUR]);
  } else {
    const d = new Date(now); d.setHours(0, 0, 0, 0);
    for (let i = period.days - 1; i >= 0; i--) {
      const s = new Date(d); s.setDate(d.getDate() - i);
      const e = new Date(s); e.setDate(s.getDate() + 1);
      out.push([s.getTime(), e.getTime()]);
    }
  }
  return out;
}

// The period's [start, end) and the start of the equal period just before it.
// Shared with the Home lead-source card (lib/sourceMix.js).
export function periodRange(period, now = Date.now()) {
  const bs = buckets(period, now);
  const start = bs[0][0];
  const end = bs[bs.length - 1][1];
  return { start, end, prevStart: start - (end - start) };
}

// Start of the equal window just before the period: what a load must cover.
export function periodSince(period, now = Date.now()) {
  return new Date(periodRange(period, now).prevStart).toISOString();
}

// db.activities ({ leadId: [activity] }) → its counted updates, as flat rows.
export function updatesFromActs(activities) {
  const out = [];
  for (const [leadId, acts] of Object.entries(activities || {})) {
    for (const a of acts || []) {
      if (a && COUNTED.has(a.type)) out.push({ id: a.id, leadId, type: a.type, userId: a.userId, timestamp: a.timestamp, companyId: a.companyId ?? null });
    }
  }
  return out;
}
const pad2 = (n) => String(n).padStart(2, '0');
const hhmm = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
function bucketLabel([s, e], period) {
  const d = new Date(s);
  const day = `${d.getDate()} ${MON[d.getMonth()]}`;
  return period.hours ? `${day}, ${hhmm(d)}–${hhmm(new Date(e))}` : day;
}

// updates: [{ id, leadId, type, userId, timestamp, companyId }], duplicates
// (same id) allowed.
// companyId: when set, drops updates stamped with another company.
// leadStatus: Map leadId → current status; a lead in it that is NEW now is
//   left out. A lead it lacks is kept.
// Returns one point per bucket ({ value, date }: that bucket's update count),
// the updates across the whole period (`total`) and in the equal period just
// before it (`prevTotal`).
export function contactPerf(updates, period, { companyId = null, leadStatus = null, now = Date.now() } = {}) {
  const bs = buckets(period, now);
  const start = bs[0][0];
  const end = bs[bs.length - 1][1];
  const prevStart = start - (end - start);
  const perBucket = bs.map(() => 0);
  let total = 0;
  let prevTotal = 0;
  const seen = new Set();
  for (const u of updates || []) {
    if (!u || !COUNTED.has(u.type) || !u.userId || u.userId === 'system') continue;
    if (u.id != null) { if (seen.has(u.id)) continue; seen.add(u.id); }
    if (companyId && u.companyId && u.companyId !== companyId) continue;
    if (leadStatus && leadStatus.get(u.leadId) === 'NEW') continue;
    const t = new Date(u.timestamp).getTime();
    if (!(t >= prevStart && t < end + SKEW)) continue;
    if (t < start) { prevTotal++; continue; }
    const i = t >= end ? bs.length - 1 : period.hours ? Math.floor((t - start) / HOUR) : bs.findIndex(([s, e]) => t >= s && t < e);
    if (i < 0 || i >= bs.length) continue;
    perBucket[i]++;
    total++;
  }
  return {
    points: bs.map((b, i) => ({ value: perBucket[i], date: bucketLabel(b, period) })),
    total,
    prevTotal,
  };
}
