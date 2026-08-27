// Supabase config — loaded from environment (Vite exposes VITE_* on import.meta.env).
// Set these in a local .env file (see .env.example). Never hardcode credentials here.
import { begin, end } from './netActivity.js';

export const SB_URL = import.meta.env.VITE_SUPABASE_URL;
export const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Startup validation — clear error if required config is missing.
if (!SB_URL || !SB_KEY) {
  console.error(
    '[config] Missing required environment variables: ' +
    [!SB_URL && 'VITE_SUPABASE_URL', !SB_KEY && 'VITE_SUPABASE_ANON_KEY'].filter(Boolean).join(', ') +
    '. Create a .env file in the project root (copy .env.example). Cloud sync is disabled until set.'
  );
}

// Every request in this module goes through sbFetch rather than fetch, so the
// in-flight count that drives the global loading bar (netActivity.js) cannot
// drift out of step with the requests it describes. finally() runs on failure
// and on abort too — a counter that only decrements on success would stick.
function sbFetch(input, init) {
  begin();
  return fetch(input, init).finally(end);
}

export const SB_H = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' };

function checkNetworkError(e) {
  if (e.name === 'TypeError' && e.message === 'Failed to fetch') {
    alert('Network error: Action could not be saved. Please check your internet connection.');
    return true;
  }
  return false;
}


export async function sbGet(path) {
  try {
    const r = await sbFetch(`${SB_URL}/rest/v1/${path}`, { headers: SB_H });
    if (!r.ok) return [];
    return r.json();
  } catch { return []; }
}

// Paginated fetch. PostgREST caps every response at 1000 rows, so a plain sbGet
// on a large table silently returns only the first page — e.g. `activities`
// (2000+ rows) ordered timestamp.asc dropped everything after the oldest 1000,
// so a recently-active agent's whole timeline was missing. This walks pages with
// Range headers until a short page proves we've reached the end.
export async function sbGetAll(path, pageSize = 1000) {
  const out = [];
  const sep = path.includes('?') ? '&' : '?';
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    let rows;
    try {
      const r = await sbFetch(`${SB_URL}/rest/v1/${path}${sep}limit=${pageSize}&offset=${from}`, {
        headers: { ...SB_H, Range: `${from}-${to}` },
      });
      if (!r.ok) break;
      rows = await r.json();
    } catch { break; }
    if (!Array.isArray(rows) || rows.length === 0) break;
    out.push(...rows);
    if (rows.length < pageSize) break; // last page
  }
  return out;
}

// Tables whose absence (PGRST205) should be skipped silently rather than logged
// as an error — they only exist after the schema migration is applied.
const _missingTables = new Set();

// Self-healing upsert: REST returns 4xx WITHOUT rejecting, so we inspect r.ok.
// - PGRST204 (unknown column): strip that column from every row and retry, so
//   inserts still succeed before the schema migration adds columns like `cart`.
// - PGRST205 (missing table): skip quietly (remember it for the session).
export async function sbUpsert(table, rows) {
  if (!rows || !rows.length) return { ok: false, skipped: true };
  if (_missingTables.has(table)) return { ok: false, skipped: true };
  let payload = rows;
  const stripped = [];

  for (let attempt = 0; attempt < 12; attempt++) {
    let r;
    try {
      r = await sbFetch(`${SB_URL}/rest/v1/${table}`, {
        method: 'POST',
        headers: { ...SB_H, Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      checkNetworkError(e);
      console.error(`Supabase Upsert network error [${table}]:`, e);
      return { ok: false, error: e };
    }

    if (r.ok) {
      if (stripped.length) {
        console.warn(`Supabase: synced '${table}' after dropping unknown column(s): ${stripped.join(', ')}. Run the schema migration to persist them.`);
      }
      return { ok: true, stripped };
    }

    let body = '';
    try { body = await r.text(); } catch {}
    let j = {};
    try { j = JSON.parse(body); } catch {}

    // Missing table → skip for the rest of the session
    if (j.code === 'PGRST205') {
      _missingTables.add(table);
      console.warn(`Supabase: table '${table}' not found — skipping cloud sync until migration is applied.`);
      return { ok: false, skipped: true };
    }

    // Unknown column → drop it from every row and retry
    if (j.code === 'PGRST204') {
      const m = /Could not find the '([^']+)' column/.exec(j.message || '');
      const col = m && m[1];
      if (col) {
        stripped.push(col);
        payload = payload.map((row) => { const c = { ...row }; delete c[col]; return c; });
        continue;
      }
    }

    // Anything else → log with the detail they asked for, and stop
    console.error(`Supabase ${table === 'leads' ? 'Lead Insert' : 'Upsert'} Error [${table}] HTTP ${r.status}:`, body);
    console.error('Payload:', payload);
    return { ok: false, status: r.status, body };
  }

  console.error(`Supabase Upsert [${table}]: gave up after stripping ${stripped.join(', ')}`);
  return { ok: false };
}

// Self-healing insert — mirrors sbUpsert's recovery so a single row insert isn't
// lost the moment the remote schema lags the client:
// - PGRST204 (unknown column): strip that column and retry, so a new lead still
//   inserts before a migration adds columns like meeting_at (null on creation, so
//   dropping them loses nothing).
// - PGRST205 (missing table): skip quietly for the rest of the session.
// Returns { ok, status, body, skipped, stripped } so callers can distinguish a
// genuine failure (surface to the UI) from a recoverable/skipped one.
export async function sbInsert(table, row) {
  if (_missingTables.has(table)) return { ok: false, skipped: true };
  let payload = { ...row };
  const stripped = [];

  for (let attempt = 0; attempt < 12; attempt++) {
    let r;
    try {
      r = await sbFetch(`${SB_URL}/rest/v1/${table}`, {
        method: 'POST',
        headers: { ...SB_H, Prefer: 'return=minimal' },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      checkNetworkError(e);
      console.error(`Supabase Insert network error [${table}]:`, e);
      return { ok: false, error: e };
    }

    if (r.ok) {
      if (stripped.length) {
        console.warn(`Supabase: inserted '${table}' after dropping unknown column(s): ${stripped.join(', ')}. Run the schema migration to persist them.`);
      }
      return { ok: true, stripped };
    }

    let body = '';
    try { body = await r.text(); } catch {}
    let j = {};
    try { j = JSON.parse(body); } catch {}

    // Missing table → skip for the rest of the session
    if (j.code === 'PGRST205') {
      _missingTables.add(table);
      console.warn(`Supabase: table '${table}' not found — skipping cloud sync until migration is applied.`);
      return { ok: false, skipped: true };
    }

    // Unknown column → drop it and retry
    if (j.code === 'PGRST204') {
      const m = /Could not find the '([^']+)' column/.exec(j.message || '');
      const col = m && m[1];
      if (col) {
        stripped.push(col);
        delete payload[col];
        continue;
      }
    }

    // Anything else (RLS denial, duplicate, bad request) → real failure
    console.error(`Supabase Insert Error [${table}] HTTP ${r.status}:`, body);
    return { ok: false, status: r.status, body };
  }

  console.error(`Supabase Insert [${table}]: gave up after stripping ${stripped.join(', ')}`);
  return { ok: false };
}

export async function sbUpdate(table, id, updates) {
  if (_missingTables.has(table)) return { ok: false, skipped: true };
  let payload = { ...updates };
  const stripped = [];

  for (let attempt = 0; attempt < 12; attempt++) {
    let r;
    try {
      r = await sbFetch(`${SB_URL}/rest/v1/${table}?id=eq.${id}`, {
        method: 'PATCH',
        headers: { ...SB_H, Prefer: 'return=minimal' },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      checkNetworkError(e);
      console.error(`Supabase Update network error [${table}]:`, e);
      return { ok: false, error: e };
    }

    if (r.ok) {
      if (stripped.length) {
        console.warn(`Supabase: patched '${table}' after dropping unknown column(s): ${stripped.join(', ')}. Run the schema migration to persist them.`);
      }
      return { ok: true, stripped };
    }

    let body = '';
    try { body = await r.text(); } catch {}
    let j = {};
    try { j = JSON.parse(body); } catch {}

    if (j.code === 'PGRST205') {
      _missingTables.add(table);
      console.warn(`Supabase: table '${table}' not found — skipping cloud sync until migration is applied.`);
      return { ok: false, skipped: true };
    }

    if (j.code === 'PGRST204') {
      const m = /Could not find the '([^']+)' column/.exec(j.message || '');
      const col = m && m[1];
      if (col) {
        stripped.push(col);
        delete payload[col];
        continue;
      }
    }

    console.error(`Supabase Update Error [${table}] HTTP ${r.status}:`, body);
    return { ok: false, status: r.status, body };
  }

  console.error(`Supabase Update [${table}]: gave up after stripping ${stripped.join(', ')}`);
  return { ok: false };
}


// Raw REST DELETE with a filter (e.g. "leads?id=in.(...)"). Logs non-2xx.
async function sbDeleteRaw(path) {
  try {
    const r = await sbFetch(`${SB_URL}/rest/v1/${path}`, { method: 'DELETE', headers: { ...SB_H, Prefer: 'return=minimal' } });
    if (!r.ok) { let b = ''; try { b = await r.text(); } catch {} console.error(`Supabase Delete Error [${path}] HTTP ${r.status}:`, b); }
    return r.ok;
  } catch (e) { console.error(`Supabase Delete network error [${path}]:`, e); return false; }
}

// Hard-delete rows by id from a table. sbSave only upserts, so without this
// deleted rows linger and reappear on the next merge-on-load.
export async function sbDelete(table, ids) {
  if (!ids || !ids.length) return;
  const list = ids.map(id => `"${id}"`).join(',');
  await sbDeleteRaw(`${table}?id=in.(${encodeURIComponent(list)})`);
}

// Deep-delete leads: remove child rows (activities/notifications/bookings) first
// to avoid foreign-key 409s, then the leads. Chunked for URL length.
export async function sbDeleteLeads(ids) {
  if (!ids || !ids.length) return;
  for (let i = 0; i < ids.length; i += 40) {
    const enc = encodeURIComponent(ids.slice(i, i + 40).map(id => `"${id}"`).join(','));
    await sbDeleteRaw(`activities?lead_id=in.(${enc})`);
    await sbDeleteRaw(`notifications?lead_id=in.(${enc})`);
    await sbDeleteRaw(`bookings?lead_id=in.(${enc})`);
    await sbDeleteRaw(`leads?id=in.(${enc})`);
  }
}

// ── row converters ──
export function lToR(l) {
  return {
    id: l.id, name: l.name, phone: l.phone, email: l.email || '', company: l.company || '—',
    source: l.source, status: l.status, assigned_to: l.assignedTo, assigned_to_name: l.assignedToName,
    assigned_role: l.assignedRole, team_id: l.teamId, previous_assignees: l.previousAssignees || [],
    property_interest: l.propertyInterest || '', budget: l.budget || 0, profession: l.profession || '',
    city: l.city || '', deal_value: l.dealValue || 0, deal_status: l.dealStatus || null,
    meeting_set_by: l.meetingSetBy || null, meeting_set_date: l.meetingSetDate || null,
    site_visit_done_by: l.siteVisitDoneBy || null, site_visit_done_date: l.siteVisitDoneDate || null,
    meeting_date: l.meetingDate || null, meeting_location: l.meetingLocation || '',
    // Meeting hand-off (IA → MA) + site-visit / deal-project fields. Without these
    // columns the meeting never reaches the MA's calendar — see 0005 migration.
    meeting_at: l.meetingAt || null, meeting_type: l.meetingType || null,
    meeting_link: l.meetingLink || '', meeting_shared: l.meetingShared || null,
    meeting_attended: l.meetingAttended || false, meeting_attended_at: l.meetingAttendedAt || null,
    visit_projects: l.visitProjects || null,
    deal_project_id: l.dealProjectId || null, deal_project_name: l.dealProjectName || null,
    // The offer that bought this lead its place in the Team Lead pipeline (0012).
    offer_sent_at: l.offerSentAt || null, offer_value: l.offerValue || null,
    call_count: l.callCount || 0, sms_count: l.smsCount || 0,
    whatsapp_count: l.whatsappCount || 0, visit_count: l.visitCount || 0,
    no_answer_count: l.noAnswerCount || 0, no_answer_lock_until: l.noAnswerLockUntil || null,
    notes: l.notes || '', external_id: l.externalId || null, priority: l.priority || null,
    preferred_time: l.preferredTime || null, next_followup: l.nextFollowup || null,
    material_sent: l.materialSent || null, cart: l.cart || null, company_id: l.companyId || null,
    created_at: l.createdAt, updated_at: l.updatedAt,
  };
}

export function rToL(r) {
  return {
    id: r.id, name: r.name, phone: r.phone, email: r.email || '', company: r.company || '—',
    source: r.source, status: r.status, assignedTo: r.assigned_to, assignedToName: r.assigned_to_name,
    assignedRole: r.assigned_role, teamId: r.team_id, previousAssignees: r.previous_assignees || [],
    propertyInterest: r.property_interest || '', budget: r.budget || 0, profession: r.profession || '',
    city: r.city || '', dealValue: r.deal_value || 0, dealStatus: r.deal_status || null,
    meetingSetBy: r.meeting_set_by || null, meetingSetDate: r.meeting_set_date || null,
    siteVisitDoneBy: r.site_visit_done_by || null, siteVisitDoneDate: r.site_visit_done_date || null,
    meetingDate: r.meeting_date || null, meetingLocation: r.meeting_location || '',
    // Read back as arrays (not null) so the calendar / panel can iterate them safely.
    meetingAt: r.meeting_at || null, meetingType: r.meeting_type || null,
    meetingLink: r.meeting_link || '', meetingShared: r.meeting_shared || [],
    meetingAttended: r.meeting_attended || false, meetingAttendedAt: r.meeting_attended_at || null,
    visitProjects: r.visit_projects || [],
    dealProjectId: r.deal_project_id || null, dealProjectName: r.deal_project_name || null,
    offerSentAt: r.offer_sent_at || null, offerValue: r.offer_value || 0,
    callCount: r.call_count || 0, smsCount: r.sms_count || 0,
    whatsappCount: r.whatsapp_count || 0, visitCount: r.visit_count || 0,
    noAnswerCount: r.no_answer_count || 0, noAnswerLockUntil: r.no_answer_lock_until || null,
    notes: r.notes || '', externalId: r.external_id || null, priority: r.priority || null,
    preferredTime: r.preferred_time || null, nextFollowup: r.next_followup || null,
    materialSent: r.material_sent || null, cart: r.cart || null, companyId: r.company_id || null,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

// company_id on activities/notifications/targets exists purely so the load can be
// scoped to one tenant in the query (see sbLoad). It is derived from the parent
// lead or the acting user at write time; migration 0009 backfills the history.
export function aToR(a, leadId) {
  return { id: a.id, lead_id: leadId, type: a.type, description: a.description || '', user_id: a.userId, user_name: a.userName, duration_seconds: a.durationSeconds || 0, timestamp: a.timestamp, company_id: a.companyId ?? null };
}

export function rToA(r) {
  return { id: r.id, type: r.type, description: r.description || '', userId: r.user_id, userName: r.user_name, durationSeconds: r.duration_seconds || 0, timestamp: r.timestamp, companyId: r.company_id ?? null };
}

// allowed_features / projects use ?? (not ||) on the way out so an EMPTY array is
// preserved: [] means "this user may see nothing", which is a real setting for an
// Executive and must not collapse to null.
export function uToR(u) {
  return { id: u.id, name: u.name, email: u.email, password: u.password, phone: u.phone || '', role: u.role, team_id: u.teamId || null, company_id: u.companyId ?? null, is_active: u.isActive !== false, avatar: u.avatar || null, projects: u.projects ?? null, allowed_features: u.allowedFeatures ?? null };
}

// ...and back to undefined (never []) when the column is null, because canSee()
// keys off Array.isArray(allowedFeatures): an array means "this list is the whole
// truth". Turning a null into [] would lock the user out of everything.
export function rToU(r) {
  return { id: r.id, name: r.name, email: r.email, password: r.password, phone: r.phone || '', role: r.role, teamId: r.team_id, companyId: r.company_id ?? null, isActive: r.is_active, avatar: r.avatar || '', projects: r.projects ?? undefined, allowedFeatures: r.allowed_features ?? undefined };
}

export function tToR(t) { return { id: t.id, name: t.name, lead_id: t.leadId, company_id: t.companyId || null }; }
export function rToT(r) { return { id: r.id, name: r.name, leadId: r.lead_id, companyId: r.company_id || null }; }

export function hrToR(h) {
  return {
    id: h.id, company_id: h.companyId || null, property_id: h.propertyId || null, property_name: h.propertyName || '',
    variant_id: h.variantId || null, variant_name: h.variantName || '', unit_id: h.unitId || '',
    agent_id: h.agentId || null, agent_name: h.agentName || '', client_name: h.clientName || '', client_phone: h.clientPhone || '',
    deal_total: h.dealTotal || 0, offer_rate: h.offerRate || 0, status: h.status || 'pending',
    hold_until: h.holdUntil || null, created_at: h.createdAt, decided_at: h.decidedAt || null, decided_by: h.decidedBy || '',
  };
}
export function rToHr(r) {
  return {
    id: r.id, companyId: r.company_id || null, propertyId: r.property_id || '', propertyName: r.property_name || '',
    variantId: r.variant_id || '', variantName: r.variant_name || '', unitId: r.unit_id || '',
    agentId: r.agent_id || '', agentName: r.agent_name || '', clientName: r.client_name || '', clientPhone: r.client_phone || '',
    dealTotal: r.deal_total || 0, offerRate: r.offer_rate || 0, status: r.status || 'pending',
    holdUntil: r.hold_until || null, createdAt: r.created_at, decidedAt: r.decided_at || null, decidedBy: r.decided_by || '',
  };
}

// Companies (multi-tenant)
export function cToR(c) { return { id: c.id, name: c.name, plan: c.plan || 'Starter', is_active: c.isActive !== false, created_at: c.createdAt || new Date().toISOString() }; }
export function rToC(r) { return { id: r.id, name: r.name, plan: r.plan || 'Starter', isActive: r.is_active !== false, createdAt: r.created_at }; }

export function nToR(n) {
  return { id: n.id, user_id: n.userId, type: n.type, message: n.message, lead_id: n.leadId || null, is_read: n.read || false, created_at: n.timestamp || new Date().toISOString(), company_id: n.companyId ?? null };
}

export function rToN(r) {
  return { id: r.id, userId: r.user_id, type: r.type, message: r.message, leadId: r.lead_id, read: r.is_read || false, timestamp: r.created_at, companyId: r.company_id ?? null };
}

// Flat array of notification objects (each has userId) → upsert to Supabase
export async function sbUpsertNotifs(notifs) {
  if (!notifs || !notifs.length) return;
  await sbUpsert('notifications', notifs.map(nToR));
}

// Which of these email addresses already belong to a user account, anywhere.
//
// The client-side duplicate check (CreateUserModal, bulkCreateUsers) compares
// against db.users, and db.users now holds one company only — so it went blind
// to the other tenants exactly when the scoped load landed. Two accounts sharing
// an address is an auth bug, not just untidy data: loginRemote matches on
// `email=ilike.<addr>` and signs in whichever row's password matches.
// Migration 0009 adds a unique index as the backstop; this is the readable error.
//
// ilike (not eq) because addresses are stored with whatever case they were typed
// in. Returns a lower-cased Set; an empty Set on a network failure, so a create
// is never blocked by being offline — the unique index still catches it.
export async function sbEmailsInUse(emails) {
  const list = [...new Set((emails || []).map(e => String(e || '').trim().toLowerCase()).filter(Boolean))];
  const hits = new Set();
  for (let i = 0; i < list.length; i += 40) {
    const chunk = list.slice(i, i + 40);
    const or = chunk.map(e => `email.ilike.${encodeURIComponent(e)}`).join(',');
    const rows = await sbGet(`users?select=email&or=(${or})`);
    (rows || []).forEach(r => r.email && hits.add(r.email.trim().toLowerCase()));
  }
  return hits;
}

// Mark specific notification ids as read in Supabase
export async function sbMarkRead(ids) {
  if (!ids || !ids.length) return;
  const filter = ids.map(id => `id.eq.${id}`).join(',');
  await sbFetch(`${SB_URL}/rest/v1/notifications?or=(${filter})`, {
    method: 'PATCH',
    headers: { ...SB_H, Prefer: 'return=minimal' },
    body: JSON.stringify({ is_read: true }),
  }).catch(e => console.warn('markRead', e));
}

export function sbSubscribeNotifs(userId, onNew) {
  const wsUrl = `${SB_URL.replace('https://', 'wss://')}/realtime/v1/websocket?apikey=${SB_KEY}&vsn=1.0.0`;
  let ws, hbTimer, reconnTimer;
  let dead = false;

  function connect() {
    try { ws = new WebSocket(wsUrl); } catch { return; }
    ws.onopen = () => {
      ws.send(JSON.stringify({
        topic: `realtime:public:notifications`,
        event: 'phx_join',
        payload: { config: { postgres_changes: [{ event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }] } },
        ref: '1',
      }));
      hbTimer = setInterval(() => {
        if (ws.readyState === 1) ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(Date.now()) }));
      }, 25000);
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.event === 'postgres_changes') {
          const rec = msg.payload?.data?.record;
          if (rec && rec.user_id === userId) onNew(rToN(rec));
        }
      } catch {}
    };
    ws.onclose = () => {
      clearInterval(hbTimer);
      if (!dead) reconnTimer = setTimeout(connect, 5000);
    };
    ws.onerror = () => ws.close();
  }

  connect();
  return () => { dead = true; clearInterval(hbTimer); clearTimeout(reconnTimer); try { ws?.close(); } catch {} };
}

const RT_TABLES = ['users', 'teams', 'leads', 'activities', 'notifications', 'targets', 'companies', 'properties', 'bookings', 'hold_requests'];

// Build the postgres_changes config. Unscoped (MASTER) is the original: one
// wildcard spec per table. Scoped splits each table in two, because a realtime
// `filter` cannot serve both cases:
//
//   INSERT/UPDATE - filtered where a single `col=eq.val` can express the scope.
//   DELETE        - never filtered. Under the default replica identity a delete
//     payload carries only the primary key, so ANY filter would drop every
//     delete event and rows would linger in the cache forever. Letting them all
//     through is safe: applyRealtimeEvent removes by id, a no-op when the row
//     was never in this browser's snapshot, and an id is all that leaks.
//
// A realtime filter accepts exactly one clause -- there is no `or` -- so the
// tables whose scope needs more than that are subscribed on a WIDER clause and
// narrowed by inScope() in db.js. Named explicitly rather than left implicit:
//
//   leads       - agent scope is "assigned to me OR previously assigned to me";
//                 only the first half fits, so subscribe on the company.
//   activities  - scope is "on a lead I hold", which is a set, not a value.
//   targets     - company-wide, narrowed to the visible user set client-side.
//
// Rows with a null company_id do not stream on the company clause. The initial
// load still tolerates them (see coFilter); migration 0009 backfills them away.
function rtConfig(user) {
  if (isUnscoped(user)) return RT_TABLES.map(table => ({ event: '*', schema: 'public', table }));
  const cid = user.companyId;
  const isMgmt = user.role === 'MANAGEMENT';
  const isTL = user.role === 'TEAM_LEAD';
  const co = `company_id=eq.${cid}`;

  return RT_TABLES.flatMap(table => {
    let filter = co;
    if (table === 'companies') filter = `id=eq.${cid}`;
    // notifications track the recipient, not the tenant -- the load fetches only
    // this user's, so the socket must match or the cache fills with rows no view
    // ever reads.
    else if (table === 'notifications') filter = `user_id=eq.${user.id}`;
    else if (table === 'users') filter = isMgmt ? co : (isTL && user.teamId ? `team_id=eq.${user.teamId}` : `id=eq.${user.id}`);
    else if (table === 'teams') filter = isMgmt ? co : (user.teamId ? `id=eq.${user.teamId}` : co);
    // activities has no company_id until migration 0009, and filtering on a
    // column that does not exist drops every event for the table.
    else if (table === 'activities' && _hasCompanyCol.activities !== true) {
      return [{ event: '*', schema: 'public', table }];
    }

    return [
      { event: 'INSERT', schema: 'public', table, filter },
      { event: 'UPDATE', schema: 'public', table, filter },
      { event: 'DELETE', schema: 'public', table },
    ];
  });
}

export function sbSubscribeAll(onEvent, user) {
  const wsUrl = `${SB_URL.replace('https://', 'wss://')}/realtime/v1/websocket?apikey=${SB_KEY}&vsn=1.0.0`;
  let ws, hbTimer, reconnTimer;
  let dead = false;

  const config = rtConfig(user);

  function connect() {
    try { ws = new WebSocket(wsUrl); } catch { return; }
    ws.onopen = () => {
      ws.send(JSON.stringify({
        topic: `realtime:public`,
        event: 'phx_join',
        payload: { config: { postgres_changes: config } },
        ref: '1',
      }));
      hbTimer = setInterval(() => {
        if (ws.readyState === 1) ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(Date.now()) }));
      }, 25000);
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.event === 'postgres_changes') {
          const payload = msg.payload?.data;
          if (payload) {
             onEvent(payload.table, payload.type, payload.record, payload.old_record);
          }
        }
      } catch {}
    };
    ws.onclose = () => {
      clearInterval(hbTimer);
      if (!dead) reconnTimer = setTimeout(connect, 5000);
    };
    ws.onerror = () => ws.close();
  }

  connect();
  return () => { dead = true; clearInterval(hbTimer); clearTimeout(reconnTimer); try { ws?.close(); } catch {} };
}

export function bkToR(b) {
  return {
    id: b.id, lead_id: b.leadId, lead_name: b.leadName, property_id: b.propertyId, property_name: b.propertyName,
    unit_no: b.unitNo || null, agent_id: b.agentId, agent_name: b.agentName, total: b.total || 0,
    status: b.status || 'ACTIVE', schedule: b.schedule || [], payments: b.payments || [],
    company_id: b.companyId || null, created_at: b.createdAt, updated_at: b.updatedAt,
  };
}
export function rToBk(r) {
  return {
    id: r.id, leadId: r.lead_id, leadName: r.lead_name, propertyId: r.property_id, propertyName: r.property_name,
    unitNo: r.unit_no || null, agentId: r.agent_id, agentName: r.agent_name, total: r.total || 0,
    status: r.status || 'ACTIVE', schedule: r.schedule || [], payments: r.payments || [],
    companyId: r.company_id || null, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export function tgToR(t) { return { id: t.id, user_id: t.userId, month: t.month, type: t.type, value: t.value, company_id: t.companyId ?? null }; }
export function rToTg(r) { return { id: r.id, userId: r.user_id, month: r.month, type: r.type, value: r.value, companyId: r.company_id ?? null }; }

export function pToR(p) {
  return {
    id: p.id, name: p.name, developer: p.developer || '', type: p.type || '', district: p.district || '',
    address: p.address || '', status: p.status || 'AVAILABLE', units_available: p.unitsAvailable || 0,
    total_units: p.totalUnits || 0, asking_price: p.askingPrice || 0, price_per_sqft: p.pricePerSqft || 0,
    size_min: p.sizeMin || 0, size_max: p.sizeMax || 0, images: p.images || [], loan: p.loan || {},
    construction: p.construction || 0, handover: p.handover || '', amenities: p.amenities || [],
    documents: p.documents || [], units: p.units || [],
    area: p.area || '', land_area: p.landArea || '', storeys: p.storeys || '', facing: p.facing || '',
    total_sft: p.totalSft || 0, unsold_sft: p.unsoldSft || 0, saleable_units: p.saleableUnits || '',
    drive_link: p.driveLink || '', purpose: p.purpose || '', size_text: p.sizeText || '',
    details: p.details || '', company_id: p.companyId || null, created_at: p.createdAt, updated_at: p.updatedAt,
    // variant/storefront model
    variants: p.variants || [], addons: p.addons || [], media: p.media || {},
    fast_close_pct: p.fastClosePct || 0, fast_close_days: p.fastCloseDays || 0,
    listing: p.listing || '', approval: p.approval || '',
  };
}
export function rToP(r) {
  return {
    id: r.id, name: r.name, developer: r.developer || '', type: r.type || '', district: r.district || '',
    address: r.address || '', status: r.status || 'AVAILABLE', unitsAvailable: r.units_available || 0,
    totalUnits: r.total_units || 0, askingPrice: r.asking_price || 0, pricePerSqft: r.price_per_sqft || 0,
    sizeMin: r.size_min || 0, sizeMax: r.size_max || 0, images: r.images || [], loan: r.loan || {},
    construction: r.construction || 0, handover: r.handover || '', amenities: r.amenities || [],
    documents: r.documents || [], units: r.units || [],
    area: r.area || '', landArea: r.land_area || '', storeys: r.storeys || '', facing: r.facing || '',
    totalSft: r.total_sft || 0, unsoldSft: r.unsold_sft || 0, saleableUnits: r.saleable_units || '',
    driveLink: r.drive_link || '', purpose: r.purpose || '', sizeText: r.size_text || '',
    details: r.details || '', companyId: r.company_id || null, createdAt: r.created_at, updatedAt: r.updated_at,
    // variant/storefront model
    variants: r.variants || [], addons: r.addons || [], media: r.media || {},
    fastClosePct: r.fast_close_pct || 0, fastCloseDays: r.fast_close_days || 0,
    listing: r.listing || '', approval: r.approval || '',
  };
}

// The bulk load deliberately does NOT request `password`. Every logged-in
// browser was being handed every user's plaintext credentials for no reason —
// login now fetches the one row it needs via loginRemote(). Safe to omit on
// write-back too: rToU leaves the field `undefined` when it isn't selected, and
// JSON.stringify drops undefined keys, so sbUpdate's PATCH never touches the
// column rather than nulling it.
//
// NOTE: only `users` gets an explicit column list. The same trick on
// `properties`/`bookings` would be a data-loss bug, because rToP/rToBk default
// missing jsonb to []/{} rather than undefined, and expireHolds() PATCHes
// `{ units: p.units }` for every property — a blob-stripped load plus one hold
// expiry would wipe every property's units in the cloud.
const USER_COLS = 'id,name,email,phone,role,team_id,company_id,is_active,avatar,projects,allowed_features';

// Explicit selects 400 on a column the table doesn't have, and sbGet turns any
// non-ok response into []. Falling back to `*` keeps a schema drift from
// silently emptying the users table (which would look like "everyone logged out").
async function sbGetUsers(path) {
  const rows = await sbGet(path);
  if (rows && rows.length) return rows;
  // Drop only the select, keep the filter -- a fallback that also dropped the
  // scoping would quietly hand this browser every user in the database.
  return sbGet(path.replace(`select=${USER_COLS}&`, '').replace(`?select=${USER_COLS}`, '?'));
}

// -- Per-account scoping -----------------------------------------------------
// Every read below used to be unfiltered: each browser downloaded the whole
// database and the filter was applied afterwards, in memory (getLeads /
// sameCompany in db.js). These build the same predicate as a query instead, so
// the rows never leave the server.
//
// The tiers mirror getLeads(user) exactly -- one source of truth for "what may
// this account see", now expressed twice: once as SQL here, once as the
// client-side filter there. Keep them in step.
//
//   agent (IA/MA/EXEC) - self only. One user row, one team row, the leads
//                        assigned to them (plus ones they forwarded on), and
//                        the activities on those leads.
//   TEAM_LEAD          - their team: its members, its team row, its leads.
//   MANAGEMENT         - their company.
//   MASTER             - everything; it oversees all companies and its own row
//                        carries no companyId, so it keeps the unfiltered load.
//
// NOTE this is a payload/correctness change, NOT access control: the anon key
// is baked into the bundle and the RLS policies that exist are `using (true)`,
// so the REST endpoint still answers an unfiltered request from anyone who
// asks. Real isolation needs Supabase Auth + JWT claims + per-table RLS.
//
// The `company_id.is.null` arm reproduces sameCompany()'s null tolerance so no
// row visible today disappears. Migration 0009 backfills those nulls; once that
// is verified in production, flip SCOPE_STRICT and the filter becomes exact.
const SCOPE_STRICT = false;
const coFilter = (cid) => (SCOPE_STRICT ? `company_id=eq.${cid}` : `or=(company_id.eq.${cid},company_id.is.null)`);

export const isUnscoped = (user) => !user || user.role === 'MASTER' || !user.companyId;

// previous_assignees is JSONB (verified against the live schema -- it is NOT a
// text[], so the array operators `ov.{...}` and `cs.{...}` both fail). JSON
// containment is the operator, and the brackets and quotes must be encoded to
// survive being nested inside `or=(...)`.
const prevAssignee = (id) => `previous_assignees.cs.${encodeURIComponent(JSON.stringify([id]))}`;

// PostgREST `in.(...)` list, quoted and encoded.
const inList = (ids) => `in.(${encodeURIComponent(ids.map(i => `"${i}"`).join(','))})`;

// Does this table have a company_id column yet?
//
// activities only gets one from migration 0009, and PostgREST answers a filter
// on an unknown column with 400 -- which sbGet turns into []. So if this code
// shipped before the migration ran, the table would load EMPTY and look like
// data loss rather than a missing column. Probe once per session and fall back
// to the unfiltered read, in the same self-healing spirit as sbUpsert's
// PGRST204 handling.
const _hasCol = {};
export async function hasColumn(table, col, hint = '') {
  const k = `${table}.${col}`;
  if (_hasCol[k] !== undefined) return _hasCol[k];
  let ok;
  try {
    const r = await sbFetch(`${SB_URL}/rest/v1/${table}?select=${col}&limit=1`, { headers: SB_H });
    ok = r.ok;
  } catch { ok = false; }
  if (!ok) console.warn(`[schema] ${k} missing.${hint ? ' ' + hint : ''}`);
  _hasCol[k] = ok;
  return ok;
}

const hasCompanyCol = (table) =>
  hasColumn(table, 'company_id', `Loading ${table} UNFILTERED. Apply supabase/migrations/0009_tenant_scoping.sql.`);

// ── Stored-procedure calls ────────────────────────────────────────────────
//
// The dashboards that aggregate (sums, group-by, per-agent leaderboards) cannot
// be expressed through PostgREST on this project -- aggregate functions are
// disabled and there is no GROUP BY -- so migration 0011 moves those reductions
// into Postgres. See the header of 0011_dashboard_rollups.sql.
//
// A MISSING function is a first-class outcome, not an error: the migration may
// not have been applied, and every caller has a whole-book fallback. PostgREST
// answers an unknown function with PGRST202, which is remembered for the
// session so the fallback path costs one probe, not one per render.
const _missingRpc = new Set();
export const rpcMissing = (fn) => _missingRpc.has(fn);

export async function sbRpc(fn, args = {}) {
  if (_missingRpc.has(fn)) return null;
  try {
    const r = await sbFetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: SB_H,
      body: JSON.stringify(args),
    });
    if (r.ok) return r.json();
    let j = {};
    try { j = JSON.parse(await r.text()); } catch { /* non-JSON error body */ }
    // PGRST202: no such function. 404 covers the same case on older gateways.
    if (j.code === 'PGRST202' || r.status === 404) {
      _missingRpc.add(fn);
      console.warn(`[rpc] ${fn} not found - falling back to the in-browser rollup. Apply supabase/migrations/0011_dashboard_rollups.sql.`);
      return null;
    }
    console.warn(`[rpc] ${fn} -> HTTP ${r.status}`, j.message || '');
    return null;
  } catch (e) { console.warn(`[rpc] ${fn} failed:`, e); return null; }
}

// ── Counted / paged reads ─────────────────────────────────────────────────
//
// Everything above fetches whole result sets. These two fetch a PAGE and the
// TOTAL, which is what lets a list render 15 rows without the other 4985
// crossing the wire. PostgREST reports the total in Content-Range when asked
// with `Prefer: count=exact` -- "0-14/268" for a page, "*/268" for a HEAD.
//
// count=exact is a real COUNT(*) on the server. That is fine at this scale and
// is the only variant that can drive an accurate page count; switch to
// planned/estimated only if a table grows past what a count can scan cheaply.
function totalFromRange(r, fallback) {
  const cr = r.headers.get('content-range') || '';
  const n = Number(cr.split('/')[1]);
  return Number.isFinite(n) ? n : fallback;
}

// Row count only -- no body. Used for the dashboard KPI cards, which need the
// number but not the leads behind it until the card is clicked.
// Returns null (not 0) on failure, so callers can tell "none" from "unknown"
// and fall back to counting what is in memory.
export async function sbCount(path) {
  try {
    const sep = path.includes('?') ? '&' : '?';
    const r = await sbFetch(`${SB_URL}/rest/v1/${path}${sep}select=id`, {
      method: 'HEAD',
      headers: { ...SB_H, Prefer: 'count=exact', Range: '0-0' },
    });
    if (!r.ok) { console.warn(`[count] ${path} -> HTTP ${r.status}`); return null; }
    const n = totalFromRange(r, null);
    return n == null ? null : n;
  } catch (e) { console.warn('count failed:', e); return null; }
}

// One page of rows plus the total. `page` is 0-based.
// Returns { rows, total } -- or null when the request fails, so the caller can
// keep whatever it was already showing rather than blanking the list.
export async function sbPage(path, { page = 0, size = 15 } = {}) {
  try {
    const offset = page * size;
    const sep = path.includes('?') ? '&' : '?';
    const r = await sbFetch(`${SB_URL}/rest/v1/${path}${sep}limit=${size}&offset=${offset}`, {
      headers: { ...SB_H, Prefer: 'count=exact', Range: `${offset}-${offset + size - 1}` },
    });
    // 416 = the offset is past the end (the page count shrank under a filter
    // change). An empty page is the honest answer, not an error.
    if (r.status === 416) return { rows: [], total: totalFromRange(r, 0) };
    if (!r.ok) { console.warn(`[page] ${path} -> HTTP ${r.status}`); return null; }
    const rows = await r.json();
    return { rows: Array.isArray(rows) ? rows : [], total: totalFromRange(r, (rows || []).length) };
  } catch (e) { console.warn('page failed:', e); return null; }
}

// Fetch rows for a set of ids, in chunks, so the URL cannot blow up.
//
// Ids are 17 chars (helpers.js uid) or 36-char uuids; inside `in.("a","b")`
// each costs its length plus 9 bytes of encoding. 50 uuids is a ~2.1 KB URL --
// comfortably under the 8 KB request line Kong accepts, and sbDeleteLeads
// already batches at 40. Each chunk goes through sbGetAll because a chunk of 50
// leads can easily hold more than PostgREST's 1000-row page.
async function sbGetByIds(makePath, ids, chunk = 50) {
  const out = [];
  for (let i = 0; i < ids.length; i += chunk) {
    out.push(...await sbGetAll(makePath(inList(ids.slice(i, i + chunk)))));
  }
  return out;
}

// Small column set for looking other people up on demand. db.users no longer
// holds the whole company, so the flows that legitimately need someone else --
// forwarding a lead, addressing a notification to management -- ask the server
// instead of scanning a local array that no longer contains them.
const USER_LITE = 'id,name,email,phone,role,team_id,company_id,is_active,avatar';
export async function sbGetUsersLite(filter) {
  return sbGet(`users?select=${USER_LITE}&${filter}`);
}

// Ids of every active user with `role`, within a company and optionally a team.
export async function sbUserIdsByRole(role, { companyId, teamId } = {}) {
  let f = `role=eq.${role}&is_active=not.eq.false`;
  if (companyId) f += `&or=(company_id.eq.${companyId},company_id.is.null)`;
  if (teamId) f += `&team_id=eq.${teamId}`;
  const rows = await sbGet(`users?select=id&${f}`);
  return (rows || []).map(r => r.id);
}

// `user` is the signed-in account. Passing nothing keeps the old unfiltered
// behaviour, which is what MASTER gets.
export async function sbLoad(user) {
  try {
    const cid = user && user.companyId;
    const tid = user && user.teamId;
    const role = user && user.role;
    const open = isUnscoped(user);
    const co = open ? '' : coFilter(cid);
    const and = co ? `&${co}` : '';
    const isMgmt = role === 'MANAGEMENT';
    const isTL = role === 'TEAM_LEAD';

    // -- users / teams ------------------------------------------------------
    // An agent gets exactly its own row and its own team row. `id.eq.self` is
    // not optional anywhere: getSession() (db.js) resolves the stored session id
    // against getDB().users, so an account missing from its own snapshot boots
    // signed out.
    let usersPath, teamsPath;
    if (open) {
      usersPath = `users?select=${USER_COLS}`;
      teamsPath = 'teams';
    } else if (isMgmt) {
      usersPath = `users?select=${USER_COLS}&${SCOPE_STRICT ? `or=(company_id.eq.${cid},id.eq.${user.id})` : `or=(company_id.eq.${cid},company_id.is.null,id.eq.${user.id})`}`;
      teamsPath = `teams?${co}`;
    } else if (isTL && tid) {
      usersPath = `users?select=${USER_COLS}&or=(team_id.eq.${tid},id.eq.${user.id})`;
      teamsPath = `teams?id=eq.${tid}`;
    } else {
      usersPath = `users?select=${USER_COLS}&id=eq.${user.id}`;
      teamsPath = tid ? `teams?id=eq.${tid}` : 'teams?id=is.null';
    }

    const [users, teams] = await Promise.all([sbGetUsers(usersPath), sbGet(teamsPath)]);
    if (!users || !users.length) return null;
    const userIds = users.map(u => u.id);

    // -- leads --------------------------------------------------------------
    // NOT loaded here either, for the same reason activities are not: it is the
    // other table that grows without bound, and the first screen needs eight
    // NUMBERS from it, not the rows. Those numbers are count queries now
    // (countLeads in db.js) and the lists are paged (queryLeads / LeadsView),
    // so a lead row is fetched only when something is about to show it.
    //
    // db.leads is therefore a cache of what has been looked at. The views that
    // genuinely aggregate over the whole book -- pipeline, reports, calendar,
    // agent performance -- pull it on mount via ensureLeadBook().

    // targets are keyed by user_id, so the loaded user set IS the filter -- no
    // company_id needed, which means no dependency on migration 0009 here.
    const targetsPath = open ? 'targets' : `targets?user_id=${inList(userIds)}`;

    const [targets, properties, bookings, companies, holdReqs, notifs] = await Promise.all([
      sbGet(targetsPath),
      sbGet(`properties?order=created_at.desc${and}`),
      sbGet(`bookings?order=created_at.desc${and}`),
      sbGet(open ? 'companies' : `companies?id=eq.${cid}`),
      sbGet(`hold_requests?order=created_at.desc${and}`),
      // notifications are read ONLY for the signed-in user -- getNotifs(user.id)
      // and getUnreadCount(user.id) in db.js, and db.notifications[user.id] in
      // App.jsx's push handler. Nothing reads another user's key, so loading
      // every user's was pure waste: 158k rows, paginated 1000 at a time on
      // every single login. Capped at 200 because NotifBell renders
      // .slice(0, 50) and addNotifs trims the local list to 60.
      //
      // Behaviour change: while impersonating (AppContext.impersonate) the bell
      // reads an empty list, since only the real account's were fetched.
      user && user.id
        ? sbGet(`notifications?user_id=eq.${user.id}&order=created_at.desc&limit=200`)
        : sbGetAll('notifications?order=created_at.desc'),
    ]);

    // -- activities ---------------------------------------------------------
    // NOT loaded here. It is by far the biggest table (one row per call, note,
    // status change, ... on every lead) and the boot payload was dominated by
    // rows nothing on the first screen reads. Two on-demand loads replace it:
    //
    //   sbActsForLead(leadId)     - the FULL history of ONE lead, fetched when
    //                               the lead detail panel opens. Only ever one
    //                               lead's worth in flight.
    //   sbLoadActWindow(...)      - a recent-only slice for the views that
    //                               aggregate (funnel / agent perf / feeds),
    //                               fetched when such a view first mounts.
    //
    // Both merge into _DB.activities by id (db.js), so the two can overlap
    // freely and neither can clobber the other.
    //
    // Realtime still delivers new activity rows live; inScope() drops any whose
    // lead this browser does not hold, exactly as before.
    const actsMap = {};
    // Convert flat notifications array into a map keyed by userId
    const notifsMap = {};
    (notifs || []).forEach(r => {
      const n = rToN(r);
      if (!notifsMap[n.userId]) notifsMap[n.userId] = [];
      notifsMap[n.userId].push(n);
    });
    return {
      companies: (companies || []).map(rToC),
      users: (users || []).map(rToU),
      teams: (teams || []).map(rToT),
      // The key is deliberately ABSENT, not empty. mergeDB reads "no leads key"
      // as "the cloud was not asked about leads, keep what is cached" -- an
      // empty array would mean "the cloud says there are none" and would wipe
      // whatever ensureLeadBook had already fetched, since this load and that
      // one race on every login.
      activities: actsMap,
      notifications: notifsMap,
      targets: (targets || []).map(rToTg),
      properties: (properties || []).map(rToP),
      bookings: (bookings || []).map(rToBk),
      holdRequests: (holdReqs || []).map(rToHr),
    };
  } catch (e) { console.warn('Supabase load failed:', e); return null; }
}

// Full activity history for ONE lead. This is the lead-detail read: the panel
// wants every entry ever logged, so it is deliberately unwindowed -- but it is
// also a single lead, so the row count is bounded by that lead's own history.
// sbGetAll (not sbGet) because a long-running lead can exceed PostgREST's
// 1000-row page.
export async function sbActsForLead(leadId) {
  if (!leadId) return [];
  const rows = await sbGetAll(`activities?order=timestamp.asc&lead_id=eq.${encodeURIComponent(leadId)}`);
  return (rows || []).map(rToA);
}

// How far back the aggregate views look. buildAgentPerf defaults to a 30-day
// window and buildStageTrend to 30 days, so 60 covers both with room for the
// date filter to be widened a little without a refetch. Raising this raises the
// payload roughly linearly -- it is the one number that trades dashboard depth
// against load time.
export const ACT_WINDOW_DAYS = 60;

// Recent activities across the whole visible lead set, for the views that
// aggregate rather than read one lead: funnel stages, per-agent call/talk-time
// rollups, and the activity feeds.
//
// Scoping mirrors sbLoad's tiers exactly (see the comment above sbLoad). Agents
// and Team Leads have no usable server-side predicate other than their lead
// set, so ids are chunked; MANAGEMENT and MASTER filter on company_id, falling
// back to unfiltered until migration 0009 has been applied.
//
// `leadIds` comes from the caller (db.js) rather than from a query here, so the
// window can never contain a lead this browser does not hold.
export async function sbLoadActWindow(user, leadIds, days = ACT_WINDOW_DAYS) {
  try {
    const since = new Date(Date.now() - days * 864e5).toISOString();
    const from = `timestamp=gte.${encodeURIComponent(since)}`;
    const open = isUnscoped(user);
    const isMgmt = user && user.role === 'MANAGEMENT';
    let rows;
    if (open) {
      rows = await sbGetAll(`activities?order=timestamp.asc&${from}`);
    } else if (isMgmt) {
      const scopable = await hasCompanyCol('activities');
      const co = scopable ? `&${coFilter(user.companyId)}` : '';
      rows = await sbGetAll(`activities?order=timestamp.asc&${from}${co}`);
    } else {
      const ids = leadIds || [];
      rows = ids.length
        ? await sbGetByIds(op => `activities?order=timestamp.asc&${from}&lead_id=${op}`, ids)
        : [];
    }
    const map = {};
    (rows || []).forEach(r => {
      if (!r || !r.lead_id) return;
      (map[r.lead_id] = map[r.lead_id] || []).push(rToA(r));
    });
    return map;
  } catch (e) { console.warn('Supabase activity window load failed:', e); return null; }
}

// UNUSED — nothing in src/ calls this; every cloud write goes through
// sbInsert/sbUpdate/sbUpsert per row. Do not wire it up: the local snapshot is
// now one company's slice AND persistLocal() progressively trims it under
// storage pressure (activities, then property images/media, then whole tables),
// while rToP/rToBk default missing jsonb to []/{} rather than undefined — so a
// trimmed snapshot pushed through here would blank every property's media in
// the cloud. Kept only because it documents the table list.
let _sbSaveTimer = null;
export function sbSave(db) {
  clearTimeout(_sbSaveTimer);
  _sbSaveTimer = setTimeout(async () => {
    try {
      const acts = [];
      Object.entries(db.activities || {}).forEach(([lid, arr]) => (arr || []).forEach(a => acts.push(aToR(a, lid))));
      await Promise.all([
        sbUpsert('companies', (db.companies || []).map(cToR)),
        sbUpsert('users', db.users.map(uToR)),
        sbUpsert('teams', (db.teams || []).map(tToR)),
        sbUpsert('leads', db.leads.map(lToR)),
        sbUpsert('activities', acts),
        sbUpsert('notifications', Object.values(db.notifications || {}).flat().map(nToR)),
        sbUpsert('targets', (db.targets || []).map(tgToR)),
        sbUpsert('properties', (db.properties || []).map(pToR)),
        sbUpsert('bookings', (db.bookings || []).map(bkToR)),
        sbUpsert('hold_requests', (db.holdRequests || []).map(hrToR)),
      ]);
    } catch (e) { console.warn('Supabase save failed:', e); }
  }, 400);
}
