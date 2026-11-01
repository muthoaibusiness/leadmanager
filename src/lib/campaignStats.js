// Numbers for the Campaign dashboard (components/views/CampaignView): one ad
// campaign — Citizen Avenue — across both WhatsApp numbers (Eyad and Dubai).
//
// Inputs are raw PostgREST rows (snake_case) for the campaign's leads and
// preleads, so this module has no store or network dependency and can be tested
// on its own. A "prelead" is an inquiry that wrote in on WhatsApp; a "lead" is
// one that reached the CRM (auto-forwarded by the Dubai bot, or forwarded by
// hand with /f).

import { PAST_CONTACT, PAST_QUALIFY, REACHED_MEETING, reachedFrom } from './constants.js';

export const CAMPAIGN_PROJECT = 'citizen';   // matched case-insensitively inside property_interest
export const CAMPAIGN_TITLE = 'Citizen Avenue';
// The ad went live on this day (Dhaka time). Leads that carry the project from earlier
// (re-labelled Osman leads, say) are not part of the campaign and are left out.
export const CAMPAIGN_START = Date.parse('2026-10-31T00:00:00+06:00');

const DAY = 864e5;
const REACHED_VISIT = reachedFrom('SITE_VISIT_DONE');
const WON = 'DEAL_CLOSED_WON';
const LOST = new Set(['DEAL_CLOSED_LOST', 'NOT_INTERESTED']);

export const PERIODS = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: 'all', label: 'Since launch' },
];

export const tail10 = (p) => String(p || '').replace(/\D/g, '').slice(-10);

// [start, end) in ms; start null = unbounded. `prev` is the window just before.
export function periodWindow(key, now = Date.now()) {
  if (key === 'all') return { start: CAMPAIGN_START, end: now + 1, prev: null };
  let start;
  if (key === 'today') { const d = new Date(now); d.setHours(0, 0, 0, 0); start = d.getTime(); }
  else start = now - (key === '30d' ? 30 : 7) * DAY;
  const len = now - start;
  return { start, end: now + 1, prev: { start: start - len, end: start } };
}

const inWin = (t, w) => t != null && (w.start == null || t >= w.start) && t < w.end;
const ts = (v) => (v ? new Date(v).getTime() : null);
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

// Which WhatsApp number an inquiry came through. The bots stamp preleads.WA
// ('Jaber' = Dubai number, 'Eyad' = Eyad number).
export const channelOfTag = (wa) => (wa === 'Jaber' ? 'dubai' : wa === 'Eyad' ? 'eyad' : 'other');

const touched = (l) => l.status !== 'NEW' || (l.call_count || 0) + (l.whatsapp_count || 0) + (l.sms_count || 0) + (l.visit_count || 0) > 0;
const contacted = (l) => PAST_CONTACT.includes(l.status) || l.talked === true || touched(l);

// Bot stage of an inquiry, in the order a customer moves through the script.
export const BOT_STEPS = [
  { key: 'silent', label: 'Not started', hint: 'No bot reply yet' },
  { key: 'greeted', label: 'Greeted', hint: 'Greeting sent, waiting' },
  { key: 'docs', label: 'Floor plan offered', hint: 'Floor plan + video offered' },
  { key: 'brochure', label: 'Brochure stage', hint: 'Floor plan sent, brochure offered or sent' },
  { key: 'done', label: 'Flow finished', hint: 'Script complete or customer declined' },
  { key: 'human', label: 'With an agent', hint: 'Forwarded / taken over' },
];
export function botStep(p) {
  const s = p.flow_stage || '';
  if (p.takeover === true || s === 'agent_assigned') return 'human';
  if (!s) return 'silent';
  if (s === 'dubai_greeted' || s === 'greeted') return 'greeted';
  if (s === 'dubai_asked_docs') return 'docs';
  if (s === 'dubai_asked_brochure' || s === 'dubai_brochure_sent') return 'brochure';
  if (s === 'dubai_done') return 'done';
  return 'greeted';
}

// users: [{id,name,role,teamId}], teams: [{id,name}]
export function buildCampaign({ leads = [], preleads = [], users = [], teams = [], period = '7d', now = Date.now() }) {
  const win = periodWindow(period, now);
  const teamName = Object.fromEntries(teams.map(t => [t.id, t.name]));
  const userById = Object.fromEntries(users.map(u => [u.id, u]));

  // phone → channel, from the inquiries
  const chanByPhone = new Map();
  preleads.forEach(p => { const k = tail10(p.phone); if (k) chanByPhone.set(k, channelOfTag(p.WA)); });
  const channelOfLead = (l) => {
    const c = chanByPhone.get(tail10(l.phone));
    if (c && c !== 'other') return c;
    return /dubai/i.test(`${teamName[l.team_id] || ''} ${l.assigned_to_name || ''}`) ? 'dubai' : 'eyad';
  };

  // Only what came in since the ad went live, whatever the period.
  const live = (r) => ts(r.created_at) >= CAMPAIGN_START;
  leads = leads.filter(live); preleads = preleads.filter(live);
  const L = leads.filter(l => inWin(ts(l.created_at), win));
  const P = preleads.filter(p => inWin(ts(p.created_at), win));
  const Lprev = win.prev ? leads.filter(l => inWin(ts(l.created_at), win.prev)) : [];
  const Pprev = win.prev ? preleads.filter(p => inWin(ts(p.created_at), win.prev)) : [];

  // ── headline ──
  const assigned = L.filter(l => l.assigned_to);
  const worked = L.filter(contacted);
  const won = L.filter(l => l.status === WON);
  const kpi = {
    inquiries: P.length,
    leads: L.length,
    distributed: assigned.length,
    unassigned: L.length - assigned.length,
    contacted: worked.length,
    contactRate: pct(worked.length, L.length),
    interested: L.filter(l => PAST_QUALIFY.includes(l.status)).length,
    meetings: L.filter(l => REACHED_MEETING.includes(l.status)).length,
    won: won.length,
    revenue: won.reduce((s, l) => s + (l.deal_value || 0), 0),
    untouched: L.filter(l => !touched(l)).length,
    inquiriesPrev: win.prev ? Pprev.length : null,
    leadsPrev: win.prev ? Lprev.length : null,
  };

  // ── funnel ──
  const funnel = [
    { key: 'inq', label: 'Inquiries', value: P.length, note: 'wrote in on WhatsApp' },
    { key: 'lead', label: 'Leads in CRM', value: L.length, note: 'reached an agent' },
    { key: 'con', label: 'Contacted', value: worked.length, note: 'an agent reached out' },
    { key: 'int', label: 'Interested', value: kpi.interested, note: 'qualified' },
    { key: 'meet', label: 'Meeting set', value: kpi.meetings, note: 'meeting booked' },
    { key: 'visit', label: 'Site visit done', value: L.filter(l => REACHED_VISIT.includes(l.status)).length, note: 'came to the site' },
    { key: 'won', label: 'Won', value: won.length, note: 'deal closed' },
  ];

  // ── by WhatsApp number ──
  const channels = ['dubai', 'eyad'].map(ch => {
    const lp = P.filter(p => channelOfTag(p.WA) === ch);
    const ll = L.filter(l => channelOfLead(l) === ch);
    return {
      key: ch, label: ch === 'dubai' ? 'Dubai number' : 'Eyad number',
      inquiries: lp.length, leads: ll.length, contacted: ll.filter(contacted).length,
      interested: ll.filter(l => PAST_QUALIFY.includes(l.status)).length,
      won: ll.filter(l => l.status === WON).length,
      forwardRate: Math.min(100, pct(ll.length, lp.length)),
    };
  });

  // ── daily inflow ──
  const days = period === 'today' ? 1 : period === '30d' ? 30 : period === 'all' ? 0 : 7;
  const dayKey = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  let first;
  if (days) { const d = new Date(now); d.setHours(0, 0, 0, 0); first = d.getTime() - (days - 1) * DAY; }
  else {
    const all = [...preleads, ...leads].map(r => ts(r.created_at)).filter(Boolean);
    first = all.length ? dayKey(Math.min(...all)) : dayKey(now);
  }
  const series = [];
  for (let t = first; t <= now; t += DAY) series.push({ t, dubai: 0, eyad: 0, leads: 0 });
  const slot = new Map(series.map(s => [s.t, s]));
  P.forEach(p => { const s = slot.get(dayKey(ts(p.created_at))); const c = channelOfTag(p.WA); if (s && (c === 'dubai' || c === 'eyad')) s[c]++; });
  L.forEach(l => { const s = slot.get(dayKey(ts(l.created_at))); if (s) s.leads++; });

  // ── bot script ──
  const bot = BOT_STEPS.map(s => ({ ...s, value: 0 }));
  const botBy = Object.fromEntries(bot.map(s => [s.key, s]));
  P.forEach(p => { botBy[botStep(p)].value++; });

  // ── distribution: who received what, and who handed what to whom ──
  const chainOf = (l) => {
    const c = [...(l.previous_assignees || []), l.assigned_to].filter(Boolean);
    return c.filter((id, i) => c.indexOf(id) === i);
  };
  const rows = new Map();
  const rowFor = (id, fallbackName) => {
    if (!rows.has(id)) {
      const u = userById[id];
      rows.set(id, {
        id, name: u?.name || fallbackName || 'Unknown', role: u?.role || null, team: teamName[u?.teamId] || '',
        received: 0, first: 0, holding: 0, handed: 0, contacted: 0, interested: 0, meetings: 0, won: 0, untouched: 0, stale: 0, revenue: 0,
      });
    }
    return rows.get(id);
  };
  const handoffs = new Map();
  L.forEach(l => {
    const chain = chainOf(l);
    chain.forEach((id, i) => {
      const r = rowFor(id, id === l.assigned_to ? l.assigned_to_name : null);
      r.received++;
      if (i === 0) r.first++;
      if (id === l.assigned_to) {
        r.holding++;
        if (contacted(l)) r.contacted++;
        if (PAST_QUALIFY.includes(l.status)) r.interested++;
        if (REACHED_MEETING.includes(l.status)) r.meetings++;
        if (l.status === WON) { r.won++; r.revenue += l.deal_value || 0; }
        if (!touched(l) && !LOST.has(l.status)) {
          r.untouched++;
          if (now - ts(l.created_at) > 36e5) r.stale++;   // untouched for over an hour
        }
      } else {
        r.handed++;
      }
    });
    for (let i = 1; i < chain.length; i++) {
      const k = `${chain[i - 1]}>${chain[i]}`;
      handoffs.set(k, (handoffs.get(k) || 0) + 1);
    }
  });
  const agents = [...rows.values()].map(r => {
    const touchRate = pct(r.contacted, r.holding);
    const qualRate = pct(r.interested, r.holding);
    const meetRate = pct(r.meetings, r.holding);
    // 0-100: reaching the leads you hold matters most, then qualifying, then meetings.
    const score = r.holding ? Math.round(touchRate * 0.45 + qualRate * 0.3 + meetRate * 0.25) : 0;
    return { ...r, touchRate, qualRate, meetRate, score };
  }).sort((a, b) => b.received - a.received || b.score - a.score);

  const flows = [...handoffs.entries()].map(([k, n]) => {
    const [from, to] = k.split('>');
    return { from: rowFor(from).name, to: rowFor(to).name, n };
  }).sort((a, b) => b.n - a.n);

  // ── status mix of what is in the CRM ──
  const statusMix = {};
  L.forEach(l => { statusMix[l.status] = (statusMix[l.status] || 0) + 1; });

  return { kpi, funnel, channels, series, bot, agents, flows, statusMix, window: win };
}
