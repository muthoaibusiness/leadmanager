// Where leads came from, for Home's lead-source card (dashboards/LeadSourcesCard).
// Leads are counted by when they were created: a period's mix is the leads
// created in it, by `source`, and its change compares that count with the equal
// period just before. "All time" is every lead the lead book holds, no change.
//
// Leads come from two places, merged by id: the card's own light cloud load
// for the period (db.js loadNewLeads, re-run every minute) and db.leads (the
// lead book, plus every lead realtime delivers), which keeps it live.
import { CONTACT_PERIODS, periodRange } from './contactPerf.js';

// Same periods as the contact tracker, plus all time. Default first.
export const SOURCE_PERIODS = [...CONTACT_PERIODS, { label: 'All time', all: true }];

// A lead stamped a little ahead of this browser's clock still counts as now.
const SKEW = 10 * 60e3;

// leads: [{ id, source, createdAt, companyId }], duplicates (same id) allowed;
// the first copy of a lead wins, so pass the freshest list first.
// companyId: when set, drops leads stamped with another company.
// Returns { counts: { sourceKey: n }, total, prevTotal } — prevTotal is null
// for all time. A lead without a source counts under 'UNKNOWN'.
export function leadSourceMix(leads, period, { now = Date.now(), companyId = null } = {}) {
  const counts = {};
  let total = 0;
  let prevTotal = 0;
  const seen = new Set();
  const range = period.all ? null : periodRange(period, now);
  for (const l of leads || []) {
    if (!l) continue;
    if (l.id != null) { if (seen.has(l.id)) continue; seen.add(l.id); }
    if (companyId && l.companyId && l.companyId !== companyId) continue;
    const t = new Date(l.createdAt).getTime();
    const inPeriod = !range || (t >= range.start && t < range.end + SKEW);
    if (inPeriod) {
      const k = l.source || 'UNKNOWN';
      counts[k] = (counts[k] || 0) + 1;
      total++;
    } else if (range && t >= range.prevStart && t < range.start) prevTotal++;
  }
  return { counts, total, prevTotal: range ? prevTotal : null };
}
