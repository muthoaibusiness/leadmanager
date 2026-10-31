// One-time recovery / invite links (CR-001 D1, defect 4), on the real
// src/lib/auth.js under vite-node with fetch, localStorage and location
// stubbed. auth-migrate.mjs gives every account such a link; without this
// the person lands on the login page with a password nobody knows.
//   * the #access_token=...&type=recovery fragment becomes the session and is
//     wiped from the address bar (no token left in history or a shared URL)
//   * the account is then in "must set a password" state until it does
//   * setting the password clears that state; a too-short one is refused
//   * a link error (#error=...&error_code=otp_expired) is reported, not stored
//   * a fragment without type=recovery|invite is ignored
import assert from 'node:assert/strict';
import { test } from 'node:test';

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.alert = () => {};
let replaced = null;
globalThis.history = { replaceState: (_s, _t, url) => { replaced = url; } };
const NOW = () => Math.floor(Date.now() / 1000);
const rows = { 'a-1': { id: 'u1', auth_user_id: 'a-1', name: 'One', email: 'one@x.co', role: 'AGENT', company_id: 'c1', is_active: true, allowed_features: null } };
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url); const h = new Headers(init.headers);
  calls.push({ url: u, method: init.method || 'GET', auth: h.get('authorization'), body: init.body ? JSON.parse(init.body) : null });
  if (u.endsWith('/auth/v1/user') && init.method === 'PUT') return new Response('{}', { status: 200 });
  // GoTrue vouches for the link's token (consumeAuthRedirect never trusts the unsigned payload).
  if (u.endsWith('/auth/v1/user')) return h.get('authorization') === `Bearer ${AT}` ? new Response('{"id":"a-1"}') : new Response('{}', { status: 401 });
  const m = /users\?auth_user_id=eq\.([^&]+)/.exec(u);
  if (m) return new Response(JSON.stringify(rows[decodeURIComponent(m[1])] ? [rows[decodeURIComponent(m[1])]] : []));
  return new Response('[]');
};

// GoTrue access tokens are JWTs whose payload carries the Auth user id (sub).
const AT = ['e30', Buffer.from(JSON.stringify({ sub: 'a-1', exp: NOW() + 3600 })).toString('base64url'), 'sig'].join('.');
// The page is opened from a recovery link: the fragment is there at load.
globalThis.window = { location: { pathname: '/', search: '', hash: `#access_token=${AT}&expires_at=${NOW() + 3600}&refresh_token=rt-0&token_type=bearer&type=recovery` } };
const A = await import('../src/lib/auth.js');
const loc = (hash) => ({ pathname: '/', search: '', hash });

test('a recovery link becomes the session, is wiped from the URL, and requires a new password', async () => {
  const r = await A.consumeAuthRedirect(loc(`#access_token=${AT}&expires_at=${NOW() + 3600}&expires_in=3600&refresh_token=rt-1&token_type=bearer&type=recovery`));
  assert.equal(r.user.id, 'u1');
  assert.equal(r.mustSetPassword, true);
  assert.equal(replaced, '/', 'token removed from the address bar');
  assert.equal(JSON.parse(store.get('pcrm_auth')).access_token, AT);
  assert.equal(A.mustSetPassword(), true, 'state survives a reload until a password is set');
});

test('a password shorter than 10 characters is refused; a good one clears the must-set state', async () => {
  assert.equal((await A.setOwnPassword('short')).ok, false);
  const r = await A.setOwnPassword('a-good-new-password');
  assert.equal(r.ok, true);
  const put = calls.filter((c) => c.url.endsWith('/auth/v1/user') && c.method === 'PUT').at(-1);
  assert.equal(put.auth, `Bearer ${AT}`);
  assert.deepEqual(put.body, { password: 'a-good-new-password' });
  assert.equal(A.mustSetPassword(), false);
});

test('an expired or used link reports its error and stores nothing', async () => {
  store.clear(); replaced = null;
  const r = await A.consumeAuthRedirect(loc('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'));
  assert.equal(r.user, null);
  assert.match(r.error, /expired/i);
  assert.equal(store.get('pcrm_auth'), undefined);
  assert.equal(replaced, '/', 'the error fragment is cleared too');
});

test('the link fragment is captured at load, before navigation code rewrites the URL', async () => {
  // The app's history hook replaces the URL on its first effect, before the
  // boot effect runs. consumeAuthRedirect() with no argument must still see
  // the fragment the page was opened with.
  store.clear(); replaced = null;
  globalThis.window.location.hash = '';
  const r = await A.consumeAuthRedirect();
  assert.ok(r && r.user, 'the fragment captured at module load was used');
  assert.equal(r.user.id, 'u1');
});

test('ordinary hashes (app routes) are left alone', async () => {
  replaced = null;
  assert.equal(await A.consumeAuthRedirect(loc('#/leads')), null);
  assert.equal(replaced, null);
  assert.equal(await A.consumeAuthRedirect(loc('#access_token=x&type=magiclink_unknown')), null);
});
