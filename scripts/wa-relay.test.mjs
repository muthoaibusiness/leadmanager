// CR-001 CR-2 + D1 for the WhatsApp composer, on the real src/lib/wa.js under
// vite-node with fetch and localStorage stubbed. Nothing is sent anywhere.
//   * The send endpoint is fixed at build time: VITE_WA_RELAY_URL, else
//     <VITE_SUPABASE_URL>/functions/v1/wa-send. wa_settings.relay_url, which
//     the anon key can rewrite, is ignored, so a planted URL never receives
//     the session token or the message.
//   * A human send carries the verified session as Bearer, and no userId.
//   * Credentials are never posted from the browser (set-credentials is 410).
//   * The avatar lookup never goes to a database-controlled URL.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.alert = () => {};

const calls = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url); const h = new Headers(init.headers);
  calls.push({ url: u, method: init.method || 'GET', auth: h.get('authorization'), body: init.body ? JSON.parse(init.body) : null });
  if (u.includes('/functions/v1/wa-send')) return new Response(JSON.stringify({ ok: true, waId: 'w1' }));
  return new Response('[]');
};

const S = await import('../src/lib/supabase.js');
const wa = await import('../src/lib/wa.js');
S.setAccessToken('session-jwt');

const EVIL = 'https://attacker.example/collect';
const settings = { relayUrl: EVIL, sessionName: '', enabled: true };
const conv = { id: 'eyad:8801700000000@s.whatsapp.net', phone: '8801700000000', account: 'eyad' };
const user = { id: 'u1', name: 'Agent', role: 'AGENT' };
const relayCalls = () => calls.filter((c) => c.url === wa.WA_RELAY_URL);

test('the relay URL is fixed at build time and is the project wa-send function', () => {
  assert.equal(wa.WA_RELAY_URL, `${S.SB_URL}/functions/v1/wa-send`);
});

test('a planted wa_settings.relay_url never receives a request', async () => {
  calls.length = 0;
  await wa.waSendMessage(settings, { conversation: conv, user, body: 'hello' });
  assert.ok(!calls.some((c) => c.url.startsWith('https://attacker.example')), 'nothing went to the planted URL');
});

test('a human send carries the session token as Bearer and no claimed userId', async () => {
  calls.length = 0;
  const r = await wa.waSendMessage(settings, { conversation: conv, user, body: 'hello' });
  assert.equal(r.ok, true);
  const c = relayCalls();
  assert.equal(c.length, 1);
  assert.equal(c[0].auth, 'Bearer session-jwt');
  assert.equal(c[0].body.action, 'send');
  assert.equal(c[0].body.text, 'hello');
  assert.equal(c[0].body.to, '8801700000000');
  assert.ok(!('userId' in c[0].body), 'identity comes from the token, not the body');
});

test('a send still works with no relay_url stored at all', async () => {
  calls.length = 0;
  const r = await wa.waSendMessage({ relayUrl: '', enabled: true }, { conversation: conv, user, body: 'hi' });
  assert.equal(r.ok, true);
  assert.equal(relayCalls().length, 1);
});

test('defect 7: the WhatsApp realtime join carries the session token (RLS on wa_messages after 0055)', async () => {
  const sent = [];
  globalThis.WebSocket = class { constructor() { setTimeout(() => this.onopen?.(), 0); } send(m) { sent.push(JSON.parse(m)); } close() {} };
  const stop = wa.waSubscribe({ onMessage() {}, onConversation() {}, onState() {} });
  await new Promise((r) => setTimeout(r, 10));
  stop();
  const join = sent.find((m) => m.event === 'phx_join');
  assert.ok(join, 'joined');
  assert.equal(join.payload.access_token, 'session-jwt');
});

test('defect 9: saving chat settings never writes relay_url (the stored value is kept for rollback)', async () => {
  calls.length = 0;
  await wa.waSaveSettings({ relayUrl: 'https://anything', sessionName: 's', enabled: true, allowedUserIds: ['u1'], webhookUrl: '' }, user);
  const up = calls.find((c) => c.url.includes('/rest/v1/wa_settings'));
  assert.ok(up, 'settings were saved');
  const row = Array.isArray(up.body) ? up.body[0] : up.body;
  assert.ok(!('relay_url' in row), `relay_url not sent (got ${JSON.stringify(row)})`);
  assert.deepEqual(row.allowed_user_ids, ['u1']);
});

