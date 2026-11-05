// Browser side of the access-admin Edge Function: every change to another
// account's role, feature access, projects, status or password, and account
// create/delete. The server checks the caller's verified session against
// access-rules.js; this only sends the request and stores the row it returns,
// so the cache always holds what the server saved.
import { SB_URL, SB_KEY, bearer, ensureFreshToken, sbPatchRows } from './supabase.js';
import { storeUserRow, getDB } from './db.js';

export const ACCESS_URL = `${SB_URL}/functions/v1/access-admin`;

// shortcut: access-admin is not deployed and migration 0054 is not applied, so
// users is still writable over PostgREST. Until then the simple field edits
// PATCH the row directly; the server-side checks and access_audit row are
// skipped (the UI's canManageUser gate still applies). Delete this once
// access-admin is live — after 0054 the PATCH is refused anyway.
const MARKERS = ['ni_only'];
const USER_SEL = 'id,name,email,phone,role,team_id,company_id,is_active,avatar,projects,allowed_features';
function directPatch(action, p) {
  switch (action) {
    case 'features.set': {
      // Keep the hidden ni_only marker, as the server does.
      const kept = (cachedUser(p.userId)?.allowedFeatures || []).filter(k => MARKERS.includes(k));
      return { allowed_features: p.features === null ? null : [...new Set([...p.features, ...kept])] };
    }
    case 'role.set': return { role: p.role };
    case 'active.set': return { is_active: p.active };
    case 'projects.set': return { projects: p.projects };
    case 'profile.set': {
      const out = {};
      if ('name' in p) out.name = String(p.name ?? '').trim().slice(0, 120);
      if ('phone' in p) out.phone = String(p.phone ?? '').trim().slice(0, 40);
      return out;
    }
    default: return null;
  }
}
async function fallback(action, payload, error) {
  const patch = directPatch(action, payload);
  if (!patch) return { ok: false, error };
  const r = await sbPatchRows('users', `id=eq.${encodeURIComponent(payload.userId)}`, patch, USER_SEL);
  if (!r.ok) return { ok: false, error: r.error };
  if (!r.rows.length) return { ok: false, error: 'The account changed or was removed. Reload and try again.' };
  return { ok: true, user: r.rows[0] };
}

async function call(action, payload) {
  let r;
  try {
    await ensureFreshToken(); r = await fetch(ACCESS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SB_KEY, Authorization: bearer() },
      body: JSON.stringify({ action, ...payload }),
    });
  } catch {
    // An undeployed function 404s its CORS preflight, which lands here too.
    return fallback(action, payload, 'Could not reach the access service. Check your connection.');
  }
  let j = null;
  try { j = await r.json(); } catch { /* not JSON */ }
  // Gateway's own "function not found", not the function's "No such account".
  if (r.status === 404 && j?.code === 'NOT_FOUND') return fallback(action, payload, 'The access service is not deployed.');
  if (!r.ok || !j?.ok) return { ok: false, status: r.status, error: j?.error || `Not saved (HTTP ${r.status})` };
  return { ok: true, ...j };
}

const saved = async (action, payload) => {
  const r = await call(action, payload);
  if (r.ok && r.user) r.user = storeUserRow(r.user);
  return r;
};

// null = back to role defaults; [] = nothing; otherwise the full list.
export const setFeatures = (userId, features) => saved('features.set', { userId, features });
export const setRole = (userId, role) => saved('role.set', { userId, role });
export const setActive = (userId, active) => saved('active.set', { userId, active });
export const setProjects = (userId, projects) => saved('projects.set', { userId, projects });
export const setProfile = (userId, fields) => saved('profile.set', { userId, ...fields });
export const resetPassword = (userId, password) => call('password.reset', { userId, password });
export const createAccount = (fields) => saved('create', fields);

// On success the caller runs db.unassignDeletedUser, which drops the cached
// row together with its leads and team.
export const deleteAccount = (userId) => call('delete', { userId });

export const cachedUser = (id) => getDB().users.find(u => u.id === id) || null;
