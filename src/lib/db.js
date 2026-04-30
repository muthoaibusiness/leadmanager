import { ROLES, STATUS_LABELS, SRC_LABELS } from './constants.js';
import { uid, now_, fmtBDT, fmtDT, curMonth, startOfMonth, rlabel } from './helpers.js';
import { sbSave, sbUpsertNotifs, sbMarkRead } from './supabase.js';

export const KEY = 'propcrm_v1';
export let _DB = null;

export function getDB() {
  if (!_DB) {
    try { _DB = JSON.parse(localStorage.getItem(KEY)) || null; } catch { }
  }
  if (!_DB) {
    _DB = { users: [], teams: [], leads: [], targets: [], activities: {}, notifications: {} };
  }
  if (!_DB.teams) _DB.teams = [];
  if (!_DB.notifications) _DB.notifications = {};
  return _DB;
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
export function getLeads(user) {
  const db = getDB();
  if (user.role === ROLES.MGMT) return db.leads;
  if (user.role === ROLES.TL) return db.leads.filter(l => l.teamId === user.teamId);
  return db.leads.filter(l => l.assignedTo === user.id);
}

export function getLead(id) { return getDB().leads.find(l => l.id === id); }

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
    const parts = [];
    if (offerData.ourOffer) parts.push('Our offer: ' + fmtBDT(offerData.ourOffer));
    if (offerData.clientOffer) parts.push('Client offer: ' + fmtBDT(offerData.clientOffer));
    if (offerData.totalSft) parts.push('Total SFT: ' + offerData.totalSft);
    if (offerData.pipelineValue) parts.push('Pipeline value: ' + fmtBDT(offerData.pipelineValue));
    if (offerData.notes) parts.push('Note: ' + offerData.notes);
    if (parts.length) addAct(leadId, { type: 'OFFER', description: parts.join(' · '), userId: currentUser.id, userName: currentUser.name, durationSeconds: 0 });
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
  if (role === ROLES.TL) {
    const tid = 't' + uid();
    mutate(db => {
      db.teams = db.teams || [];
      db.teams.push({ id: tid, name: name + "'s Team", leadId: id });
      db.users.push({ id, name, email, password: password || '1234', phone: phone || '', role, teamId: tid });
    });
  } else {
    mutate(db => { db.users.push({ id, name, email, password: password || '1234', phone: phone || '', role, teamId: currentUser.teamId }); });
  }
  return id;
}

export function addLeadFn(name, phone, phones, email, emails, company, source, prop, budget, profession, city, user) {
  const id = 'l' + uid();
  const lead = {
    id, name,
    phone, phones: phones || [phone],
    email: email || '', emails: emails || (email ? [email] : []),
    company: company || '—', source, status: 'NEW',
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
  // case-insensitive column lookup
  const col = (names) => { for (const n of (Array.isArray(names)?names:[names])) { for (const k of Object.keys(row)) { if (k.toLowerCase().trim() === n.toLowerCase().trim()) return row[k] || ''; } } return ''; };
  const srcMap = { meta: 'META_ADS', metaads: 'META_ADS', whatsapp: 'WHATSAPP_ADS', whatsappads: 'WHATSAPP_ADS', linkedin: 'LINKEDIN', website: 'WEBSITE', hotline: 'HOTLINE', personal: 'PERSONAL' };
  const src = srcMap[(col(['Lead Source','Source','LeadSource'])).toLowerCase().trim().replace(/[\s_-]/g, '')] || 'META_ADS';
  const stageMap = { contacted: 'CONTACTED', 'not fit': 'NOT_INTERESTED', 'not received': 'CONTACTED', qualified: 'INTERESTED', interested: 'INTERESTED', new: 'NEW', 'not interested': 'NOT_INTERESTED', negotiating: 'NEGOTIATING' };
  const status = stageMap[(col(['Stage','Status','Lead Stage'])).toLowerCase().trim()] || 'NEW';
  const name = col(['Full Name','Name','Customer Name','Lead Name']).trim();
  const rawPhone = col(['Phone Number','Phone','Mobile','Contact']).trim();
  const phone = rawPhone.replace(/[\s\n]/g, '').split(',')[0].trim();
  if (!name && !phone) return null;
  const sqft = parseInt(col(['Square Feet Requirement','Sqft','Area'])) || 0;
  const propParts = [col(['Interested For','Property','Property Interest']).trim(), sqft ? sqft + ' sqft' : ''].filter(Boolean);
  const createdAt = parseImportDate(col(['Lead Created Date','Created Date','Created At','Date'])) || now_();
  const updatedAt = parseImportDate(col(['Last Communication Date','Last Updated','Updated At'])) || createdAt;
  const priority = col(['Priority Label','Priority']).replace(/priority\s*/i, '').trim() || null;
  return {
    id: 'l' + uid(),
    name: name || 'Unknown', phone,
    email: col(['Email','Email Address']).split(',')[0].trim(),
    company: col(['Company Name','Company']).trim() || '—',
    source: src, status,
    assignedTo: user.id, assignedToName: user.name, assignedRole: user.role,
    teamId: user.teamId || 't1', previousAssignees: [],
    propertyInterest: propParts.join(' · '),
    budget: parseFloat(col(['Budget','Budget (BDT)','Budget (AED)'])) || 0,
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

export function processImportCSV(text, user) {
  const rows = parseCSV(text);
  const db = getDB();
  const existingPhones = new Set(db.leads.map(l => l.phone.replace(/[^\d]/g, '')));
  const leads = []; let skipped = 0;
  rows.forEach(row => {
    const lead = mapCSVToLead(row, user);
    if (!lead) return;
    const p = lead.phone.replace(/[^\d]/g, '');
    if (p && existingPhones.has(p)) { skipped++; return; }
    leads.push(lead);
  });
  return { leads, skipped, total: rows.length };
}

export function submitImport(importData, user) {
  if (!importData || !importData.leads.length) return 0;
  const { leads } = importData;
  let count = 0;
  mutate(db => {
    const ep = new Set(db.leads.map(l => l.phone.replace(/[^\d]/g, '')));
    leads.forEach(lead => {
      const p = lead.phone.replace(/[^\d]/g, '');
      if (p && ep.has(p)) return;
      ep.add(p);
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
