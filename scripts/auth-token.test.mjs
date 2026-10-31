// Session token lifetime (CR-001 D1), on the real src/lib/auth.js +
// supabase.js under vite-node with fetch and localStorage stubbed.
//   * defect 3: a stored session is attached synchronously at module load, so
//     the first requests of a warm reload carry it, not the anon key
//   * defect 2: a request made after the access token expired refreshes it
//     first and goes out with the new one; concurrent requests share one
//     refresh
//   * defect 5: a network failure while refreshing keeps the stored session
//     (the user stays signed in offline); only a refused refresh signs out
import assert from 'node:assert/strict';
import { test } from 'node:test';

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.alert = () => {};
const NOW = () => Math.floor(Date.now() / 1000);

// A session stored by a previous visit, still valid. Set BEFORE the modules load.
store.set('pcrm_auth', JSON.stringify({ access_token: 'stored-at', refresh_token: 'r0', expires_at: NOW() + 3600, sub: 'a-mgr', uid: 'mgr' }));

let refreshMode = 'ok'; let refreshes = 0; let next = 1;
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url); const h = new Headers(init.headers);
  calls.push({ url: u, auth: h.get('authorization') });
  if (u.endsWith('/auth/v1/token?grant_type=refresh_token')) {
    refreshes++;
    if (refreshMode === 'network') throw new TypeError('Failed to fetch');
    if (refreshMode === 'refused') return new Response('{"error":"invalid_grant"}', { status: 400 });
    await new Promise((r) => setTimeout(r, 20));
    const n = next++;
    return new Response(JSON.stringify({ access_token: `fresh-${n}`, refresh_token: `r${n}`, expires_at: NOW() + 3600, user: { id: 'a-mgr' } }));
  }
  return new Response('[]');
};

const S = await import('../src/lib/supabase.js');
const A = await import('../src/lib/auth.js');

test('defect 3: the stored token is attached at load, before any async restore', async () => {
  calls.length = 0;
  await S.sbGet('leads?select=id');
  assert.equal(calls.at(-1).auth, 'Bearer stored-at');
});

const expire = () => { const s = JSON.parse(store.get('pcrm_auth')); store.set('pcrm_auth', JSON.stringify({ ...s, expires_at: NOW() - 5 })); };

test('defect 2: after expiry, the next request refreshes first and carries the new token', async () => {
  expire(); calls.length = 0; refreshes = 0;
  await S.sbGet('leads?select=id');
  assert.equal(refreshes, 1);
  assert.match(calls.at(-1).auth, /^Bearer fresh-\d+$/);
});

test('defect 2: concurrent requests after expiry share a single refresh', async () => {
  expire(); calls.length = 0; refreshes = 0;
  await Promise.all([S.sbGet('a'), S.sbGet('b'), S.sbGet('c'), S.sbGet('d')]);
  assert.equal(refreshes, 1, 'one refresh for four requests');
  const toks = new Set(calls.filter((c) => c.url.includes('/rest/v1/')).map((c) => c.auth));
  assert.equal(toks.size, 1);
});

test('defect 5: a network error during refresh keeps the stored session', async () => {
  expire(); refreshMode = 'network';
  const s = await A.freshSession();
  assert.equal(s, null, 'no fresh token right now');
  assert.ok(store.get('pcrm_auth'), 'the session is kept for when the network is back');
  refreshMode = 'ok';
  assert.ok(await A.freshSession(), 'next try succeeds and the user was never signed out');
});

test('defect 5: a refused refresh (dead refresh token) still signs out', async () => {
  expire(); refreshMode = 'refused';
  assert.equal(await A.freshSession(), null);
  assert.equal(store.get('pcrm_auth'), undefined);
  refreshMode = 'ok';
});
