// lead_followups (migration 0066): row converters, reads, and the day buckets
// the Smart To-Do uses. Writes live in db.js (saveFollowUp / completeFollowUp /
// cancelFollowUp) with every other mutation.
//
// leads.next_followup stays the source the lists and counts query; this table
// adds what a follow-up is (type, purpose, note, reminder) and what came of it.
import { sbGet, hasColumn } from './supabase.js';
import { typeOf, purposeText, noteText } from './followupTypes.js';

export function rToF(r) {
  return {
    id: r.id, companyId: r.company_id ?? null, leadId: r.lead_id, ownerId: r.owner_id ?? null,
    createdBy: r.created_by ?? null, createdByName: r.created_by_name ?? '',
    type: r.type, purpose: r.purpose ?? null, purposeOther: r.purpose_other ?? '',
    projectId: r.project_id ?? null, projectName: r.project_name ?? '',
    dueAt: r.due_at, remindMin: r.remind_min, remindAt: r.remind_at ?? null,
    noteCode: r.note_code ?? null, note: r.note ?? '',
    status: r.status, source: r.source, remindedAt: r.reminded_at ?? null,
    doneAt: r.done_at ?? null, doneBy: r.done_by ?? null, outcome: r.outcome ?? '',
    cancelledAt: r.cancelled_at ?? null, cancelReason: r.cancel_reason ?? '',
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export function fToR(f) {
  return {
    id: f.id, company_id: f.companyId ?? null, lead_id: f.leadId, owner_id: f.ownerId ?? null,
    created_by: f.createdBy ?? null, created_by_name: f.createdByName ?? null,
    type: f.type, purpose: f.purpose || null, purpose_other: f.purpose === 'OTHER' ? f.purposeOther || null : null,
    project_id: f.projectId || null, project_name: f.projectName || null,
    due_at: f.dueAt, remind_min: f.remindMin,
    note_code: f.noteCode || null, note: f.note || null,
    status: f.status || 'pending', source: f.source || 'app',
  };
}

// Before 0066 the table is missing and every caller falls back to
// leads.next_followup alone (no type, purpose or reminder lead time).
export const hasFollowupTable = () =>
  hasColumn('lead_followups', 'id', 'Follow-up details are off. Apply supabase/migrations/0066_lead_followups.sql.');

// Pending follow-ups by lead, cached for the session. A miss is cached too
// (null), so a lead with nothing pending costs one request, not one per render.
const _pending = new Map();
export const pendingFor = (leadId) => _pending.get(leadId) ?? null;
export function rememberPending(leadId, f) { _pending.set(leadId, f || null); }

const inIds = (ids) => `in.(${ids.map((i) => `"${String(i).replace(/"/g, '')}"`).join(',')})`;

export async function fetchPending(leadIds, { force = false } = {}) {
  const want = [...new Set((leadIds || []).filter(Boolean))].filter((id) => force || !_pending.has(id));
  if (!want.length || !(await hasFollowupTable())) return;
  for (let i = 0; i < want.length; i += 100) {
    const chunk = want.slice(i, i + 100);
    const rows = await sbGet(`lead_followups?lead_id=${encodeURIComponent(inIds(chunk))}&status=eq.pending&select=*`);
    const got = new Map((Array.isArray(rows) ? rows : []).map((r) => [r.lead_id, rToF(r)]));
    chunk.forEach((id) => _pending.set(id, got.get(id) || null));
  }
}

// Follow-ups this person completed in [start, end), for the activity counts.
export async function fetchDone(userId, start, end) {
  if (!userId || !(await hasFollowupTable())) return null;
  const q = `lead_followups?done_by=eq.${encodeURIComponent(userId)}&status=eq.done`
    + `&done_at=gte.${encodeURIComponent(new Date(start).toISOString())}&done_at=lt.${encodeURIComponent(new Date(end).toISOString())}`
    + '&select=type,done_at&limit=5000';
  const rows = await sbGet(q);
  return Array.isArray(rows) ? rows : [];
}

// ── Day buckets ─────────────────────────────────────────────────────────────
// The JS twin of KPI.followToday / followMissed / followUpcoming (leadQuery.js):
// Missed = due before today, Today = due today (also earlier today), Upcoming =
// after today. Days are the browser's local days, as everywhere on the dashboard.
export function dayBounds(now = new Date()) {
  const s = new Date(now); s.setHours(0, 0, 0, 0);
  const e = new Date(now); e.setHours(23, 59, 59, 999);
  return { start: s.toISOString(), end: e.toISOString() };
}

export function followBucket(iso, now = new Date()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const { start, end } = dayBounds(now);
  if (t < Date.parse(start)) return 'missed';
  if (t <= Date.parse(end)) return 'today';
  return 'upcoming';
}

// Counts of completed follow-ups by type, this period against the one before.
export function activitySummary(cur = [], prev = []) {
  const byType = {};
  cur.forEach((r) => { byType[r.type] = (byType[r.type] || 0) + 1; });
  const total = cur.length, before = prev.length;
  const change = before ? Math.round(((total - before) / before) * 100) : null;
  return { total, before, change, byType };
}

// One line for the activity timeline and the follow-up summary card.
export function followupLine(f, when) {
  return [typeOf(f.type).label, purposeText(f), f.projectName, when, noteText(f)].filter(Boolean).join(' · ');
}
