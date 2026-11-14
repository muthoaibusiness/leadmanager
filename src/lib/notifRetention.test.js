import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keepNotif, pruneNotifList, LOCAL_CAP } from './notifRetention.js';

const NOW = Date.parse('2026-11-10T12:00:00Z');
const ago = (days) => new Date(NOW - days * 864e5).toISOString();

test('read rows go after 30 days, unread after 90', () => {
  assert.equal(keepNotif({ read: true, timestamp: ago(29) }, NOW), true);
  assert.equal(keepNotif({ read: true, timestamp: ago(31) }, NOW), false);
  assert.equal(keepNotif({ read: false, timestamp: ago(89) }, NOW), true);
  assert.equal(keepNotif({ read: false, timestamp: ago(91) }, NOW), false);
  assert.equal(keepNotif({ timestamp: ago(60) }, NOW), true);          // no read flag = unread
  assert.equal(keepNotif({ read: true, timestamp: 'bad' }, NOW), true); // undatable rows are kept
});

test('the cached list is pruned, newest first, and capped', () => {
  const list = [
    { id: 'a', read: true, timestamp: ago(40) },
    { id: 'b', read: false, timestamp: ago(1) },
    { id: 'c', read: false, timestamp: ago(5) },
    null,
  ];
  assert.deepEqual(pruneNotifList(list, NOW).map((n) => n.id), ['b', 'c']);
  const many = Array.from({ length: LOCAL_CAP + 50 }, (_, i) => ({ id: 'n' + i, read: false, timestamp: ago(i / 100) }));
  assert.equal(pruneNotifList(many, NOW).length, LOCAL_CAP);
  assert.deepEqual(pruneNotifList(undefined, NOW), []);
});
