// Hold requests are created and decided straight on the cloud row
// (createHoldRequest inserts, decideHoldRequest updates), so the cloud is the
// source of truth. A request deleted there must leave the Requests tab on the
// next load instead of being kept, and later re-uploaded, from a browser's cache.
// Runs the real db.js under vite-node with localStorage stubbed.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { mergeDB } = await import('../src/lib/db.js');

const MIN = 60 * 1000;
// An hour old by default: past the 15-minute "insert still in flight" window.
const hr = (id, extra = {}) => ({ id, status: 'pending', createdAt: new Date(Date.now() - 60 * MIN).toISOString(), ...extra });

test('a request the cloud deleted is dropped from the cache', () => {
  const merged = mergeDB({ holdRequests: [hr('keep')] }, { holdRequests: [hr('keep'), hr('gone', { status: 'rejected' })] });
  assert.deepEqual(merged.holdRequests.map(r => r.id), ['keep']);
});

test('the cloud copy wins for a request both sides hold', () => {
  const merged = mergeDB({ holdRequests: [hr('a', { status: 'rejected' })] }, { holdRequests: [hr('a', { status: 'pending' })] });
  assert.equal(merged.holdRequests[0].status, 'rejected');
});

test('a request created moments ago and not yet on the cloud is kept', () => {
  const fresh = hr('new', { createdAt: new Date(Date.now() - 2 * MIN).toISOString() });
  const merged = mergeDB({ holdRequests: [] }, { holdRequests: [fresh] });
  assert.deepEqual(merged.holdRequests.map(r => r.id), ['new']);
});

test('cloud not asked (no holdRequests key) keeps the cache as it is', () => {
  const merged = mergeDB({}, { holdRequests: [hr('x')] });
  assert.deepEqual(merged.holdRequests.map(r => r.id), ['x']);
});
