// The lead list is no longer held in memory in full — LeadsView asks the server
// for one page at a time and the dashboard KPI cards ask for counts. Both need
// the same thing: "what may this account see, narrowed by the filters currently
// on screen", expressed as a PostgREST predicate instead of an Array.filter.
//
// This module is that translation, and it is the ONLY place it happens. The
// predicate here and getLeads() in db.js answer the same question in two
// languages — if they drift, a page of results stops matching its own count.
// Keep them in step, and keep both in step with sbLoad's query tiers.
//
// ── Why one `and=(...)` and not several params ──
// PostgREST accepts at most one top-level `or=` per request, and this needs
// several independent or-groups (scope, search, tabs). The logic-tree form
// nests them: `and=(a.eq.1,or(b.eq.2,c.eq.3))`. The whole expression is
// percent-encoded as a single value, so commas inside quoted literals cannot be
// mistaken for term separators.
import { ROLES, PAST_CONTACT } from './constants.js';

// Statuses that take a lead out of the working pipeline. Mirrors the CLOSED
// list the dashboards use.
export const CLOSED_STATUSES = ['DEAL_CLOSED_WON', 'DEAL_CLOSED_LOST', 'NOT_INTERESTED'];

// Quote a literal for a logic tree. PostgREST treats `,` `.` `(` `)` as
// structure unless the value is double-quoted, and a `"` inside is backslashed.
const lit = (v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

// `ilike` wildcards are `*`, not `%`. A user typing `%` or `*` in the search box
// must not turn into a wildcard of their own, so both are stripped.
const contains = (col, q) => `${col}.ilike.${lit('*' + String(q).replace(/[*%]/g, '') + '*')}`;

// JSONB containment — previous_assignees is jsonb (NOT text[]), so `cs` with a
// JSON array is the operator. See the note above prevAssignee in supabase.js.
const holdsPrev = (id) => `previous_assignees.cs.${JSON.stringify([id])}`;

// The first name in the assignee chain is the lead's originator (see firstOwner
// in InitialAgentDash / agentPerf). An empty chain means it never moved, so the
// current assignee is also the originator.
const sourcedBy = (id) => or(`previous_assignees->>0.eq.${lit(id)}`, and(`previous_assignees->>0.is.null`, `assigned_to.eq.${lit(id)}`));

const group = (op, terms) => {
  const t = terms.filter(Boolean);
  if (!t.length) return null;
  return t.length === 1 ? t[0] : `${op}(${t.join(',')})`;
};
export const and = (...terms) => group('and', terms);
export const or = (...terms) => group('or', terms);

const inSet = (col, vals) => (vals && vals.length ? `${col}.in.(${vals.map(lit).join(',')})` : null);

// ── Scope: the SQL twin of getLeads(user, opts) ───────────────────────────
//
// `teamMemberIds` must be supplied by the caller (from db.users) for the Team
// Lead tier — a team's membership lives in the users table, and joining to it
// from here would cost a second round trip on every keystroke.
//
// The company arm reproduces sameCompany()'s null tolerance exactly, including
// its "no companyId on the user means see everything" case.
export function scopeExpr(user, { involved = false, teamMemberIds = [] } = {}) {
  if (!user || user.role === ROLES.MASTER || !user.companyId) return null;
  const co = or(`company_id.eq.${lit(user.companyId)}`, 'company_id.is.null');
  if (user.role === ROLES.MGMT) return co;
  if (user.role === ROLES.TL) {
    const ids = teamMemberIds || [];
    const mine = or(
      user.teamId ? `team_id.eq.${lit(user.teamId)}` : null,
      inSet('assigned_to', ids),
      ...ids.map(holdsPrev),
    );
    return and(co, mine);
  }
  // Agents. `involved` is the superset used by the Leads tab and the KPI cards:
  // a lead they forwarded on is still theirs to see, and dropping it would make
  // "Meeting Set" read zero the moment the meeting agent takes over.
  const mine = involved
    ? or(`assigned_to.eq.${lit(user.id)}`, holdsPrev(user.id))
    : `assigned_to.eq.${lit(user.id)}`;
  return and(co, mine);
}

// "Leads I am or was on" — the Team Lead's own hand-off queue. Their scope is
// the whole team, so this narrows it to themselves without losing the ones they
// have already forwarded on.
export const selfInvolved = (id) => or(`assigned_to.eq.${lit(id)}`, holdsPrev(id));

// ── Named KPI predicates ──────────────────────────────────────────────────
//
// One entry per clickable dashboard card, so the number on the card and the
// list behind it can never be computed two different ways.
//
// CONNECTED reads `leads.talked`, the flag migration 0010 adds and keeps in
// step from activities. The rule is "reached CONTACTED+, or some CALL activity
// carries real talk time" — and the second half genuinely cannot be a lead-row
// expression: PostgREST compares a column to a VALUE, never to another column,
// and a related-table filter cannot sit inside an OR with a base predicate.
// Every row-only approximation was measured and rejected — for one agent the
// true count is 155 while `call_count > 0` says 225 — so the fact is stored.
// countLeads() falls back to counting in memory when the migration has not run.
export const KPI = {
  all: () => null,
  connected: () => or(inSet('status', PAST_CONTACT), 'talked.is.true'),
  interested: () => 'status.eq.INTERESTED',
  notInterested: () => 'status.eq.NOT_INTERESTED',
  // Untouched = born new and never worked. The activity-based test ("no entry
  // other than the auto CREATED one") is equivalent to all four touch counters
  // being zero, since every touch bumps one of them.
  untouched: () => and('status.eq.NEW', 'call_count.eq.0', 'sms_count.eq.0', 'whatsapp_count.eq.0', 'visit_count.eq.0'),
  followPending: () => and('next_followup.not.is.null', `status.not.in.(${CLOSED_STATUSES.join(',')})`),
  meetingsSet: (userId) => `meeting_set_by.eq.${lit(userId)}`,
  sourced: (userId) => sourcedBy(userId),
  active: () => `status.not.in.(${CLOSED_STATUSES.join(',')})`,
};

// Term builders for the one-off predicates a dashboard needs but that are not
// worth a KPI name — passed through `extra`. Values go through the same quoting
// as everything else, so a status or an ISO timestamp is safe to interpolate.
export const eq = (col, v) => `${col}.eq.${lit(v)}`;
export const is = (col, v) => `${col}.is.${v}`;          // true / false / null
export const lt = (col, v) => `${col}.lt.${lit(v)}`;
export const gt = (col, v) => `${col}.gt.${lit(v)}`;
export const notNull = (col) => `${col}.not.is.null`;
// "I handed this lead to X" — previous_assignees carries me, and the lead has
// since moved on to that role.
export const forwardedToRole = (id, role) => and(holdsPrev(id), eq('assigned_role', role));

// ── The full query ────────────────────────────────────────────────────────
//
// opts:
//   user, involved, teamMemberIds   scope (above)
//   kpi / kpiArg                    one of KPI, applied on top of scope
//   status                          exact status, or the two synthetic filters
//                                   the Leads tab offers (FOLLOW_UP/FORWARDED)
//   project                         propertyInterest substring
//   teamId / agentId                management + team-lead narrowing
//   ownTab 'mine' | 'fwd'           the agent's My Leads / Forwarded toggle
//   search                          name / phone / property
//   dateField, start, end           the global date filter (createdAt by default)
//   extra                           raw terms for anything one-off
export function leadWhere(opts = {}) {
  const {
    user, involved = true, teamMemberIds = [],
    kpi, kpiArg, status, project, teamId, agentId, ownTab,
    search, dateField = 'created_at', start, end, extra = [],
  } = opts;

  const terms = [scopeExpr(user, { involved, teamMemberIds })];

  if (kpi && KPI[kpi]) terms.push(KPI[kpi](kpiArg));

  // The agent's own two tabs. "Forwarded" is every lead they handed on, which
  // is precisely "I am a previous assignee and not the current one".
  if (ownTab === 'fwd' && user) terms.push(and(holdsPrev(user.id), `assigned_to.not.eq.${lit(user.id)}`));
  else if (ownTab === 'mine' && user) terms.push(`assigned_to.eq.${lit(user.id)}`);

  if (teamId) {
    const ids = teamMemberIds || [];
    terms.push(or(`team_id.eq.${lit(teamId)}`, inSet('assigned_to', ids), ...ids.map(holdsPrev)));
  }
  if (agentId && agentId !== 'ALL') terms.push(`assigned_to.eq.${lit(agentId)}`);

  // FOLLOW_UP / FORWARDED are overlays on the status pill bar, not real statuses.
  if (status === 'FOLLOW_UP') terms.push(and('next_followup.not.is.null', inSet('status', ['NEW', 'CONTACTED', 'INTERESTED'])));
  else if (status === 'FORWARDED') terms.push('previous_assignees.neq.[]');
  else if (status && status !== 'ALL') terms.push(`status.eq.${lit(status)}`);

  if (project && project !== 'ALL') terms.push(contains('property_interest', project));

  if (search) {
    const q = String(search).trim();
    if (q) terms.push(or(contains('name', q), contains('phone', q), contains('property_interest', q)));
  }

  if (start) terms.push(`${dateField}.gte.${lit(new Date(start).toISOString())}`);
  if (end) terms.push(`${dateField}.lte.${lit(new Date(end).toISOString())}`);

  extra.filter(Boolean).forEach(t => terms.push(t));

  return and(...terms);
}

// Turn the predicate into the query-string fragment a path can carry. Empty
// when there is nothing to filter by (MASTER with no filters on screen).
export function leadFilterParam(opts) {
  const w = leadWhere(opts);
  return w ? `and=${encodeURIComponent(`(${w})`)}` : '';
}

// The sort keys the Leads tab offers, as PostgREST order clauses. `updated`
// falls back to created_at for rows that have never been edited — nulls last,
// or a never-touched lead would sort above everything.
export const ORDER = {
  newest: 'created_at.desc',
  oldest: 'created_at.asc',
  updated: 'updated_at.desc.nullslast,created_at.desc',
  name: 'name.asc',
};
