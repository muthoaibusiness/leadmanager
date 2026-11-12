// npx vite-node scripts/followup-writers.test.mjs [legacy]
// saveFollowUp / completeFollowUp / cancelFollowUp each write exactly ONE
// FOLLOW_UP activity (Prospects contacted counts them), and with migration 0066
// they write lead_followups rows while leaving leads.next_followup to the
// database trigger. With `legacy` the table is missing and they fall back to
// writing next_followup, as before. Runs the real db.js with fetch stubbed.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const LEGACY = process.argv.includes('legacy');
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.alert = () => {};

let calls = [];
globalThis.fetch = async (url, init = {}) => {
  const u = decodeURIComponent(String(url));
  const method = init.method || 'GET';
  if (method === 'GET' && u.includes('lead_followups?select=id&limit=1')) {
    return new Response(LEGACY ? '{"code":"42P01"}' : '[]', { status: LEGACY ? 404 : 200, headers: { 'Content-Type': 'application/json' } });
  }
  calls.push({ method, url: u, body: init.body ? JSON.parse(init.body) : null });
  return new Response('[]', { status: 201, headers: { 'Content-Type': 'application/json' } });
};

const db = await import('../src/lib/db.js');
const { saveFollowUp, completeFollowUp, cancelFollowUp, getDB, getActs } = db;
const flush = () => new Promise((r) => setTimeout(r, 0));

const AGENT = { id: 'u1', name: 'Agent', role: 'AGENT', companyId: 'c1' };
const D = getDB();
D.leads = [
  { id: 'L1', name: 'Rahim', status: 'CONTACTED', assignedTo: 'u1', companyId: 'c1', nextFollowup: null },
  { id: 'L2', name: 'Stopped', status: 'CONTACTED', assignedTo: 'u1', companyId: 'c1', followupSuppressedAt: '2026-11-01T00:00:00.000Z' },
];
D.activities = {};
const due = new Date(Date.now() + 2 * 864e5).toISOString();
const next = { dueAt: due, type: 'PROJECT_VISIT', purpose: 'SITE_VISIT', remindMin: 30, noteCode: 'CONFIRM_VISIT', projectId: 'p1', projectName: 'Citizen' };
const followActs = (id) => (getActs(id) || []).filter((a) => a.type === 'FOLLOW_UP');
const writes = (frag, method) => calls.filter((c) => c.url.includes(frag) && (!method || c.method === method));
const lead = (id) => D.leads.find((l) => l.id === id);

test('save: one activity; the row (or next_followup) carries the follow-up', async () => {
  calls = [];
  const at = await saveFollowUp('L1', next, AGENT);
  await flush();
  assert.equal(at, due);
  assert.equal(followActs('L1').length, 1);
  assert.match(followActs('L1')[0].description, /^Follow-up scheduled — Project visit · Site visit planning · Citizen · .+ · Confirm site visit$/);
  assert.equal(lead('L1').nextFollowup, due, 'shown at once from the local cache');
  if (LEGACY) {
    assert.equal(writes('lead_followups').length, 0);
    assert.equal(writes('leads?id=eq.L1', 'PATCH')[0].body.next_followup, due);
  } else {
    const ins = writes('lead_followups', 'POST');
    assert.equal(ins.length, 1);
    const row = Array.isArray(ins[0].body) ? ins[0].body[0] : ins[0].body;
    assert.equal(row.type, 'PROJECT_VISIT'); assert.equal(row.remind_min, 30); assert.equal(row.due_at, due);
    assert.equal(row.owner_id, 'u1'); assert.equal(row.company_id, 'c1');
    assert.equal(writes('leads?id=eq.L1', 'PATCH').length, 0, 'the database trigger writes next_followup');
  }
});

test('done with a next one: still one activity', async () => {
  calls = [];
  await completeFollowUp('L1', { outcome: 'Talked', next: { ...next, type: 'CALL', purpose: 'BUDGET' } }, AGENT);
  await flush();
  assert.equal(followActs('L1').length, 2);
  assert.match(followActs('L1')[0].description, /^Follow-up completed.* · Outcome: Talked · Next: Phone call · Budget discussion/);
  assert.equal(lead('L1').nextFollowup, due);
  if (!LEGACY) {
    const p = writes('lead_followups', 'PATCH')[0];
    assert.equal(p.body.status, 'done'); assert.equal(p.body.outcome, 'Talked'); assert.equal(p.body.done_by, 'u1');
    assert.equal(writes('lead_followups', 'POST').length, 1);
  }
});

test('cancel: one activity, nothing pending', async () => {
  calls = [];
  await cancelFollowUp('L1', 'client travelling', AGENT);
  await flush();
  assert.equal(followActs('L1').length, 3);
  assert.equal(followActs('L1')[0].description, 'Follow-up cancelled — client travelling');
  assert.equal(lead('L1').nextFollowup, null);
  if (!LEGACY) assert.equal(writes('lead_followups', 'PATCH')[0].body.status, 'cancelled');
});

test('a lead whose follow-ups are stopped is left alone', async () => {
  calls = [];
  assert.equal(await saveFollowUp('L2', next, AGENT), null);
  await flush();
  assert.equal(followActs('L2').length, 0);
  assert.equal(calls.length, 0);
});
