// Verified sign-in (CR-001 D1), on the real src/lib/auth.js + db.js under
// vite-node with fetch and localStorage stubbed. GoTrue and PostgREST are
// scripted here; nothing reaches a real server.
//   * signIn: password grant at GoTrue, then the CRM row by auth_user_id.
//   * The stored session is the Auth token pair, not a CRM user id. A
//     hand-edited pcrm_sess naming another account opens nothing.
//   * Requests carry the access token as Bearer, never the anon key, once
//     signed in. An expired token is refreshed once; a dead refresh signs out.
//   * signOut revokes this browser's session at GoTrue (scope=local) and
//     clears the token pair and the cache.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.alert = () => {};

const NOW = () => Math.floor(Date.now() / 1000);
const jwt = (sub, exp) => ['e30', Buffer.from(JSON.stringify({ sub, exp })).toString('base64url'), 'sig'].join('.');
const auth = { 'm@x.co': { pw: 'right-pass-123', sub: 'a-mgr' } };
const rows = { 'a-mgr': { id: 'mgr', auth_user_id: 'a-mgr', name: 'M', email: 'm@x.co', role: 'MANAGEMENT', company_id: 'c1', is_active: true, allowed_features: null } };
let refreshOk = true;
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url); const h = new Headers(init.headers);
  calls.push({ url: u, method: init.method || 'GET', auth: h.get('authorization') });
  if (u.endsWith('/auth/v1/token?grant_type=password')) {
    const b = JSON.parse(init.body); const a = auth[b.email];
    if (!a || a.pw !== b.password) return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
    return new Response(JSON.stringify({ access_token: jwt(a.sub, NOW() + 3600), refresh_token: 'r1', expires_at: NOW() + 3600, user: { id: a.sub } }));
  }
  if (u.endsWith('/auth/v1/token?grant_type=refresh_token')) {
    // GoTrue's answer for a dead refresh token (checked against a local GoTrue).
    if (!refreshOk) return new Response('{"code":400,"error_code":"refresh_token_not_found","msg":"Invalid Refresh Token: Refresh Token Not Found"}', { status: 400 });
    return new Response(JSON.stringify({ access_token: jwt('a-mgr', NOW() + 3600), refresh_token: 'r2', expires_at: NOW() + 3600, user: { id: 'a-mgr' } }));
  }
  if (u.includes('/auth/v1/logout')) return new Response(null, { status: 204 });
  const m = /\/rest\/v1\/users\?auth_user_id=eq\.([^&]+)/.exec(u);
  if (m) return new Response(JSON.stringify(rows[decodeURIComponent(m[1])] ? [rows[decodeURIComponent(m[1])]] : []));
  return new Response('[]');
};

const A = await import('../src/lib/auth.js');
const S = await import('../src/lib/supabase.js');
const db = await import('../src/lib/db.js');

test('wrong password is refused at GoTrue; nothing is stored', async () => {
  const r = await A.signIn('m@x.co', 'nope');
  assert.equal(r.user, null);
  assert.equal(A.currentSession(), null);
});

test('right password: the CRM account comes from the verified sub, and no password is fetched', async () => {
  calls.length = 0;
  const r = await A.signIn('M@X.co ', 'right-pass-123');
  assert.equal(r.user.id, 'mgr');
  assert.equal(r.user.role, 'MANAGEMENT');
  const rowCall = calls.find((c) => c.url.includes('/rest/v1/users'));
  assert.ok(!/password/.test(rowCall.url), 'select list has no password');
  assert.match(rowCall.auth, /^Bearer e30\./, 'the row is read with the session token');
});

test('signed-in requests send the access token as Bearer', async () => {
  calls.length = 0;
  await S.sbGet('leads?select=id');
  assert.match(calls.at(-1).auth, /^Bearer e30\./);
});

test('a hand-edited pcrm_sess naming another account restores nothing', async () => {
  A.signOutLocal();
  // The cache holds the manager's row, as it would on a shared browser.
  db.getDB().users = [{ id: 'mgr', name: 'M', role: 'MANAGEMENT', companyId: 'c1', isActive: true }];
  store.set('pcrm_sess', JSON.stringify({ id: 'mgr' }));
  assert.equal(db.hasSessionId(), false, 'a bare id is not a session');
  assert.equal(await A.restoreSession(), null);
  assert.equal(db.getSession(), null, 'getSession no longer trusts a stored id');
  assert.equal(store.has('pcrm_sess'), false, 'the legacy key is dropped');
});

test('an expired access token is refreshed once before the request', async () => {
  await A.signIn('m@x.co', 'right-pass-123');
  const s = JSON.parse(store.get(A.SESSION_KEY));
  store.set(A.SESSION_KEY, JSON.stringify({ ...s, expires_at: NOW() - 10 }));
  calls.length = 0;
  const u = await A.restoreSession();
  assert.equal(u.id, 'mgr');
  assert.ok(calls.some((c) => c.url.endsWith('grant_type=refresh_token')));
  assert.equal(JSON.parse(store.get(A.SESSION_KEY)).refresh_token, 'r2');
});

test('a dead refresh token signs out instead of carrying on as anon', async () => {
  const s = JSON.parse(store.get(A.SESSION_KEY));
  store.set(A.SESSION_KEY, JSON.stringify({ ...s, expires_at: NOW() - 10 }));
  refreshOk = false;
  assert.equal(await A.restoreSession(), null);
  assert.equal(A.currentSession(), null);
  refreshOk = true;
});

test('signOut revokes at GoTrue and clears the session and the cache', async () => {
  await A.signIn('m@x.co', 'right-pass-123');
  store.set(db.KEY, '{"users":[]}');
  calls.length = 0;
  await A.signOut();
  assert.ok(calls.some((c) => c.url.endsWith('/auth/v1/logout?scope=local')), 'this browser only');
  assert.equal(A.currentSession(), null);
  assert.equal(store.has(db.KEY), false);
});
