// Forward semantics, run on the real db.js under vite-node with fetch and
// localStorage stubbed. Nothing here reaches a real database.
//   * fwdLead keeps the same lead id, reassigns the owner, appends the old
//     owner to previousAssignees, and logs exactly one FORWARDED row. Status,
//     follow-up, attempts, meeting/visit data and suppression are untouched.
//   * A plain hand-off to a Team Lead (no offer) sets no offer and adds no
//     OFFER row; a closing hand-off without a complete offer refuses.
//   * Self-forward (claimLeadForSelf) is a FORWARDED event (not a NOTE) and
//     keeps the previous owner in previousAssignees.
//   * canSelfForward admits Meeting Agents, self_forward grants, and any
//     Add-Customer holder; nobody else.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.alert = () => {};

const calls = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ url: u, method: init.method || 'GET', body });
  return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const db = await import('../src/lib/db.js');
const { fwdLead, claimLeadForSelf, getDB, getActs } = db;
const { canSelfForward, ROLES } = await import('../src/lib/constants.js');

const U = { id: 'u1', name: 'Alice', role: ROLES.AGENT, companyId: 'c1', teamId: 't1' };
const TO = { id: 'u2', name: 'Bob', role: ROLES.AGENT, companyId: 'c1' };
const TL = { id: 'u3', name: 'Tara', role: ROLES.TL, companyId: 'c1' };

const seed = (over = {}) => {
  const lead = {
    id: 'L1', name: 'Client', status: 'SITE_VISIT_DONE', assignedTo: 'u1',
    assignedToName: 'Alice', assignedRole: ROLES.AGENT, companyId: 'c1',
    previousAssignees: [], nextFollowup: null, noAnswerCount: 0, callCount: 0,
    meetingAt: null, meetingType: null, meetingLink: null, meetingShared: [],
    meetingAttended: false, offerSentAt: null, offerValue: null,
    followupSuppressedAt: null, followupSuppressedReason: null,
    ...over,
  };
  const d = getDB();
  d.users = [U, TO, TL];
  d.leads = [lead];
  d.activities = {};
  return lead;
};
const reset = () => { calls.length = 0; };

const fwdActs = (leadId) => (getActs(leadId) || []).filter(a => a.type === 'FORWARDED');

test('fwdLead keeps the same lead id and preserves status, follow-up, attempts, meeting/visit and suppression', () => {
  reset();
  const before = seed({
    status: 'MEETING_SET', nextFollowup: '2026-11-02T10:00:00.000Z', noAnswerCount: 3,
    meetingAt: '2026-11-01T10:00:00.000Z', meetingType: 'ONLINE', meetingLink: 'https://x', meetingAttended: true,
    followupSuppressedAt: null, followupSuppressedReason: null,
  });
  assert.equal(fwdLead('L1', TO, U), true);
  const after = getDB().leads.find(l => l.id === 'L1');
  assert.equal(after.id, 'L1');
  assert.equal(after.assignedTo, 'u2');
  assert.equal(after.assignedToName, 'Bob');
  assert.equal(after.status, 'MEETING_SET', 'status preserved');
  assert.equal(after.nextFollowup, '2026-11-02T10:00:00.000Z', 'follow-up preserved');
  assert.equal(after.noAnswerCount, 3, 'attempt count preserved');
  assert.equal(after.meetingAt, '2026-11-01T10:00:00.000Z', 'meeting preserved');
  assert.equal(after.meetingType, 'ONLINE');
  assert.equal(after.meetingAttended, true);
  assert.deepEqual(after.previousAssignees, ['u1'], 'old owner appended');
  assert.equal(fwdActs('L1').length, 1, 'one FORWARDED row');
  assert.match(fwdActs('L1')[0].description, /Forwarded to Bob/);
});

test('fwdLead does not touch suppression or the offer', () => {
  reset();
  seed({ followupSuppressedAt: '2026-11-01T09:00:00.000Z', followupSuppressedReason: 'NO_LONGER_RESPONDING', offerSentAt: '2026-11-01T09:00:00.000Z', offerValue: 42 });
  fwdLead('L1', TO, U);
  const after = getDB().leads[0];
  assert.equal(after.followupSuppressedAt, '2026-11-01T09:00:00.000Z', 'never unsuppresses on forward');
  assert.equal(after.followupSuppressedReason, 'NO_LONGER_RESPONDING');
  assert.equal(after.offerSentAt, '2026-11-01T09:00:00.000Z');
});

test('a plain hand-off to a Team Lead sets no offer and logs no OFFER', () => {
  reset();
  seed();
  fwdLead('L1', TL, U, null);
  const after = getDB().leads[0];
  assert.equal(after.offerSentAt, null);
  assert.equal(after.offerValue, null);
  assert.equal((getActs('L1') || []).filter(a => a.type === 'OFFER').length, 0);
  assert.equal(getDB().leads[0].assignedTo, 'u3');
});

test('a closing hand-off without a complete offer returns false and changes nothing', () => {
  reset();
  seed();
  assert.equal(fwdLead('L1', TL, U, { ourOffer: 0, clientOffer: 0, totalSft: 0 }), false);
  const after = getDB().leads[0];
  assert.equal(after.assignedTo, 'u1', 'owner unchanged');
  assert.equal((getActs('L1') || []).filter(a => a.type === 'FORWARDED').length, 0);
});

test('self-forward records FORWARDED (not a NOTE) and keeps the previous owner', () => {
  reset();
  seed();
  assert.equal(claimLeadForSelf('L1', { ...U, role: ROLES.MA }), true);
  const acts = getActs('L1') || [];
  assert.equal(acts.filter(a => a.type === 'FORWARDED').length, 1, 'FORWARDED row');
  assert.equal(acts.filter(a => a.type === 'NOTE').length, 0, 'no NOTE row');
  const after = getDB().leads[0];
  assert.equal(after.assignedTo, 'u1');
  assert.deepEqual(after.previousAssignees, ['u1'], 'previous owner preserved');
  assert.equal(after.status, 'SITE_VISIT_DONE', 'status preserved');
});

test('canSelfForward admits MA, self_forward, and Add-Customer holders only', () => {
  assert.equal(canSelfForward({ role: ROLES.MA, allowedFeatures: [] }), true);
  assert.equal(canSelfForward({ role: ROLES.AGENT, allowedFeatures: ['self_forward'] }), true);
  assert.equal(canSelfForward({ role: ROLES.AGENT, allowedFeatures: ['add_customer'] }), true, 'explicit Add-Customer grant');
  assert.equal(canSelfForward({ role: ROLES.AGENT }), true, 'default Add-Customer holder (AGENT)');
  assert.equal(canSelfForward({ role: ROLES.TL }), true, 'Team Lead is an Add-Customer holder');
  assert.equal(canSelfForward({ role: ROLES.EXEC }), false, 'Executive has no defaults');
  assert.equal(canSelfForward({ role: ROLES.AGENT, allowedFeatures: [] }), false, 'explicit empty grant overrides defaults');
  assert.equal(canSelfForward(null), false);
});
