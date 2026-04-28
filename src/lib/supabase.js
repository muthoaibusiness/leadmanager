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
  await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...SB_H, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify(rows),
  }).catch(e => console.warn('upsert', table, e));
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
    material_sent: l.materialSent || null, created_at: l.createdAt, updated_at: l.updatedAt,
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
    materialSent: r.material_sent || null, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export function aToR(a, leadId) {
  return { id: a.id, lead_id: leadId, type: a.type, description: a.description || '', user_id: a.userId, user_name: a.userName, duration_seconds: a.durationSeconds || 0, timestamp: a.timestamp };
}

export function rToA(r) {
  return { id: r.id, type: r.type, description: r.description || '', userId: r.user_id, userName: r.user_name, durationSeconds: r.duration_seconds || 0, timestamp: r.timestamp };
}

export function uToR(u) {
  return { id: u.id, name: u.name, email: u.email, password: u.password, phone: u.phone || '', role: u.role, team_id: u.teamId || null, is_active: u.isActive !== false };
}

export function rToU(r) {
  return { id: r.id, name: r.name, email: r.email, password: r.password, phone: r.phone || '', role: r.role, teamId: r.team_id, isActive: r.is_active };
}

export function tToR(t) { return { id: t.id, name: t.name, lead_id: t.leadId }; }
export function rToT(r) { return { id: r.id, name: r.name, leadId: r.lead_id }; }

export function nToR(n) {
  return { id: n.id, user_id: n.userId, type: n.type, message: n.message, lead_id: n.leadId || null, is_read: n.isRead || false, created_at: n.createdAt || new Date().toISOString() };
}

export function rToN(r) {
  return { id: r.id, userId: r.user_id, type: r.type, message: r.message, leadId: r.lead_id, isRead: r.is_read, createdAt: r.created_at };
}

export function tgToR(t) { return { id: t.id, user_id: t.userId, month: t.month, type: t.type, value: t.value }; }
export function rToTg(r) { return { id: r.id, userId: r.user_id, month: r.month, type: r.type, value: r.value }; }

export async function sbLoad() {
  try {
    const [users, teams, leads, acts, notifs, targets] = await Promise.all([
      sbGet('users'), sbGet('teams'), sbGet('leads'),
      sbGet('activities?order=timestamp.asc'),
      sbGet('notifications?order=created_at.desc'),
      sbGet('targets'),
    ]);
    if (!leads || !leads.length) return null;
    const actsMap = {};
    (acts || []).forEach(r => { if (!actsMap[r.lead_id]) actsMap[r.lead_id] = []; actsMap[r.lead_id].push(rToA(r)); });
    return {
      users: (users || []).map(rToU),
      teams: (teams || []).map(rToT),
      leads: (leads || []).map(rToL),
      activities: actsMap,
      notifications: (notifs || []).map(rToN),
      targets: (targets || []).map(rToTg),
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
        sbUpsert('users', db.users.map(uToR)),
        sbUpsert('teams', (db.teams || []).map(tToR)),
        sbUpsert('leads', db.leads.map(lToR)),
        sbUpsert('activities', acts),
        sbUpsert('notifications', (db.notifications || []).map(nToR)),
        sbUpsert('targets', (db.targets || []).map(tgToR)),
      ]);
    } catch (e) { console.warn('Supabase save failed:', e); }
  }, 400);
}
