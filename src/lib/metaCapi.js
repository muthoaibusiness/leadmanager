// Browser side of Admin › Meta CAPI. Every call goes to the meta-capi Edge
// Function with the signed-in user's Supabase Auth session (bearer()); the
// server allows it only for Management, Master or a 'metacapi' grant, and
// never returns the Meta token. Sending, the bot switches and settings stay
// refused server-side until they are separately approved (CR-001 D1); this
// file decides nothing.
import { SB_URL, SB_KEY, bearer, ensureFreshToken } from './supabase.js';

export const CAPI_URL = `${SB_URL}/functions/v1/meta-capi`;

export async function capiCall(user, action, payload = {}) {
  let r;
  try {
    await ensureFreshToken(); r = await fetch(CAPI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SB_KEY, Authorization: bearer() },
      body: JSON.stringify({ action, payload }),
    });
  } catch {
    throw Object.assign(new Error('Could not reach the Meta CAPI service. It may not be deployed yet.'), { code: 'network' });
  }
  let j = null;
  try { j = await r.json(); } catch { /* not JSON */ }
  if (!r.ok || !j?.ok) throw Object.assign(new Error(j?.error?.message || `Request failed (HTTP ${r.status})`), { status: r.status });
  return j.data;
}

// Lead reporting status (one per lead) — distinct from an attempt's outcome.
export const CAPI_TABS = [
  ['all', 'All'], ['success', 'Success'], ['failed', 'Failed'], ['pending', 'Pending'], ['expired', 'Expired'], ['ineligible', 'Ineligible'],
];
export const STATUS_HINT = {
  success: 'Meta confirmed the event (or it was reported before this log existed).',
  failed: 'Tried, not confirmed by Meta yet. Still inside the 7-day window.',
  pending: 'Not tried yet. Still inside the 7-day window.',
  expired: 'Older than 7 days and never confirmed: Meta no longer accepts it.',
  ineligible: 'Nothing to report: no Meta click id (ctwa_clid), or no agent has marked it Connected or Interested.',
};
export const OUTCOME_LABEL = {
  accepted: 'Accepted', rejected: 'Rejected', timeout: 'Timed out', network: 'No connection', ambiguous: 'No clear answer', skipped: 'Skipped', rate_limited: 'Rate limited by Meta',
};
export const RESULT_LABEL = {
  accepted: 'Accepted by Meta', rejected: 'Rejected by Meta', timeout: 'Timed out', network: 'No connection', ambiguous: 'Meta gave no clear answer',
  skipped_already_reported: 'Skipped: already reported', skipped_expired: 'Skipped: past 7 days', skipped_ineligible: 'Skipped: not eligible',
  skipped_locked: 'Skipped: another send in progress', skipped_unsure: 'Held: an earlier send got no clear answer',
  rate_limited: 'Rate limited: still queued, not sent',
};

// Both clocks at once, for audit views: the stored UTC instant and Dhaka time.
export const fmtBoth = (iso) => (iso ? `${fmtTime(iso, 'UTC')} (Dhaka ${fmtTime(iso, 'Asia/Dhaka')})` : 'Not recorded');

// UTC instant → "29 Oct 2026, 4:43 PM" in the chosen zone (12-hour, AM/PM).
// Only the display changes; the stored value stays the UTC instant. Missing
// means it was never recorded.
export const fmtTime = (iso, tz) => {
  if (!iso) return 'Not recorded';
  try {
    const d = new Date(iso);
    const day = new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short', year: 'numeric' }).format(d);
    const time = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
    return `${day}, ${time}${tz === 'UTC' ? ' UTC' : ''}`;
  } catch { return iso; }
};

// Rows per page of the lead list.
export const CAPI_PAGE = 50;

// Why a row cannot be ticked for sending, shown in the row itself ('' = it can).
export function blockedWhy(r, canAct) {
  if (r.status === 'success') return 'Already reported';
  if (r.status === 'expired') return 'Past 7 days';
  if (r.status === 'ineligible') return r.has_clid ? 'No agent action' : 'No click id';
  if (r.unsure) return 'Unclear earlier answer';
  if (!canAct) return 'View only';
  return '';
}

// Who may delete leads, the rule LeadPanel and LeadTable already apply
// (Management or Master). Deleting goes through db.js bulkDeleteLeads.
export const canDeleteLeads = (user) => user?.role === 'MANAGEMENT' || user?.role === 'MASTER';
