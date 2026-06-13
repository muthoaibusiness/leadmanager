export const SB_URL = 'https://nqfxxdrxdcdhoerwylfn.supabase.co';
export const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xZnh4ZHJ4ZGNkaG9lcnd5bGZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwOTA0NzAsImV4cCI6MjA5MjY2NjQ3MH0.Q4I0DSu7mYZfufpHosOTR3yhaw1UWDYi0fF6n5IPIxQ';
export const SB_H = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' };

export async function sbGet(path) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: SB_H });
    if (!r.ok) return [];
    return r.json();
  } catch { return []; }
}

export async function sbUpsert(table, rows) {
  if (!rows || !rows.length) return;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: { ...SB_H, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(rows),
    });
    // REST returns 4xx WITHOUT rejecting the promise — must inspect r.ok explicitly.
    if (!r.ok) {
      let body = '';
      try { body = await r.text(); } catch {}
      console.error(`Supabase ${table === 'leads' ? 'Lead Insert' : 'Upsert'} Error [${table}] HTTP ${r.status}:`, body);
      console.error('Payload:', rows);
      return { ok: false, status: r.status, body };
    }
    return { ok: true };
  } catch (e) {
    console.error(`Supabase Upsert network error [${table}]:`, e);
    console.error('Payload:', rows);
    return { ok: false, error: e };
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
    call_count: l.callCount || 0, sms_count: l.smsCount || 0,
    whatsapp_count: l.whatsappCount || 0, visit_count: l.visitCount || 0,
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
    callCount: r.call_count || 0, smsCount: r.sms_count || 0,
    whatsappCount: r.whatsapp_count || 0, visitCount: r.visit_count || 0,
    notes: r.notes || '', externalId: r.external_id || null, priority: r.priority || null,
    preferredTime: r.preferred_time || null, nextFollowup: r.next_followup || null,
    materialSent: r.material_sent || null, cart: r.cart || null, companyId: r.company_id || null,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export function aToR(a, leadId) {
  return { id: a.id, lead_id: leadId, type: a.type, description: a.description || '', user_id: a.userId, user_name: a.userName, duration_seconds: a.durationSeconds || 0, timestamp: a.timestamp };
}

export function rToA(r) {
  return { id: r.id, type: r.type, description: r.description || '', userId: r.user_id, userName: r.user_name, durationSeconds: r.duration_seconds || 0, timestamp: r.timestamp };
}

export function uToR(u) {
  return { id: u.id, name: u.name, email: u.email, password: u.password, phone: u.phone || '', role: u.role, team_id: u.teamId || null, company_id: u.companyId ?? null, is_active: u.isActive !== false, avatar: u.avatar || null, projects: u.projects ?? null };
}

export function rToU(r) {
  return { id: r.id, name: r.name, email: r.email, password: r.password, phone: r.phone || '', role: r.role, teamId: r.team_id, companyId: r.company_id ?? null, isActive: r.is_active, avatar: r.avatar || '', projects: r.projects ?? undefined };
}

export function tToR(t) { return { id: t.id, name: t.name, lead_id: t.leadId, company_id: t.companyId || null }; }
export function rToT(r) { return { id: r.id, name: r.name, leadId: r.lead_id, companyId: r.company_id || null }; }

// Companies (multi-tenant)
export function cToR(c) { return { id: c.id, name: c.name, plan: c.plan || 'Starter', is_active: c.isActive !== false, created_at: c.createdAt || new Date().toISOString() }; }
export function rToC(r) { return { id: r.id, name: r.name, plan: r.plan || 'Starter', isActive: r.is_active !== false, createdAt: r.created_at }; }

export function nToR(n) {
  return { id: n.id, user_id: n.userId, type: n.type, message: n.message, lead_id: n.leadId || null, is_read: n.read || false, created_at: n.timestamp || new Date().toISOString() };
}

export function rToN(r) {
  return { id: r.id, userId: r.user_id, type: r.type, message: r.message, leadId: r.lead_id, read: r.is_read || false, timestamp: r.created_at };
}

// Flat array of notification objects (each has userId) → upsert to Supabase
export async function sbUpsertNotifs(notifs) {
  if (!notifs || !notifs.length) return;
  await sbUpsert('notifications', notifs.map(nToR));
}

// Mark specific notification ids as read in Supabase
export async function sbMarkRead(ids) {
  if (!ids || !ids.length) return;
  const filter = ids.map(id => `id.eq.${id}`).join(',');
  await fetch(`${SB_URL}/rest/v1/notifications?or=(${filter})`, {
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

export function tgToR(t) { return { id: t.id, user_id: t.userId, month: t.month, type: t.type, value: t.value }; }
export function rToTg(r) { return { id: r.id, userId: r.user_id, month: r.month, type: r.type, value: r.value }; }

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
  };
}

export async function sbLoad() {
  try {
    const [users, teams, leads, acts, notifs, targets, properties, bookings, companies] = await Promise.all([
      sbGet('users'), sbGet('teams'), sbGet('leads'),
      sbGet('activities?order=timestamp.asc'),
      sbGet('notifications?order=created_at.desc'),
      sbGet('targets'),
      sbGet('properties?order=created_at.desc'),
      sbGet('bookings?order=created_at.desc'),
      sbGet('companies'),
    ]);
    if (!users || !users.length) return null;
    const actsMap = {};
    (acts || []).forEach(r => { if (!actsMap[r.lead_id]) actsMap[r.lead_id] = []; actsMap[r.lead_id].push(rToA(r)); });
    // Convert flat notifications array → map keyed by userId
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
      leads: (leads || []).map(rToL),
      activities: actsMap,
      notifications: notifsMap,
      targets: (targets || []).map(rToTg),
      properties: (properties || []).map(rToP),
      bookings: (bookings || []).map(rToBk),
    };
  } catch (e) { console.warn('Supabase load failed:', e); return null; }
}

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
      ]);
    } catch (e) { console.warn('Supabase save failed:', e); }
  }, 400);
}
