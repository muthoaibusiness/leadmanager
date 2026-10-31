// node --test scripts/metacapi-access.test.mjs — who sees Admin › Meta CAPI in
// the browser, and that the page is wired into navigation like WA Relay and the
// AI Trainer. The server repeats the same rule (capi-core.ts loadActor); this
// only decides what is shown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canSee, NAV_SCOPES, FEATURE_KEYS, FEATURE_LABELS, defaultFeatures } from '../src/lib/constants.js';
import { VIEW_TITLES, toHash } from '../src/lib/navHistory.js';
import { NAV_META } from '../src/lib/navMeta.js';

const u = (role, allowedFeatures) => ({ id: 'x', role, ...(allowedFeatures ? { allowedFeatures } : {}) });

test('Management sees Meta CAPI by role; Master too; agents, team leads and executives do not', () => {
  assert.equal(canSee(u('MANAGEMENT'), 'metacapi'), true);
  assert.equal(canSee(u('MASTER'), 'metacapi'), true);
  for (const r of ['AGENT', 'MEETING_AGENT', 'TEAM_LEAD', 'EXECUTIVE']) assert.equal(canSee(u(r), 'metacapi'), false, r);
  assert.equal(canSee(null, 'metacapi'), false);
});

test('a saved feature list decides: granted opens it, a list without it closes it even for Management', () => {
  assert.equal(canSee(u('AGENT', ['metacapi']), 'metacapi'), true);
  assert.equal(canSee(u('MANAGEMENT', ['leads']), 'metacapi'), false);
});

test('it is a grantable feature with a label, on by default only for Management', () => {
  assert.ok(FEATURE_KEYS.includes('metacapi'));
  assert.equal(FEATURE_LABELS.metacapi, 'Meta CAPI');
  assert.ok(defaultFeatures('MANAGEMENT').includes('metacapi'));
  assert.ok(!defaultFeatures('AGENT').includes('metacapi'));
  assert.ok(NAV_SCOPES.metacapi.includes('MANAGEMENT'));
});

test('navigation knows the page: title, icon and a stable URL', () => {
  assert.equal(VIEW_TITLES.metacapi, 'Meta CAPI');
  assert.equal(NAV_META.metacapi.lbl, 'Meta CAPI');
  assert.ok(NAV_META.metacapi.ico);
  assert.equal(toHash({ view: 'metacapi' }), '#/metacapi');
});
