// Browser side of the access-admin Edge Function: every change to another
// account's role, feature access, projects, status or password, and account
// create/delete. The server checks the caller's verified session against
// access-rules.js; this only sends the request and stores the row it returns,
// so the cache always holds what the server saved.
import { SB_URL, SB_KEY, bearer, ensureFreshToken } from './supabase.js';
import { storeUserRow, getDB } from './db.js';

export const ACCESS_URL = `${SB_URL}/functions/v1/access-admin`;

async function call(action, payload) {
  let r;
  try {
    await ensureFreshToken(); r = await fetch(ACCESS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SB_KEY, Authorization: bearer() },
      body: JSON.stringify({ action, ...payload }),
    });
  } catch {
    return { ok: false, error: 'Could not reach the access service. Check your connection.' };
  }
  let j = null;
  try { j = await r.json(); } catch { /* not JSON */ }
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
