import { ROLES, STATUS_LABELS, SRC_LABELS, PAST_CONTACT } from './constants.js';
import { uid, now_, fmtBDT, fmtDT, curMonth, startOfMonth, rlabel } from './helpers.js';
import { leadFilterParam, ORDER } from './leadQuery.js';
import { sbGet, sbGetAll, sbCount, sbPage, hasColumn, sbRpc, sbUpdate, sbInsert, sbUpsert, sbMarkRead, sbDelete, sbDeleteLeads, sbEmailsInUse, sbUserIdsByRole, sbActsForLead, sbLoadActWindow, ACT_WINDOW_DAYS, lToR, rToL, uToR, rToU, tToR, rToT, aToR, rToA, rToN, tgToR, rToTg, pToR, rToP, bkToR, rToBk, cToR, rToC, hrToR, rToHr, sbUpsertNotifs } from './supabase.js';
// Bumped from propcrm_v1 when the cloud load became tenant-scoped: every
// existing browser is carrying a full multi-tenant snapshot under the old key,
// and mergeDB would happily fold it back in on top of the scoped one. A new key
// makes every client start cold exactly once.
export const KEY = 'propcrm_v2';
// Which account the cached snapshot belongs to. The snapshot only holds one
// company now, so handing it to a different account is a data leak, not a
// head start — see hydrateFromCloud.
export const OWNER_KEY = 'propcrm_owner';
export let _DB = null;

export function getDB() {
  if (!_DB) {
    try { _DB = JSON.parse(localStorage.getItem(KEY)) || null; } catch { }
  }
  if (!_DB) {
    _DB = { companies: [], users: [], teams: [], leads: [], targets: [], activities: {}, notifications: {}, properties: [], bookings: [], holdRequests: [] };
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
  // Users/teams carry NO updatedAt, so the generic mergeArr (local wins when
  // ts >= remote) makes ts always 0 → a browser's STALE local copy overrides a
  // remote rename forever. User/team edits always push to the cloud via sbUpdate,
  // so the cloud is authoritative: take every remote row, then keep only local-only
  // rows (created offline, not yet synced) on top. Fixes edits not propagating.
  const mergeCloudFirst = (rem = [], loc = []) => {
    const remIds = new Set(rem.filter(x => x && x.id != null).map(x => x.id));
    const localOnly = loc.filter(x => x && x.id != null && !remIds.has(x.id));
    return [...rem.filter(x => x && x.id != null), ...localOnly];
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
  const tomb = (l.deletionLog || []).slice(-8000); // cap growth
  const deleted = new Set(tomb.map(d => d.id));
  // Leads: the CLOUD is the source of truth (so every browser shows the same set).
  // We only keep a local-only lead if it's genuinely fresh (created/updated very
  // recently and not yet synced). Stale local-only leads = ones deleted on another
  // browser, so they are dropped. This stops per-browser divergence (e.g. 36 vs 51).
  //
  // `r.leads === undefined` is NOT the same as `r.leads === []`. The scoped
  // cloud load no longer fetches leads at all (they are paged and counted on
  // demand), so it omits the key entirely; an absent key means "not asked", and
  // the local cache -- including whatever ensureLeadBook has already pulled --
  // is kept as-is. An empty ARRAY still means "the cloud has none", which is
  // what the deletion paths rely on.
  const GRACE_MS = 6 * 60 * 60 * 1000;
  const nowMs = Date.now();
  const remoteIds = new Set((r.leads || []).map(x => x.id));
  const cloudLeads = (r.leads || []).filter(x => !deleted.has(x.id));
  const freshLocal = (l.leads || []).filter(x =>
    !remoteIds.has(x.id) && !deleted.has(x.id) &&
    (nowMs - new Date(x.updatedAt || x.createdAt || 0).getTime() < GRACE_MS)
  );
  const leads = r.leads === undefined
    ? (l.leads || []).filter(x => x && x.id != null && !deleted.has(x.id))
    : [...cloudLeads, ...freshLocal];
  return {
    companies: mergeArr(r.companies, l.companies),
    // users/teams: cloud-authoritative (no updatedAt to compare), never resurrect
    // a tombstoned (deleted) id.
    users: mergeCloudFirst(r.users, l.users).filter(u => !deleted.has(u.id)),
    teams: mergeCloudFirst(r.teams, l.teams).filter(t => !deleted.has(t.id)),
    leads,
    targets: mergeArr(r.targets, l.targets),
    deletionLog: tomb,
    properties: mergeArr(r.properties, l.properties).filter(p => !deleted.has(p.id)),
    bookings: mergeArr(r.bookings, l.bookings),
    holdRequests: mergeArr(r.holdRequests, l.holdRequests),
    activities: mergeActs(r.activities, l.activities),
    notifications: mergeNotifs(r.notifications, l.notifications),
  };
}

// Re-delete from the cloud any lead that was deleted locally (tombstoned) but is
// still present in the remote snapshot — e.g. another tab/device re-uploaded it.
// Run on every load so deletions stay deleted across clients.
export function reconcileDeletions(db, remoteLeads) {
  const tomb = new Set((db.deletionLog || []).map(d => d.id));
  if (!tomb.size || !remoteLeads || !remoteLeads.length) return;
  const ids = remoteLeads.filter(l => tomb.has(l.id)).map(l => l.id);
  if (ids.length) sbDeleteLeads(ids);
}

// One-time purge of the old demo seed accounts/team from local data so they
// don't get re-uploaded to Supabase (cloud copies already removed). Also issues
// a cloud delete for any that slipped through from another device.
const DEMO_SEED_EMAILS = ['rahim@crm.com', 'nusrat@crm.com', 'fatima@crm.com', 'tariq@crm.com', 'masud@crm.com'];
export function purgeDemoSeed(db) {
  let changed = false;
  const killUsers = (db.users || []).filter(u => DEMO_SEED_EMAILS.includes((u.email || '').toLowerCase())).map(u => u.id);
  if (killUsers.length) {
    const s = new Set(killUsers);
    db.users = db.users.filter(u => !s.has(u.id));
    sbDelete('users', killUsers);
    changed = true;
  }
  if (db.teams && db.teams.some(t => t.id === 't1')) {
    db.teams = db.teams.filter(t => t.id !== 't1');
    sbDelete('teams', ['t1']);
    changed = true;
  }
  return changed;
}

// `user` is the signed-in account. When the cloud load was tenant-scoped, this
// function is looking at ONE company's slice, and two of its branches become
// actively wrong:
//   - the 'c1' mint would invent a company that already exists under another id,
//     and then stamp it onto every untagged row, merging two tenants;
//   - the master mint would fire on EVERY scoped login, because a MASTER row
//     (companyId null) is never in a scoped users list — silently recreating a
//     plaintext super-admin account in every agent's browser.
// So under a scoped load it only backfills, using the user's own company id.
export function migrateTenancy(db, user) {
  if (!db.companies) db.companies = [];
  let changed = false;
  const scoped = !!(user && user.role !== ROLES.MASTER && user.companyId);
  if (!db.companies.length) {
    if (scoped) {
      // The company row exists in the cloud; this snapshot just didn't get it
      // (offline, or a failed request). Stand one in locally under the RIGHT id
      // so nothing downstream defaults to 'c1'. Never pushed to the cloud.
      db.companies.push({ id: user.companyId, name: 'My Company', plan: 'Growth', createdAt: now_(), isActive: true });
    } else {
      db.companies.push({ id: 'c1', name: 'My Company', plan: 'Growth', createdAt: now_(), isActive: true });
    }
    changed = true;
  }
  const defCid = scoped ? user.companyId : db.companies[0].id;
  (db.users || []).forEach(u => { if (u.role !== ROLES.MASTER && !u.companyId) { u.companyId = defCid; changed = true; } });
  (db.teams || []).forEach(t => { if (!t.companyId) { t.companyId = defCid; changed = true; } });
  (db.leads || []).forEach(l => { if (!l.companyId) { l.companyId = defCid; changed = true; } });
  (db.properties || []).forEach(p => { if (!p.companyId) { p.companyId = defCid; changed = true; } });
  (db.bookings || []).forEach(b => { if (!b.companyId) { b.companyId = defCid; changed = true; } });
  // Ensure a master account exists so the company-wise view is reachable.
  // Skipped under a scoped load: MASTER carries no companyId, so it is never in
  // a scoped users list and "missing" here proves nothing.
  if (!scoped && !db.users.some(u => u.role === ROLES.MASTER)) {
    db.users.push({ id: 'u0', name: 'Master Admin', email: 'master@wepro.com', password: '1234', role: ROLES.MASTER, teamId: null, companyId: null, phone: '', isActive: true });
    changed = true;
  }
  return changed;
}

// Second line of defence for the scoped realtime socket, and the thing that
// makes the socket's limitations survivable. A realtime `filter` can express
// exactly one `col=eq.val`, so it cannot encode "leads assigned to me OR
// previously assigned to me", and it cannot filter activities by a lead set at
// all — those tables are subscribed loosely and narrowed here instead.
//
// DELETE is always allowed through by the caller: a delete payload carries only
// the primary key under the default replica identity, so scope cannot be
// evaluated. Removing an id this browser does not hold is a no-op, whereas
// blocking it would strand deleted rows in the cache forever.
//
// The tiers must mirror sbLoad's query tiers and getLeads() — if this is looser
// than the load, realtime slowly fills the cache with rows the next reload
// throws away; if it is tighter, live updates go missing.
export function inScope(table, record, user) {
  if (!user || user.role === ROLES.MASTER || !user.companyId) return true;
  if (!record) return true;
  const db = _DB || {};
  const isMgmt = user.role === ROLES.MGMT;
  const isTL = user.role === ROLES.TL;
  const sameCo = sameCompany(record.company_id ?? null, user.companyId);

  switch (table) {
    case 'companies':
      return !record.id || record.id === user.companyId;
    // Only the signed-in user's notifications are ever read (getNotifs /
    // getUnreadCount), and that is all sbLoad fetches. company_id is not the
    // test: it is null on every pre-0009 row, which sameCompany waves through.
    case 'notifications':
      return record.user_id === user.id;
    case 'targets':
      return isMgmt ? sameCo : (db.users || []).some(u => u.id === record.user_id);
    case 'users':
      if (isMgmt) return sameCo;
      if (isTL) return record.team_id === user.teamId || record.id === user.id;
      return record.id === user.id;
    case 'teams':
      return isMgmt ? sameCo : record.id === user.teamId;
    case 'leads': {
      if (isMgmt) return sameCo;
      const prev = Array.isArray(record.previous_assignees) ? record.previous_assignees : [];
      if (isTL) {
        const team = new Set((db.users || []).filter(u => u.teamId === user.teamId).map(u => u.id));
        return record.team_id === user.teamId || team.has(record.assigned_to) || prev.some(id => team.has(id));
      }
      return record.assigned_to === user.id || prev.includes(user.id);
    }
    // Activities cannot be filtered server-side by a lead set, so every one in
    // the company arrives. Keep only those on a lead this browser actually
    // holds — otherwise _DB.activities fills with orphan keys that no view can
    // reach and mergeActs then carries forward forever.
    case 'activities':
      return (db.leads || []).some(l => l.id === record.lead_id);
    default:
      return sameCo;
  }
}

// Notify every active holder of `role` within a scope. db.users no longer holds
// the whole company (an agent's snapshot is a single row), so the recipient list
// has to come from the server rather than from a local filter that would return
// an empty array and drop the notification silently.
export async function addNotifsToRole(role, scope, make, currentUser) {
  try {
    const ids = await sbUserIdsByRole(role, scope);
    if (ids.length) addNotifs(ids.map(make), currentUser);
  } catch (e) { console.warn('notify ' + role + ' failed:', e); }
}

export function applyRealtimeEvent(table, eventType, record, oldRecord, user) {
  if (!_DB) return false;
  if (eventType !== 'DELETE' && !inScope(table, record, user)) return false;
  let changed = false;
  
  const handleArrayEvent = (arrName, converter) => {
    if (!_DB[arrName]) _DB[arrName] = [];
    if (eventType === 'INSERT' || eventType === 'UPDATE') {
      const item = converter(record);
      const idx = _DB[arrName].findIndex(x => x.id === item.id);
      if (idx >= 0) _DB[arrName][idx] = item;
      else _DB[arrName].unshift(item);
      changed = true;
    } else if (eventType === 'DELETE') {
      const id = oldRecord?.id;
      if (id) {
        const before = _DB[arrName].length;
        _DB[arrName] = _DB[arrName].filter(x => x.id !== id);
        if (_DB[arrName].length !== before) changed = true;
      }
    }
  };

  if (table === 'users') handleArrayEvent('users', rToU);
  else if (table === 'teams') handleArrayEvent('teams', rToT);
  else if (table === 'leads') handleArrayEvent('leads', rToL);
  else if (table === 'companies') handleArrayEvent('companies', rToC);
  else if (table === 'properties') handleArrayEvent('properties', rToP);
  else if (table === 'bookings') handleArrayEvent('bookings', rToBk);
  else if (table === 'targets') handleArrayEvent('targets', rToTg);
  else if (table === 'hold_requests') handleArrayEvent('holdRequests', rToHr);
  else if (table === 'activities') {
    if (eventType === 'INSERT' || eventType === 'UPDATE') {
      const act = rToA(record);
      const lid = record.lead_id;
      if (lid) {
        if (!_DB.activities[lid]) _DB.activities[lid] = [];
        const idx = _DB.activities[lid].findIndex(a => a.id === act.id);
        if (idx >= 0) _DB.activities[lid][idx] = act;
        else _DB.activities[lid].unshift(act);
        changed = true;
      }
    } else if (eventType === 'DELETE') {
      const id = oldRecord?.id;
      if (id) {
        Object.keys(_DB.activities).forEach(lid => {
          const arr = _DB.activities[lid];
          const before = arr.length;
          _DB.activities[lid] = arr.filter(a => a.id !== id);
          if (_DB.activities[lid].length !== before) changed = true;
        });
      }
    }
  } else if (table === 'notifications') {
    if (eventType === 'INSERT' || eventType === 'UPDATE') {
      const n = rToN(record);
      const uid = n.userId;
      if (uid) {
        if (!_DB.notifications[uid]) _DB.notifications[uid] = [];
        const idx = _DB.notifications[uid].findIndex(x => x.id === n.id);
        if (idx >= 0) _DB.notifications[uid][idx] = n;
        else _DB.notifications[uid].unshift(n);
        changed = true;
      }
    } else if (eventType === 'DELETE') {
      const id = oldRecord?.id;
      if (id) {
        Object.keys(_DB.notifications).forEach(uid => {
          const arr = _DB.notifications[uid];
          const before = arr.length;
          _DB.notifications[uid] = arr.filter(x => x.id !== id);
          if (_DB.notifications[uid].length !== before) changed = true;
        });
      }
    }
  }

  if (changed) persistLocal(_DB);
  return changed;
}

export function saveDB(db) {
  _DB = db;            // in-memory copy is always current
  persistLocal(db);    // best-effort local cache (never throws)
}

// Same as saveDB, but the localStorage write waits for an idle frame.
// persistLocal stringifies the entire dataset (and retries up to four times on
// QuotaExceededError), which is tens to hundreds of ms of blocked main thread —
// too expensive to run inline during boot. The in-memory assignment stays
// synchronous because refreshDB and every reader downstream depend on it.
const _idle = (fn) => (typeof requestIdleCallback === 'function'
  ? requestIdleCallback(fn, { timeout: 2000 })
  : setTimeout(fn, 0));

export function saveDBDeferred(db) {
  _DB = db;
  _idle(() => persistLocal(db));
}

// localStorage is ~5MB; the full dataset (esp. activities + property media) can
// exceed it and setItem would THROW, crashing whatever triggered the save (even
// navigation). Persist best-effort: full snapshot, then progressively trimmed
// fallbacks. Since sbSave/sbLoad keep the cloud authoritative and mergeDB rebuilds
// the dropped parts on next load, a trimmed cache only costs a reload round-trip.
function persistLocal(db) {
  const attempts = [
    () => JSON.stringify(db),
    () => JSON.stringify({ ...db, activities: {} }),
    () => JSON.stringify({ ...db, activities: {}, properties: (db.properties || []).map(p => ({ ...p, images: [], media: {}, documents: [] })) }),
    () => JSON.stringify({ ...db, activities: {}, notifications: {}, properties: [], bookings: [] }),
  ];
  for (const make of attempts) {
    try {
      localStorage.setItem(KEY, make());
      const sid = JSON.parse(localStorage.getItem('pcrm_sess') || 'null')?.id;
      if (sid) localStorage.setItem(OWNER_KEY, sid);
      return true;
    }
    catch (e) {
      if (e && e.name === 'QuotaExceededError') continue; // shrink and retry
      console.warn('saveDB: local persist failed —', e); return false;
    }
  }
  console.warn('saveDB: localStorage full even after trimming — running on cloud sync only.');
  return false;
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

// Columns login needs. Deliberately explicit: the bulk load must NOT ship
// `password`, and this filtered lookup is the only place it is fetched.
const LOGIN_COLS = 'id,name,email,password,phone,role,team_id,company_id,is_active,avatar,projects,allowed_features';

// Login against the cloud without needing the whole `users` table in memory.
// Tries the cached DB first (keeps working offline / on a warm cache), then
// falls back to a single filtered row.
//
// `ilike` — not `eq` — because tryLogin's cached comparison is case-insensitive
// while PostgREST's `eq` is not, so `eq` would reject on a cold cache the exact
// logins that succeed on a warm one. `ilike` treats `_` (common in emails) and
// `%` as wildcards, so it can over-match; the match below re-checks the address
// exactly, making the server-side filter a narrowing hint rather than the test.
export async function loginRemote(email, pass) {
  const local = tryLogin(email, pass);
  if (local) return local;
  const wanted = String(email).trim().toLowerCase();
  const rows = await sbGet(`users?email=ilike.${encodeURIComponent(wanted)}&select=${LOGIN_COLS}`);
  const hit = (rows || []).map(rToU)
    .find(u => u.email && u.email.toLowerCase() === wanted && u.password === pass);
  if (hit) return hit;

  // Bootstrap escape hatch. migrateTenancy mints the built-in master account
  // when no user exists anywhere; it used to run on every cold boot, but that
  // boot now happens after login, so a brand-new deployment (empty cache AND
  // empty cloud) would have nothing to sign in with. Only fires when the whole
  // dataset is empty, so it cannot resurrect a deleted master.
  const db = getDB();
  if (!db.users.length && !(rows || []).length) {
    migrateTenancy(db);
    saveDB(db);
    return tryLogin(email, pass);
  }
  return null;
}

// Cheap "is there a session at all" probe. getSession() resolves the stored id
// against getDB().users, so on a cold visit with an empty cache it returns null
// even when a valid session exists — it cannot be used to decide whether to
// skip the initial load.
export function hasSessionId() {
  try { return !!JSON.parse(localStorage.getItem('pcrm_sess') || 'null')?.id; }
  catch { return false; }
}

export function getSession() {
  try {
    const s = JSON.parse(localStorage.getItem('pcrm_sess'));
    if (!s) return null;
    return getDB().users.find(u => u.id === s.id) || null;
  } catch { return null; }
}

// Deliberately does NOT stamp OWNER_KEY. The session is set at login, BEFORE
// the old tenant's snapshot has been cleared, so stamping here would mark the
// outgoing user's cache as belonging to the incoming one and cacheBelongsTo
// would wave it through. Only persistLocal stamps, once the data is actually
// this account's.
export function setSession(u) { localStorage.setItem('pcrm_sess', JSON.stringify({ id: u.id })); }

// Drop the cached snapshot AND the in-memory singleton. Since the snapshot now
// only ever holds one company's rows, leaving it behind for the next account to
// merge into is how another tenant's data ends up on screen.
export function clearLocalDB() {
  try { localStorage.removeItem(KEY); localStorage.removeItem(OWNER_KEY); } catch { /* private mode / storage disabled */ }
  _DB = null;
  resetActCache();
  resetLeadCache();
}

export function clearSession() {
  localStorage.removeItem('pcrm_sess');
  clearLocalDB();
}

// True when the cached snapshot was built for a different account. Covers the
// path clearSession cannot: the browser was closed without signing out, or the
// tab crashed, and someone else signs in.
export function cacheBelongsTo(userId) {
  try { return localStorage.getItem(OWNER_KEY) === userId; } catch { return false; }
}

// Fetch one user row by id, without needing the users table in memory. Session
// restore on a cold cache has a stored id but no user, and the scoped load needs
// the user (for companyId) before it can build its filters — chicken and egg.
export async function fetchSessionUser(id) {
  if (!id) return null;
  const rows = await sbGet(`users?id=eq.${encodeURIComponent(id)}&select=${LOGIN_COLS}`);
  return (rows && rows[0]) ? rToU(rows[0]) : null;
}

// ── Queries ──
// A lead belongs to the user's company when its companyId matches OR is missing
// (legacy rows, or rows whose company_id wasn't persisted to Supabase yet — the
// column may not exist. Tolerating null prevents leads from vanishing on reload).
function sameCompany(entityCid, userCid) {
  return !userCid || !entityCid || entityCid === userCid;
}

// opts.involved (IA/MA only): also include leads the agent forwarded (where they
// are a previous assignee), so views like the Leads tab can show/filter their
// forwarded leads (e.g. Meeting Set) even after ownership moved on.
export function getLeads(user, opts = {}) {
  const db = getDB();
  if (user.role === ROLES.MASTER) return db.leads; // master sees everything
  const inCo = db.leads.filter(l => sameCompany(l.companyId, user.companyId));
  if (user.role === ROLES.MGMT) return inCo;
  if (user.role === ROLES.TL) {
    // A Team Lead sees every lead under their team. "Under their team" =
    // the lead originated in the team (teamId) OR is currently/previously
    // handled by any member of the team. The assignee union guards against
    // teamId drift, since fwdLead reassigns `assignedTo` without touching
    // `teamId` — so a lead can sit with a team agent yet carry a stale team.
    const teamMemberIds = new Set(
      db.users.filter(u => u.teamId === user.teamId).map(u => u.id)
    );
    return inCo.filter(l =>
      l.teamId === user.teamId ||
      teamMemberIds.has(l.assignedTo) ||
      (l.previousAssignees || []).some(id => teamMemberIds.has(id))
    );
  }
  if (opts.involved) return inCo.filter(l => l.assignedTo === user.id || (l.previousAssignees || []).includes(user.id));
  return inCo.filter(l => l.assignedTo === user.id);
}

export function getLead(id) { return getDB().leads.find(l => l.id === id); }

// ── Server-side lead queries ──────────────────────────────────────────────
//
// sbLoad no longer ships the lead table. db.leads is now a CACHE of whatever
// has been looked at — the page of results a list is showing, the rows behind a
// KPI card, plus anything a whole-book view pulled — not the account's complete
// set. Two consequences worth knowing:
//
//   * getLeads(user) still works and still filters client-side, but it can only
//     see what has been fetched. Views that genuinely need the complete set
//     call ensureLeadBook() first (useLeadBook does this for them).
//   * Counts NEVER come from db.leads.length. They come from countLeads(),
//     which asks the server, so a KPI card is right even though the rows behind
//     it were never downloaded.
//
// Rows always merge INTO the cache rather than replacing it: a lead open in the
// detail panel must not disappear because the list moved to another page.

// Fold fetched rows into db.leads, newest wins. Returns the converted rows in
// the order the server sent them — the caller renders THAT, not a filter over
// the cache, so server-side ordering and paging survive.
function cacheLeads(rows) {
  const list = (rows || []).map(rToL);
  if (!list.length) return list;
  const db = getDB();
  const byId = new Map((db.leads || []).map(l => [l.id, l]));
  list.forEach(l => byId.set(l.id, l));
  db.leads = [...byId.values()];
  saveDBDeferred(db);
  return list;
}

// The team's member ids, for the Team Lead scope arm. Comes from the users
// snapshot, which for a TL is exactly their team (see sbLoad's tiers).
function teamIds(user) {
  if (!user || user.role !== ROLES.TL) return [];
  return getDB().users.filter(u => u.teamId === user.teamId).map(u => u.id);
}

const leadPath = (opts, tail = '') => {
  const f = leadFilterParam({ ...opts, teamMemberIds: teamIds(opts.user) });
  return `leads?${[f, tail].filter(Boolean).join('&')}`;
};

// Does this database have the flag migration 0010 adds? With it, CONNECTED is
// one predicate and the drill-down can list exactly the leads it counted.
const hasTalkedCol = () => hasColumn('leads', 'talked',
  'CONNECTED is counted with two queries instead of one, and its drill-down lists only the status arm. Apply supabase/migrations/0010_leads_talked_flag.sql.');

// CONNECTED without the `talked` column, counted EXACTLY and without loading a
// single lead row.
//
// The rule is "reached CONTACTED+ OR some CALL activity carries real talk
// time". PostgREST cannot OR a base-table predicate with a related-table one —
// but it can count each half separately, and the two halves are disjoint if the
// second is restricted to leads NOT already past CONTACTED. So:
//
//   count(status in PAST_CONTACT)
// + count(status NOT in PAST_CONTACT and has a CALL with duration > 0)
//
// The second uses an embedded inner join, which is the one place PostgREST does
// express "has a related row matching X". Verified against live data: 149 + 7 =
// 156, matching what the browser used to compute from the full activity log.
async function countConnected(opts) {
  const inPast = `status.in.(${PAST_CONTACT.join(',')})`;
  const notPast = `status.not.in.(${PAST_CONTACT.join(',')})`;
  const base = { ...opts, kpi: undefined };
  const [a, b] = await Promise.all([
    sbCount(leadPath({ ...base, extra: [...(opts.extra || []), inPast] })),
    sbCount(leadPath(
      { ...base, extra: [...(opts.extra || []), notPast] },
      'activities.type=eq.CALL&activities.duration_seconds=gt.0&select=id,activities!inner(id)',
    )),
  ]);
  if (a == null && b == null) return null;
  return (a || 0) + (b || 0);
}

// How many leads match, without fetching any. Returns null when the request
// fails, so a card can show a placeholder instead of a confident wrong zero.
export async function countLeads(opts = {}) {
  if (opts.kpi === 'connected' && !(await hasTalkedCol())) return countConnected(opts);
  return sbCount(leadPath(opts));
}


// One page of matching leads, newest first by default. `page` is 0-based.
// Resolves to { rows, total } with rows already in app shape and cached.
export async function queryLeads(opts = {}, { page = 0, size = 15, sort = 'newest' } = {}) {
  const res = await sbPage(leadPath(opts, `order=${ORDER[sort] || ORDER.newest}`), { page, size });
  if (!res) return null;
  return { rows: cacheLeads(res.rows), total: res.total };
}

// Every matching lead, paginated internally. This is the escape hatch for the
// views that genuinely aggregate over the whole book (pipeline board, reports,
// calendar, agent performance) — it is the expensive call, which is exactly why
// it is no longer on the boot path.
export async function fetchLeadBook(user, opts = {}) {
  const rows = await sbGetAll(leadPath({ user, involved: true, ...opts }, 'order=created_at.desc'));
  return cacheLeads(rows);
}

// Fetch ONE lead by id into the cache. The detail panel can be opened from a
// notification or a carpool request — places that hold only an id — and with
// the book no longer preloaded, that lead may never have been fetched. Resolves
// to true when the cache gained something worth re-rendering for.
export async function ensureLead(id) {
  if (!id || getLead(id)) return false;
  const rows = await sbGet(`leads?id=eq.${encodeURIComponent(id)}&limit=1`);
  return cacheLeads(rows).length > 0;
}

// { key, promise } for the whole-book load, so the ten views that need it share
// one request instead of each firing their own.
let _bookLoad = null;
// Flipped when the first whole-book load RESOLVES. `_bookLoad` alone is set the
// moment the request starts, and a view that read it as "ready" would render a
// confident empty state over a cache that is still filling.
let _bookDone = false;

// Pull the complete lead book once per account. Safe to call from every view
// that needs it; whichever mounts first pays.
export function ensureLeadBook(user) {
  // No user means no scope, and an unscoped book fetch is every lead in every
  // company. Callers can mount before the session resolves, so refuse rather
  // than trust them.
  if (!user || !user.id) return Promise.resolve(false);
  const key = user.id;
  if (_bookLoad && _bookLoad.key === key) return _bookLoad.promise;
  const promise = fetchLeadBook(user)
    .then(rows => { _bookDone = true; return rows.length > 0; })
    .catch(e => { console.warn('lead book load failed:', e); _bookDone = true; return false; });
  _bookLoad = { key, promise };
  return promise;
}

// True once the whole book is in memory. Views use it to tell "no leads" apart
// from "not loaded yet" so they render a loading state instead of a false zero.
export function leadBookReady() { return _bookDone; }

export function resetLeadCache() { _bookLoad = null; _bookDone = false; _projectOpts = null; }

// ── Dashboard rollups (migration 0011) ────────────────────────────────────
//
// The Team Lead / Management / Master dashboards reduce over every lead in
// their scope: revenue and pipeline sums, a status funnel, a source mix, a
// 14-day trend, a per-agent leaderboard, team talk time. None of that is a
// count, and PostgREST cannot aggregate here, so those pages were the last
// thing still downloading the whole book.
//
// These three call the functions 0011 installs. Each returns null when the
// migration has not been applied, and every caller then falls back to the
// in-browser reduction over ensureLeadBook()'s data — so the app behaves the
// same either way, just with a very different payload.

// Which ids the scope covers, for the per-agent and per-team arms. MANAGEMENT
// and MASTER pass none (the whole company / everything); a Team Lead passes
// their roster, which db.users already holds.
function scopeArgs(user, { teamId = null, userIds = null } = {}) {
  return {
    p_company: user && user.role !== ROLES.MASTER ? (user.companyId ?? null) : null,
    p_team: teamId,
    p_user_ids: userIds,
  };
}

const iso = (d) => (d ? new Date(d).toISOString() : null);

export async function dashboardRollup(user, { teamId = null, userIds = null, start = null, end = null, trendDays = 14 } = {}) {
  return sbRpc('dashboard_rollup', {
    ...scopeArgs(user, { teamId, userIds }),
    p_start: iso(start), p_end: iso(end), p_trend_days: trendDays,
  });
}

// Per-agent leaderboard. `userIds` is required — the function returns one row
// per id given, including agents with no leads at all.
export async function agentLeadStats(user, userIds, { start = null, end = null, monthStart = null } = {}) {
  if (!userIds || !userIds.length) return [];
  const rows = await sbRpc('agent_lead_stats', {
    p_user_ids: userIds,
    p_company: user && user.role !== ROLES.MASTER ? (user.companyId ?? null) : null,
    p_start: iso(start), p_end: iso(end), p_month_start: iso(monthStart),
  });
  if (!rows) return null;
  return rows.map(r => ({
    userId: r.user_id,
    leads: Number(r.leads) || 0,
    calls: Number(r.calls) || 0,
    won: Number(r.won) || 0,
    closed: Number(r.closed) || 0,
    revenue: Number(r.revenue) || 0,
    converted: Number(r.converted) || 0,
    meetingsSet: Number(r.meetings_set) || 0,
    visitsDone: Number(r.visits_done) || 0,
  }));
}

// Per-day stage events for the conversion panel's trend chart. Same shape
// buildStageTrend() produces, so the panel can render either source.
export async function stageTrend(user, { teamId = null, userIds = null, days = 30 } = {}) {
  return sbRpc('stage_trend', {
    ...scopeArgs(user, { teamId, userIds }),
    p_days: days,
  });
}

export async function activityRollup(user, { userIds = null, start = null, end = null } = {}) {
  return sbRpc('activity_rollup', {
    p_company: user && user.role !== ROLES.MASTER ? (user.companyId ?? null) : null,
    p_user_ids: userIds,
    p_start: iso(start), p_end: iso(end),
  });
}

// Distinct project names for the Leads tab's project filter.
//
// The options cannot come from the rows on screen any more (one page of 15
// would offer one page's worth of projects), and they cannot come from the
// project catalog either: the interest picker accepts free text and CSV import
// brings its own names, so a catalog-driven list would both miss real values
// and offer dead ones. So: one column, every row, once per account. A single
// short text column is a fraction of a full lead row, and the result is cached
// for the session.
let _projectOpts = null;
export async function fetchLeadProjects(user) {
  const key = user?.id || 'anon';
  if (_projectOpts && _projectOpts.key === key) return _projectOpts.promise;
  const path = leadPath({ user, involved: true, extra: ['property_interest.neq.'] }, 'select=property_interest');
  const promise = sbGetAll(path)
    .then(rows => {
      // propertyInterest holds one or more names in a single string, and the
      // writers disagree on the separator (', ' vs ' · '). Split on both, and
      // dedupe case-insensitively keeping the first spelling seen — otherwise
      // "Sky Villa" and "sky villa" list twice and select the same leads.
      const seen = new Map();
      (rows || []).forEach(r => {
        String(r.property_interest || '').split(/[,·]/).forEach(p => {
          const v = p.trim();
          if (!v) return;
          const k = v.toLowerCase();
          if (!seen.has(k)) seen.set(k, v);
        });
      });
      return [...seen.values()].sort((a, b) => a.localeCompare(b));
    })
    .catch(e => { console.warn('project options load failed:', e); return []; });
  _projectOpts = { key, promise };
  return promise;
}




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

// ── On-demand activity loading ────────────────────────────────────────────
// sbLoad no longer ships activities. Nothing in _DB.activities is guaranteed to
// be there, so everything that reads it goes through one of the two ensure*
// calls below first. Both merge INTO the existing map by activity id, never
// replace it: a lead whose full history was fetched for the detail panel must
// not be trimmed back to the 60-day window when a dashboard later loads, and a
// locally-created activity that has not round-tripped to the cloud yet must
// survive both.

// leadIds whose FULL history is in memory (fetched by ensureLeadActs). A lead
// missing from this set may still have rows -- from the window load, realtime,
// or a local write -- they are just not known to be complete.
const _actsFull = new Set();
// leadId -> in-flight promise, so two panels opening the same lead (or a
// re-render mid-fetch) share one request instead of racing.
const _actsInflight = new Map();
// { key, promise } for the aggregate window; `key` is user id + day count so
// switching account or widening the window refetches.
let _actWindow = null;

// Union `map` ({ leadId: Activity[] }) into db.activities, newest row per id.
// Returns true when anything actually changed, so callers can skip a re-render.
function mergeActMap(db, map) {
  let changed = false;
  if (!db.activities) db.activities = {};
  Object.entries(map || {}).forEach(([lid, arr]) => {
    if (!arr || !arr.length) return;
    const cur = db.activities[lid] || [];
    const byId = new Map(cur.map(a => [a.id, a]));
    arr.forEach(a => {
      if (!a || a.id == null || byId.has(a.id)) return;
      byId.set(a.id, a);
      changed = true;
    });
    if (byId.size !== cur.length) db.activities[lid] = [...byId.values()];
  });
  return changed;
}

// True when this lead's complete history is already in memory. The detail panel
// uses it to decide between rendering a spinner and rendering the cache.
export function hasFullActs(leadId) { return _actsFull.has(leadId); }

// Load ONE lead's full activity history. Cache-first by contract: the caller
// renders getActs(leadId) immediately and this refreshes underneath, so
// reopening a lead never shows a spinner. Resolves to true when the cache
// changed and the caller should re-render.
//
// Unions rather than replaces, for the same reason mergeDB does: a row this
// browser just wrote may not have reached the cloud yet, and the response would
// otherwise erase it. Activities are append-only in practice -- the only delete
// path (deleteLead) drops the lead's whole key -- so nothing needs the response
// to be authoritative about absence.
export function ensureLeadActs(leadId) {
  if (!leadId) return Promise.resolve(false);
  const running = _actsInflight.get(leadId);
  if (running) return running;
  const p = sbActsForLead(leadId)
    .then(acts => {
      const db = getDB();
      const changed = mergeActMap(db, { [leadId]: acts || [] });
      _actsFull.add(leadId);
      if (changed) saveDBDeferred(db);
      return changed;
    })
    .catch(e => { console.warn('activity load failed for lead ' + leadId + ':', e); return false; })
    .finally(() => { _actsInflight.delete(leadId); });
  _actsInflight.set(leadId, p);
  return p;
}

// Load the recent-activity window used by every aggregate view (funnel, agent
// performance, activity feeds). Runs at most once per account+window; call it
// freely from every such view's mount.
export function ensureActWindow(user, days = ACT_WINDOW_DAYS) {
  const db = getDB();
  const leadIds = (db.leads || []).map(l => l.id);
  // The lead count is part of the key on purpose. A dashboard can mount before
  // hydrateFromCloud has landed, when db.leads is empty or partial -- for an
  // agent or Team Lead the lead set IS the query, so that load would return
  // nothing and a plain user-id key would cache the emptiness forever. Keying
  // on the count makes the arrival of the real lead set trigger exactly one
  // refetch; mergeActMap dedupes by activity id, so the overlap costs nothing.
  const key = (user?.id || 'anon') + ':' + days + ':' + leadIds.length;
  if (_actWindow && _actWindow.key === key) return _actWindow.promise;
  const promise = sbLoadActWindow(user, leadIds, days)
    .then(map => {
      if (!map) return false;
      const d = getDB();
      const changed = mergeActMap(d, map);
      if (changed) saveDBDeferred(d);
      return changed;
    })
    .catch(e => { console.warn('activity window load failed:', e); return false; });
  _actWindow = { key, promise };
  return promise;
}

// Forget that a lead's history was fully loaded. Must be called wherever
// db.activities[leadId] is dropped, or a lead id reused after a delete would
// render an empty timeline and never refetch.
export function forgetLeadActs(leadId) {
  _actsFull.delete(leadId);
  _actsInflight.delete(leadId);
}

// One person's recent activity, newest first — the Team Activity feed.
//
// Scoped to a SINGLE user on the server. The feed used to reduce over the whole
// 60-day activity window for the entire team and then slice 30 rows off the
// front, which meant downloading every teammate's history to show one column of
// it. This asks for exactly the rows it renders.
//
// The lead's name comes back through the embedded relationship rather than from
// a second round trip or from db.leads — the feed labels each row with it, and
// the lead itself may not be cached at all now that leads load per page.
export async function fetchUserActivity(userId, { limit = 40 } = {}) {
  if (!userId) return [];
  const rows = await sbGet(
    `activities?select=id,type,description,timestamp,duration_seconds,user_id,user_name,lead_id,leads(name)`
    + `&user_id=eq.${encodeURIComponent(userId)}&order=timestamp.desc&limit=${limit}`,
  );
  return (rows || []).map(r => ({
    ...rToA(r),
    leadId: r.lead_id,
    // A deleted lead leaves its activities behind; label those rather than
    // dropping them, so the feed does not silently lose entries.
    leadName: r.leads?.name || 'Deleted customer',
  }));
}

// Drop every on-demand marker. Called on sign-out and on a tenant switch: the
// underlying _DB is thrown away there, so leaving "full" flags behind would
// make the next account's panels render an empty timeline and never refetch.
export function resetActCache() {
  _actsFull.clear();
  _actsInflight.clear();
  _actWindow = null;
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

// Live display name for a userId, resolved from the cloud-authoritative users
// list. Activities and leads store a NAME SNAPSHOT (userName / assignedToName)
// that goes stale when a user is renamed — always resolve by id so the current
// name shows everywhere, falling back to the stored snapshot if the id is gone.
export function userNameById(userId, fallback = null) {
  if (!userId || userId === 'system') return fallback;
  const u = getDB().users.find(x => x.id === userId);
  return (u && u.name) || fallback;
}

// Update an agent's editable fields (name/phone) and project assignment.
// projects: 'ALL' (all projects) | array of property ids | [] (none).
export function updateAgent(userId, fields) {
  let updated;
  mutate(db => {
    const u = db.users.find(x => x.id === userId);
    if (u) { Object.assign(u, fields); updated = u; }
  });
  // Push to the cloud too. Without this the edit lives only in localStorage and
  // the next reload wipes it: sbLoad + mergeDB take the remote snapshot wholesale.
  if (updated) sbUpdate('users', userId, uToR(updated));
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
  const newProp = { id, companyId, ...p, createdAt: now_(), updatedAt: now_() };
  mutate(db => {
    if (!db.properties) db.properties = [];
    db.properties.unshift(newProp);
  });
  sbInsert('properties', pToR(newProp));
  return id;
}

export function updatePropertyFn(id, upd) {
  let updatedProp;
  mutate(db => {
    const i = (db.properties || []).findIndex(p => p.id === id);
    if (i >= 0) {
      db.properties[i] = { ...db.properties[i], ...upd, updatedAt: now_() };
      updatedProp = db.properties[i];
    }
  });
  if (updatedProp) sbUpdate('properties', id, pToR(updatedProp));
}

export function deletePropertyFn(id) {
  mutate(db => {
    const p = (db.properties || []).find(x => x.id === id);
    db.properties = (db.properties || []).filter(x => x.id !== id);
    // Tombstone so the cloud copy is never resurrected by mergeDB on reload.
    if (!db.deletionLog) db.deletionLog = [];
    db.deletionLog.push({ id, name: p?.name || 'project', kind: 'property', deletedBy: 'admin', deletedAt: now_() });
  });
  sbDelete('properties', [id]); // hard-delete from Supabase
}

// ── Unit booking (seat-style) ──
// Build a unit list from the "saleable unit codes" text (e.g. "01, 02, A-4"),
// falling back to U-01…U-N from Total units. Existing units with the same code
// keep their status (hold/booked/sold), so editing codes never wipes live data.
export function unitsFromCodes(saleableUnits, totalUnits, existing = []) {
  const codes = (saleableUnits || '')
    .split(/[\n,;/]+|\s{2,}/)
    .map(s => s.trim())
    .filter(Boolean);
  const list = codes.length
    ? codes
    : Array.from({ length: totalUnits || 0 }, (_, i) => 'U-' + String(i + 1).padStart(2, '0'));
  const byNo = new Map((existing || []).map(u => [u.no, u]));
  return list.map(no => byNo.get(no) || ({ no, status: 'available', heldBy: null, heldByName: '', heldAt: null }));
}

export function genUnits(p) {
  if (p.units && p.units.length) return p.units;
  return unitsFromCodes(p.saleableUnits, p.totalUnits, []);
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
    // Keep the stored units in step with the saleable codes (so actions target the
    // same units the grid shows), preserving existing statuses by matching code.
    if (p.saleableUnits && p.saleableUnits.trim()) p.units = unitsFromCodes(p.saleableUnits, p.totalUnits, p.units);
    else if (!p.units || !p.units.length) p.units = genUnits(p);
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
      
      // Upsert booking
      sbUpsert('bookings', [bkToR(bk)]);
    }
  });
  // Update property since units changed
  const p = getProperty(propId);
  if (p) sbUpdate('properties', propId, { units: p.units, updated_at: p.updatedAt });
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
  if (changed) {
    saveDB(db);
    (db.properties || []).forEach(p => {
       sbUpdate('properties', p.id, { units: p.units, updated_at: p.updatedAt });
    });
    // For simplicity, we can rely on realtime subscriptions for others, but let's bulk upsert bookings since they are EXPIRED
    const expBks = (db.bookings || []).filter(b => b.status === 'EXPIRED');
    if (expBks.length) sbUpsert('bookings', expBks.map(bkToR));
  }
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
  const bk = {
    id, leadId, leadName: l.name, companyId: l.companyId || user.companyId, propertyId: c.propertyId, propertyName: c.propertyName,
    unitNo: c.unitNo || null, agentId: user.id, agentName: user.name,
    total, status: 'ACTIVE', schedule: defaultSchedule(total), payments: [],
    createdAt: now_(), updatedAt: now_(),
  };
  mutate(d => {
    if (!d.bookings) d.bookings = [];
    d.bookings.unshift(bk);
  });
  sbInsert('bookings', bkToR(bk));
  return id;
}

export function recordPayment(bookingId, { amount, method, ref, scheduleIdx }, user) {
  let updatedBk;
  mutate(db => {
    const b = (db.bookings || []).find(x => x.id === bookingId);
    if (!b) return;
    if (!b.payments) b.payments = [];
    b.payments.push({ id: 'pm' + uid(), amount: parseFloat(amount) || 0, method: method || 'Cash', ref: ref || '', date: now_(), by: user.name });
    if (scheduleIdx != null && b.schedule[scheduleIdx]) { b.schedule[scheduleIdx].paid = true; b.schedule[scheduleIdx].paidDate = now_(); }
    const paid = b.payments.reduce((s, p) => s + (p.amount || 0), 0);
    if (paid >= (b.total || 0) && b.total > 0) b.status = 'COMPLETED';
    b.updatedAt = now_();
    updatedBk = b;
  });
  if (updatedBk) sbUpdate('bookings', bookingId, { payments: updatedBk.payments, schedule: updatedBk.schedule, status: updatedBk.status, updated_at: updatedBk.updatedAt });
}

export function setBookingStatus(bookingId, status) {
  let updatedBk;
  mutate(db => { const b = (db.bookings || []).find(x => x.id === bookingId); if (b) { b.status = status; b.updatedAt = now_(); updatedBk = b; } });
  if (updatedBk) sbUpdate('bookings', bookingId, { status: updatedBk.status, updated_at: updatedBk.updatedAt });
}

// ── Commerce pipeline (cart → checkout → payment → purchased) ──
export const CART_STAGES = ['CART', 'CHECKOUT', 'PAYMENT', 'PURCHASED'];
export const CART_STAGE_LABEL = { CART: 'In Cart', CHECKOUT: 'Offer Sent', PAYMENT: 'Payment / Locked', PURCHASED: 'Purchased' };

export function cartAdd(leadId, property, unitNo, user) {
  const cart = {
    propertyId: property.id, propertyName: property.name, unitNo: unitNo || null,
    stage: 'CART', value: property.askingPrice || 0,
    addedBy: user.id, addedByName: user.name, addedAt: now_(), updatedAt: now_(),
  };
  updLead(leadId, { cart });
  addAct(leadId, { type: 'CART', description: 'Added to cart: ' + property.name + (unitNo ? ' · Unit ' + unitNo.replace('U-', '') : ''), userId: user.id, userName: user.name, durationSeconds: 0 });
}

export function cartRemove(leadId, user) {
  updLead(leadId, { cart: null });
  addAct(leadId, { type: 'CART', description: 'Removed project from cart', userId: user.id, userName: user.name, durationSeconds: 0 });
}

// advance: 'CHECKOUT' | 'PAYMENT' | 'PURCHASED'
export function cartStage(leadId, stage, user, value) {
  const l0 = getLead(leadId);
  if (!l0 || !l0.cart) return;
  const cart = { ...l0.cart, stage, updatedAt: now_() };
  if (value != null) cart.value = value;
  updLead(leadId, { cart });
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
  const newAct = { ...act, id: 'a' + uid(), timestamp: now_() };
  mutate(db => {
    // activities.company_id exists so the load can be tenant-scoped in the
    // query (migration 0009). Inherit it from the lead the activity belongs to.
    if (newAct.companyId == null) newAct.companyId = db.leads.find(l => l.id === leadId)?.companyId ?? null;
    if (!db.activities[leadId]) db.activities[leadId] = [];
    db.activities[leadId].unshift(newAct);
  });
  sbInsert('activities', aToR(newAct, leadId));
}

export function updLead(id, upd) {
  const ts = now_();
  mutate(db => {
    const i = db.leads.findIndex(l => l.id === id);
    if (i >= 0) db.leads[i] = { ...db.leads[i], ...upd, updatedAt: ts };
  });
  const snakeUpd = { updated_at: ts };
  Object.keys(upd).forEach(k => {
    const snake = k.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
    snakeUpd[snake] = upd[k];
  });
  sbUpdate('leads', id, snakeUpd);
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
    forgetLeadActs(leadId); // the "full history loaded" flag must die with the key
  });
  sbDeleteLeads([leadId]); // deep cloud delete (children first) so it doesn't return on reload
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
    leadIds.forEach(id => { delete db.activities[id]; forgetLeadActs(id); });
  });
  sbDeleteLeads(leadIds); // deep cloud delete (children first) so they don't return on reload
}

// Remove duplicate leads from the DB (keep newest per phone / name+email). Used
// as a one-shot cleanup on load so the app stops re-uploading dupes to the cloud.
export function dedupeLeads(db) {
  const seen = new Set();
  const removed = [];
  const keep = [];
  [...(db.leads || [])]
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))
    .forEach(l => {
      const k = leadDedupKey(l);
      if (k && seen.has(k)) { removed.push(l.id); return; }
      if (k) seen.add(k);
      keep.push(l);
    });
  if (removed.length) {
    db.leads = keep;
    removed.forEach(id => { if (db.activities) delete db.activities[id]; forgetLeadActs(id); });
    if (!db.deletionLog) db.deletionLog = [];
    removed.forEach(id => db.deletionLog.push({ id, name: 'duplicate', deletedBy: 'system', deletedAt: now_() }));
    sbDeleteLeads(removed); // purge from cloud too (deep)
  }
  return removed.length;
}

export function getDeletionLog() {
  const db = getDB();
  return (db.deletionLog || []).filter(d => d.kind !== 'property').slice().sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
}

export function changeStatus(leadId, status, user) {
  // Advancing a stage restarts the "No Answer" attempt counter and clears any
  // active lock — each stage gets its own fresh 7-attempt budget.
  updLead(leadId, { status, noAnswerCount: 0, noAnswerLockUntil: null });
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

export function schedVisit(leadId, dt, loc, user, projects) {
  const patch = { status: 'SITE_VISIT_SCHEDULED', meetingDate: dt, meetingLocation: loc };
  if (Array.isArray(projects) && projects.length) {
    patch.visitProjects = projects;
    // Reflect the latest projects on the lead profile (Project Interest).
    patch.propertyInterest = projects.map(p => p.name).join(', ');
  }
  updLead(leadId, patch);
  const projTxt = (projects && projects.length) ? ' · ' + projects.map(p => p.name).join(', ') : '';
  addAct(leadId, { type: 'STATUS_CHANGE', description: 'Site visit scheduled for ' + fmtDT(dt) + (loc ? ' at ' + loc : '') + projTxt, userId: user.id, userName: user.name, durationSeconds: 0 });
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
  if (iaId) addNotifs([{ userId: iaId, type: 'VISIT_DONE', message: 'Site visit completed: ' + l.name, leadId }], user);
  // The lead's Team Leads are not in this browser's snapshot when a Meeting
  // Agent marks the visit done — an agent loads only its own user row.
  addNotifsToRole(ROLES.TL, { companyId: user.companyId, teamId: l.teamId },
    (userId) => ({ userId, type: 'VISIT_DONE', message: 'Site visit done — ready to close: ' + l.name, leadId }), user);
}

export function closeDealFn(leadId, won, val, user) {
  const status = won ? 'DEAL_CLOSED_WON' : 'DEAL_CLOSED_LOST';
  updLead(leadId, { status, dealValue: won ? parseFloat(val) || 0 : 0, dealStatus: won ? 'WON' : 'LOST' });
  addAct(leadId, { type: 'DEAL', description: 'Deal ' + (won ? 'WON — ' + fmtBDT(val) : 'LOST'), userId: user.id, userName: user.name, durationSeconds: 0 });
  const l = getLead(leadId);
  const msg = won ? 'Deal WON: ' + l.name + (val ? ' — ' + fmtBDT(val) : '') : 'Deal lost: ' + l.name;
  const type = won ? 'DEAL_WON' : 'DEAL_LOST';
  addNotifs([...new Set(l.previousAssignees)].map(userId => ({ userId, type, message: msg, leadId })), user);
  // MANAGEMENT is resolved server-side: this used to read db.users, which held
  // every tenant (so it notified all of them) and now holds only the signed-in
  // agent (so it would notify nobody).
  addNotifsToRole(ROLES.MGMT, { companyId: user.companyId },
    (userId) => ({ userId, type, message: msg, leadId }), user);
}

export function setFollowUpFn(leadId, days, user) {
  const date = new Date();
  date.setDate(date.getDate() + parseInt(days));
  const iso = date.toISOString();
  updLead(leadId, { nextFollowup: iso });
  addAct(leadId, { type: 'FOLLOW_UP', description: 'Follow-up reminder set for ' + days + ' day' + (days == 1 ? '' : 's') + ' — ' + new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }), userId: user.id, userName: user.name, durationSeconds: 0 });
}

// Schedule a follow-up at an exact date+time (ISO string).
export function setFollowUpAt(leadId, iso, user) {
  updLead(leadId, { nextFollowup: iso });
  const when = new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  addAct(leadId, { type: 'FOLLOW_UP', description: 'Follow-up scheduled for ' + when, userId: user.id, userName: user.name, durationSeconds: 0 });
}

// 24h cool-off applied once an agent burns through a batch of attempts.
const NO_ANSWER_LOCK_MS = 24 * 60 * 60 * 1000;

// Returns the active lock expiry (a Date in the future) if the lead is currently
// locked for no-answer, else null. A lock whose time has passed reads as null —
// the lead is free again and the next attempt starts a fresh batch.
export function noAnswerLock(lead) {
  const until = lead?.noAnswerLockUntil ? new Date(lead.noAnswerLockUntil) : null;
  return until && until > new Date() ? until : null;
}

// Phase-1 "No Answer": log a 0-min call attempt and auto-schedule a same-time
// follow-up for tomorrow, keeping status unchanged. After `maxAttempts` no-answers
// the lead is LOCKED for 24h — its status is NOT changed (no auto-disqualify);
// once the lock lifts the agent is granted a fresh batch of attempts. Calling
// while still locked is a no-op that returns { locked: true, lockUntil }.
// Returns { attempts, hitCap, locked, lockUntil }.
export function logNoAnswer(leadId, user, maxAttempts = 7) {
  const lead = getLead(leadId);
  if (!lead) return { attempts: 0, hitCap: false, locked: false };

  const now = new Date();
  const lockUntil = lead.noAnswerLockUntil ? new Date(lead.noAnswerLockUntil) : null;

  // Still inside the 24h cool-off → refuse; the lead is locked.
  if (lockUntil && lockUntil > now) {
    return { attempts: lead.noAnswerCount || 0, hitCap: true, locked: true, lockUntil: lockUntil.toISOString() };
  }

  // A lapsed lock means the cool-off elapsed → start a fresh batch of attempts.
  const prior = lockUntil ? 0 : (lead.noAnswerCount || 0);
  const attempts = prior + 1;
  const callTotal = (lead.callCount || 0) + 1;
  const hitCap = attempts >= maxAttempts;

  const patch = { noAnswerCount: attempts, callCount: callTotal };
  if (hitCap) {
    // Lock for 24h without touching status; resurface via a follow-up when it lifts.
    const until = new Date(now.getTime() + NO_ANSWER_LOCK_MS);
    patch.noAnswerLockUntil = until.toISOString();
    patch.nextFollowup = until.toISOString();
  } else {
    patch.noAnswerLockUntil = null;
    const next = new Date(); next.setDate(next.getDate() + 1);
    patch.nextFollowup = next.toISOString();
  }
  updLead(leadId, patch);

  addAct(leadId, {
    type: 'CALL', result: 'No Answer', durationSeconds: 0,
    description: 'Call attempt · No Answer (' + attempts + '/' + maxAttempts + ')',
    userId: user.id, userName: user.name,
  });
  const when = new Date(patch.nextFollowup).toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  addAct(leadId, {
    type: 'FOLLOW_UP', durationSeconds: 0,
    description: hitCap
      ? maxAttempts + ' attempts reached — locked 24h, retry after ' + when
      : 'Auto follow-up next day — ' + when,
    userId: user.id, userName: user.name,
  });
  return { attempts, hitCap, locked: false, lockUntil: hitCap ? patch.noAnswerLockUntil : null };
}

// Meeting Agent attended the scheduled meeting — flag it + log to the timeline.
// Status stays so the agent can then Schedule the Site Visit (booking).
export function attendMeeting(leadId, user) {
  const lead = getLead(leadId);
  if (!lead) return;
  updLead(leadId, { meetingAttended: true, meetingAttendedAt: now_() });
  addAct(leadId, { type: 'VISIT', description: 'Meeting attended', userId: user.id, userName: user.name, durationSeconds: 0 });
}

// Meeting Agent reschedules a hand-off meeting to a new time/day. Logs the change
// to the lead's activity timeline (old → new).
export function rescheduleMeeting(leadId, iso, user, link, type) {
  const lead = getLead(leadId);
  if (!lead) return;
  const oldAt = lead.meetingAt;
  const newType = type || lead.meetingType || 'ONLINE';
  const patch = { meetingAt: new Date(iso).toISOString(), meetingType: newType };
  if (link !== undefined) patch.meetingLink = newType === 'ONLINE' ? link : '';
  updLead(leadId, patch);
  const fmt = (d) => d ? new Date(d).toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
  addAct(leadId, {
    type: 'FOLLOW_UP', durationSeconds: 0,
    description: (oldAt ? 'Meeting rescheduled: ' + fmt(oldAt) + ' → ' : 'Meeting time set: ') + fmt(iso),
    userId: user.id, userName: user.name,
  });
}

// ── Hold requests (agent → management approval workflow) ─────────────────────
export function getHoldRequests() {
  const cid = currentCompanyId();
  const all = getDB().holdRequests || [];
  return cid ? all.filter(r => sameCompany(r.companyId, cid)) : all;
}

// Agent asks management to hold a unit. Records the request (pending) + notifies
// every Management user in the company. Unit status is set by the caller.
export function createHoldRequest(payload, user) {
  const id = 'hr' + uid();
  const req = {
    id, companyId: user.companyId, status: 'pending',
    createdAt: now_(), holdUntil: null, decidedAt: null, decidedBy: '',
    ...payload, agentId: user.id, agentName: user.name,
  };
  mutate(db => { db.holdRequests = db.holdRequests || []; db.holdRequests.unshift(req); });
  sbInsert('hold_requests', hrToR(req));
  addNotifsToRole(ROLES.MGMT, { companyId: user.companyId }, (userId) => ({
    userId, type: 'HOLD_REQUEST', leadId: null,
    message: `${user.name} requested a hold on ${payload.propertyName} · Unit ${payload.unitId} for ${payload.clientName}`,
  }), user);
  return id;
}

// Management accepts/rejects. On accept, stamps a hold-until date (default 2 days).
// Returns the updated request so the caller can update the unit. Notifies the agent.
export function decideHoldRequest(id, approve, user, days = 2) {
  let req = null;
  mutate(db => {
    const r = (db.holdRequests || []).find(x => x.id === id);
    if (!r) return;
    r.status = approve ? 'approved' : 'rejected';
    r.decidedAt = now_();
    r.decidedBy = user.name;
    if (approve) r.holdUntil = new Date(Date.now() + days * 86400000).toISOString();
    req = { ...r };
  });
  if (req) {
    sbUpdate('hold_requests', req.id, hrToR(req));
    const until = req.holdUntil ? new Date(req.holdUntil).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '';
    addNotifs([{
      userId: req.agentId, type: approve ? 'HOLD_APPROVED' : 'HOLD_REJECTED', leadId: null,
      message: approve
        ? `Hold approved — ${req.propertyName} · Unit ${req.unitId} booked until ${until}`
        : `Hold rejected — ${req.propertyName} · Unit ${req.unitId}`,
    }], user);
  }
  return req;
}

// ── Carpool requests (Meeting Agent → Management approval for a site-visit ride) ──
export function getCarpoolRequests() {
  const cid = currentCompanyId();
  const all = getDB().carpoolRequests || [];
  return cid ? all.filter(r => sameCompany(r.companyId, cid)) : all;
}

export function createCarpoolRequest(payload, user) {
  const id = 'cp' + uid();
  const req = {
    id, companyId: user.companyId, status: 'pending',
    createdAt: now_(), decidedAt: null, decidedBy: '',
    ...payload, agentId: user.id, agentName: user.name,
  };
  mutate(db => { db.carpoolRequests = db.carpoolRequests || []; db.carpoolRequests.unshift(req); });
  if (payload.leadId) updLead(payload.leadId, { carpoolRequested: true });
  addNotifsToRole(ROLES.MGMT, { companyId: user.companyId }, (userId) => ({
    userId, type: 'CARPOOL_REQUEST', leadId: payload.leadId || null,
    message: `${user.name} requested a carpool${payload.clientName ? ' for ' + payload.clientName : ''}`,
  }), user);
  return id;
}

export function decideCarpoolRequest(id, approve, user) {
  let agentId = null, clientName = '';
  mutate(db => {
    const r = (db.carpoolRequests || []).find(x => x.id === id);
    if (!r) return;
    r.status = approve ? 'approved' : 'rejected';
    r.decidedAt = now_();
    r.decidedBy = user.name;
    agentId = r.agentId; clientName = r.clientName || '';
  });
  if (agentId) addNotifs([{
    userId: agentId, type: 'CARPOOL_REQUEST', leadId: null,
    message: `Your carpool request${clientName ? ' for ' + clientName : ''} was ${approve ? 'approved' : 'rejected'}`,
  }], user);
}

// Mark a follow-up task as done — clears the reminder.
export function clearFollowup(leadId, user) {
  updLead(leadId, { nextFollowup: null });
  addAct(leadId, { type: 'FOLLOW_UP', description: 'Follow-up completed', userId: user.id, userName: user.name, durationSeconds: 0 });
}

export function markLostFn(leadId, reason, user) {
  updLead(leadId, { status: 'DEAL_CLOSED_LOST', dealStatus: 'LOST' });
  addAct(leadId, { type: 'DEAL', description: 'Deal LOST', userId: user.id, userName: user.name, durationSeconds: 0 });
  if (reason) addAct(leadId, { type: 'LOST_REASON', description: reason, userId: user.id, userName: user.name, durationSeconds: 0 });
  const l = getLead(leadId);
  addNotifs([...new Set(l.previousAssignees)].map(userId => ({ userId, type: 'DEAL_LOST', message: 'Deal lost: ' + l.name, leadId })), user);
  addNotifsToRole(ROLES.MGMT, { companyId: user.companyId },
    (userId) => ({ userId, type: 'DEAL_LOST', message: 'Deal lost: ' + l.name, leadId }), user);
}

export function checkFollowUpReminders(db) {
  const now = new Date();
  const notifList = [];
  // `leads` is a cache now, not a guaranteed key — sbLoad no longer ships it.
  (db.leads || []).forEach(lead => {
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
      const companyId = db.users.find(u => u.id === userId)?.companyId ?? null;
      const n = { id: 'n' + uid(), type, message, leadId, timestamp: ts, read: false, userId, companyId };
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
  let saved;
  mutate(db => {
    const i = db.targets.findIndex(t => t.userId === userId && t.month === mo);
    const role = db.users.find(u => u.id === userId)?.role;
    const type = role === ROLES.IA ? 'MEETINGS_SET' : 'SITE_VISITS';
    // Reuse the existing row's id when replacing, so the upsert updates that row
    // rather than leaving an orphan behind under a fresh id.
    const entry = { id: i >= 0 ? db.targets[i].id : 'tg' + uid(), userId, month: mo, type, value: parseInt(val), companyId: db.users.find(u => u.id === userId)?.companyId ?? null };
    if (i >= 0) db.targets[i] = entry;
    else db.targets.push(entry);
    saved = entry;
  });
  if (saved) sbUpsert('targets', [tgToR(saved)]);
}

export function createUserFn(name, email, password, phone, role, currentUser) {
  const id = 'u' + uid();
  const companyId = currentUser.companyId; // inherit the admin's company
  const stamp = now_();
  const baseUser = { id, name, email, password: password || '1234', phone: phone || '', role, teamId: currentUser.teamId, companyId, isActive: true, createdAt: stamp, updatedAt: stamp };

  // mutate() only writes the in-memory copy and the localStorage cache — it does NOT
  // reach Supabase. Every create has to push its own row, or the account exists on this
  // browser only and is gone on the next machine (and on the next sbLoad).
  if (role === ROLES.TL) {
    const tid = 't' + uid();
    const team = { id: tid, name: name + "'s Team", leadId: id, companyId, createdAt: stamp, updatedAt: stamp };
    const tlUser = { ...baseUser, teamId: tid };
    mutate(db => {
      db.teams = db.teams || [];
      db.teams.push(team);
      db.users.push(tlUser);
    });
    // Team first: the user row's team_id points at it.
    sbInsert('teams', tToR(team));
    sbInsert('users', uToR(tlUser));
  } else {
    const newUser = role === ROLES.EXEC ? { ...baseUser, allowedFeatures: [] } : baseUser;
    mutate(db => { db.users.push(newUser); });
    sbInsert('users', uToR(newUser));
  }
  return id;
}

// Delete a user and persist it: tombstone (so the cloud snapshot can't resurrect
// it on reload) + hard-delete from Supabase. If a Team Lead is removed, their team
// is deleted too and its agents are unassigned.
export function deleteUserFn(userId, currentUser) {
  const db = getDB();
  const u = db.users.find(x => x.id === userId);
  if (!u) return;
  const teamToKill = (u.role === ROLES.TL && u.teamId) ? u.teamId : null;
  mutate(d => {
    d.users = d.users.filter(x => x.id !== userId);
    // Unassign any leads owned by the removed user (keep them in the company, just
    // ownerless) so the delete isn't blocked and no lead is lost.
    (d.leads || []).forEach(l => {
      if (l.assignedTo === userId) {
        l.previousAssignees = l.previousAssignees || [];
        if (!l.previousAssignees.includes(userId)) l.previousAssignees.push(userId);
        l.assignedTo = null;
        l.updatedAt = now_();
      }
    });
    if (teamToKill) {
      d.teams = (d.teams || []).filter(t => t.id !== teamToKill);
      d.users.forEach(x => { if (x.teamId === teamToKill) { x.teamId = null; x.updatedAt = now_(); } });
    }
    d.deletionLog = d.deletionLog || [];
    d.deletionLog.push({ id: userId, kind: 'user', name: u.name, status: u.role, deletedBy: currentUser?.name || '', deletedAt: now_() });
    if (teamToKill) d.deletionLog.push({ id: teamToKill, kind: 'team', name: u.name + "'s Team", deletedBy: currentUser?.name || '', deletedAt: now_() });
  });
  sbDelete('users', [userId]);
  if (teamToKill) sbDelete('teams', [teamToKill]);
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
  const company = { id: cid, name: name.trim(), plan: plan || 'Starter', createdAt: now_(), isActive: true };
  const admin = { id: aid, name: (adminName || 'Admin').trim(), email: (adminEmail || '').trim(), password: password || '1234', phone: phone || '', role: ROLES.MGMT, teamId: null, companyId: cid, isActive: true };
  mutate(db => {
    db.companies = db.companies || [];
    db.companies.push(company);
    db.users.push(admin);
  });
  // Company first: the admin row's company_id points at it.
  sbInsert('companies', cToR(company));
  sbInsert('users', uToR(admin));
  return { companyId: cid, adminId: aid, adminEmail: (adminEmail || '').trim(), password: password || '1234' };
}

export function setCompanyActive(cid, active) {
  let updated;
  mutate(db => { const c = (db.companies || []).find(x => x.id === cid); if (c) { c.isActive = active; updated = { ...c }; } });
  if (updated) sbUpdate('companies', cid, cToR(updated));
}

// Provision many accounts in one pass. `rows`: [{name,email,phone,role,password,teamId}].
// Validates each row (name+email required, valid+unique email incl. within the batch),
// creates Team Leads with their own team, and agents under the chosen/owner team.
// Returns { created:[{name,email,pass,roleLabel,role}], errors:[{line,name,reason}] }.
// Async since the cloud load became tenant-scoped: getDB().users holds one
// company, so a purely local duplicate-email check can no longer see the other
// tenants. The server is asked about this batch's addresses first.
export async function bulkCreateUsers(rows, currentUser) {
  const created = [];
  const errors = [];
  const emailRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  const candidates = (rows || []).map(r => (r.email || '').trim()).filter(e => emailRe.test(e));
  const remote = await sbEmailsInUse(candidates);
  const seen = new Set([...getDB().users.map(u => (u.email || '').toLowerCase()), ...remote]);

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
    // As in createUserFn: mutate() is local-only, so each row is pushed to Supabase too.
    const stamp = now_();
    if (role === ROLES.TL) {
      const tid = 't' + uid();
      const team = { id: tid, name: name + "'s Team", leadId: id, companyId };
      const u = { id, name, email, password: pass, phone, role, teamId: tid, companyId, isActive: true, createdAt: stamp, updatedAt: stamp };
      mutate(db => {
        db.teams = db.teams || [];
        db.teams.push(team);
        db.users.push(u);
      });
      sbInsert('teams', tToR(team));
      sbInsert('users', uToR(u));
    } else {
      // Management rows carry no team; everyone else inherits the admin's (or the
      // team picked on the row).
      const teamId = role === ROLES.MGMT ? undefined : (r.teamId || currentUser.teamId);
      const u = { id, name, email, password: pass, phone, role, teamId, companyId, isActive: true, createdAt: stamp, updatedAt: stamp };
      mutate(db => { db.users.push(u); });
      sbInsert('users', uToR(u));
    }
    created.push({ id, name, email, pass, role, roleLabel: rlabel(role) });
  });

  return { created, errors };
}

// Normalize a phone to E.164-ish with country code. Bangladesh-aware:
//   01XXXXXXXXX  -> +8801XXXXXXXXX
//   8801XXXXXXXX -> +8801XXXXXXXX
//   1XXXXXXXXX   -> +8801XXXXXXXXX
//   +<cc>...      -> kept (any explicit country code)
// Returns '' when there aren't enough digits to be a real number.
export function normalizePhone(raw) {
  if (!raw) return '';
  let s = String(raw).trim();
  let digits = s.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) {
    digits = '88' + digits;
  }
  if (digits.length < 10) return ''; // too short to be valid
  return digits;
}

export function isValidPhone(raw) {
  const n = normalizePhone(raw);
  return /^\d{10,15}$/.test(n);
}

// Find an existing lead with the same (normalized) phone. Used to prevent
// duplicate leads on manual create and import.
export function leadByPhone(phone) {
  const n = normalizePhone(phone);
  if (!n) return null;
  return getDB().leads.find(l => normalizePhone(l.phone) === n) || null;
}

// Create a lead. Strict-block: the record is written to the cloud FIRST and the
// local DB is only mutated once the server confirms, so the UI never reports
// success for a lead that didn't persist (previously the optimistic local write +
// unchecked sbInsert made a rejected insert look like a success and then vanish on
// reload). Async — callers must await the { ok, id } result.
//   ok:true            → saved (cloud + local). `id` is the new/existing lead id.
//   ok:false, skipped  → cloud sync unavailable (no config / table missing); saved
//                        locally only, still a success from the user's view.
//   ok:false           → genuine server rejection (RLS/network/HTTP); nothing saved.
export async function addLeadFn(name, phone, phones, email, emails, company, source, prop, profession, city, user) {
  const norm = normalizePhone(phone);
  if (!norm) return { ok: false, invalid: true }; // never create a lead without a valid phone
  const dup = leadByPhone(norm);
  if (dup) return { ok: true, id: dup.id };        // never create a duplicate-phone lead — return the existing one
  phone = norm;
  // Keep every valid number the caller supplied, primary first and de-duped.
  // Phone is immutable once the lead exists, so creation is the only chance to
  // record secondaries — dropping them here would lose them for good.
  phones = [...new Set([norm, ...(phones || []).map(p => normalizePhone(p)).filter(Boolean)])];
  const id = 'l' + uid();
  const lead = {
    id, name,
    phone, phones,
    email: email || '', emails: emails || (email ? [email] : []),
    company: company || '—', source, status: 'NEW',
    companyId: user.companyId, // tenant the lead belongs to
    assignedTo: user.id, assignedToName: user.name, assignedRole: user.role,
    teamId: user.teamId || 't1', previousAssignees: [],
    // budget is no longer captured in the lead UI; CSV import still sets it.
    propertyInterest: prop || '', budget: 0,
    profession: profession || '', city: city || '',
    dealValue: 0, dealStatus: null, meetingSetBy: null, meetingSetDate: null,
    siteVisitDoneBy: null, siteVisitDoneDate: null, notes: '',
    createdAt: now_(), updatedAt: now_(),
    callCount: 0, smsCount: 0, whatsappCount: 0, visitCount: 0,
    meetingDate: null, meetingLocation: '',
  };

  // Cloud write first. A recoverable outcome (ok, or skipped = sync disabled)
  // lets the local write proceed; a genuine rejection blocks it so the UI can
  // report the failure instead of silently losing the lead on the next reload.
  const res = await sbInsert('leads', lToR(lead));
  if (!res.ok && !res.skipped) return { ok: false, status: res.status, body: res.body, error: res.error };

  const activity = { id: 'a' + uid(), type: 'CREATED', description: 'Lead created from ' + SRC_LABELS[source], userId: user.id, userName: user.name, timestamp: now_(), durationSeconds: 0 };
  mutate(db => {
    db.leads.unshift(lead);
    db.activities[id] = [activity];
  });
  sbInsert('activities', aToR(activity, id));
  addNotifs([{ userId: user.id, type: 'ASSIGNED', message: 'New lead added to your list: ' + name, leadId: id }], null);
  return { ok: true, id, skipped: res.skipped };
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
  const phone = normalizePhone(rawPhone.split(/[,/\n]/)[0]); // require + normalize to +<cc>
  if (!phone) return null; // skip rows without a valid phone number
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

// Single dedup identity for a lead: normalized phone if present, else name+email.
export function leadDedupKey(l) {
  const p = normalizePhone(l.phone);
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
  const existing = new Map();
  db.leads.forEach(l => { const k = leadDedupKey(l); if (k) existing.set(k, l); });
  const batch = new Map(); // collapse same-number rows within the file (last wins)
  let blank = 0;
  rows.forEach(row => {
    const lead = mapCSVToLead(row, user);
    if (!lead) { blank++; return; }            // no valid phone — unusable row
    const key = leadDedupKey(lead);
    if (key) batch.set(key, lead);
  });
  const leads = []; const updates = [];
  batch.forEach((lead, key) => {
    const ex = existing.get(key);
    if (ex) updates.push({ id: ex.id, owner: ex.assignedToName || '—', lead });
    else leads.push(lead);
  });
  return { leads, updates, skipped: updates.length, blank, total: rows.length };
}

// Fields an import is allowed to refresh on an existing (duplicate) lead.
const IMPORT_MERGE_FIELDS = ['name', 'email', 'company', 'propertyInterest', 'budget', 'city', 'profession', 'source', 'status', 'priority', 'nextFollowup', 'materialSent'];

export function submitImport(importData, user) {
  const leads = importData?.leads || [];
  const updates = importData?.updates || [];
  if (!leads.length && !updates.length) return 0;
  let count = 0;
  mutate(db => {
    // new leads
    leads.forEach(lead => {
      const log = lead._log; delete lead._log;
      db.leads.push(lead);
      const acts = [{ id: 'a' + uid(), type: 'CREATED', description: 'Lead imported' + (lead.externalId ? ' (' + lead.externalId + ')' : '') + ' from ' + (SRC_LABELS[lead.source] || lead.source), userId: user.id, userName: user.name, timestamp: lead.createdAt, durationSeconds: 0 }];
      if (log) acts.push({ id: 'a' + uid(), type: 'NOTE', description: log, userId: user.id, userName: user.name, timestamp: lead.updatedAt, durationSeconds: 0 });
      db.activities[lead.id] = acts;
      count++;
    });
    // duplicates → update the existing lead (keep its owner/assignment/createdAt)
    updates.forEach(u => {
      const ex = db.leads.find(x => x.id === u.id);
      if (!ex) return;
      const nl = u.lead;
      IMPORT_MERGE_FIELDS.forEach(f => {
        const v = nl[f];
        if (v !== undefined && v !== '' && v !== null && v !== '—' && v !== 0) ex[f] = v;
      });
      ex.updatedAt = now_();
      (db.activities[u.id] = db.activities[u.id] || []).push({ id: 'a' + uid(), type: 'NOTE', description: 'Updated via import — duplicate number (owner: ' + (u.owner || '—') + ')', userId: user.id, userName: user.name, timestamp: now_(), durationSeconds: 0 });
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
      // Same reason as addAct: notifications.company_id is what makes the load
      // scopable. Take it from the recipient, falling back to the sender.
      const companyId = db.users.find(u => u.id === userId)?.companyId ?? currentUser?.companyId ?? null;
      const n = { id: 'n' + uid(), type, message, leadId, timestamp: ts, read: false, userId, companyId };
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
