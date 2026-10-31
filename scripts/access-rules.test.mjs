// node --test scripts/access-rules.test.mjs — the one permission source
// (supabase/functions/_shared/access-rules.js). The browser (constants.js) and
// every Edge Function import it, so a grant means the same thing on both sides.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as rules from '../supabase/functions/_shared/access-rules.js';

const u = (role, allowed_features) => ({ id: 'x', role, is_active: true, ...(allowed_features !== undefined ? { allowed_features } : {}) });

test('role defaults decide when no feature list is saved', () => {
  assert.equal(rules.hasFeature(u('MANAGEMENT'), 'accounts'), true);
  assert.equal(rules.hasFeature(u('AGENT'), 'accounts'), false);
  assert.equal(rules.hasFeature(u('TEAM_LEAD'), 'team'), true);
  assert.equal(rules.hasFeature(u('EXECUTIVE'), 'leads'), false);
});

test('MANAGEMENT is the admin role: Users & Accounts stays open whatever list is saved', () => {
  assert.equal(rules.hasFeature(u('MANAGEMENT', ['leads']), 'accounts'), true);
  assert.equal(rules.hasFeature(u('MANAGEMENT', []), 'accounts'), true);
  const newMgmt = { ...u('MANAGEMENT', ['leads']), company_id: 'c1' };
  assert.equal(rules.canManageUser(newMgmt, { id: 't', role: 'MANAGEMENT', company_id: 'c1' }), true, 'a new Management account manages Management accounts');
  assert.ok(rules.assignableRoles(newMgmt).includes('MANAGEMENT'), 'and can create them');
});

test('a saved list fully decides, both ways, and [] means nothing', () => {
  assert.equal(rules.hasFeature(u('AGENT', ['accounts']), 'accounts'), true);
  assert.equal(rules.hasFeature(u('MANAGEMENT', ['leads']), 'aitrainer'), false);
  assert.equal(rules.hasFeature(u('MANAGEMENT', []), 'dashboard'), false);
  assert.equal(rules.hasFeature(u('AGENT', ['users']), 'accounts'), true, 'legacy users grant opens accounts');
});

test('inactive, missing or roleless accounts get nothing', () => {
  assert.equal(rules.hasFeature(null, 'leads'), false);
  assert.equal(rules.hasFeature({ ...u('MANAGEMENT'), is_active: false }, 'accounts'), false);
});

test('defaultFeatures and FEATURE_KEYS come from the same table', () => {
  assert.ok(rules.FEATURE_KEYS.includes('accounts'));
  assert.ok(rules.defaultFeatures('MANAGEMENT').includes('accounts'));
  assert.ok(!rules.defaultFeatures('AGENT').includes('accounts'));
  assert.deepEqual(rules.defaultFeatures('EXECUTIVE'), []);
});

test('the browser re-exports the same objects, so there is one source', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
  const c = await import('../src/lib/constants.js');
  assert.equal(c.NAV_SCOPES, rules.NAV_SCOPES);
  assert.equal(c.FEATURE_KEYS, rules.FEATURE_KEYS);
  assert.equal(c.defaultFeatures, rules.defaultFeatures);
  // canSee is the browser's camelCase view of the same rule.
  assert.equal(c.canSee({ role: 'AGENT', allowedFeatures: ['accounts'] }, 'accounts'), true);
  assert.equal(c.canSee({ role: 'MANAGEMENT', allowedFeatures: ['leads'] }, 'aitrainer'), false);
  assert.equal(c.canSee({ role: 'MANAGEMENT', allowedFeatures: ['leads'] }, 'accounts'), true, 'Management stays admin');
});

test('canManageUsers: Management or an accounts grant, inside its own company; Master everywhere', () => {
  const mgmt = { ...u('MANAGEMENT'), company_id: 'c1' };
  const target = { id: 't', role: 'AGENT', company_id: 'c1' };
  assert.equal(rules.canManageUser(mgmt, target), true);
  assert.equal(rules.canManageUser(mgmt, { ...target, company_id: 'c2' }), false, 'other company');
  assert.equal(rules.canManageUser({ ...u('AGENT'), company_id: 'c1' }, target), false);
  assert.equal(rules.canManageUser({ ...u('MASTER'), company_id: null }, { ...target, company_id: 'c2' }), true);
  assert.equal(rules.canManageUser(mgmt, { ...target, role: 'MASTER', company_id: null }), false, 'nobody but Master touches Master');
});

test('canManageUser: a delegated grant reaches only roles it could assign; grantableFeatures excludes what it lacks', () => {
  const del = { id: 'd', role: 'AGENT', is_active: true, company_id: 'c1', allowed_features: ['accounts', 'leads'] };
  assert.equal(rules.canManageUser(del, { id: 'm', role: 'MANAGEMENT', company_id: 'c1' }), false);
  assert.equal(rules.canManageUser(del, { id: 't', role: 'TEAM_LEAD', company_id: 'c1' }), false);
  assert.equal(rules.canManageUser(del, { id: 'a', role: 'AGENT', company_id: 'c1' }), true);
  assert.deepEqual(rules.grantableFeatures(del), ['leads']);
  assert.deepEqual(rules.grantableFeatures({ role: 'MANAGEMENT', is_active: true }), rules.FEATURE_KEYS);
});

test('assignable roles: no one hands out a role above their own', () => {
  assert.deepEqual(rules.assignableRoles({ role: 'MANAGEMENT' }), ['AGENT', 'MEETING_AGENT', 'TEAM_LEAD', 'MANAGEMENT', 'EXECUTIVE']);
  assert.deepEqual(rules.assignableRoles({ role: 'MASTER' }), ['AGENT', 'MEETING_AGENT', 'TEAM_LEAD', 'MANAGEMENT', 'EXECUTIVE']);
  assert.deepEqual(rules.assignableRoles({ role: 'AGENT', allowed_features: ['accounts'] }), ['AGENT', 'MEETING_AGENT', 'EXECUTIVE']);
});
