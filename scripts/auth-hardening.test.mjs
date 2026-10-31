// vite-node scripts/auth-hardening.test.mjs — session defects found in review
// (CR-001 D1), on the real src/lib/auth.js + supabase.js + wa.js with fetch,
// localStorage, location and WebSocket stubbed. Nothing reaches a server.
//   1. a refresh during a request re-reads the token: the request, and the
//      relay calls in wa.js, never go out with the expired one
//   2. restoreSession keeps the session on a network error or a 5xx; only a
//      definitive refusal (401, or an empty/inactive row) ends it
//   3. a refresh refused for a reason other than a dead refresh token (429,
//      408, 5xx) keeps the session; another tab that already rotated the
//      token is picked up instead of signing every tab out
//   4. signOut ends only this browser's session (scope=local)
//   5. a recovery link whose token GoTrue does not vouch for opens nothing
//   6. realtime joins carry a current token, and a refresh is pushed to open
//      sockets
import assert from 'node:assert/strict';
import { test } from 'node:test';

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.alert = () => {};
globalThis.history = { replaceState() {} };
const NOW = () => Math.floor(Date.now() / 1000);
let jti = 0; // every token distinct, as GoTrue's are
const jwt = (sub, exp = NOW() + 3600) => ['e30', Buffer.from(JSON.stringify({ sub, exp, jti: ++jti })).toString('base64url'), 'sig'].join('.');
globalThis.window = { location: { pathname: '/', search: '', hash: '' } };

const rows = { 'a-1': { id: 'u1', auth_user_id: 'a-1', name: 'One', email: 'one@x.co', role: 'AGENT', company_id: 'c1', is_active: true, allowed_features: null } };
const valid = new Set();            // access tokens GoTrue vouches for
let usersMode = 'ok';               // ok | network | 500 | 401 | empty
let refresh = 'ok';                 // ok | 429 | 408 | 500 | invalid_grant | rotated
let n = 0;
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url); const h = new Headers(init.headers);
  calls.push({ url: u, method: init.method || 'GET', auth: h.get('authorization') });
  if (u.endsWith('/auth/v1/token?grant_type=refresh_token')) {
    if (refresh === 'invalid_grant') return new Response('{"error":"invalid_grant","error_description":"Invalid Refresh Token: Refresh Token Not Found"}', { status: 400 });
    if (refresh === 'gotrue_new') return new Response('{"code":400,"error_code":"refresh_token_not_found","msg":"Invalid Refresh Token: Refresh Token Not Found"}', { status: 400 });
    if (refresh === 'waf403') return new Response('<html>blocked</html>', { status: 403 });
    if (refresh === 'rotated') {
      // Another tab rotated it a moment ago and stored the new pair.
      const t = jwt('a-1'); valid.add(t);
      store.set('pcrm_auth', JSON.stringify({ access_token: t, refresh_token: 'r-other-tab', expires_at: NOW() + 3600, sub: 'a-1', uid: 'u1' }));
      return new Response('{"error":"invalid_grant","error_description":"Invalid Refresh Token: Already Used"}', { status: 400 });
    }
    if (refresh !== 'ok') return new Response('{}', { status: Number(refresh) });
    const t = jwt('a-1'); valid.add(t);
    return new Response(JSON.stringify({ access_token: t, refresh_token: `r${++n}`, expires_at: NOW() + 3600, user: { id: 'a-1' } }));
  }
  if (u.endsWith('/auth/v1/user') && (init.method || 'GET') === 'GET') {
    const t = (h.get('authorization') || '').replace('Bearer ', '');
    return valid.has(t) ? new Response(JSON.stringify({ id: 'a-1' })) : new Response('{"msg":"invalid JWT"}', { status: 401 });
  }
  if (u.includes('/auth/v1/logout')) return new Response(null, { status: 204 });
  const m = /\/rest\/v1\/users\?auth_user_id=eq\.([^&]+)/.exec(u);
  if (m) {
    if (usersMode === 'network') throw new TypeError('Failed to fetch');
    if (usersMode === '500') return new Response('{}', { status: 500 });
    if (usersMode === '401') return new Response('{"message":"JWT expired"}', { status: 401 });
    if (['408', '429', '400'].includes(usersMode)) return new Response('{}', { status: Number(usersMode) });
    if (usersMode === 'empty') return new Response('[]');
    const row = rows[decodeURIComponent(m[1])];
    return new Response(JSON.stringify(row ? [row] : []));
  }
  return new Response('[]');
};

const sockets = [];
globalThis.WebSocket = class { constructor() { this.sent = []; this.readyState = 1; sockets.push(this); setTimeout(() => this.onopen?.(), 0); } send(m) { this.sent.push(JSON.parse(m)); } close() { this.readyState = 3; } };

const S = await import('../src/lib/supabase.js');
const A = await import('../src/lib/auth.js');
const wa = await import('../src/lib/wa.js');

const signedIn = (exp = NOW() + 3600) => { const t = jwt('a-1', exp); valid.add(t); store.set('pcrm_auth', JSON.stringify({ access_token: t, refresh_token: 'r0', expires_at: exp, sub: 'a-1', uid: 'u1' })); S.setAccessToken(t); return t; };
const expired = () => signedIn(NOW() - 5);
const reset = () => { usersMode = 'ok'; refresh = 'ok'; calls.length = 0; };

const fresh = () => `Bearer ${JSON.parse(store.get('pcrm_auth')).access_token}`;
test('1: a request after expiry goes out with the refreshed token, not the old one', async () => {
  // sbGet passes SB_H itself; the others spread it into a new object first.
  for (const [name, run, part] of [
    ['sbGet', () => S.sbGet('leads?select=id'), '/rest/v1/leads'],
    ['sbUpsert', () => S.sbUpsert('notes_x', [{ id: 'n1' }]), '/rest/v1/notes_x'],
    ['sbCount', () => S.sbCount('leads?status=eq.NEW'), '/rest/v1/leads'],
  ]) {
    reset(); const old = expired();
    await run();
    const sent = calls.filter((c) => c.url.includes(part));
    assert.ok(sent.length >= 1, name);
    for (const c of sent) assert.notEqual(c.auth, `Bearer ${old}`, `${name}: the expired token was sent`);
    assert.equal(sent.at(-1).auth, fresh(), name);
  }
});

test('1: wa.js PATCH and relay calls after expiry carry the refreshed token', async () => {
  reset(); let old = expired();
  await wa.waMarkRead('eyad:1@s.whatsapp.net');
  const mr = calls.filter((c) => c.url.includes('/rest/v1/wa_conversations'));
  assert.equal(mr.length, 1); assert.notEqual(mr[0].auth, `Bearer ${old}`, 'waMarkRead sent the expired token'); assert.equal(mr[0].auth, fresh());
  reset(); old = expired();
  await wa.waFailMessage('m1', 'x');
  const fm = calls.filter((c) => c.url.includes('/rest/v1/wa_messages'));
  assert.equal(fm.length, 1); assert.notEqual(fm[0].auth, `Bearer ${old}`, 'waFailMessage sent the expired token');
  reset(); old = expired();
  await wa.waSendMessage({ enabled: true }, { conversation: { id: 'eyad:8801711111111@s.whatsapp.net', phone: '8801711111111', account: 'eyad' }, user: { id: 'u1', name: 'One', role: 'AGENT' }, body: 'hi' });
  const relay = calls.filter((c) => c.url === wa.WA_RELAY_URL);
  assert.equal(relay.length, 1);
  assert.notEqual(relay[0].auth, `Bearer ${old}`);
  assert.equal(relay[0].auth, fresh());
});

test('2: restoreSession keeps the session on a network error or 5xx', async () => {
  for (const mode of ['network', '500']) {
    reset(); signedIn(); usersMode = mode;
    const r = await A.restoreSession();
    assert.ok(store.get('pcrm_auth'), `${mode}: session kept`);
    assert.equal(r && r.offline, true, `${mode}: reported as offline, not signed out`);
  }
});

test('2: a definitive refusal still ends the session', async () => {
  for (const mode of ['401', 'empty']) {
    reset(); signedIn(); usersMode = mode;
    assert.equal(await A.restoreSession(), null, mode);
    assert.equal(store.get('pcrm_auth'), undefined, `${mode}: session removed`);
  }
  reset(); signedIn(); rows['a-1'].is_active = false;
  assert.equal(await A.restoreSession(), null, 'inactive');
  rows['a-1'].is_active = true;
});

test('3: a rate-limited, timed-out or failing refresh keeps the session', async () => {
  for (const code of ['429', '408', '500']) {
    reset(); expired(); refresh = code;
    assert.equal(await S.ensureFreshToken(), null, code);
    assert.ok(store.get('pcrm_auth'), `${code}: session kept`);
  }
});

test('3: a refresh token another tab already rotated is picked up, not treated as sign-out', async () => {
  reset(); expired(); refresh = 'rotated';
  const s = await S.ensureFreshToken();
  assert.equal(s && s.refresh_token, 'r-other-tab');
  assert.equal(JSON.parse(store.get('pcrm_auth')).refresh_token, 'r-other-tab');
});

test('3: a dead refresh token (invalid_grant) still signs out', async () => {
  reset(); expired(); refresh = 'invalid_grant';
  assert.equal(await S.ensureFreshToken(), null);
  assert.equal(store.get('pcrm_auth'), undefined);
});

test('4: signOut ends only this browser\'s session', async () => {
  reset(); signedIn();
  await A.signOut();
  const out = calls.find((c) => c.url.includes('/auth/v1/logout'));
  assert.ok(out, 'logout called');
  assert.match(out.url, /[?&]scope=local\b/);
});

test('5: a recovery link whose token GoTrue does not vouch for opens nothing', async () => {
  reset(); store.clear(); S.setAccessToken(null);
  const forged = jwt('a-1');           // well-formed, names a real account, never issued
  const r = await A.consumeAuthRedirect({ pathname: '/', search: '', hash: `#access_token=${forged}&refresh_token=rt&expires_at=${NOW() + 3600}&type=recovery` });
  assert.equal(r.user, null);
  assert.equal(store.get('pcrm_auth'), undefined, 'nothing stored');
});

test('5: a link token GoTrue vouches for still works', async () => {
  reset(); store.clear();
  const t = jwt('a-1'); valid.add(t);
  const r = await A.consumeAuthRedirect({ pathname: '/', search: '', hash: `#access_token=${t}&refresh_token=rt&expires_at=${NOW() + 3600}&type=recovery` });
  assert.equal(r.user && r.user.id, 'u1');
});

test('6: realtime joins use a fresh token, and a refresh is pushed to open sockets', async () => {
  reset(); const old = expired();
  sockets.length = 0;
  const stop = wa.waSubscribe({ onMessage() {}, onConversation() {}, onState() {} });
  try {
    await new Promise((r) => setTimeout(r, 20));
    const join = sockets[0].sent.find((m) => m.event === 'phx_join');
    assert.ok(join, 'joined');
    assert.notEqual(join.payload.access_token, old, 'join did not use the expired token');
    // A later refresh reaches the open socket on the topic it joined.
    const s = JSON.parse(store.get('pcrm_auth'));
    store.set('pcrm_auth', JSON.stringify({ ...s, expires_at: NOW() - 5 }));
    await S.ensureFreshToken();
    const push = sockets[0].sent.find((m) => m.event === 'access_token');
    assert.ok(push, 'access_token pushed after refresh');
    assert.equal(push.topic, join.topic);
    assert.equal(push.payload.access_token, JSON.parse(store.get('pcrm_auth')).access_token);
  } finally { stop(); }
});

test('7: sessionStillValid: true when the account resolves or the server is unreachable, false once deactivated', async () => {
  reset(); signedIn();
  assert.equal(await A.sessionStillValid(), true);
  usersMode = 'network'; assert.equal(await A.sessionStillValid(), true, 'offline is not a sign-out');
  usersMode = 'ok'; rows['a-1'].is_active = false;
  assert.equal(await A.sessionStillValid(), false, 'deactivated');
  rows['a-1'].is_active = true;
});

test('8: 408, 429 or 400 on the account lookup is not a sign-out', async () => {
  for (const mode of ['408', '429', '400']) {
    reset(); signedIn(); usersMode = mode;
    const r = await A.restoreSession();
    assert.equal(r && r.offline, true, mode);
    assert.ok(store.get('pcrm_auth'), `${mode}: session kept`);
  }
});

test('17: a refresh refused by a proxy (non-JSON 403) keeps the session; GoTrue\'s current dead-token shape ends it', async () => {
  reset(); expired(); refresh = 'waf403';
  assert.equal(await S.ensureFreshToken(), null);
  assert.ok(store.get('pcrm_auth'), 'proxy 403: kept');
  reset(); expired(); refresh = 'gotrue_new';
  assert.equal(await S.ensureFreshToken(), null);
  assert.equal(store.get('pcrm_auth'), undefined, 'refresh_token_not_found: signed out');
});

test('9: the notifications and main realtime sockets also receive refreshed tokens', async () => {
  reset(); signedIn();
  sockets.length = 0;
  const stopN = S.sbSubscribeNotifs('u1', () => {});
  const stopA = S.sbSubscribeAll(() => {}, { id: 'u1', role: 'MASTER' });
  try {
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(sockets.length, 2, 'two sockets');
    const s = JSON.parse(store.get('pcrm_auth'));
    store.set('pcrm_auth', JSON.stringify({ ...s, expires_at: NOW() - 5 }));
    await S.ensureFreshToken();
    const t = JSON.parse(store.get('pcrm_auth')).access_token;
    for (const ws of sockets) {
      const join = ws.sent.find((m) => m.event === 'phx_join');
      const push = ws.sent.find((m) => m.event === 'access_token');
      assert.ok(push, `pushed on ${join.topic}`);
      assert.equal(push.topic, join.topic);
      assert.equal(push.payload.access_token, t);
    }
  } finally { stopN(); stopA(); }
});

test('10: a token another tab refreshed reaches this tab\'s sockets', async () => {
  reset(); signedIn();
  sockets.length = 0;
  const stop = wa.waSubscribe({ onMessage() {}, onConversation() {}, onState() {} });
  try {
    await new Promise((r) => setTimeout(r, 20));
    const t = jwt('a-1'); valid.add(t);
    store.set('pcrm_auth', JSON.stringify({ access_token: t, refresh_token: 'r-tab2', expires_at: NOW() + 3600, sub: 'a-1', uid: 'u1' }));
    await S.ensureFreshToken();
    const push = sockets[0].sent.find((m) => m.event === 'access_token');
    assert.ok(push && push.payload.access_token === t, 'the other tab\'s token was pushed');
  } finally { stop(); }
});

test('23: signing out clears the must-set-password flag, so the next account is not stuck on it', async () => {
  reset(); signedIn();
  store.set('pcrm_must_set_password', '1');
  A.signOutLocal();
  assert.equal(store.get('pcrm_must_set_password'), undefined);
});
