// Numbers for the Requests insights page: how the hold-request queue is doing and what
// the live holds look like. Pure functions over the hold requests and the projects,
// no React. A request is { status: pending | approved | rejected, createdAt, decidedAt,
// holdUntil, dealTotal, agentName, propertyId, propertyName, unitId, … }.

import { projectInventory } from './projects.js';

const DAY = 86400000;
const HOUR = 3600000;
const ms = (iso) => (iso ? new Date(iso).getTime() : NaN);
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null);

export const PERIODS = [
  { key: '7', label: '7 days', days: 7 },
  { key: '30', label: '30 days', days: 30 },
  { key: '90', label: '90 days', days: 90 },
  { key: 'all', label: 'All time', days: 0 },
];

// → hours between the request and its decision (null while pending or if the dates are odd)
const waitH = (r) => {
  const d = ms(r.decidedAt) - ms(r.createdAt);
  return Number.isFinite(d) && d >= 0 ? d / HOUR : null;
};
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// Counts for a set of requests.
function tally(list) {
  const approved = list.filter(r => r.status === 'approved');
  const rejected = list.filter(r => r.status === 'rejected');
  const pending = list.filter(r => r.status === 'pending');
  const waits = [...approved, ...rejected].map(waitH).filter(w => w != null);
  return {
    total: list.length, approved: approved.length, rejected: rejected.length, pending: pending.length,
    rate: pct(approved.length, approved.length + rejected.length),
    value: list.reduce((s, r) => s + (r.dealTotal || 0), 0),
    approvedValue: approved.reduce((s, r) => s + (r.dealTotal || 0), 0),
    pendingValue: pending.reduce((s, r) => s + (r.dealTotal || 0), 0),
    avgWait: avg(waits), medWait: median(waits),
  };
}

// The chart's buckets: one per day up to 30 days, one per week beyond.
function series(list, days, now) {
  const weekly = days > 30;
  const size = weekly ? 7 : 1;
  const n = Math.ceil(days / size);
  const end = new Date(now); end.setHours(23, 59, 59, 999);
  const buckets = Array.from({ length: n }, (_, i) => {
    const to = end.getTime() - (n - 1 - i) * size * DAY;
    return { from: to - size * DAY, to, approved: 0, rejected: 0, pending: 0 };
  });
  list.forEach(r => {
    const t = ms(r.createdAt);
    const b = buckets.find(x => t > x.from && t <= x.to);
    if (b) b[r.status === 'approved' ? 'approved' : r.status === 'rejected' ? 'rejected' : 'pending']++;
  });
  return { weekly, buckets };
}

// Each live hold across all projects, with how long it has left.
function liveHolds(projects, now) {
  const out = [];
  projects.forEach(p => (p.variants || []).forEach(v => (v.units || []).forEach(u => {
    if (u.status !== 'hold') return;
    const until = ms(u.holdUntil);
    out.push({
      key: `${p.id}:${u.id}`, projectId: p.id, project: p.name, unit: u.id, type: v.name || '',
      client: u.clientName || '', by: u.heldByName || '', byId: u.heldBy || null, until: Number.isFinite(until) ? until : null,
      left: Number.isFinite(until) ? until - now : null,
    });
  })));
  return out.sort((a, b) => (a.left ?? Infinity) - (b.left ?? Infinity));
}

// A unit belongs to an agent when they asked for it (the request names them): approving a hold
// stamps the manager on the unit, not the agent, so the unit alone cannot say who it is for.
function agentKeys(allRequests, agentId) {
  const m = new Map();
  allRequests.filter(r => r.agentId === agentId && r.status !== 'rejected').forEach(r => {
    const k = r.propertyId + ':' + r.unitId;
    if (!m.has(k) || ms(r.createdAt) > ms(m.get(k).createdAt)) m.set(k, r);
  });
  return m;
}
function soldBy(projects, keys) {
  let n = 0, area = 0;
  projects.forEach(p => (p.variants || []).forEach(v => (v.units || []).forEach(u => {
    if (u.status === 'sold' && keys.has(p.id + ':' + u.id)) { n++; area += u.size > 0 ? u.size : (v.size || 0); }
  })));
  return { n, area };
}

// `agentId`: only that agent's requests and holds (the Booking tab's agent dashboard).
export function holdStats(allRequests, projects, periodKey = '30', now = Date.now(), agentId = null) {
  const all = agentId ? allRequests.filter(r => r.agentId === agentId) : allRequests;
  const period = PERIODS.find(p => p.key === periodKey) || PERIODS[1];
  const days = period.days || Math.max(7, Math.min(365, Math.ceil((now - Math.min(now, ...all.map(r => ms(r.createdAt)).filter(Number.isFinite))) / DAY) + 1));
  const from = period.days ? now - period.days * DAY : -Infinity;
  const prevFrom = period.days ? from - period.days * DAY : -Infinity;
  const inP = all.filter(r => ms(r.createdAt) >= from);
  const prev = period.days ? all.filter(r => ms(r.createdAt) >= prevFrom && ms(r.createdAt) < from) : [];

  const cur = tally(inP);
  const before = tally(prev);

  // The queue as it is now, whatever the period.
  const queue = all.filter(r => r.status === 'pending').sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
  const stale = queue.filter(r => now - ms(r.createdAt) > DAY);
  const oldest = queue[0] ? now - ms(queue[0].createdAt) : null;

  const keys = agentId ? agentKeys(allRequests, agentId) : null;
  const holds = (keys
    ? liveHolds(projects, now).filter(h => h.byId === agentId || keys.has(h.projectId + ':' + h.unit))
      .map(h => { const r = keys.get(h.projectId + ':' + h.unit); const u = h.until ?? ms(r?.holdUntil); return Number.isFinite(u) ? { ...h, until: u, left: u - now } : h; })
      .sort((a, b) => (a.left ?? Infinity) - (b.left ?? Infinity))
    : liveHolds(projects, now));
  const overdue = holds.filter(h => h.left != null && h.left < 0);
  const soon = holds.filter(h => h.left != null && h.left >= 0 && h.left <= DAY);

  // Per project: this period's requests next to the live inventory.
  const byProject = projects.map(p => {
    const t = tally(inP.filter(r => r.propertyId === p.id));
    const inv = projectInventory(p);
    return { id: p.id, name: p.name, ...t, inv, sell: pct(inv.sold, inv.total) };
  }).filter(r => r.total > 0 || r.inv.hold > 0 || r.inv.sold > 0).sort((a, b) => b.total - a.total || b.inv.hold - a.inv.hold);

  const agents = new Map();
  inP.forEach(r => { const k = r.agentName || '—'; if (!agents.has(k)) agents.set(k, []); agents.get(k).push(r); });
  const byAgent = [...agents].map(([name, list]) => ({ name, ...tally(list) })).sort((a, b) => b.total - a.total || b.approved - a.approved);

  // Units people keep asking for.
  const units = new Map();
  inP.forEach(r => {
    const k = `${r.propertyId}:${r.unitId}`;
    if (!units.has(k)) units.set(k, { key: k, unit: r.unitId, project: r.propertyName, list: [] });
    units.get(k).list.push(r);
  });
  const hot = [...units.values()].filter(u => u.list.length > 1)
    .map(u => ({ ...u, n: u.list.length, rejected: u.list.filter(r => r.status === 'rejected').length, agents: new Set(u.list.map(r => r.agentName)).size }))
    .sort((a, b) => b.n - a.n).slice(0, 5);

  const weekday = Array.from({ length: 7 }, () => 0);
  inP.forEach(r => { const d = new Date(r.createdAt).getDay(); if (Number.isFinite(d)) weekday[(d + 6) % 7]++; }); // Monday first

  const delta = (a, b) => (period.days && b > 0 ? Math.round(((a - b) / b) * 100) : null);
  return {
    period, cur, before, requestsDelta: delta(cur.total, before.total),
    queue: { count: queue.length, stale, oldest, value: queue.reduce((s, r) => s + (r.dealTotal || 0), 0), list: queue },
    holds: { all: holds, overdue, soon },
    sold: keys ? soldBy(projects, keys) : null, recent: [...inP].sort((a, b) => ms(b.createdAt) - ms(a.createdAt)).slice(0, 8),
    series: series(inP, days, now), byProject, byAgent, hot, weekday,
  };
}

// "3 h", "2 d 4 h", "45 min": a length of time for a card.
export function fmtSpan(msec) {
  if (msec == null || !Number.isFinite(msec)) return '—';
  const m = Math.round(Math.abs(msec) / 60000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h${m % 60 ? ` ${m % 60} min` : ''}`;
  const d = Math.floor(h / 24);
  return `${d} d${h % 24 ? ` ${h % 24} h` : ''}`;
}
export const fmtHours = (h) => (h == null ? '—' : fmtSpan(h * HOUR));
