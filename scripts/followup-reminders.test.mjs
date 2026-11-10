// npm run test:followup — checkFollowUpReminders creates each FOLLOW_UP
// reminder once. It runs on every app load, in every tab, and before this fix
// a refresh re-notified every overdue follow-up (the cloud copy got a fresh
// random id each time, and nextFollowup was cleared only in the local cache).
// Runs the real db.js under vite-node with fetch and localStorage stubbed.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.alert = () => {};

// What the server holds, keyed by id, and how notifications/ POSTs resolve:
// ignore-duplicates keeps the stored row as it is, merge-duplicates overwrites it.
const server = new Map();
const posts = [];
globalThis.fetch = async (url, init = {}) => {
  if (init.method === 'POST' && String(url).includes('/rest/v1/notifications')) {
    const prefer = init.headers?.Prefer || '';
    const rows = JSON.parse(init.body);
    posts.push({ prefer, rows });
    for (const r of rows) {
      if (server.has(r.id) && !prefer.includes('merge-duplicates')) continue;
      server.set(r.id, { ...r });
    }
  }
  return new Response('[]', { status: 201, headers: { 'Content-Type': 'application/json' } });
};

const { checkFollowUpReminders } = await import('../src/lib/db.js');
const flush = () => new Promise((r) => setTimeout(r, 0));

const AGENT = { id: 'u1', name: 'Agent', role: 'AGENT', companyId: 'c1' };
const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const lead = (over = {}) => ({ id: 'L1', name: 'Client', status: 'CONTACTED', assignedTo: 'u1', companyId: 'c1', nextFollowup: past, ...over });
const freshDB = (leads) => ({ users: [AGENT], leads, notifications: {} });
const reset = () => { server.clear(); posts.length = 0; };
const followUps = (db, uid = 'u1') => (db.notifications[uid] || []).filter((n) => n.type === 'FOLLOW_UP');

test('a refresh does not create the reminder again', async () => {
  reset();
  const l = lead();
  for (let i = 0; i < 3; i++) { checkFollowUpReminders(freshDB([l]), AGENT); await flush(); }
  assert.equal(server.size, 1);
  assert.equal(l.nextFollowup, past, 'the due date is not cleared in the cache');
});

test('two calls on one cache keep one local reminder, with the cloud id', async () => {
  reset();
  const db = freshDB([lead()]);
  checkFollowUpReminders(db, AGENT);
  checkFollowUpReminders(db, AGENT);
  await flush();
  assert.equal(followUps(db).length, 1);
  assert.equal(server.size, 1);
  assert.equal(followUps(db)[0].id, [...server.keys()][0]);
});

test('a reminder already read stays read after a refresh', async () => {
  reset();
  checkFollowUpReminders(freshDB([lead()]), AGENT);
  await flush();
  const [id] = server.keys();
  server.get(id).is_read = true;
  checkFollowUpReminders(freshDB([lead()]), AGENT);
  await flush();
  assert.equal(server.get(id).is_read, true);
  assert.ok(posts.every((p) => p.prefer.includes('ignore-duplicates')));
});

test('a rescheduled follow-up gets its own reminder', async () => {
  reset();
  checkFollowUpReminders(freshDB([lead()]), AGENT);
  const later = new Date(Date.now() - 60 * 1000).toISOString();
  checkFollowUpReminders(freshDB([lead({ nextFollowup: later })]), AGENT);
  await flush();
  assert.equal(server.size, 2);
});

test('one instant written in different ISO forms makes one reminder', async () => {
  reset();
  // The browser writes toISOString() ("Z"); PostgREST returns "+00:00" and up
  // to six fractional digits; another client may send its own offset.
  // A recent instant: anything older than a week is no longer reminded (FU_CLIENT_WINDOW_MS).
  const t = new Date(Date.now() - 2 * 60 * 60 * 1000); t.setUTCMilliseconds(0);
  const z = t.toISOString();
  const plus6 = new Date(t.getTime() + 6 * 3600e3).toISOString().replace('.000Z', '+06:00');
  for (const at of [z, z.replace('.000Z', '+00:00'), z.replace('.000Z', '.000000+00:00'), plus6]) {
    checkFollowUpReminders(freshDB([lead({ nextFollowup: at })]), AGENT);
  }
  await flush();
  assert.equal(server.size, 1);
});

test('two tabs at once, each with its own cache, make one reminder', async () => {
  reset();
  const tabA = freshDB([lead()]);
  const tabB = freshDB([lead()]);
  checkFollowUpReminders(tabA, AGENT);
  checkFollowUpReminders(tabB, AGENT);
  await flush();
  assert.equal(server.size, 1);
  assert.equal(followUps(tabA)[0].id, followUps(tabB)[0].id);
});

test('closed leads get no reminder', async () => {
  reset();
  checkFollowUpReminders(freshDB([
    lead({ id: 'W', status: 'DEAL_CLOSED_WON' }),
    lead({ id: 'X', status: 'DEAL_CLOSED_LOST' }),
  ]), AGENT);
  await flush();
  assert.equal(server.size, 0);
});

test('suppressed leads get no reminder', async () => {
  reset();
  checkFollowUpReminders(freshDB([lead({ followupSuppressedAt: past })]), AGENT);
  await flush();
  assert.equal(server.size, 0);
});

test('not yet due, or no follow-up set: no reminder', async () => {
  reset();
  checkFollowUpReminders(freshDB([lead({ id: 'F', nextFollowup: future }), lead({ id: 'N', nextFollowup: null })]), AGENT);
  await flush();
  assert.equal(server.size, 0);
});

test('the cloud row matches the local one, and only the assignee gets it', async () => {
  reset();
  const db = freshDB([lead(), lead({ id: 'Z', assignedTo: 'gone' })]);
  checkFollowUpReminders(db, AGENT);
  await flush();
  const rows = [...server.values()];
  assert.equal(rows.length, 1);
  const [local] = followUps(db);
  assert.equal(rows[0].id, local.id);
  assert.equal(rows[0].user_id, 'u1');
  assert.equal(rows[0].company_id, 'c1');
  assert.equal(rows[0].lead_id, 'L1');
  assert.equal(rows[0].type, 'FOLLOW_UP');
  assert.equal(rows[0].is_read, false);
  assert.equal(rows[0].created_at, local.timestamp);
  assert.ok(!Number.isNaN(Date.parse(rows[0].created_at)));
});

test('only the browser of the agent who holds the lead makes the reminder', async () => {
  reset();
  const MGR = { id: 'm1', name: 'Manager', role: 'MANAGEMENT', companyId: 'c1' };
  const db = { users: [AGENT, MGR], leads: [lead()], notifications: {} };
  checkFollowUpReminders(db, MGR);
  await flush();
  assert.equal(server.size, 0, 'a manager caching the lead makes nothing for the agent');
  checkFollowUpReminders(db, AGENT);
  await flush();
  assert.equal(server.size, 1);
});

test('a follow-up due more than a week ago is not reminded again', async () => {
  reset();
  const old = new Date(Date.now() - 8 * 24 * 3600e3).toISOString();
  checkFollowUpReminders(freshDB([lead({ nextFollowup: old })]), AGENT);
  await flush();
  assert.equal(server.size, 0);
});

test('no signed-in user, no reminders', async () => {
  reset();
  checkFollowUpReminders(freshDB([lead()]));
  await flush();
  assert.equal(server.size, 0);
});
