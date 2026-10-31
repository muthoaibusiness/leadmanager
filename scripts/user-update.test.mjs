// Saving an account (CR-001 D1), on the real db.js + accessAdmin.js under
// vite-node with fetch and localStorage stubbed. Nothing reaches a server.
//   * updateProfile PATCHes only the changed profile fields, never role or
//     allowed_features, asks for the row back, and reports 0 rows as failure.
//   * setFeatures goes to the access-admin function with the session token
//     and stores the row the server returned, so a reload shows the same.
//   * A refusal leaves the cached row untouched and says why.
//   * A realtime UPDATE of the signed-in account's own row reaches the
//     session user (onSelfChange), so revoked access disappears at once.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.alert = () => {};

let patchRows = null;
let fnAnswer = null;
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url); const h = new Headers(init.headers);
  calls.push({ url: u, method: init.method || 'GET', auth: h.get('authorization'), prefer: h.get('prefer'), body: init.body ? JSON.parse(init.body) : null });
  if (u.includes('/rest/v1/users') && init.method === 'PATCH') return new Response(JSON.stringify(patchRows), { status: 200 });
  if (u.includes('/functions/v1/access-admin')) return new Response(JSON.stringify(fnAnswer.body), { status: fnAnswer.status });
  return new Response('[]');
};

const S = await import('../src/lib/supabase.js');
const db = await import('../src/lib/db.js');
const AA = await import('../src/lib/accessAdmin.js');
S.setAccessToken('session-jwt');

const seed = () => {
  const d = db.getDB();
  d.users = [
    { id: 'mgr', name: 'M', role: 'MANAGEMENT', companyId: 'c1', isActive: true },
    { id: 'ag', name: 'Old', phone: '1', role: 'AGENT', companyId: 'c1', isActive: true, allowedFeatures: ['leads'] },
  ];
};

test('profile save PATCHes only changed profile fields and asks for the row back', async () => {
  seed(); calls.length = 0;
  patchRows = [{ id: 'ag', name: 'New', phone: '1', role: 'AGENT', company_id: 'c1', is_active: true, allowed_features: ['leads'] }];
  const r = await db.updateProfile('ag', { name: 'New', phone: '1', role: 'MANAGEMENT', allowedFeatures: ['accounts'] });
  assert.equal(r.ok, true);
  const p = calls.find((c) => c.method === 'PATCH');
  assert.deepEqual(p.body, { name: 'New' }, 'unchanged phone and non-profile fields are not sent');
  assert.match(p.prefer, /return=representation/);
  assert.match(p.url, /select=/, 'names its columns: select=* would include password');
  assert.equal(p.auth, 'Bearer session-jwt');
  assert.equal(db.getDB().users.find((u) => u.id === 'ag').name, 'New');
});

test('zero rows back is a failure and the cache is not changed', async () => {
  seed();
  patchRows = [];
  const r = await db.updateProfile('ag', { name: 'Ghost' });
  assert.equal(r.ok, false);
  assert.match(r.error, /not saved/i);
  assert.equal(db.getDB().users.find((u) => u.id === 'ag').name, 'Old');
});

test('nothing changed: no request, reported as ok', async () => {
  seed(); calls.length = 0;
  const r = await db.updateProfile('ag', { name: 'Old' });
  assert.equal(r.ok, true);
  assert.equal(calls.length, 0);
});

test('feature grant goes through access-admin and the stored row is what the server returned', async () => {
  seed(); calls.length = 0;
  fnAnswer = { status: 200, body: { ok: true, user: { id: 'ag', name: 'Old', role: 'AGENT', company_id: 'c1', is_active: true, allowed_features: ['leads', 'calendar'] } } };
  const r = await AA.setFeatures('ag', ['leads', 'calendar']);
  assert.equal(r.ok, true);
  const c = calls.find((x) => x.url.includes('/functions/v1/access-admin'));
  assert.deepEqual(c.body, { action: 'features.set', userId: 'ag', features: ['leads', 'calendar'] });
  assert.equal(c.auth, 'Bearer session-jwt');
  assert.ok(!calls.some((x) => x.url.includes('/rest/v1/users') && x.method === 'PATCH'), 'no direct users PATCH');
  assert.deepEqual(db.getDB().users.find((u) => u.id === 'ag').allowedFeatures, ['leads', 'calendar']);
  // "after reload": the persisted snapshot holds the same list.
  db.saveDB(db.getDB());
  assert.deepEqual(JSON.parse(store.get(db.KEY)).users.find((u) => u.id === 'ag').allowedFeatures, ['leads', 'calendar']);
});

test('a refused grant leaves the cached row and says why', async () => {
  seed();
  fnAnswer = { status: 403, body: { ok: false, error: 'You may not change this account' } };
  const r = await AA.setFeatures('ag', ['accounts']);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'You may not change this account');
  assert.deepEqual(db.getDB().users.find((u) => u.id === 'ag').allowedFeatures, ['leads']);
});

test('revoke to role defaults sends null, and the cache drops the list', async () => {
  seed();
  fnAnswer = { status: 200, body: { ok: true, user: { id: 'ag', name: 'Old', role: 'AGENT', company_id: 'c1', is_active: true, allowed_features: null } } };
  await AA.setFeatures('ag', null);
  assert.equal(db.getDB().users.find((u) => u.id === 'ag').allowedFeatures, undefined);
});

test('defect 8: createCompany whose admin account fails leaves no company behind', async () => {
  seed(); calls.length = 0;
  db.getDB().companies = [];
  const failing = async () => ({ ok: false, error: 'Email already in use' });
  const r = await db.createCompany({ name: 'Acme', plan: 'Starter', adminName: 'A', adminEmail: 'a@acme.co', password: 'long-enough-1', phone: '' }, failing);
  assert.match(r.error, /Email already in use/);
  assert.equal(db.getDB().companies.length, 0, 'no company left in the cache');
  const posted = calls.find((c) => c.url.includes('/rest/v1/companies') && c.method === 'POST');
  const removed = calls.find((c) => c.url.includes('/rest/v1/companies') && c.method === 'DELETE');
  assert.ok(posted && removed, 'the company row is removed from the server too');
  assert.ok(removed.url.includes(posted.body.id ?? posted.body[0]?.id), 'the same company id');
});

test('a realtime UPDATE of my own row reaches the session user', async () => {
  seed();
  const seen = [];
  const off = db.onSelfChange((u) => seen.push(u));
  const me = { id: 'ag', role: 'AGENT', companyId: 'c1' };
  db.applyRealtimeEvent('users', 'UPDATE', { id: 'ag', name: 'Old', role: 'AGENT', company_id: 'c1', is_active: true, allowed_features: [] }, null, me);
  off();
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].allowedFeatures, []);
});
