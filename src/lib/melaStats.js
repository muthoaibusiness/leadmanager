// Numbers for the Avenue Mela dashboard (components/views/MelaView): the Citizen
// Avenue sales-festival campaign, per agent and per country of the customer.
// Inputs are raw PostgREST rows (snake_case); nothing here touches the store or
// the network, so it is tested on its own.
//
//   invited        the lead got the Mela invitation card (marker activity
//                  `mela-invite-<lead id>` written by the mela-invite function)
//   contacted      the lead went past New, or someone called / messaged it
//   response time  from the moment the lead reached its current holder until that
//                  holder first contacted it
//   Mela score     round(70 x invited / most invited + 30 x fastest time / own time)

import { PAST_CONTACT } from './constants.js';

export const MELA_SENT_PREFIX = 'Mela invitation sent';
const CONTACT_TYPES = new Set(['CALL', 'WHATSAPP', 'SMS', 'EMAIL', 'STATUS_CHANGE']);
const TOUCH_TYPES = new Set(['CALL', 'WHATSAPP', 'SMS', 'EMAIL']);

const BN = '০১২৩৪৫৬৭৮৯';
export const bn = (v) => String(v).replace(/\d/g, (d) => BN[+d]);

// 95 -> "১ ঘ ৩৫ মি"; 12 -> "১২ মি"; under a minute -> "১ মি".
export function fmtMins(m) {
  if (m == null || !Number.isFinite(m)) return '—';
  const t = Math.max(1, Math.round(m));
  if (t < 60) return `${bn(t)} মি`;
  const h = Math.floor(t / 60);
  if (h < 24) return t % 60 ? `${bn(h)} ঘ ${bn(t % 60)} মি` : `${bn(h)} ঘ`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${bn(d)} দিন ${bn(h % 24)} ঘ` : `${bn(d)} দিন`;
}

const digits = (p) => String(p || '').replace(/\D/g, '');
export const regionOf = (phone) => {
  const d = digits(phone);
  return d.startsWith('880') || (d.length === 11 && d.startsWith('01')) ? 'bd' : 'dubai';
};

const ts = (v) => (v ? new Date(v).getTime() : NaN);
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

// users: [{id, name, role, teamId}]; acts: raw activities rows for the leads
export function buildMela({ leads = [], acts = [], users = [] }) {
  const userById = Object.fromEntries(users.map((u) => [u.id, u]));
  const actsBy = new Map();
  for (const a of acts) {
    if (!actsBy.has(a.lead_id)) actsBy.set(a.lead_id, []);
    actsBy.get(a.lead_id).push(a);
  }
  for (const list of actsBy.values()) list.sort((a, b) => ts(a.timestamp) - ts(b.timestamp));

  const rows = leads.map((l) => {
    const list = actsBy.get(l.id) || [];
    const holder = userById[l.assigned_to];
    // When the current holder got it: the last hand-off naming them, else creation.
    let assignedAt = ts(l.created_at);
    if (holder?.name) {
      for (const a of list) if (a.type === 'FORWARDED' && String(a.description || '').includes(holder.name)) assignedAt = ts(a.timestamp);
    }
    let firstContact = NaN;
    if (l.assigned_to) {
      for (const a of list) {
        if (ts(a.timestamp) < assignedAt || a.user_id !== l.assigned_to || !CONTACT_TYPES.has(a.type)) continue;
        if (a.type === 'STATUS_CHANGE' && /→\s*New\s*$/i.test(a.description || '')) continue;
        firstContact = ts(a.timestamp);
        break;
      }
    }
    const minutes = Number.isFinite(firstContact) && Number.isFinite(assignedAt) ? Math.max(0, (firstContact - assignedAt) / 60000) : null;
    return {
      lead: l,
      region: regionOf(l.phone),
      holder: l.assigned_to || null,
      contacted: PAST_CONTACT.includes(l.status) || list.some((a) => TOUCH_TYPES.has(a.type)),
      invited: list.some((a) => a.id === `mela-invite-${l.id}` && String(a.description || '').startsWith(MELA_SENT_PREFIX)),
      minutes,
    };
  });

  const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  const timed = rows.filter((r) => r.minutes != null).map((r) => r.minutes);
  const kpi = {
    total: rows.length,
    contacted: rows.filter((r) => r.contacted).length,
    invited: rows.filter((r) => r.invited).length,
    avgResponse: avg(timed),
  };
  kpi.contactedPct = pct(kpi.contacted, kpi.total);
  kpi.invitedPct = pct(kpi.invited, kpi.total);

  const region = (key) => {
    const r = rows.filter((x) => x.region === key);
    return { leads: r.length, contacted: r.filter((x) => x.contacted).length, invited: r.filter((x) => x.invited).length };
  };

  const byAgent = new Map();
  for (const r of rows) {
    if (!r.holder) continue;
    if (!byAgent.has(r.holder)) byAgent.set(r.holder, []);
    byAgent.get(r.holder).push(r);
  }
  const agents = [...byAgent.entries()].map(([id, rs]) => {
    const t = avg(rs.filter((r) => r.minutes != null).map((r) => r.minutes));
    return {
      id, name: userById[id]?.name || rs[0].lead.assigned_to_name || 'Unknown',
      leads: rs.length, contacted: rs.filter((r) => r.contacted).length, invited: rs.filter((r) => r.invited).length, minutes: t,
    };
  });
  const maxInvited = Math.max(0, ...agents.map((a) => a.invited));
  const times = agents.map((a) => a.minutes).filter((m) => m != null && m > 0);
  const fastest = times.length ? Math.min(...times) : null;
  for (const a of agents) {
    const inv = maxInvited ? (70 * a.invited) / maxInvited : 0;
    const spd = fastest != null && a.minutes != null && a.minutes > 0 ? (30 * fastest) / a.minutes : (a.minutes === 0 ? 30 : 0);
    a.score = Math.round(inv + spd);
  }
  return { kpi, dubai: region('dubai'), bd: region('bd'), agents };
}

// The three orders the leaderboard offers.
export function sortAgents(agents, mode) {
  const a = agents.slice();
  if (mode === 'response') return a.sort((x, y) => (x.minutes ?? Infinity) - (y.minutes ?? Infinity) || y.invited - x.invited);
  if (mode === 'score') return a.sort((x, y) => y.score - x.score || y.invited - x.invited);
  return a.sort((x, y) => y.invited - x.invited || y.leads - x.leads);
}
