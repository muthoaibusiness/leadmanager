// Pure unit tests for the Lead Lifecycle audit fixes:
//   * toastMap — legacy showToast types map to goey method names (ProjectsToaster).
//   * followupDirty / forwardDirty — modal dirty predicates drive useDiscardGuard.
// No DOM, no fetch, no goey host needed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toastFor, toastMsg } from '../src/lib/toastMap.js';
import { followupDirty } from '../src/lib/followupDirty.js';
import { forwardDirty } from '../src/lib/forwardDirty.js';

test('toastFor maps legacy types to goey method names', () => {
  assert.equal(toastFor('ok'), 'success');
  assert.equal(toastFor('warn'), 'warning');
  assert.equal(toastFor('err'), 'error');
  assert.equal(toastFor(''), 'info');
  assert.equal(toastFor(undefined), 'info');
  assert.equal(toastFor('bogus'), 'info');
});

test('toastMsg dispatches on the correct goey handle method', () => {
  const calls = [];
  const toast = {
    success: (m) => calls.push(['success', m]),
    warning: (m) => calls.push(['warning', m]),
    error: (m) => calls.push(['error', m]),
    info: (m) => calls.push(['info', m]),
  };
  toastMsg(toast, 'ok msg', 'ok');
  toastMsg(toast, 'warn msg', 'warn');
  toastMsg(toast, 'err msg', 'err');
  toastMsg(toast, 'plain msg');
  assert.deepEqual(calls, [
    ['success', 'ok msg'],
    ['warning', 'warn msg'],
    ['error', 'err msg'],
    ['info', 'plain msg'],
  ]);
});

test('followupDirty: defaults are clean, any edit is dirty', () => {
  const defDate = '2026-10-30';
  const clean = { note: '', newNote: '', customerAsked: false, date: defDate, time: '10:00' };
  assert.equal(followupDirty(clean, { defDate, defTime: '10:00' }), false, 'pristine form is clean');
  assert.equal(followupDirty({ ...clean, note: ' hi ' }, { defDate }), true, 'typed note is dirty');
  assert.equal(followupDirty({ ...clean, newNote: 'x' }, { defDate }), true, 'quick-add draft is dirty');
  assert.equal(followupDirty({ ...clean, customerAsked: true }, { defDate }), true, 'customer-requested promise is dirty');
  assert.equal(followupDirty({ ...clean, date: '2026-11-01' }, { defDate }), true, 'changed date is dirty');
  assert.equal(followupDirty({ ...clean, time: '09:00' }, { defDate }), true, 'changed time is dirty');
});

test('forwardDirty: untouched state is clean, any input is dirty', () => {
  const clean = {};
  assert.equal(forwardDirty(clean), false, 'pristine forward state is clean');
  assert.equal(forwardDirty({ selected: 'u2' }), true, 'selected recipient is dirty');
  assert.equal(forwardDirty({ pq: 'a' }), true, 'search text is dirty');
  assert.equal(forwardDirty({ meetingAt: '2026-10-30T14:00' }), true, 'meeting time is dirty');
  assert.equal(forwardDirty({ meetingLink: ' https://x ' }), true, 'meeting link is dirty');
  assert.equal(forwardDirty({ shared: ['price'] }), true, 'shared chips are dirty');
  assert.equal(forwardDirty({ meetingType: 'OFFLINE' }), true, 'offline meeting is dirty');
  assert.equal(forwardDirty({ projectId: 'p1' }), true, 'project selection is dirty');
  assert.equal(forwardDirty({ ourOffer: '10500' }), true, 'our offer is dirty');
  assert.equal(forwardDirty({ clientOffer: '9500' }), true, 'client offer is dirty');
  assert.equal(forwardDirty({ totalSft: '1200' }), true, 'total SFT is dirty');
  assert.equal(forwardDirty({ offerNotes: 'n' }), true, 'offer notes are dirty');
});
