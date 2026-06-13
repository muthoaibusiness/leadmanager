import { ROLES, STATUS_LABELS, SRC_LABELS } from './constants.js';
import { uid, now_, fmtBDT, fmtDT, curMonth, startOfMonth, rlabel } from './helpers.js';
import { sbSave, sbUpsertNotifs, sbMarkRead, sbDelete } from './supabase.js';

export const KEY = 'propcrm_v1';
export let _DB = null;

export function getDB() {
  if (!_DB) {
    try { _DB = JSON.parse(localStorage.getItem(KEY)) || null; } catch { }
  }
  if (!_DB) {
    _DB = { companies: [], users: [], teams: [], leads: [], targets: [], activities: {}, notifications: {}, properties: [], bookings: [] };
  }
  if (!_DB.companies) _DB.companies = [];
  if (!_DB.teams) _DB.teams = [];
  if (!_DB.notifications) _DB.notifications = {};
  if (!_DB.properties) _DB.properties = [];
  if (!_DB.bookings) _DB.bookings = [];
  return _DB;
}

// Backfill multi-tenant fields on a pre-tenancy DB (existing localStorage data):
// guarantee at least one company and tag every team/user/agent-lead/property with a
// companyId so the master overview and per-company scoping work. Idempotent.
// Merge a remote (Supabase) snapshot with the local (localStorage) DB so that
// records created locally but not yet synced to the cloud are NOT lost when the
// app reloads. Union by id; for record collections the newer updatedAt/createdAt
// wins. Activities/notifications are unioned per key. This makes the app
// offline-tolerant and prevents "new upload gone after refresh".
export function mergeDB(remote, local) {
  const r = remote || {};
  const l = local || {};
  const ts = (x) => new Date(x?.updatedAt || x?.createdAt || 0).getTime();
  const mergeArr = (rem = [], loc = []) => {
    const m = new Map();
    rem.forEach(x => x && x.id != null && m.set(x.id, x));
    loc.forEach(x => {
      if (!x || x.id == null) return;
      const ex = m.get(x.id);
      if (!ex || ts(x) >= ts(ex)) m.set(x.id, x); // local edits / newer win
    });
    return [...m.values()];
  };
  // activities: keyed by leadId → union activity arrays by activity id
  const mergeActs = (rem = {}, loc = {}) => {
    const out = {};
    new Set([...Object.keys(rem), ...Object.keys(loc)]).forEach(k => {
      const m = new Map();
      (rem[k] || []).forEach(a => a && m.set(a.id, a));
      (loc[k] || []).forEach(a => a && m.set(a.id, a));
      out[k] = [...m.values()];
    });
    return out;
  };
  // notifications: keyed by userId → union by notif id
  const mergeNotifs = (rem = {}, loc = {}) => {
    const out = {};
    new Set([...Object.keys(rem), ...Object.keys(loc)]).forEach(k => {
      const m = new Map();
      (rem[k] || []).forEach(n => n && m.set(n.id, n));
      (loc[k] || []).forEach(n => n && m.set(n.id, n));
      out[k] = [...m.values()];
    });
    return out;
  };
  // tombstones: ids deleted locally must never be resurrected from the cloud
  const deleted = new Set((l.deletionLog || []).map(d => d.id));
  const leads = mergeArr(r.leads, l.leads).filter(x => !deleted.has(x.id));
  return {
    companies: mergeArr(r.companies, l.companies),
    users: mergeArr(r.users, l.users),
    teams: mergeArr(r.teams, l.teams),
    leads,
    targets: mergeArr(r.targets, l.targets),
    deletionLog: l.deletionLog || [],
    properties: mergeArr(r.properties, l.properties),
    bookings: mergeArr(r.bookings, l.bookings),
    activities: mergeActs(r.activities, l.activities),
    notifications: mergeNotifs(r.notifications, l.notifications),
  };
}

export function migrateTenancy(db) {
  if (!db.companies) db.companies = [];
  let changed = false;
  if (!db.companies.length) {
    const name = (db.users.find(u => u.role === ROLES.MGMT)?.name) ? 'My Company' : 'My Company';
    db.companies.push({ id: 'c1', name, plan: 'Growth', createdAt: now_(), isActive: true });
    changed = true;
  }
  const defCid = db.companies[0].id;
  (db.users || []).forEach(u => { if (u.role !== ROLES.MASTER && !u.companyId) { u.companyId = defCid; changed = true; } });
  (db.teams || []).forEach(t => { if (!t.companyId) { t.companyId = defCid; changed = true; } });
  (db.leads || []).forEach(l => { if (!l.companyId) { l.companyId = defCid; changed = true; } });
  (db.properties || []).forEach(p => { if (!p.companyId) { p.companyId = defCid; changed = true; } });
  (db.bookings || []).forEach(b => { if (!b.companyId) { b.companyId = defCid; changed = true; } });
  // ensure a master account exists so the company-wise view is reachable
  if (!db.users.some(u => u.role === ROLES.MASTER)) {
    db.users.push({ id: 'u0', name: 'Master Admin', email: 'master@wepro.com', password: '1234', role: ROLES.MASTER, teamId: null, companyId: null, phone: '', isActive: true });
    changed = true;
  }
  return changed;
}

export function saveDB(db) {
  _DB = db;
  localStorage.setItem(KEY, JSON.stringify(db));
  sbSave(db);
}

export function mutate(fn) {
  const db = getDB();
  fn(db);
  saveDB(db);
}

// ── Auth ──
export function tryLogin(email, pass) {
  const db = getDB();
  return db.users.find(u => u.email.toLowerCase() === email.toLowerCase() && u.password === pass) || null;
}

export function getSession() {
  try {
    const s = JSON.parse(localStorage.getItem('pcrm_sess'));
    if (!s) return null;
    return getDB().users.find(u => u.id === s.id) || null;
  } catch { return null; }
}

export function setSession(u) { localStorage.setItem('pcrm_sess', JSON.stringify({ id: u.id })); }
export function clearSession() { localStorage.removeItem('pcrm_sess'); }

// ── Queries ──
// A lead belongs to the user's company when its companyId matches OR is missing
// (legacy rows, or rows whose company_id wasn't persisted to Supabase yet — the
// column may not exist. Tolerating null prevents leads from vanishing on reload).
function sameCompany(entityCid, userCid) {
  return !userCid || !entityCid || entityCid === userCid;
}

export function getLeads(user) {
  const db = getDB();
  if (user.role === ROLES.MASTER) return db.leads; // master sees everything
  const inCo = db.leads.filter(l => sameCompany(l.companyId, user.companyId));
  if (user.role === ROLES.MGMT) return inCo;
  if (user.role === ROLES.TL) return inCo.filter(l => l.teamId === user.teamId);
  return inCo.filter(l => l.assignedTo === user.id);
}

export function getLead(id) { return getDB().leads.find(l => l.id === id); }

// ── Pipelines (CRM kanban funnels) ──
// Stored inside the local DB object. sbSave() only upserts known tables, so
// these persist locally without needing a Supabase schema change.
const DEFAULT_PIPELINES = [{
  id: 'sales',
  name: 'Sales Pipeline',
  stages: [
    { id: 'inquiry', name: 'Inquiry', color: '#2563EB', set: 'CONTACTED' },
    { id: 'visit', name: 'Site Visit', color: '#0891B2', set: 'SITE_VISIT_SCHEDULED' },
    { id: 'negotiation', name: 'Negotiation', color: '#7C3AED', set: 'NEGOTIATING' },
    { id: 'won', name: 'Closed Won', color: '#059669', set: 'DEAL_CLOSED_WON' },
  ],
}];

function statusToStageId(status) {
  if (status === 'DEAL_CLOSED_WON') return 'won';
  if (['INTERESTED', 'NEGOTIATING'].includes(status)) return 'negotiation';
  if (['MEETING_SET', 'SITE_VISIT_SCHEDULED', 'SITE_VISIT_DONE'].includes(status)) return 'visit';
  return 'inquiry'; // NEW / CONTACTED
}

export function getPipelines() {
  const db = getDB();
  if (!db.pipelines || !db.pipelines.length) {
    db.pipelines = JSON.parse(JSON.stringify(DEFAULT_PIPELINES));
    saveDB(db);
  }
  return db.pipelines;
}

function placements() { const db = getDB(); if (!db.pipePlace) db.pipePlace = {}; return db.pipePlace; }

// Which stage a lead currently sits in for a given pipeline.
export function leadStageId(pipeline, lead) {
  const m = placements()[pipeline.id] || {};
  if (m[lead.id] && pipeline.stages.some(s => s.id === m[lead.id])) return m[lead.id];
  if (pipeline.id === 'sales') {
    const s = statusToStageId(lead.status);
    return pipeline.stages.some(x => x.id === s) ? s : pipeline.stages[0]?.id;
  }
  return pipeline.stages[0]?.id;
}

// Move a lead to a stage. On the Sales pipeline, stages carrying a `set` keep the
// lead's real status in sync (drives the rest of the app); everything else is a
// lightweight per-pipeline placement.
export function moveLead(pipeline, leadId, stageId, user) {
  const stage = pipeline.stages.find(s => s.id === stageId);
  if (pipeline.id === 'sales' && stage?.set) {
    if (stage.set === 'DEAL_CLOSED_WON') closeDealFn(leadId, true, 0, user);
    else changeStatus(leadId, stage.set, user);
    mutate(db => { if (db.pipePlace?.[pipeline.id]) delete db.pipePlace[pipeline.id][leadId]; });
    return;
  }
  mutate(db => {
    if (!db.pipePlace) db.pipePlace = {};
    if (!db.pipePlace[pipeline.id]) db.pipePlace[pipeline.id] = {};
    db.pipePlace[pipeline.id][leadId] = stageId;
  });
}

export function createPipeline(name) {
  const p = {
    id: uid(),
    name: (name || '').trim() || 'New Pipeline',
    stages: [
      { id: uid(), name: 'New', color: '#2563EB' },
      { id: uid(), name: 'In Progress', color: '#0891B2' },
      { id: uid(), name: 'Won', color: '#059669' },
    ],
  };
  mutate(db => { db.pipelines = db.pipelines || []; db.pipelines.push(p); });
  return p;
}
export function renamePipeline(id, name) {
  mutate(db => { const p = (db.pipelines || []).find(x => x.id === id); if (p) p.name = (name || '').trim() || p.name; });
}
export function deletePipeline(id) {
  mutate(db => {
    db.pipelines = (db.pipelines || []).filter(p => p.id !== id);
    if (db.pipePlace) delete db.pipePlace[id];
  });
}
export function addStage(pipelineId, name) {
  mutate(db => {
    const p = (db.pipelines || []).find(x => x.id === pipelineId);
    if (p) p.stages.push({ id: uid(), name: (name || '').trim() || 'New Stage', color: '#64748B' });
  });
}
export function renameStage(pipelineId, stageId, name) {
  mutate(db => {
    const p = (db.pipelines || []).find(x => x.id === pipelineId);
    const s = p?.stages.find(x => x.id === stageId);
    if (s) s.name = (name || '').trim() || s.name;
  });
}
export function deleteStage(pipelineId, stageId) {
  mutate(db => {
    const p = (db.pipelines || []).find(x => x.id === pipelineId);
    if (p && p.stages.length > 1) p.stages = p.stages.filter(s => s.id !== stageId);
    if (db.pipePlace?.[pipelineId]) {
      Object.keys(db.pipePlace[pipelineId]).forEach(lid => {
        if (db.pipePlace[pipelineId][lid] === stageId) delete db.pipePlace[pipelineId][lid];
      });
    }
  });
}

export function getActs(leadId) {
  return (getDB().activities[leadId] || []).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

export function getTarget(userId) {
  const mo = curMonth();
  return getDB().targets.find(t => t.userId === userId && t.month === mo) || null;
}

export function achievement(userId, role) {
  const db = getDB();
  const sm = startOfMonth();
  if (role === ROLES.IA) {
    return db.leads.filter(l => l.meetingSetBy === userId && l.meetingSetDate && new Date(l.meetingSetDate) >= sm).length;
  }
  if (role === ROLES.MA) {
    return db.leads.filter(l => l.siteVisitDoneBy === userId && l.siteVisitDoneDate && new Date(l.siteVisitDoneDate) >= sm).length;
  }
  return 0;
}

export function usersByRole(role) { return getDB().users.filter(u => u.role === role); }

// Update an agent's editable fields (name/phone) and project assignment.
// projects: 'ALL' (all projects) | array of property ids | [] (none).
export function updateAgent(userId, fields) {
  mutate(db => {
    const u = db.users.find(x => x.id === userId);
    if (u) Object.assign(u, fields);
  });
}

// Resolve the projects an agent may deal on ('ALL' or array of ids).
export function agentProjects(user) {
  const all = getDB().properties || [];
  if (!user) return [];
  if (user.projects === 'ALL') return all;
  const ids = Array.isArray(user.projects) ? user.projects : [];
  return all.filter(p => ids.includes(p.id));
}

// ── Properties (catalog) ──
// Current logged-in tenant (null for master / no session) — used to sandbox list queries.
function currentCompanyId() {
  const s = getSession();
  return s && s.role !== ROLES.MASTER ? s.companyId : null;
}
export function getProperties() {
  const cid = currentCompanyId();
  const all = getDB().properties || [];
  return cid ? all.filter(p => sameCompany(p.companyId, cid)) : all;
}
export function getProperty(id) { return (getDB().properties || []).find(p => p.id === id); }

export function addPropertyFn(p) {
  const id = 'p' + uid();
  const companyId = p.companyId || currentCompanyId(); // belongs to the creating tenant
  mutate(db => {
    if (!db.properties) db.properties = [];
    db.properties.unshift({ id, companyId, ...p, createdAt: now_(), updatedAt: now_() });
  });
  return id;
}

export function updatePropertyFn(id, upd) {
  mutate(db => {
    const i = (db.properties || []).findIndex(p => p.id === id);
    if (i >= 0) db.properties[i] = { ...db.properties[i], ...upd, updatedAt: now_() };
  });
}

export function deletePropertyFn(id) {
  mutate(db => { db.properties = (db.properties || []).filter(p => p.id !== id); });
}

// ── Unit booking (seat-style) ──
export function genUnits(p) {
  if (p.units && p.units.length) return p.units;
  const n = p.totalUnits || 0;
  const arr = [];
  for (let i = 1; i <= n; i++) {
    arr.push({ no: 'U-' + String(i).padStart(2, '0'), status: 'available', heldBy: null, heldByName: '', heldAt: null });
  }
  return arr;
}

// action: 'lock' | 'book' | 'sold' | 'available' ; lead = {id,name}
// meta = { offerPrice, holdDays, estValue }
export function setUnitStatus(propId, unitNo, action, user, lead, meta = {}) {
  let propName = '';
  let clientId = lead?.id || null;
  mutate(db => {
    const p = (db.properties || []).find(x => x.id === propId);
    if (!p) return;
    propName = p.name;
    if (!p.units || !p.units.length) p.units = genUnits(p);
    const u = p.units.find(x => x.no === unitNo);
    if (!u) return;
    if (action === 'available') {
      u.status = 'available'; u.heldBy = null; u.heldByName = ''; u.heldAt = null;
      u.clientId = null; u.clientName = ''; u.holdUntil = null; u.offerPrice = 0; u.estValue = 0; u.holdDays = 0;
    } else {
      u.status = action === 'lock' ? 'locked' : action;
      u.heldBy = user.id; u.heldByName = user.name; u.heldAt = now_();
      if (lead) { u.clientId = lead.id; u.clientName = lead.name; }
      if (meta.offerPrice != null) u.offerPrice = meta.offerPrice;
      if (meta.estValue != null) u.estValue = meta.estValue;
      if (meta.holdDays != null) { u.holdDays = meta.holdDays; u.holdUntil = plusDays(meta.holdDays); }
      if (!clientId) clientId = u.clientId || null;
    }
    p.updatedAt = now_();

    // Sync a booking record (reflects agent, client, offer, est value, hold-until)
    if (!db.bookings) db.bookings = [];
    if (action !== 'available' && clientId) {
      const total = u.estValue || u.offerPrice || 0;
      let bk = db.bookings.find(b => b.propertyId === propId && b.unitNo === unitNo && b.leadId === clientId && !['CANCELLED', 'EXPIRED'].includes(b.status));
      if (!bk) {
        bk = {
          id: 'bk' + uid(), leadId: clientId, leadName: lead?.name || u.clientName,
          propertyId: propId, propertyName: propName, unitNo,
          agentId: user.id, agentName: user.name, total, offerPrice: u.offerPrice || 0,
          holdUntil: u.holdUntil || null, status: 'HOLD', schedule: [], payments: [],
          createdAt: now_(), updatedAt: now_(),
        };
        db.bookings.unshift(bk);
      }
      bk.agentId = user.id; bk.agentName = user.name;
      if (u.offerPrice) bk.offerPrice = u.offerPrice;
      if (total) bk.total = total;
      bk.holdUntil = u.holdUntil || null;
      bk.updatedAt = now_();
      if (action === 'lock') bk.status = 'HOLD';
      if (action === 'book') { bk.status = 'ACTIVE'; bk.holdUntil = null; if (!bk.schedule.length) bk.schedule = defaultSchedule(bk.total); }
      if (action === 'sold') { bk.status = 'ACTIVE'; if (!bk.schedule.length) bk.schedule = defaultSchedule(bk.total); }
    }
  });
  if (clientId && action !== 'available') {
    const verb = { lock: 'Held', book: 'Booked', sold: 'Sold' }[action] || 'Updated';
    const extra = action === 'lock' && (meta.offerPrice || meta.holdDays)
      ? ' (offer ' + (meta.offerPrice ? fmtBDT(meta.offerPrice) : '—') + (meta.holdDays ? ', ' + meta.holdDays + 'd hold' : '') + ')' : '';
    addAct(clientId, { type: 'BOOKING', description: verb + ' Unit ' + unitNo.replace('U-', '') + ' · ' + propName + extra, userId: user.id, userName: user.name, durationSeconds: 0 });
  }
}

// Auto-release expired holds (run on app load / interval)
export function expireHolds() {
  const db = getDB();
  let changed = false;
  const now = new Date();
  (db.properties || []).forEach(p => {
    (p.units || []).forEach(u => {
      if (u.status === 'locked' && u.holdUntil && new Date(u.holdUntil) < now) {
        const cid = u.clientId, no = u.no;
        u.status = 'available'; u.heldBy = null; u.heldByName = ''; u.clientId = null; u.clientName = '';
        u.holdUntil = null; u.offerPrice = 0; u.estValue = 0; u.holdDays = 0;
        const bk = (db.bookings || []).find(b => b.propertyId === p.id && b.unitNo === no && b.status === 'HOLD');
        if (bk) bk.status = 'EXPIRED';
        changed = true;
        if (cid && db.activities) {
          if (!db.activities[cid]) db.activities[cid] = [];
          db.activities[cid].unshift({ id: 'a' + uid(), type: 'BOOKING', description: 'Hold expired — Unit ' + no.replace('U-', '') + ' auto-released (' + p.name + ')', userId: 'system', userName: 'system', timestamp: now_(), durationSeconds: 0 });
        }
      }
    });
  });
  if (changed) saveDB(db);
  return changed;
}

// ── Bookings & Payments ──
export function getBookings() {
  const cid = currentCompanyId();
  const all = getDB().bookings || [];
  return cid ? all.filter(b => sameCompany(b.companyId, cid)) : all;
}
export function getBooking(id) { return (getDB().bookings || []).find(b => b.id === id); }
export function getBookingByLead(leadId) { return (getDB().bookings || []).find(b => b.leadId === leadId); }

function plusDays(n) { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString(); }

function defaultSchedule(total) {
  const t = total || 0;
  const a = Math.round(t * 0.10), b = Math.round(t * 0.20);
  return [
    { label: 'Booking money', amount: a, dueDate: now_(), paid: false, paidDate: null },
    { label: '1st instalment', amount: b, dueDate: plusDays(30), paid: false, paidDate: null },
    { label: '2nd instalment', amount: b, dueDate: plusDays(90), paid: false, paidDate: null },
    { label: 'On handover', amount: t - a - b - b, dueDate: plusDays(180), paid: false, paidDate: null },
  ];
}

export function bookingPaid(b) { return (b.payments || []).reduce((s, p) => s + (p.amount || 0), 0); }
export function bookingDue(b) { return Math.max(0, (b.total || 0) - bookingPaid(b)); }
export function bookingNextDue(b) { return (b.schedule || []).find(s => !s.paid) || null; }

// Create a booking from a lead's cart (idempotent per lead)
export function createBookingFromCart(leadId, user) {
  const db = getDB();
  if ((db.bookings || []).find(b => b.leadId === leadId)) return;
  const l = (db.leads || []).find(x => x.id === leadId);
  if (!l || !l.cart) return;
  const c = l.cart;
  const total = c.value || 0;
  const id = 'bk' + uid();
  mutate(d => {
    if (!d.bookings) d.bookings = [];
    d.bookings.unshift({
      id, leadId, leadName: l.name, companyId: l.companyId || user.companyId, propertyId: c.propertyId, propertyName: c.propertyName,
      unitNo: c.unitNo || null, agentId: user.id, agentName: user.name,
      total, status: 'ACTIVE', schedule: defaultSchedule(total), payments: [],
      createdAt: now_(), updatedAt: now_(),
    });
  });
  return id;
}

export function recordPayment(bookingId, { amount, method, ref, scheduleIdx }, user) {
  mutate(db => {
    const b = (db.bookings || []).find(x => x.id === bookingId);
    if (!b) return;
    if (!b.payments) b.payments = [];
    b.payments.push({ id: 'pm' + uid(), amount: parseFloat(amount) || 0, method: method || 'Cash', ref: ref || '', date: now_(), by: user.name });
    if (scheduleIdx != null && b.schedule[scheduleIdx]) { b.schedule[scheduleIdx].paid = true; b.schedule[scheduleIdx].paidDate = now_(); }
    const paid = b.payments.reduce((s, p) => s + (p.amount || 0), 0);
    if (paid >= (b.total || 0) && b.total > 0) b.status = 'COMPLETED';
    b.updatedAt = now_();
  });
}

export function setBookingStatus(bookingId, status) {
  mutate(db => { const b = (db.bookings || []).find(x => x.id === bookingId); if (b) { b.status = status; b.updatedAt = now_(); } });
}

// ── Commerce pipeline (cart → checkout → payment → purchased) ──
export const CART_STAGES = ['CART', 'CHECKOUT', 'PAYMENT', 'PURCHASED'];
export const CART_STAGE_LABEL = { CART: 'In Cart', CHECKOUT: 'Offer Sent', PAYMENT: 'Payment / Locked', PURCHASED: 'Purchased' };

export function cartAdd(leadId, property, unitNo, user) {
  mutate(db => {
    const l = db.leads.find(x => x.id === leadId);
    if (!l) return;
    l.cart = {
      propertyId: property.id, propertyName: property.name, unitNo: unitNo || null,
      stage: 'CART', value: property.askingPrice || 0,
      addedBy: user.id, addedByName: user.name, addedAt: now_(), updatedAt: now_(),
    };
    l.updatedAt = now_();
  });
  addAct(leadId, { type: 'CART', description: 'Added to cart: ' + property.name + (unitNo ? ' · Unit ' + unitNo.replace('U-', '') : ''), userId: user.id, userName: user.name, durationSeconds: 0 });
}

export function cartRemove(leadId, user) {
  mutate(db => { const l = db.leads.find(x => x.id === leadId); if (l) { l.cart = null; l.updatedAt = now_(); } });
  addAct(leadId, { type: 'CART', description: 'Removed project from cart', userId: user.id, userName: user.name, durationSeconds: 0 });
}

// advance: 'CHECKOUT' | 'PAYMENT' | 'PURCHASED'
export function cartStage(leadId, stage, user, value) {
  const l0 = getLead(leadId);
  if (!l0 || !l0.cart) return;
  const cart = l0.cart;
  mutate(db => {
    const l = db.leads.find(x => x.id === leadId);
    if (l && l.cart) { l.cart.stage = stage; if (value != null) l.cart.value = value; l.cart.updatedAt = now_(); l.updatedAt = now_(); }
  });
  const desc = { CHECKOUT: 'Offer sent — checkout', PAYMENT: 'Payment received — unit locked', PURCHASED: 'Purchased — deal closed' }[stage] || ('Stage → ' + stage);
  addAct(leadId, { type: 'CART', description: desc + ' (' + cart.propertyName + ')', userId: user.id, userName: user.name, durationSeconds: 0 });
  const leadRef = { id: leadId, name: l0.name };
  const m = { estValue: cart.value || 0 };
  if (stage === 'PAYMENT') {
    if (cart.unitNo) setUnitStatus(cart.propertyId, cart.unitNo, 'book', user, leadRef, m);
    createBookingFromCart(leadId, user); // open a payment schedule (no-op if unit booking already made one)
  }
  if (stage === 'PURCHASED') {
    if (cart.unitNo) setUnitStatus(cart.propertyId, cart.unitNo, 'sold', user, leadRef, m);
    createBookingFromCart(leadId, user);
    closeDealFn(leadId, true, value != null ? value : (cart.value || 0), user);
  }
}

// ── Mutations ──
export function addAct(leadId, act) {
  mutate(db => {
    if (!db.activities[leadId]) db.activities[leadId] = [];
    db.activities[leadId].unshift({ ...act, id: 'a' + uid(), timestamp: now_() });
  });
}

export function updLead(id, upd) {
  mutate(db => {
    const i = db.leads.findIndex(l => l.id === id);
    if (i >= 0) db.leads[i] = { ...db.leads[i], ...upd, updatedAt: now_() };
  });
}

export function deleteLead(leadId, user) {
  mutate(db => {
    const l = db.leads.find(x => x.id === leadId);
    if (l) {
      if (!db.deletionLog) db.deletionLog = [];
      db.deletionLog.push({ id: leadId, name: l.name, phone: l.phone, status: l.status, deletedBy: user?.name || 'Unknown', deletedById: user?.id, deletedAt: now_() });
    }
    db.leads = db.leads.filter(l => l.id !== leadId);
    delete db.activities[leadId];
  });
  sbDelete('leads', [leadId]); // remove from cloud so it doesn't return on reload
}

export function bulkDeleteLeads(leadIds, user) {
  mutate(db => {
    if (!db.deletionLog) db.deletionLog = [];
    leadIds.forEach(id => {
      const l = db.leads.find(x => x.id === id);
      if (l) db.deletionLog.push({ id, name: l.name, phone: l.phone, status: l.status, deletedBy: user?.name || 'Unknown', deletedById: user?.id, deletedAt: now_() });
    });
    const idSet = new Set(leadIds);
    db.leads = db.leads.filter(l => !idSet.has(l.id));
    leadIds.forEach(id => delete db.activities[id]);
  });
  sbDelete('leads', leadIds); // remove from cloud so they don't return on reload
}

export function getDeletionLog() {
  const db = getDB();
  return (db.deletionLog || []).slice().sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
}

export function changeStatus(leadId, status, user) {
  updLead(leadId, { status });
  addAct(leadId, { type: 'STATUS_CHANGE', description: 'Status → ' + (STATUS_LABELS[status] || status), userId: user.id, userName: user.name, durationSeconds: 0 });
}

export function fwdLead(leadId, toUser, currentUser, offerData) {
  const l = getLead(leadId);
  const isMeetingSet = toUser.role === ROLES.MA;
  updLead(leadId, {
    assignedTo: toUser.id, assignedToName: toUser.name, assignedRole: toUser.role,
    previousAssignees: [...l.previousAssignees, currentUser.id],
    status: isMeetingSet ? 'MEETING_SET' : l.status,
    meetingSetBy: isMeetingSet ? currentUser.id : l.meetingSetBy,
    meetingSetDate: isMeetingSet ? now_() : l.meetingSetDate,
  });
  addAct(leadId, { type: 'FORWARDED', description: 'Forwarded to ' + toUser.name + ' (' + rlabel(toUser.role) + ')', userId: currentUser.id, userName: currentUser.name, durationSeconds: 0 });
  if (offerData && toUser.role === ROLES.TL) {
    addAct(leadId, { type: 'OFFER', description: JSON.stringify({ ourOffer: offerData.ourOffer || 0, clientOffer: offerData.clientOffer || 0, totalSft: offerData.totalSft || 0, pipelineValue: offerData.pipelineValue || 0, notes: offerData.notes || '' }), userId: currentUser.id, userName: currentUser.name, durationSeconds: 0 });
  }
  const notifList = [{ userId: toUser.id, type: 'ASSIGNED', message: 'New lead assigned: ' + l.name + ' (from ' + currentUser.name + ')', leadId }];
  if (toUser.role === ROLES.TL) {
    const iaId = l.previousAssignees[0];
    if (iaId) notifList.push({ userId: iaId, type: 'FORWARDED', message: 'Your lead moved to negotiation: ' + l.name, leadId });
  }
  addNotifs(notifList, currentUser);
}

export function schedVisit(leadId, dt, loc, user) {
  updLead(leadId, { status: 'SITE_VISIT_SCHEDULED', meetingDate: dt, meetingLocation: loc });
  addAct(leadId, { type: 'STATUS_CHANGE', description: 'Site visit scheduled for ' + fmtDT(dt) + (loc ? ' at ' + loc : ''), userId: user.id, userName: user.name, durationSeconds: 0 });
  const l = getLead(leadId);
  const iaId = l.previousAssignees[0];
  if (iaId) addNotifs([{ userId: iaId, type: 'VISIT_SCHED', message: 'Site visit scheduled for your lead: ' + l.name + ' on ' + fmtDT(dt), leadId }], user);
}

export function doneVisit(leadId, user) {
  updLead(leadId, { status: 'SITE_VISIT_DONE', siteVisitDoneBy: user.id, siteVisitDoneDate: now_(), visitCount: (getLead(leadId).visitCount || 0) + 1 });
  addAct(leadId, { type: 'VISIT', description: 'Site visit completed', userId: user.id, userName: user.name, durationSeconds: 0 });
  addAct(leadId, { type: 'STATUS_CHANGE', description: 'Status → Site Visit Done', userId: user.id, userName: user.name, durationSeconds: 0 });
  const l = getLead(leadId);
  const iaId = l.previousAssignees[0];
  const db = getDB();
  const tlIds = db.users.filter(u => u.role === ROLES.TL && u.teamId === l.teamId).map(u => u.id);
  const notifList = [];
  if (iaId) notifList.push({ userId: iaId, type: 'VISIT_DONE', message: 'Site visit completed: ' + l.name, leadId });
  tlIds.forEach(uid2 => notifList.push({ userId: uid2, type: 'VISIT_DONE', message: 'Site visit done — ready to close: ' + l.name, leadId }));
  addNotifs(notifList, user);
}

export function closeDealFn(leadId, won, val, user) {
  const status = won ? 'DEAL_CLOSED_WON' : 'DEAL_CLOSED_LOST';
  updLead(leadId, { status, dealValue: won ? parseFloat(val) || 0 : 0, dealStatus: won ? 'WON' : 'LOST' });
  addAct(leadId, { type: 'DEAL', description: 'Deal ' + (won ? 'WON — ' + fmtBDT(val) : 'LOST'), userId: user.id, userName: user.name, durationSeconds: 0 });
  const l = getLead(leadId);
  const msg = won ? 'Deal WON: ' + l.name + (val ? ' — ' + fmtBDT(val) : '') : 'Deal lost: ' + l.name;
  const type = won ? 'DEAL_WON' : 'DEAL_LOST';
  const db = getDB();
  const mgmtIds = db.users.filter(u => u.role === ROLES.MGMT).map(u => u.id);
  const involved = [...new Set([...l.previousAssignees, ...mgmtIds])];
  addNotifs(involved.map(userId => ({ userId, type, message: msg, leadId })), user);
}

export function setFollowUpFn(leadId, days, user) {
  const date = new Date();
  date.setDate(date.getDate() + parseInt(days));
  const iso = date.toISOString();
  updLead(leadId, { nextFollowup: iso });
  addAct(leadId, { type: 'FOLLOW_UP', description: 'Follow-up reminder set for ' + days + ' day' + (days == 1 ? '' : 's') + ' — ' + new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }), userId: user.id, userName: user.name, durationSeconds: 0 });
}

export function markLostFn(leadId, reason, user) {
  updLead(leadId, { status: 'DEAL_CLOSED_LOST', dealStatus: 'LOST' });
  addAct(leadId, { type: 'DEAL', description: 'Deal LOST', userId: user.id, userName: user.name, durationSeconds: 0 });
  if (reason) addAct(leadId, { type: 'LOST_REASON', description: reason, userId: user.id, userName: user.name, durationSeconds: 0 });
  const l = getLead(leadId);
  const db = getDB();
  const mgmtIds = db.users.filter(u => u.role === ROLES.MGMT).map(u => u.id);
  const involved = [...new Set([...l.previousAssignees, ...mgmtIds])];
  addNotifs(involved.map(userId => ({ userId, type: 'DEAL_LOST', message: 'Deal lost: ' + l.name, leadId })), user);
}

export function checkFollowUpReminders(db) {
  const now = new Date();
  const notifList = [];
  db.leads.forEach(lead => {
    if (!lead.nextFollowup) return;
    if (new Date(lead.nextFollowup) > now) return;
    const tl = db.users.find(u => u.id === lead.assignedTo);
    if (!tl) return;
    notifList.push({ userId: tl.id, type: 'FOLLOW_UP', message: 'Follow-up reminder: ' + lead.name, leadId: lead.id });
    lead.nextFollowup = null;
  });
  if (notifList.length) {
    if (!db.notifications) db.notifications = {};
    const ts = now_();
    notifList.forEach(({ userId, type, message, leadId }) => {
      if (!db.notifications[userId]) db.notifications[userId] = [];
      const n = { id: 'n' + uid(), type, message, leadId, timestamp: ts, read: false, userId };
      db.notifications[userId].unshift(n);
    });
    sbUpsertNotifs(notifList.map(({ userId, type, message, leadId }) => ({
      id: 'n' + uid(), userId, type, message, leadId, timestamp: ts, read: false,
    })));
  }
}

export function addNote(leadId, txt, user) {
  addAct(leadId, { type: 'NOTE', description: txt, userId: user.id, userName: user.name, durationSeconds: 0 });
}

export function setTargetFn(userId, val) {
  const mo = curMonth();
  mutate(db => {
    const i = db.targets.findIndex(t => t.userId === userId && t.month === mo);
    const role = db.users.find(u => u.id === userId)?.role;
    const type = role === ROLES.IA ? 'MEETINGS_SET' : 'SITE_VISITS';
    const entry = { id: 'tg' + uid(), userId, month: mo, type, value: parseInt(val) };
    if (i >= 0) db.targets[i] = entry;
    else db.targets.push(entry);
  });
}

export function createUserFn(name, email, password, phone, role, currentUser) {
  const id = 'u' + uid();
  const companyId = currentUser.companyId; // inherit the admin's company
  if (role === ROLES.TL) {
    const tid = 't' + uid();
    mutate(db => {
      db.teams = db.teams || [];
      db.teams.push({ id: tid, name: name + "'s Team", leadId: id, companyId });
      db.users.push({ id, name, email, password: password || '1234', phone: phone || '', role, teamId: tid, companyId });
    });
  } else {
    mutate(db => { db.users.push({ id, name, email, password: password || '1234', phone: phone || '', role, teamId: currentUser.teamId, companyId }); });
  }
  return id;
}

// ── Companies (multi-tenant) ──
export function getCompanies() { return getDB().companies || []; }
export function getCompany(id) { return (getDB().companies || []).find(c => c.id === id); }

// Company-wise rollup for the master overview (data company-wise, not people-wise).
export function companyStats(cid) {
  const db = getDB();
  const users = db.users.filter(u => u.companyId === cid && u.role !== ROLES.MASTER);
  const teams = db.teams.filter(t => t.companyId === cid);
  const leads = db.leads.filter(l => l.companyId === cid);
  const props = (db.properties || []).filter(p => p.companyId === cid);
  const closedSet = ['DEAL_CLOSED_WON', 'DEAL_CLOSED_LOST', 'NOT_INTERESTED'];
  const won = leads.filter(l => l.status === 'DEAL_CLOSED_WON');
  const active = leads.filter(l => !closedSet.includes(l.status));
  const leadIds = new Set(leads.map(l => l.id));
  let collected = 0;
  (db.bookings || []).forEach(b => {
    if (b.companyId === cid || leadIds.has(b.leadId)) {
      (b.payments || []).forEach(p => { collected += (p.amount || 0); });
    }
  });
  return {
    accounts: users.length,
    managers: users.filter(u => u.role === ROLES.MGMT).length,
    teamLeads: users.filter(u => u.role === ROLES.TL).length,
    agents: users.filter(u => u.role === ROLES.IA || u.role === ROLES.MA).length,
    teams: teams.length,
    leads: leads.length,
    active: active.length,
    won: won.length,
    projects: props.length,
    collected,
  };
}

// Create a new company + its first Management (admin) account. Master-only.
export function createCompany({ name, plan, adminName, adminEmail, password, phone }) {
  const cid = 'c' + uid();
  const aid = 'u' + uid();
  const exists = getDB().users.some(u => (u.email || '').toLowerCase() === (adminEmail || '').toLowerCase());
  if (exists) return { error: 'Admin email already in use' };
  mutate(db => {
    db.companies = db.companies || [];
    db.companies.push({ id: cid, name: name.trim(), plan: plan || 'Starter', createdAt: now_(), isActive: true });
    db.users.push({ id: aid, name: (adminName || 'Admin').trim(), email: (adminEmail || '').trim(), password: password || '1234', phone: phone || '', role: ROLES.MGMT, teamId: null, companyId: cid, isActive: true });
  });
  return { companyId: cid, adminId: aid, adminEmail: (adminEmail || '').trim(), password: password || '1234' };
}

export function setCompanyActive(cid, active) {
  mutate(db => { const c = (db.companies || []).find(x => x.id === cid); if (c) c.isActive = active; });
}

// Provision many accounts in one pass. `rows`: [{name,email,phone,role,password,teamId}].
// Validates each row (name+email required, valid+unique email incl. within the batch),
// creates Team Leads with their own team, and agents under the chosen/owner team.
// Returns { created:[{name,email,pass,roleLabel,role}], errors:[{line,name,reason}] }.
export function bulkCreateUsers(rows, currentUser) {
  const created = [];
  const errors = [];
  const seen = new Set(getDB().users.map(u => (u.email || '').toLowerCase()));
  const emailRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  rows.forEach((r, i) => {
    const line = i + 1;
    const name = (r.name || '').trim();
    const email = (r.email || '').trim();
    const role = r.role || ROLES.IA;
    const pass = (r.password || '').trim() || '1234';
    const phone = (r.phone || '').trim();

    if (!name && !email) return; // skip blank rows silently
    if (!name) { errors.push({ line, name: email || '(row ' + line + ')', reason: 'Name required' }); return; }
    if (!email) { errors.push({ line, name, reason: 'Email required' }); return; }
    if (!emailRe.test(email)) { errors.push({ line, name, reason: 'Invalid email' }); return; }
    if (seen.has(email.toLowerCase())) { errors.push({ line, name, reason: 'Email already in use' }); return; }

    const id = 'u' + uid();
    seen.add(email.toLowerCase());

    const companyId = r.companyId || currentUser.companyId; // new accounts join the admin's company
    if (role === ROLES.TL) {
      const tid = 't' + uid();
      mutate(db => {
        db.teams = db.teams || [];
        db.teams.push({ id: tid, name: name + "'s Team", leadId: id, companyId });
        db.users.push({ id, name, email, password: pass, phone, role, teamId: tid, companyId });
      });
    } else if (role === ROLES.MGMT) {
      mutate(db => { db.users.push({ id, name, email, password: pass, phone, role, companyId }); });
    } else {
      const teamId = r.teamId || currentUser.teamId;
      mutate(db => { db.users.push({ id, name, email, password: pass, phone, role, teamId, companyId }); });
    }
    created.push({ id, name, email, pass, role, roleLabel: rlabel(role) });
  });

  return { created, errors };
}

// Find an existing lead with the same phone (digits only). Used to prevent
// duplicate leads on manual create and import.
export function leadByPhone(phone) {
  const d = (phone || '').replace(/[^\d]/g, '');
  if (!d) return null;
  return getDB().leads.find(l => (l.phone || '').replace(/[^\d]/g, '') === d) || null;
}

export function addLeadFn(name, phone, phones, email, emails, company, source, prop, budget, profession, city, user) {
  const dup = leadByPhone(phone);
  if (dup) return dup.id; // never create a duplicate-phone lead — return the existing one
  const id = 'l' + uid();
  const lead = {
    id, name,
    phone, phones: phones || [phone],
    email: email || '', emails: emails || (email ? [email] : []),
    company: company || '—', source, status: 'NEW',
    companyId: user.companyId, // tenant the lead belongs to
    assignedTo: user.id, assignedToName: user.name, assignedRole: user.role,
    teamId: user.teamId || 't1', previousAssignees: [],
    propertyInterest: prop || '', budget: parseFloat(budget) || 0,
    profession: profession || '', city: city || '',
    dealValue: 0, dealStatus: null, meetingSetBy: null, meetingSetDate: null,
    siteVisitDoneBy: null, siteVisitDoneDate: null, notes: '',
    createdAt: now_(), updatedAt: now_(),
    callCount: 0, smsCount: 0, whatsappCount: 0, visitCount: 0,
    meetingDate: null, meetingLocation: '',
  };
  mutate(db => {
    db.leads.push(lead);
    db.activities[id] = [{ id: 'a' + uid(), type: 'CREATED', description: 'Lead created from ' + SRC_LABELS[source], userId: user.id, userName: user.name, timestamp: now_(), durationSeconds: 0 }];
  });
  addNotifs([{ userId: user.id, type: 'ASSIGNED', message: 'New lead added to your list: ' + name, leadId: id }], null);
  return id;
}

// ── CSV Import ──
function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const fields = []; const rows = []; let cur = ''; let inQ = false; let row = [];
  for (let i = 0; i <= text.length; i++) {
    const c = i < text.length ? text[i] : null;
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else if (c === null) row.push(cur);
      else cur += c;
    } else {
      if (c === '"') { inQ = true; }
      else if (c === ',') { row.push(cur.trim()); cur = ''; }
      else if (c === '\n' || c === null) {
        row.push(cur.trim()); cur = '';
        if (row.some(f => f)) rows.push(row);
        row = [];
      } else cur += c;
    }
  }
  if (!rows.length) return [];
  const headers = rows[0].map(h => h.replace(/^"|"$/g, '').trim());
  return rows.slice(1).map(vals => {
    const obj = {}; headers.forEach((h, idx) => { obj[h] = (vals[idx] || '').trim(); });
    return obj;
  });
}

function parseImportDate(s) {
  if (!s) return null; s = s.trim(); if (!s) return null;
  const m1 = s.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})/);
  if (m1) { const y = m1[3].length === 2 ? '20' + m1[3] : m1[3]; const d = new Date(`${y}-${m1[2].padStart(2, '0')}-${m1[1].padStart(2, '0')}`); if (!isNaN(d)) return d.toISOString(); }
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m2) { const y = m2[3].length === 2 ? '20' + m2[3] : m2[3]; const d = new Date(`${y}-${m2[2].padStart(2, '0')}-${m2[1].padStart(2, '0')}`); if (!isNaN(d)) return d.toISOString(); }
  const m3 = s.match(/^(\d{1,2})-(\d{1,2})$/);
  if (m3) { const y = new Date().getFullYear(); const d = new Date(`${y}-${m3[2].padStart(2, '0')}-${m3[1].padStart(2, '0')}`); if (!isNaN(d)) return d.toISOString(); }
  return null;
}

export function mapCSVToLead(row, user) {
  // Fuzzy header lookup: normalize headers (strip non-alphanumerics, lowercase)
  // and match by exact-normalized first, then contains, so variants like
  // "Mobile Number", "Contact No", "phone_number" all resolve to phone.
  // Normalize headers (strip spaces/punctuation, lowercase) so "Mobile Number",
  // "mobile_number", "Mobile  Number" all match the alias "Mobile Number".
  // Exact-normalized match only (no substring matching) to avoid false hits like
  // "Contact Name" being read as a phone.
  const norm = (s) => (s || '').toString().toLowerCase().replace(/[^a-z0-9]/g, '');
  const keys = Object.keys(row);
  const normKeys = keys.map(k => [norm(k), k]);
  const col = (names) => {
    const wants = (Array.isArray(names) ? names : [names]).map(norm);
    let fallback = '';
    for (const w of wants) for (const [nk, k] of normKeys) {
      if (nk === w) {
        const v = (row[k] ?? '').toString();
        if (v.trim() !== '') return v;   // prefer a populated column
        if (!fallback) fallback = v;
      }
    }
    return fallback;
  };
  const srcMap = { meta: 'META_ADS', metaads: 'META_ADS', facebook: 'META_ADS', fb: 'META_ADS', whatsapp: 'WHATSAPP_ADS', whatsappads: 'WHATSAPP_ADS', linkedin: 'LINKEDIN', website: 'WEBSITE', web: 'WEBSITE', hotline: 'HOTLINE', phone: 'HOTLINE', personal: 'PERSONAL', referral: 'PERSONAL' };
  const src = srcMap[(col(['Lead Source','Source','LeadSource','Channel','Platform'])).toLowerCase().trim().replace(/[\s_-]/g, '')] || 'META_ADS';
  const stageMap = { contacted: 'CONTACTED', 'not fit': 'NOT_INTERESTED', 'not received': 'CONTACTED', qualified: 'INTERESTED', interested: 'INTERESTED', new: 'NEW', 'not interested': 'NOT_INTERESTED', negotiating: 'NEGOTIATING', won: 'DEAL_CLOSED_WON', lost: 'DEAL_CLOSED_LOST' };
  const status = stageMap[(col(['Stage','Status','Lead Stage','Lead Status'])).toLowerCase().trim()] || 'NEW';
  const name = col(['Full Name','Customer Name','Client Name','Lead Name','Contact Name','Name']).trim();
  const rawPhone = col(['Phone Number','Mobile Number','Contact Number','WhatsApp Number','Phone No','Mobile No','Cell Number','Phone','Mobile','Cell','Contact','WhatsApp','Msisdn']).toString().trim();
  const phone = rawPhone.replace(/[\s\n]/g, '').split(/[,/]/)[0].trim();
  if (!name && !phone) return null;
  const sqft = parseInt(col(['Square Feet Requirement','Sqft','Size','Area Required'])) || 0;
  const propParts = [col(['Interested For','Property','Property Interest','Project','Interest']).trim(), sqft ? sqft + ' sqft' : ''].filter(Boolean);
  const createdAt = parseImportDate(col(['Lead Created Date','Created Date','Created At','Date'])) || now_();
  const updatedAt = now_(); // stamp import time so freshly-imported leads sort to the top
  const priority = col(['Priority Label','Priority']).replace(/priority\s*/i, '').trim() || null;
  return {
    id: 'l' + uid(),
    name: name || 'Unknown', phone,
    email: (col(['Email','Email Address','E-mail','Mail']) || '').split(',')[0].trim(),
    company: col(['Company Name','Company','Organization','Organisation']).trim() || '—',
    source: src, status,
    companyId: user.companyId, // tenant the imported lead belongs to
    assignedTo: user.id, assignedToName: user.name, assignedRole: user.role,
    teamId: user.teamId || 't1', previousAssignees: [],
    propertyInterest: propParts.join(' · '),
    budget: parseFloat((col(['Budget','Budget (BDT)','Budget (AED)','Price','Amount']) || '').toString().replace(/[^\d.]/g, '')) || 0,
    dealValue: 0, dealStatus: null,
    meetingSetBy: null, meetingSetDate: null,
    siteVisitDoneBy: null, siteVisitDoneDate: null,
    notes: '', createdAt, updatedAt,
    callCount: parseInt(col(['Call Count','Calls'])) || 0,
    smsCount: 0, whatsappCount: 0, visitCount: 0,
    meetingDate: null, meetingLocation: '',
    externalId: col(['Lead ID','ID','External ID']) || '',
    priority,
    city: col(['City','Location']).trim(),
    profession: col(['Profession','Job','Occupation']).trim(),
    preferredTime: col(['Prefered Time','Preferred Time']).trim().replace(/_/g, ' '),
    sqft,
    nextFollowup: parseImportDate(col(['Next Follwup Date','Next Followup Date','Follow-up Date'])) || null,
    materialSent: col(['Marketing Material Sent','Material Sent']).trim(),
    _log: col(['Communication Log','Notes','Log']).trim(),
  };
}

// Single dedup identity for a lead: phone digits if present, else name+email.
export function leadDedupKey(l) {
  const p = (l.phone || '').replace(/[^\d]/g, '');
  if (p) return 'p:' + p;
  const n = (l.name || '').toLowerCase().trim();
  const e = (l.email || '').toLowerCase().trim();
  return (n || e) ? 'ne:' + n + '|' + e : '';
}

// Scan the user's leads for duplicates (same phone, or same name+email when no
// phone). Returns groups of >1, each sorted newest-first (keep[0], rest are dups).
export function findDuplicateLeads(user) {
  const leads = getLeads(user);
  const map = new Map();
  leads.forEach(l => {
    const k = leadDedupKey(l);
    if (!k) return;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(l);
  });
  const groups = [];
  map.forEach((arr, key) => {
    if (arr.length > 1) {
      arr.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
      groups.push({ key, leads: arr });
    }
  });
  return groups;
}

export function processImportCSV(text, user) {
  const rows = parseCSV(text);
  const db = getDB();
  const seen = new Set(db.leads.map(leadDedupKey).filter(Boolean)); // existing leads
  const leads = []; let skipped = 0; let blank = 0;
  rows.forEach(row => {
    const lead = mapCSVToLead(row, user);
    if (!lead) { blank++; return; }            // no name AND no phone — unusable row
    const key = leadDedupKey(lead);
    if (key && seen.has(key)) { skipped++; return; } // duplicate (file or existing)
    if (key) seen.add(key);
    leads.push(lead);
  });
  return { leads, skipped, blank, total: rows.length };
}

export function submitImport(importData, user) {
  if (!importData || !importData.leads.length) return 0;
  const { leads } = importData;
  let count = 0;
  mutate(db => {
    const seen = new Set(db.leads.map(leadDedupKey).filter(Boolean));
    leads.forEach(lead => {
      const key = leadDedupKey(lead);
      if (key && seen.has(key)) return; // skip duplicates at insert time
      if (key) seen.add(key);
      const log = lead._log; delete lead._log;
      db.leads.push(lead);
      const acts = [{ id: 'a' + uid(), type: 'CREATED', description: 'Lead imported' + (lead.externalId ? ' (' + lead.externalId + ')' : '') + ' from ' + (SRC_LABELS[lead.source] || lead.source), userId: user.id, userName: user.name, timestamp: lead.createdAt, durationSeconds: 0 }];
      if (log) acts.push({ id: 'a' + uid(), type: 'NOTE', description: log, userId: user.id, userName: user.name, timestamp: lead.updatedAt, durationSeconds: 0 });
      db.activities[lead.id] = acts;
      count++;
    });
  });
  return count;
}

// ── Notifications ──
export function calcPipelineValue(leadId, db) {
  const acts = db.activities?.[leadId] || [];
  const offerAct = acts.find(a => a.type === 'OFFER');
  if (!offerAct) return 0;
  try { return JSON.parse(offerAct.description).pipelineValue || 0; } catch { return 0; }
}

export function getNotifs(userId) { return ((getDB().notifications) || {})[userId] || []; }
export function getUnreadCount(userId) { return getNotifs(userId).filter(n => !n.read).length; }

export function addNotifs(list, currentUser) {
  if (!list || !list.length) return;
  const ts = now_();
  const toInsert = [];
  mutate(db => {
    if (!db.notifications) db.notifications = {};
    list.forEach(({ userId, type, message, leadId }) => {
      if (!userId || (currentUser && userId === currentUser.id)) return;
      const n = { id: 'n' + uid(), type, message, leadId, timestamp: ts, read: false, userId };
      if (!db.notifications[userId]) db.notifications[userId] = [];
      db.notifications[userId].unshift(n);
      if (db.notifications[userId].length > 60) db.notifications[userId].length = 60;
      toInsert.push(n);
    });
  });
  if (toInsert.length) sbUpsertNotifs(toInsert);
}

export function markAllRead(userId) {
  let ids = [];
  mutate(db => {
    const arr = db.notifications?.[userId] || [];
    ids = arr.filter(n => !n.read).map(n => n.id);
    arr.forEach(n => { n.read = true; });
  });
  if (ids.length) sbMarkRead(ids);
}

export function markOneRead(notifId, userId) {
  mutate(db => { const n = (db.notifications[userId] || []).find(x => x.id === notifId); if (n) n.read = true; });
  sbMarkRead([notifId]);
}
