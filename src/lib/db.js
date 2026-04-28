import { ROLES, STATUS_LABELS, SRC_LABELS } from './constants.js';
import { uid, now_, fmtBDT, fmtDT, curMonth, startOfMonth, rlabel } from './helpers.js';
import { USERS, TEAMS, DEF_LEADS, DEF_TARGETS, genActs } from './data.js';
import { sbSave } from './supabase.js';

export const KEY = 'propcrm_v1';
export let _DB = null;

export function getDB() {
  if (!_DB) {
    try { _DB = JSON.parse(localStorage.getItem(KEY)) || null; } catch { }
  }
  if (!_DB) {
    const acts = {};
    DEF_LEADS.forEach(l => { acts[l.id] = genActs(l); });
    _DB = { users: USERS, teams: TEAMS, leads: DEF_LEADS, targets: DEF_TARGETS, activities: acts };
  }
  if (!_DB.teams) _DB.teams = TEAMS;
  if (!_DB.notifications) { _DB.notifications = genSeedNotifs(_DB); }
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

export function deleteLead(leadId) {
  mutate(db => {
    db.leads = db.leads.filter(l => l.id !== leadId);
    delete db.activities[leadId];
  });
}

export function changeStatus(leadId, status, user) {
  updLead(leadId, { status });
  addAct(leadId, { type: 'STATUS_CHANGE', description: 'Status → ' + (STATUS_LABELS[status] || status), userId: user.id, userName: user.name, durationSeconds: 0 });
}

export function fwdLead(leadId, toUser, currentUser) {
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
  return id;
}

// ── CSV Import ──
function parseCSVLine(line) {
  const r = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQ = !inQ;
    else if (c === ',' && !inQ) { r.push(cur); cur = ''; }
    else cur += c;
  }
  r.push(cur); return r;
}

function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/);
  if (!lines.length) return [];
  const headers = parseCSVLine(lines[0]).map(h => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim(); if (!line) continue;
    const vals = parseCSVLine(line);
    const obj = {}; headers.forEach((h, idx) => { obj[h] = (vals[idx] || '').trim(); });
    rows.push(obj);
  }
  return rows;
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
  const srcMap = { meta: 'META_ADS', whatsapp: 'WHATSAPP_ADS', linkedin: 'LINKEDIN', website: 'WEBSITE' };
  const src = srcMap[(row['Lead Source'] || '').toLowerCase().trim().replace(/\s+/g, '')] || 'META_ADS';
  const stageMap = { contacted: 'CONTACTED', 'not fit': 'NOT_INTERESTED', 'not received': 'CONTACTED', qualified: 'INTERESTED', 'not fit ': 'NOT_INTERESTED' };
  const status = stageMap[(row['Stage'] || '').toLowerCase().trim()] || 'NEW';
  const name = (row['Full Name'] || '').trim();
  const rawPhone = (row['Phone Number'] || '').trim();
  const phone = rawPhone.replace(/[\s\n]/g, '').split(',')[0].trim();
  if (!name && !phone) return null;
  const sqft = parseInt(row['Square Feet Requirement']) || 0;
  const propParts = [(row['Interested For'] || '').trim(), sqft ? sqft + ' sqft' : ''].filter(Boolean);
  const createdAt = parseImportDate(row['Lead Created Date']) || now_();
  const updatedAt = parseImportDate(row['Last Communication Date']) || createdAt;
  const priority = (row['Priority Label'] || '').replace(/priority\s*/i, '').trim() || null;
  return {
    id: 'l' + uid(),
    name: name || 'Unknown', phone,
    email: (row['Email'] || '').split(',')[0].trim(),
    company: (row['Company Name'] || '').trim() || '—',
    source: src, status,
    assignedTo: user.id, assignedToName: user.name, assignedRole: user.role,
    teamId: user.teamId || 't1', previousAssignees: [],
    propertyInterest: propParts.join(' · '),
    budget: 0, dealValue: 0, dealStatus: null,
    meetingSetBy: null, meetingSetDate: null,
    siteVisitDoneBy: null, siteVisitDoneDate: null,
    notes: '', createdAt, updatedAt,
    callCount: 0, smsCount: 0, whatsappCount: 0, visitCount: 0,
    meetingDate: null, meetingLocation: '',
    externalId: row['Lead ID'] || '',
    priority,
    city: (row['City'] || '').trim(),
    profession: (row['Profession'] || '').trim(),
    preferredTime: (row['Prefered Time'] || '').trim().replace(/_/g, ' '),
    sqft,
    nextFollowup: parseImportDate(row['Next Follwup Date']) || null,
    materialSent: (row['Marketing Material Sent'] || '').trim(),
    _log: (row['Communication Log'] || '').trim(),
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
export function genSeedNotifs(db) {
  const notifs = {};
  const nid = () => 'n' + Math.random().toString(36).slice(2, 9);
  const add = (toId, type, msg, leadId, ts) => {
    if (!toId || toId === 'system') return;
    if (!notifs[toId]) notifs[toId] = [];
    const read = (Date.now() - new Date(ts)) / 86400000 > 5;
    notifs[toId].push({ id: nid(), type, message: msg, leadId, timestamp: ts, read });
  };
  const mgmtIds = db.users.filter(u => u.role === ROLES.MGMT).map(u => u.id);
  db.leads.forEach(lead => {
    const iaId = lead.previousAssignees[0] || (lead.assignedRole === ROLES.IA ? lead.assignedTo : null);
    const maId = lead.siteVisitDoneBy || lead.previousAssignees[1] || (lead.assignedRole === ROLES.MA ? lead.assignedTo : null);
    if (lead.meetingSetDate) {
      if (lead.assignedRole === ROLES.MA || lead.assignedRole === ROLES.TL)
        add(lead.assignedTo, 'ASSIGNED', 'New lead assigned: ' + lead.name, lead.id, lead.meetingSetDate);
      if (iaId) add(iaId, 'VISIT_SCHED', 'Site visit scheduled for your lead: ' + lead.name, lead.id, lead.meetingSetDate);
    }
    if (lead.siteVisitDoneDate) {
      if (iaId) add(iaId, 'VISIT_DONE', 'Site visit completed: ' + lead.name, lead.id, lead.siteVisitDoneDate);
      if (['NEGOTIATING', 'DEAL_CLOSED_WON', 'DEAL_CLOSED_LOST'].includes(lead.status) && lead.assignedRole === ROLES.TL)
        add(lead.assignedTo, 'FORWARDED', 'Lead ready for negotiation: ' + lead.name, lead.id, lead.siteVisitDoneDate);
    }
    if (lead.status === 'DEAL_CLOSED_WON') {
      const msg = 'Deal WON: ' + lead.name + (lead.dealValue ? ' — ' + fmtBDT(lead.dealValue) : '');
      if (iaId) add(iaId, 'DEAL_WON', msg, lead.id, lead.updatedAt);
      if (maId && maId !== iaId) add(maId, 'DEAL_WON', msg, lead.id, lead.updatedAt);
      mgmtIds.forEach(uid2 => add(uid2, 'DEAL_WON', msg, lead.id, lead.updatedAt));
    }
    if (lead.status === 'DEAL_CLOSED_LOST') {
      if (iaId) add(iaId, 'DEAL_LOST', 'Deal lost on: ' + lead.name, lead.id, lead.updatedAt);
      if (maId && maId !== iaId) add(maId, 'DEAL_LOST', 'Deal lost on: ' + lead.name, lead.id, lead.updatedAt);
    }
  });
  Object.keys(notifs).forEach(uid2 => notifs[uid2].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)));
  return notifs;
}

export function getNotifs(userId) { return ((getDB().notifications) || {})[userId] || []; }
export function getUnreadCount(userId) { return getNotifs(userId).filter(n => !n.read).length; }

export function addNotifs(list, currentUser) {
  if (!list || !list.length) return;
  const ts = now_();
  mutate(db => {
    if (!db.notifications) db.notifications = {};
    list.forEach(({ userId, type, message, leadId }) => {
      if (!userId || (currentUser && userId === currentUser.id)) return;
      if (!db.notifications[userId]) db.notifications[userId] = [];
      db.notifications[userId].unshift({ id: 'n' + uid(), type, message, leadId, timestamp: ts, read: false });
      if (db.notifications[userId].length > 60) db.notifications[userId].length = 60;
    });
  });
}

export function markAllRead(userId) {
  mutate(db => { if (db.notifications && db.notifications[userId]) db.notifications[userId].forEach(n => n.read = true); });
}

export function markOneRead(notifId, userId) {
  mutate(db => { const n = (db.notifications[userId] || []).find(x => x.id === notifId); if (n) n.read = true; });
}
