// Conversion funnel + stage trend. Pure (no React/DOM, imports only constants)
// so it stays cheap to test and renders identically on server or client.
//
// Two different questions, two different date rules — this is deliberate:
//   Funnel — a COHORT measure: "of the leads created in this period, how far did
//            they get?" Filtered by createdAt, so one population spans all bars.
//   Trend  — an EVENT measure: "what happened on each day?" A lead created in May
//            whose meeting was set yesterday belongs in yesterday's bucket.
import { ROLES, STATUS_LABELS, PAST_CONTACT, REACHED_MEETING } from './constants.js';

export const STAGE = { LEAD: 0, CONNECTED: 1, MEETING: 2, VISIT: 3, WON: 4 };

// The one honest signal that a human conversation happened. LogCall writes a
// real duration (60-1800s); logNoAnswer always writes 0. Note callCount is
// incremented by BOTH, so `callCount > 0` can never tell them apart.
const talkedTo = (acts) => (acts || []).some(a => a.type === 'CALL' && (a.durationSeconds || 0) > 0);

// How far a lead actually got. Returns the DEEPEST stage reached, so counting
// `rank >= stage` makes the funnel monotonic by construction rather than by luck.
//
// Persisted timestamps are checked as evidence alongside status: a lead that
// reached a late stage and was later marked NOT_INTERESTED would otherwise fall
// all the way back to LEAD and dent the bars above it.
export function leadStage(l, acts) {
  if (!l) return STAGE.LEAD;
  if (l.status === 'DEAL_CLOSED_WON') return STAGE.WON;
  if (l.status === 'SITE_VISIT_DONE' || l.siteVisitDoneDate) return STAGE.VISIT;
  if (REACHED_MEETING.includes(l.status) || l.meetingSetDate) return STAGE.MEETING;
  // talkedTo recovers the one hole in PAST_CONTACT: it excludes NOT_INTERESTED,
  // so a lead we genuinely spoke to and then disqualified would not count as
  // connected. Talk-time proves the conversation; a no-answer (0s) never does.
  if (PAST_CONTACT.includes(l.status) || talkedTo(acts)) return STAGE.CONNECTED;
  return STAGE.LEAD;
}

// Canonical ladder. Colours match TeamLeadDash's existing funnel palette.
export const FUNNEL_STAGES = [
  { key: 'lead', stage: STAGE.LEAD, label: 'Leads', color: '#FFFFFF' },
  { key: 'connected', stage: STAGE.CONNECTED, label: 'Connected', color: '#D4D4D8' },
  { key: 'meetingSet', stage: STAGE.MEETING, label: 'Meeting Set', color: '#F0A92B' },
  { key: 'siteVisit', stage: STAGE.VISIT, label: 'Site Visit', color: '#2DD4BF' },
  { key: 'won', stage: STAGE.WON, label: 'Won', color: '#34D399' },
];

export const TREND_SERIES = {
  connected: { key: 'connected', label: 'Connected', color: '#D4D4D8' },
  meetingSet: { key: 'meetingSet', label: 'Meeting Set', color: '#F0A92B' },
  siteVisit: { key: 'siteVisit', label: 'Site Visit', color: '#2DD4BF' },
};

// A Meeting Agent only ever receives leads already at MEETING_SET or later, so
// showing them Leads/Connected would render three flat 100% bars. Starting their
// funnel at the rung they actually enter makes the % read as "of the meetings I
// received, how many converted" — which is their actual job.
export function panelConfigFor(role) {
  if (role === ROLES.MA) {
    return {
      stages: FUNNEL_STAGES.filter(s => s.stage >= STAGE.MEETING),
      seriesKeys: ['meetingSet', 'siteVisit'],
      title: 'Meeting → Visit Funnel',
    };
  }
  return {
    stages: FUNNEL_STAGES,
    seriesKeys: ['connected', 'meetingSet', 'siteVisit'],
    title: role === ROLES.TL ? 'Team Funnel' : 'Conversion Funnel',
  };
}

// activities: the raw { [leadId]: Activity[] } map from getDB().
export function buildFunnel(leads, activities, stages = FUNNEL_STAGES) {
  const ranks = (leads || []).map(l => leadStage(l, activities?.[l.id]));
  return stages.map(s => ({ ...s, value: ranks.filter(r => r >= s.stage).length }));
}

// ── Stage event dates ────────────────────────────────────────────────────────
// Only createdAt / meetingSetDate / siteVisitDoneDate are real persisted stamps.
// Connected has none, so it gets reconstructed from the activity timeline.

const tOf = (v) => { const t = new Date(v).getTime(); return Number.isFinite(t) && t > 0 ? t : null; };

// Earliest evidence that we reached this lead, or null if nothing dates it.
// Built from STATUS_LABELS so a label rename can't silently break the match
// (the arrow is U+2192 and must match byte-for-byte).
export function connectedAt(l, acts) {
  const needle = 'Status → ' + STATUS_LABELS.CONTACTED;
  const cands = [];
  (acts || []).forEach(a => {
    if (a.type === 'CALL' && (a.durationSeconds || 0) > 0) cands.push(a.timestamp);
    else if (a.type === 'STATUS_CHANGE' && a.description === needle) cands.push(a.timestamp);
  });
  // A set meeting proves we had connected by then, even with no call logged.
  if (l?.meetingSetDate) cands.push(l.meetingSetDate);
  const ts = cands.map(tOf).filter(Boolean);
  return ts.length ? Math.min(...ts) : null;
}

// meetingSetDate is written only by fwdLead; siteVisitDoneDate only by doneVisit.
// Both persist. We deliberately do NOT parse 'Status → Site Visit Done' — doneVisit
// hardcodes that string while STATUS_LABELS.SITE_VISIT_DONE is 'Visit Done', so a
// label-driven lookup would never match anyway.
export function stageDates(l, acts) {
  return {
    connected: connectedAt(l, acts),
    meetingSet: tOf(l?.meetingSetDate),
    siteVisit: tOf(l?.siteVisitDoneDate),
  };
}

// ── Day bucketing ────────────────────────────────────────────────────────────
// Half-open [start, end) LOCAL day windows. Local, not UTC: this is a UTC+6 app,
// so toISOString().slice(0,10) would file every evening's events under the wrong
// day. setDate() rolls months/years/DST correctly.
export function dayWindows(days, now = new Date()) {
  const t0 = new Date(now);
  t0.setHours(0, 0, 0, 0);
  return Array.from({ length: days }, (_, i) => {
    const s = new Date(t0);
    s.setDate(s.getDate() - (days - 1 - i));
    const e = new Date(s);
    e.setDate(e.getDate() + 1);
    return [s.getTime(), e.getTime()];
  });
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Per-day counts of stage events over a rolling window, dated by when the event
// happened. Leads with no dateable evidence for a stage are simply absent from
// that series — they still count in the funnel, which is status-driven.
export function buildStageTrend(leads, activities, { days = 30, keys = ['connected', 'meetingSet', 'siteVisit'], now = new Date() } = {}) {
  const wins = dayWindows(days, now);
  const labels = wins.map(([s]) => { const d = new Date(s); return MON[d.getMonth()] + ' ' + d.getDate(); });
  const counts = {};
  keys.forEach(k => { counts[k] = new Array(days).fill(0); });

  (leads || []).forEach(l => {
    const dates = stageDates(l, activities?.[l.id]);
    keys.forEach(k => {
      const t = dates[k];
      if (t == null) return;
      // Windows are contiguous and ascending; find the one containing t.
      for (let i = 0; i < wins.length; i++) {
        if (t >= wins[i][0] && t < wins[i][1]) { counts[k][i]++; break; }
      }
    });
  });

  return {
    labels,
    series: keys.map(k => ({ ...TREND_SERIES[k], points: counts[k] })),
  };
}
