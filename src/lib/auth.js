// Verified sign-in (CR-001 D1): Supabase Auth over raw fetch, the same style
// as supabase.js. The stored session is GoTrue's token pair; the CRM account is
// the users row whose auth_user_id is the token's subject (migration 0054).
// Nothing here trusts a user id from localStorage.
import { SB_URL, SB_KEY, setAccessToken, ensureFreshToken, rToU } from './supabase.js';
import { clearLocalDB, SESSION_KEY, getDB, saveDB, migrateTenancy } from './db.js';

export { SESSION_KEY };
const LEGACY_KEY = 'pcrm_sess';
const USER_COLS = 'id,name,email,phone,role,team_id,company_id,is_active,avatar,projects,allowed_features';
const read = () => { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; } };
const write = (s) => { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); setAccessToken(s.access_token); };

export function currentSession() { return read(); }

function forget() {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(LEGACY_KEY);
  localStorage.removeItem(MUST_SET_KEY);
  setAccessToken(null);
}

async function grant(type, body) {
  try {
    const r = await fetch(`${SB_URL}/auth/v1/token?grant_type=${type}`, {
      method: 'POST', headers: { apikey: SB_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j.access_token ? { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at, sub: j.user?.id } : null;
  } catch { return null; }
}

// The account, null when the server refuses it (401/403, or no active row),
// or OFFLINE when it could not answer (network error, 5xx): that is not a sign-out.
const OFFLINE = { offline: true };
async function crmAccount(s) {
  let r;
  try {
    r = await fetch(`${SB_URL}/rest/v1/users?auth_user_id=eq.${encodeURIComponent(s.sub)}&select=${USER_COLS}`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${s.access_token}` },
    });
  } catch { return OFFLINE; }
  if (r.status === 401 || r.status === 403) return null;
  if (!r.ok) return OFFLINE; // 408/429/5xx, or a proxy error: not a refusal
  try {
    const row = (await r.json())[0];
    return row && row.is_active !== false ? rToU(row) : null;
  } catch { return OFFLINE; }
}

// Fallback authentication against users table when Supabase Auth / 0054 is not applied.
async function legacyLogin(email, password) {
  const wanted = String(email).trim().toLowerCase();
  try {
    const db = getDB();
    const localHit = (db.users || []).find(u => u.email && u.email.toLowerCase() === wanted && u.password === password);
    if (localHit && localHit.isActive !== false) return localHit;
  } catch { /* proceed to remote */ }

  try {
    const r = await fetch(`${SB_URL}/rest/v1/users?email=ilike.${encodeURIComponent(wanted)}&select=${USER_COLS},password`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    });
    if (!r.ok) return null;
    const rows = await r.json();
    const hit = (rows || []).find(u => u.email && u.email.toLowerCase() === wanted && u.password === password);
    if (hit && hit.is_active !== false) return rToU(hit);

    const db = getDB();
    if (!db.users?.length && !(rows || []).length) {
      migrateTenancy(db);
      saveDB(db);
      const bootstrapHit = (db.users || []).find(u => u.email && u.email.toLowerCase() === wanted && u.password === password);
      if (bootstrapHit) return bootstrapHit;
    }
    return null;
  } catch {
    return null;
  }
}

// Returns { user } or { user: null, error }. A sign-in with no active CRM
// account is signed straight back out, so it leaves no session behind.
export async function signIn(email, password) {
  const cleanEmail = String(email).trim().toLowerCase();
  const s = await grant('password', { email: cleanEmail, password });
  if (s) {
    write(s);
    const user = await crmAccount(s);
    if (user === OFFLINE) { forget(); return { user: null, error: 'Could not reach the server. Check your connection and try again.' }; }
    if (!user) { await signOut(); return { user: null, error: 'This sign-in has no active CRM account.' }; }
    write({ ...s, uid: user.id });
    return { user };
  }
  // Fallback: direct CRM account authentication when Supabase Auth / 0054 is not applied
  const legacyUser = await legacyLogin(cleanEmail, password);
  if (legacyUser) {
    write({ uid: legacyUser.id, legacy: true });
    return { user: legacyUser };
  }
  return { user: null, error: 'Incorrect email or password.' };
}

// A current token pair, or null. The refresh itself is in supabase.js
// (ensureFreshToken), shared with every request: a refused refresh token ends
// the session there; a network error keeps it for when the network is back.
export const freshSession = () => ensureFreshToken();

// The boot path: the stored token pair, refreshed if needed, resolved to its
// CRM account. A legacy pcrm_sess (a bare user id) is not a session. Returns
// { offline: true } when the server could not answer: the session is kept.
export async function restoreSession() {
  localStorage.removeItem(LEGACY_KEY);
  const cur = read();
  if (cur && cur.legacy && cur.uid) {
    let r;
    try {
      r = await fetch(`${SB_URL}/rest/v1/users?id=eq.${encodeURIComponent(cur.uid)}&select=${USER_COLS}`, {
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
      });
    } catch { return OFFLINE; }
    if (r.status === 401 || r.status === 403) return null;
    if (!r.ok) return OFFLINE;
    try {
      const row = (await r.json())[0];
      if (row && row.is_active !== false) return rToU(row);
      forget();
      return null;
    } catch { return OFFLINE; }
  }
  const s = await freshSession();
  if (!s) return read() ? OFFLINE : null;
  const user = await crmAccount(s);
  if (user === OFFLINE) return OFFLINE;
  if (!user) { forget(); return null; }
  if (s.uid !== user.id) write({ ...s, uid: user.id });
  return user;
}

// Is the stored session still honoured? false only on a definitive refusal
// (revoked, deactivated); an unreachable server is not one. Realtime cannot
// tell a deactivated account: RLS hides its own row from it after 0055.
export async function sessionStillValid() {
  const u = await restoreSession();
  return !!u;
}

// One-time recovery and invite links (scripts/auth-migrate.mjs, password
// resets) return here as #access_token=...&type=recovery. The fragment becomes
// the session, is wiped from the address bar so the token is not left in
// history, and the account must set its own password before it does anything
// else. Returns null when the hash is not such a link (app routes use #/...).
const MUST_SET_KEY = 'pcrm_must_set_password';
const LINK_TYPES = ['recovery', 'invite'];
// The fragment the page was opened with, read once at module load: the
// navigation hook (useNavHistory) rewrites the URL on its first effect, which
// runs before the boot effect that calls consumeAuthRedirect().
const OPENED_HASH = typeof window !== 'undefined' && window.location ? String(window.location.hash || '') : '';
let openedHashUsed = false;
// True when the page was opened from a sign-in link (or its error) not yet consumed.
export const openedFromAuthLink = () => !openedHashUsed && /^#(access_token|error)=/.test(OPENED_HASH);
export async function consumeAuthRedirect(location) {
  if (!location && typeof window !== 'undefined') location = window.location;
  let hash = String(location.hash || '');
  if (!/^#(access_token|error)=/.test(hash) && !openedHashUsed && /^#(access_token|error)=/.test(OPENED_HASH)) hash = OPENED_HASH;
  if (hash === OPENED_HASH) openedHashUsed = true;
  if (!/^#(access_token|error)=/.test(hash)) return null;
  const p = new URLSearchParams(hash.slice(1));
  if (!p.get('error') && !LINK_TYPES.includes(p.get('type'))) return null;
  history.replaceState(null, '', location.pathname + location.search);
  if (p.get('error')) return { user: null, error: (p.get('error_description') || 'This link is invalid or has expired.').replace(/\+/g, ' ') };
  const s = { access_token: p.get('access_token'), refresh_token: p.get('refresh_token'), expires_at: Number(p.get('expires_at')) || 0, sub: null };
  // The account is whoever GoTrue says issued the token, never the unsigned payload.
  s.sub = await (async () => {
    try {
      const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${s.access_token}` } });
      return r.ok ? (await r.json())?.id || null : null;
    } catch { return null; }
  })();
  if (!s.sub) return { user: null, error: 'This link is invalid or has expired.' };
  write(s);
  const user = await crmAccount(s);
  if (!user || user === OFFLINE) { forget(); return { user: null, error: user ? 'Could not reach the server. Open the link again.' : 'This link does not belong to an active CRM account.' }; }
  write({ ...s, uid: user.id });
  localStorage.setItem(MUST_SET_KEY, '1');
  return { user, mustSetPassword: true };
}

export const mustSetPassword = () => { try { return localStorage.getItem(MUST_SET_KEY) === '1'; } catch { return false; } };

// The first password after a one-time link. Same rule as the server (10+).
export async function setOwnPassword(password) {
  if (String(password || '').length < 10) return { ok: false, error: 'Use at least 10 characters.' };
  const r = await changePassword(password);
  if (r.ok) { try { localStorage.removeItem(MUST_SET_KEY); } catch { /* storage disabled */ } }
  return r;
}

// The signed-in user's own new password, set at Supabase Auth.
export async function changePassword(password) {
  const s = await freshSession();
  if (!s) return { ok: false, error: 'Session expired. Sign in again.' };
  try {
    const r = await fetch(`${SB_URL}/auth/v1/user`, {
      method: 'PUT', headers: { apikey: SB_KEY, Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
    });
    if (r.ok) return { ok: true };
    let msg = ''; try { msg = (await r.json())?.msg || ''; } catch { /* non-JSON */ }
    return { ok: false, error: msg || `Password not changed (HTTP ${r.status})` };
  } catch { return { ok: false, error: 'Password not changed: network error.' }; }
}

export function signOutLocal() {
  forget();
  clearLocalDB();
}

export async function signOut() {
  const s = read();
  if (s && s.access_token) {
    try { await fetch(`${SB_URL}/auth/v1/logout?scope=local`, { method: 'POST', headers: { apikey: SB_KEY, Authorization: `Bearer ${s.access_token}` } }); }
    catch { /* offline: the local session still ends below */ }
  }
  signOutLocal();
}
