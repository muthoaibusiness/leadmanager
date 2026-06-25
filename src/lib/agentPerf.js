// Agent performance metrics — role-aware. Pure (no React/DOM) so it stays testable.
// Three sales roles run different plays, so each gets its own KPIs, funnel and table:
//   Initial Agent  → sourcing + first contact (calls, qualify, hand to Meeting Agent)
//   Meeting Agent  → meetings + site visits (schedule, run, hand to Team Lead)
//   Team Lead      → negotiation + closing (offers, deals won/lost, revenue)
import { ROLES } from './constants.js';

const CLOSED_LOST = ['DEAL_CLOSED_LOST', 'NOT_INTERESTED'];
const PAST_CONTACT = ['CONTACTED', 'INTERESTED', 'MEETING_SET', 'SITE_VISIT_SCHEDULED', 'SITE_VISIT_DONE', 'NEGOTIATING', 'DEAL_CLOSED_WON', 'DEAL_CLOSED_LOST'];
const PAST_QUALIFY = ['INTERESTED', 'MEETING_SET', 'SITE_VISIT_SCHEDULED', 'SITE_VISIT_DONE', 'NEGOTIATING', 'DEAL_CLOSED_WON', 'DEAL_CLOSED_LOST'];
const REACHED_MEETING = ['MEETING_SET', 'SITE_VISIT_SCHEDULED', 'SITE_VISIT_DONE', 'NEGOTIATING', 'DEAL_CLOSED_WON', 'DEAL_CLOSED_LOST'];

const ts = (s) => (s ? new Date(s).getTime() : 0);
const firstOwner = (l) => (l.previousAssignees && l.previousAssignees[0]) || l.assignedTo;
const involves = (l, id) => l.assignedTo === id || (l.previousAssignees || []).includes(id);
const offerValue = (a) => { try { return JSON.parse(a.description).pipelineValue || 0; } catch { return 0; } };

function blank(u) {
  return {
    u, sourced: 0, untouched: 0, calls: 0, talkMins: 0, followups: 0, contacted: 0, qualified: 0, meetingsSet: 0,
    mReceived: 0, visitsSched: 0, visitsDone: 0, sentTL: 0,
    negotiation: 0, proposals: 0, won: 0, lost: 0, revenue: 0,
    _respSum: 0, _respN: 0, _dealSum: 0,
  };
}

// First real touch (any non-system activity) → response latency in hours.
function firstTouchHrs(l, acts) {
  const a = (acts || []).filter(x => !['CREATED', 'ASSIGNED'].includes(x.type)).sort((x, y) => ts(x.timestamp) - ts(y.timestamp))[0];
  if (!a || !l.createdAt) return null;
  const h = (ts(a.timestamp) - ts(l.createdAt)) / 3.6e6;
  return h >= 0 && h < 24 * 120 ? h : null;
}

export function buildAgentPerf(db, { periodDays = 30, start = null, end = null, teamId = null } = {}) {
  // Honour an explicit {start,end} range (from the global date filter) when given;
  // otherwise fall back to a rolling periodDays window.
  const since = start != null ? start : (periodDays ? Date.now() - periodDays * 864e5 : 0);
  const until = end != null ? end : Infinity;
  const leads = (db.leads || []).filter(l => { const t = ts(l.createdAt); return t >= since && t <= until; });
  const acts = db.activities || {};
  const bookings = db.bookings || [];
  const bookTotal = (leadId) => { const b = bookings.find(x => x.leadId === leadId); return b ? b.total || 0 : 0; };

  const users = (db.users || []).filter(u => [ROLES.IA, ROLES.MA, ROLES.TL].includes(u.role) && (!teamId || u.teamId === teamId));
  const stat = {};
  users.forEach(u => { stat[u.id] = blank(u); });

  // Per-agent activity rollup — count ONLY valid/real activity (skip system or
  // empty entries; a call counts only if it has real talk duration > 0).
  Object.entries(acts).forEach(([leadId, arr]) => {
    (arr || []).forEach(a => {
      if (!a || !a.userId || a.userId === 'system') return;
      const s = stat[a.userId]; if (!s) return;
      if (a.type === 'CALL') {
        const sec = a.durationSeconds || 0;
        if (sec > 0) { s.calls++; s.talkMins += sec / 60; } // valid connected call
      } else if (a.type === 'FOLLOW_UP' && a.description) {
        s.followups++;
      }
    });
  });

  leads.forEach(l => {
    const la = acts[l.id] || [];
    const contacted = PAST_CONTACT.includes(l.status) || (l.callCount || 0) > 0;
    const qualified = PAST_QUALIFY.includes(l.status);
    const reachedMeeting = REACHED_MEETING.includes(l.status) || !!l.meetingSetDate;
    const won = l.status === 'DEAL_CLOSED_WON';
    const lost = CLOSED_LOST.includes(l.status);
    const resp = firstTouchHrs(l, la);
    const offerByLead = {};
    la.forEach(a => { if (a.type === 'OFFER') offerByLead[a.userId] = true; });

    // ── Initial Agent: credit the originator ──
    const fo = firstOwner(l);
    if (stat[fo] && stat[fo].u.role === ROLES.IA) {
      const s = stat[fo];
      s.sourced++;
      if (!contacted) s.untouched++;
      if (contacted) s.contacted++;
      if (qualified) s.qualified++;
      if (resp != null) { s._respSum += resp; s._respN++; }
    }
    // Meetings set credited to whoever set the meeting (an IA hand-off).
    if (stat[l.meetingSetBy] && stat[l.meetingSetBy].u.role === ROLES.IA) stat[l.meetingSetBy].meetingsSet++;

    // ── Meeting Agent: leads that reached the meeting stage and they handled ──
    users.filter(u => u.role === ROLES.MA).forEach(u => {
      if (!involves(l, u.id)) return;
      const didVisitAct = la.some(a => a.userId === u.id && ['VISIT_SCHED', 'VISIT_DONE', 'VISIT'].includes(a.type));
      if (!reachedMeeting && !didVisitAct) return;
      const s = stat[u.id];
      s.mReceived++;
      if (l.status === 'SITE_VISIT_SCHEDULED' || l.status === 'SITE_VISIT_DONE' || la.some(a => a.userId === u.id && a.type === 'VISIT_SCHED')) s.visitsSched++;
      if (l.siteVisitDoneBy === u.id || l.status === 'SITE_VISIT_DONE' || la.some(a => a.userId === u.id && a.type === 'VISIT_DONE')) s.visitsDone++;
      if (l.assignedRole === ROLES.TL && (l.previousAssignees || []).includes(u.id)) s.sentTL++;
    });

    // ── Team Lead: negotiation + closing on leads they own/owned ──
    users.filter(u => u.role === ROLES.TL).forEach(u => {
      const ownsNow = l.assignedTo === u.id;
      const madeOffer = offerByLead[u.id];
      if (!ownsNow && !madeOffer) return;
      const s = stat[u.id];
      if (madeOffer) s.proposals++;
      if (ownsNow && l.status === 'NEGOTIATING') s.negotiation++;
      if (ownsNow && won) {
        s.won++;
        const v = l.dealValue || bookTotal(l.id) || offerValue(la.find(a => a.type === 'OFFER') || {}) || 0;
        s.revenue += v; s._dealSum += v;
      }
      if (ownsNow && lost) s.lost++;
    });
  });

  const rows = Object.values(stat).map(s => {
    const resp = s._respN ? s._respSum / s._respN : null;
    const avgDeal = s.won ? s._dealSum / s.won : 0;
    const contactRate = s.sourced ? (s.contacted / s.sourced) * 100 : 0;
    const showRate = s.visitsSched ? (s.visitsDone / s.visitsSched) * 100 : 0;
    const closeRate = (s.won + s.lost) ? (s.won / (s.won + s.lost)) * 100 : 0;
    return { ...s, talkMins: Math.round(s.talkMins), resp, avgDeal, contactRate, showRate, closeRate };
  });

  // Role-relative score (0–100), normalised against the active cohort for that role.
  const maxOf = (role, f) => Math.max(1, ...rows.filter(r => r.u.role === role).map(f));
  const mxSourced = maxOf(ROLES.IA, r => r.sourced);
  const mxRecv = maxOf(ROLES.MA, r => r.mReceived);
  const mxRev = maxOf(ROLES.TL, r => r.revenue);
  const speed = (r) => r.resp == null ? 0.4 : 1 - Math.min(r.resp / 48, 1);
  rows.forEach(r => {
    if (r.u.role === ROLES.IA) {
      r.score = Math.round(100 * (0.4 * (r.contactRate / 100) + 0.25 * (r.sourced / mxSourced) + 0.2 * (r.meetingsSet / Math.max(1, r.sourced)) + 0.15 * speed(r)));
    } else if (r.u.role === ROLES.MA) {
      r.score = Math.round(100 * (0.45 * (r.showRate / 100) + 0.3 * (r.mReceived / mxRecv) + 0.25 * (r.sentTL / Math.max(1, r.mReceived))));
    } else {
      r.score = Math.round(100 * (0.45 * (r.closeRate / 100) + 0.35 * (r.revenue / mxRev) + 0.2 * (r.won / Math.max(1, r.won + r.lost + r.negotiation))));
    }
    r.score = Math.max(0, Math.min(100, r.score || 0));
  });

  return rows;
}

// Outcome split for a role's leads (for the donut), computed over the same period.
export function outcomeFor(rows) {
  return rows;
}

// ── role view definitions: columns + KPIs + funnel, all reading the stat row ──
const num = (v) => (v == null ? '—' : v);
const pct = (v) => (v == null ? '—' : v.toFixed(1) + '%');
const hrs = (v) => (v == null ? '—' : v.toFixed(1) + 'h');

export const ROLE_VIEWS = {
  [ROLES.IA]: {
    label: 'Initial Agent', ico: 'person_search', volume: 'sourced',
    kpis: (t) => [
      { label: 'Leads Sourced', val: t.sourced, sub: 'this period' },
      { label: 'Calls Logged', val: t.calls, sub: t.talkMins + ' min talk' },
      { label: 'Follow-ups', val: t.followups, tone: t.followups ? 'accent' : '', sub: 'reminders worked' },
      { label: 'Meetings Set', val: t.meetingsSet, tone: t.meetingsSet ? 'good' : '', sub: 'handed to MA' },
    ],
    columns: [
      { k: 'sourced', t: 'Sourced', fmt: num }, { k: 'contacted', t: 'Contacted', fmt: num },
      { k: 'qualified', t: 'Qualified', fmt: num }, { k: 'followups', t: 'Follow-ups', fmt: num },
      { k: 'meetingsSet', t: 'Meetings Set', fmt: num }, { k: 'calls', t: 'Calls', fmt: num },
      { k: 'contactRate', t: 'Contact %', fmt: pct, rate: true }, { k: 'resp', t: 'Avg Resp', fmt: hrs },
    ],
    funnel: (t, C) => [
      { label: 'Sourced', value: t.sourced, color: C[0] }, { label: 'Contacted', value: t.contacted, color: C[3] },
      { label: 'Qualified', value: t.qualified, color: C[1] }, { label: 'Meeting Set', value: t.meetingsSet, color: C[2] },
    ],
  },
  [ROLES.MA]: {
    label: 'Meeting Agent', ico: 'event_available', volume: 'mReceived',
    kpis: (t) => [
      { label: 'Meetings Received', val: t.mReceived, sub: 'this period' },
      { label: 'Visits Scheduled', val: t.visitsSched, sub: 'booked' },
      { label: 'Visits Done', val: t.visitsDone, tone: t.visitsDone ? 'good' : '', sub: 'completed' },
      { label: 'Sent to Team Lead', val: t.sentTL, tone: 'accent', sub: 'handed up' },
    ],
    columns: [
      { k: 'mReceived', t: 'Received', fmt: num }, { k: 'visitsSched', t: 'Scheduled', fmt: num },
      { k: 'visitsDone', t: 'Visits Done', fmt: num }, { k: 'showRate', t: 'Show-up %', fmt: pct, rate: true },
      { k: 'sentTL', t: 'Sent to TL', fmt: num }, { k: 'resp', t: 'Avg Resp', fmt: hrs },
    ],
    funnel: (t, C) => [
      { label: 'Received', value: t.mReceived, color: C[0] }, { label: 'Visit Scheduled', value: t.visitsSched, color: C[3] },
      { label: 'Visit Done', value: t.visitsDone, color: C[1] }, { label: 'Sent to TL', value: t.sentTL, color: C[2] },
    ],
  },
  [ROLES.TL]: {
    label: 'Team Lead', ico: 'workspace_premium', volume: 'revenue',
    kpis: (t) => [
      { label: 'In Negotiation', val: t.negotiation, tone: t.negotiation ? 'warn' : '', sub: 'live deals' },
      { label: 'Proposals Sent', val: t.proposals, sub: 'offers made' },
      { label: 'Deals Won', val: t.won, tone: t.won ? 'good' : '', sub: t.closeRate.toFixed(0) + '% close rate' },
      { label: 'Revenue', val: '__REVENUE__', tone: 'accent', sub: t.won + ' deals' },
    ],
    columns: [
      { k: 'negotiation', t: 'Negotiating', fmt: num }, { k: 'proposals', t: 'Proposals', fmt: num },
      { k: 'won', t: 'Won', fmt: num, good: true }, { k: 'lost', t: 'Lost', fmt: num, bad: true },
      { k: 'closeRate', t: 'Close %', fmt: pct, rate: true }, { k: 'avgDeal', t: 'Avg Deal', money: true },
      { k: 'revenue', t: 'Revenue', money: true },
    ],
    funnel: (t, C) => [
      { label: 'Proposals', value: t.proposals, color: C[0] }, { label: 'Negotiation', value: t.negotiation + t.won, color: C[3] },
      { label: 'Closed Won', value: t.won, color: C[1] },
    ],
  },
};
