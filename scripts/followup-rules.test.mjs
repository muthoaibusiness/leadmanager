// npm run test:followup-rules — the browser side of migration 0049, run on the
// real db.js under vite-node with fetch and localStorage stubbed. Nothing here
// reaches a real database.
//   * logNoAnswer goes through lead_log_no_answer with one request id per
//     click, and shows the server's answer (cap 5, suppression).
//   * Before 0049 is applied (RPC missing), it falls back to the old local path.
//   * No Longer Responding, the customer-requested time, and the follow-up
//     rules the UI reads (followUpBlock, nextFollowupFor).
import assert from 'node:assert/strict';
import { test } from 'node:test';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.alert = () => {};

// A fake PostgREST: rpc/lead_log_no_answer answers from `rpc`, every other
// request is recorded and answered empty.
const calls = [];
let rpc = null; // (body) => Response
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ url: u, method: init.method || 'GET', body });
  if (u.includes('/rpc/lead_log_no_answer') && rpc) return rpc(body);
  return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const db = await import('../src/lib/db.js');
const { logNoAnswer, setNoLongerResponding, clearFollowupSuppression, setFollowUpAt, followUpBlock, nextFollowupFor, MAX_ATTEMPTS, getDB } = db;
const flush = () => new Promise((r) => setTimeout(r, 0));

const AGENT = { id: 'u1', name: 'Agent', role: 'AGENT', companyId: 'c1' };
const seed = (over = {}) => {
  const l = { id: 'L1', name: 'Client', status: 'CONTACTED', assignedTo: 'u1', companyId: 'c1', noAnswerCount: 0, callCount: 0, nextFollowup: null, ...over };
  const d = getDB();
  d.users = [AGENT];
  d.leads = [l];
  d.activities = {};
  return l;
};
const reset = () => { calls.length = 0; rpc = null; };
const rpcCalls = () => calls.filter((c) => c.url.includes('/rpc/lead_log_no_answer'));
const patches = () => calls.filter((c) => c.method === 'PATCH' && c.url.includes('/rest/v1/leads'));

test('the cap is 5', () => { assert.equal(MAX_ATTEMPTS, 5); });

test('No Answer calls the server function once, with a request id and the claimed user', async () => {
  reset(); seed();
  rpc = () => json(200, [{ attempts: 1, counted: true, next_followup: '2026-11-02T10:00:00.000Z', suppressed_reason: null }]);
  const res = await logNoAnswer('L1', AGENT);
  const [c] = rpcCalls();
  assert.equal(rpcCalls().length, 1);
  assert.equal(c.body.p_lead_id, 'L1');
  assert.equal(c.body.p_user_id, 'u1');
  assert.match(c.body.p_request_id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(res, { attempts: 1, counted: true, hitCap: false, suppressed: false, nextFollowup: '2026-11-02T10:00:00.000Z' });
  assert.equal(patches().length, 0, 'the server writes the lead; the browser does not PATCH it');
});

test('the cache takes the server answer, not a local increment', async () => {
  reset(); const l = seed({ noAnswerCount: 3 });
  rpc = () => json(200, [{ attempts: 4, counted: true, next_followup: '2026-11-02T10:00:00.000Z', suppressed_reason: null }]);
  await logNoAnswer('L1', AGENT);
  const cached = getDB().leads.find((x) => x.id === l.id);
  assert.equal(cached.noAnswerCount, 4);
  assert.equal(cached.nextFollowup, '2026-11-02T10:00:00.000Z');
});

test('the 5th attempt reports the cap and the suppression', async () => {
  reset(); seed({ noAnswerCount: 4 });
  rpc = () => json(200, [{ attempts: 5, counted: true, next_followup: null, suppressed_reason: 'ATTEMPTS_EXHAUSTED' }]);
  const res = await logNoAnswer('L1', AGENT);
  assert.equal(res.hitCap, true);
  assert.equal(res.suppressed, true);
  const cached = getDB().leads[0];
  assert.equal(cached.followupSuppressedReason, 'ATTEMPTS_EXHAUSTED');
  assert.equal(cached.nextFollowup, null);
});

test('a refused attempt (over the cap, closed, suppressed) is reported, not counted', async () => {
  reset(); seed({ noAnswerCount: 7 });
  rpc = () => json(200, [{ attempts: 7, counted: false, next_followup: '2026-11-01T09:00:00.000Z', suppressed_reason: null }]);
  const res = await logNoAnswer('L1', AGENT);
  assert.equal(res.counted, false);
  assert.equal(res.hitCap, true, '7 is past the cap');
  assert.equal(getDB().leads[0].noAnswerCount, 7, 'existing high count left as is');
});

test('a network retry reuses the same request id', async () => {
  reset(); seed();
  let n = 0;
  rpc = () => { n++; if (n === 1) throw new TypeError('network down'); return json(200, [{ attempts: 1, counted: true, next_followup: null, suppressed_reason: null }]); };
  const res = await logNoAnswer('L1', AGENT);
  const ids = rpcCalls().map((c) => c.body.p_request_id);
  assert.equal(ids.length, 2);
  assert.equal(ids[0], ids[1]);
  assert.equal(res.attempts, 1);
});

test('two quick clicks on one lead send one request', async () => {
  reset(); seed();
  let release;
  rpc = () => new Promise((r) => { release = () => r(json(200, [{ attempts: 1, counted: true, next_followup: null, suppressed_reason: null }])); });
  const a = logNoAnswer('L1', AGENT);
  const b = logNoAnswer('L1', AGENT);
  await flush(); release();
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(rpcCalls().length, 1);
  assert.deepEqual(ra, rb);
});

test('a server error is reported, and nothing is counted locally', async () => {
  reset(); seed({ noAnswerCount: 2 });
  rpc = () => json(500, { message: 'boom' });
  const res = await logNoAnswer('L1', AGENT);
  assert.equal(res.error, true);
  assert.equal(getDB().leads[0].noAnswerCount, 2);
  assert.equal(patches().length, 0);
});

test('an attempt on a suppressed lead takes the server answer, not a local count', async () => {
  reset(); seed({ followupSuppressedAt: 'x', followupSuppressedReason: 'NO_LONGER_RESPONDING', noAnswerCount: 2 });
  rpc = () => json(200, [{ attempts: 2, counted: false, next_followup: null, suppressed_reason: 'NO_LONGER_RESPONDING' }]);
  const res = await logNoAnswer('L1', AGENT);
  assert.equal(res.counted, false);
  assert.equal(res.suppressed, true);
  const cached = getDB().leads[0];
  assert.equal(cached.noAnswerCount, 2, 'count stays at the server value');
  assert.equal(cached.callCount, 0, 'callCount only moves when counted');
  assert.equal(cached.nextFollowup, null, 'suppression cleared any follow-up');
});

// Last of the RPC tests: a missing function is remembered for the session.
test('before 0049 is applied, the old local path still works (cap 5, no lock)', async () => {
  reset(); seed({ noAnswerCount: 4 });
  rpc = () => json(404, { code: 'PGRST202', message: 'Could not find the function' });
  const res = await logNoAnswer('L1', AGENT);
  assert.equal(res.attempts, 5);
  assert.equal(res.hitCap, true);
  const cached = getDB().leads[0];
  assert.equal(cached.noAnswerCount, 5);
  assert.equal(cached.nextFollowup, null, 'the 5th stops follow-ups locally too');
  assert.equal(patches().length, 1, 'falls back to the old PATCH');
  // Once known missing, it does not ask again; and a 6th is refused locally.
  reset(); seed({ noAnswerCount: 5 });
  const sixth = await logNoAnswer('L1', AGENT);
  assert.equal(rpcCalls().length, 0);
  assert.equal(sixth.counted, false);
  assert.equal(patches().length, 0);
});

test('No Longer Responding stops follow-ups, keeps the lead and its status', async () => {
  reset(); seed({ nextFollowup: '2026-11-02T10:00:00.000Z', status: 'INTERESTED' });
  setNoLongerResponding('L1', AGENT);
  const l = getDB().leads[0];
  assert.equal(l.status, 'INTERESTED');
  assert.equal(l.followupSuppressedReason, 'NO_LONGER_RESPONDING');
  assert.ok(l.followupSuppressedAt);
  assert.equal(l.nextFollowup, null);
  const [p] = patches();
  assert.equal(p.body.followup_suppressed_reason, 'NO_LONGER_RESPONDING');
  assert.equal(p.body.next_followup, null);
  assert.equal(p.body.status, undefined, 'status is not sent');
  await flush();
  const act = calls.find((c) => c.method === 'POST' && c.url.includes('/rest/v1/activities'));
  assert.equal(act.body.type, 'FOLLOW_UP');
  assert.match(act.body.description, /No longer responding/);
  assert.equal(getDB().leads.length, 1, 'nothing deleted');
});

test('followUpBlock names why follow-ups are off', () => {
  assert.equal(followUpBlock({ status: 'CONTACTED' }), null);
  assert.equal(followUpBlock({ status: 'DEAL_CLOSED_WON' }), 'closed');
  assert.equal(followUpBlock({ status: 'CONTACTED', followupSuppressedReason: 'NOT_INTERESTED_X2', followupSuppressedAt: 'x' }), 'NOT_INTERESTED_X2');
  assert.equal(followUpBlock({ status: 'CONTACTED', noAnswerCount: 5 }), 'ATTEMPTS_EXHAUSTED');
  assert.equal(followUpBlock({ status: 'CONTACTED', noAnswerCount: 7 }), 'ATTEMPTS_EXHAUSTED', 'existing high-attempt leads read as used up');
});

test('a customer-requested time wins over an earlier pick, in toISOString() form', () => {
  const l = { followupNotBefore: '2026-12-10T09:00:00.000Z' };
  assert.equal(nextFollowupFor(l, new Date('2026-12-01T10:00:00Z')), '2026-12-10T09:00:00.000Z');
  assert.equal(nextFollowupFor(l, new Date('2026-12-20T10:00:00Z')), '2026-12-20T10:00:00.000Z');
  assert.equal(nextFollowupFor({}, new Date('2026-12-01T10:00:00Z')), '2026-12-01T10:00:00.000Z');
  // The database hands back a timestamptz as '+00:00'; it is read by instant.
  assert.equal(nextFollowupFor({ followupNotBefore: '2026-12-10T09:00:00+00:00' }, new Date('2026-12-01T10:00:00Z')), '2026-12-10T09:00:00.000Z');
});

test('setFollowUpAt with a customer request stores both, in toISOString() form', async () => {
  reset(); seed();
  setFollowUpAt('L1', '2026-12-10T09:00:00.000Z', AGENT, { customerRequested: true });
  const l = getDB().leads[0];
  assert.equal(l.nextFollowup, '2026-12-10T09:00:00.000Z');
  assert.equal(l.followupNotBefore, '2026-12-10T09:00:00.000Z');
  const [p] = patches();
  assert.equal(p.body.next_followup, '2026-12-10T09:00:00.000Z');
  assert.equal(p.body.followup_not_before, '2026-12-10T09:00:00.000Z');
  await flush();
  const act = calls.find((c) => c.method === 'POST' && c.url.includes('/rest/v1/activities'));
  assert.match(act.body.description, /customer asked/);
});

test('setFollowUpAt never schedules before an existing customer request', () => {
  reset(); seed({ followupNotBefore: '2026-12-10T09:00:00.000Z' });
  setFollowUpAt('L1', '2026-12-01T10:00:00.000Z', AGENT);
  assert.equal(getDB().leads[0].nextFollowup, '2026-12-10T09:00:00.000Z');
});

test('resuming clears both suppression fields and keeps the lead', async () => {
  reset(); seed({ followupSuppressedAt: '2026-11-01T09:00:00.000Z', followupSuppressedReason: 'NO_LONGER_RESPONDING', nextFollowup: null });
  clearFollowupSuppression('L1', AGENT);
  const l = getDB().leads[0];
  assert.equal(l.followupSuppressedAt, null);
  assert.equal(l.followupSuppressedReason, null);
  assert.equal(l.status, 'CONTACTED');
  const [p] = patches();
  assert.deepEqual({ at: p.body.followup_suppressed_at, reason: p.body.followup_suppressed_reason }, { at: null, reason: null });
  await flush();
  const act = calls.find((c) => c.method === 'POST' && c.url.includes('/rest/v1/activities'));
  assert.match(act.body.description, /Follow-ups resumed/);
});

test('setFollowUpAt does nothing on a suppressed lead', () => {
  reset(); seed({ followupSuppressedAt: 'x', followupSuppressedReason: 'NO_LONGER_RESPONDING' });
  setFollowUpAt('L1', '2026-12-01T10:00:00.000Z', AGENT);
  assert.equal(getDB().leads[0].nextFollowup, null);
  assert.equal(patches().length, 0);
});
