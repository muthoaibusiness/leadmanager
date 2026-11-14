import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeForwardTargets, extraUsersFilter } from './forwardTargets.js';

test('own team plus the named users from other teams, once each, never the user, by name', () => {
  const own = [{ id: 'b', name: 'Brand' }, { id: 'r', name: 'Rahat' }, { id: 'me', name: 'Barna' }];
  const extra = [{ id: 'n', name: 'Nasrin' }, { id: 'j', name: 'Jannat' }, { id: 'b', name: 'Brand' }];
  assert.deepEqual(mergeForwardTargets(own, extra, 'me').map((u) => u.name), ['Brand', 'Jannat', 'Nasrin', 'Rahat']);
  assert.deepEqual(mergeForwardTargets(own, null, 'me').map((u) => u.name), ['Brand', 'Rahat']);   // no extra users: as before
  assert.deepEqual(mergeForwardTargets(undefined, undefined, 'me'), []);
});

test('the user query names the extra users and cleans the ids', () => {
  assert.equal(extraUsersFilter(['u1', 'u2']), 'id=in.(u1,u2)&is_active=not.eq.false');
  assert.equal(extraUsersFilter([]), null);
  assert.equal(extraUsersFilter(null), null);
  assert.equal(extraUsersFilter(['u1)&role=eq.MASTER']), 'id=in.(u1roleeqMASTER)&is_active=not.eq.false');   // no query injection
});
