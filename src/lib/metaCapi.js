// Browser side of Admin › Meta CAPI. Every call goes to the meta-capi Edge
// Function with the signed-in CRM user's id; the server allows it only for
// Management, Master or a 'metacapi' grant, and never returns the Meta token.
// Sending, the bot switches and settings are refused server-side until the
// CRM has a verified sign-in (CR-001 D1); this file decides nothing.
import { SB_URL, SB_KEY } from './supabase.js';

export const CAPI_URL = `${SB_URL}/functions/v1/meta-capi`;

export async function capiCall(user, action, payload = {}) {
  let r;
  try {
    r = await fetch(CAPI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
      body: JSON.stringify({ action, payload, userId: user?.id }),
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

// UTC instant → text in the chosen zone. Missing means it was never recorded.
export const fmtTime = (iso, tz) => {
  if (!iso) return 'Not recorded';
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
      + (tz === 'UTC' ? ' UTC' : '');
  } catch { return iso; }
};
