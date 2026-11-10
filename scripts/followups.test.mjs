// npx vite-node scripts/followups.test.mjs — the follow-up helpers: row
// converters, the Today / Missed / Upcoming rule (JS twin and query twin), the
// activity summary, the labels, and the modal's dirty check.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rToF, fToR, followBucket, dayBounds, activitySummary, followupLine } from '../src/lib/followups.js';
import { purposeText, noteText, typeOf } from '../src/lib/followupTypes.js';
import { KPI, ORDER } from '../src/lib/leadQuery.js';
import { followupDirty } from '../src/lib/followupDirty.js';

test('row converters round-trip; Other text is kept only for Other', () => {
  const f = { id: 'lf1', leadId: 'L1', companyId: 'c1', ownerId: 'u1', type: 'MESSAGE', purpose: 'BUDGET', purposeOther: 'stray',
    dueAt: '2026-11-12T04:30:00.000Z', remindMin: 30, noteCode: 'BROCHURE', note: '', projectId: 'p1', projectName: 'Citizen' };
  const r = fToR(f);
  assert.equal(r.purpose_other, null);
  assert.equal(r.status, 'pending'); assert.equal(r.source, 'app');
  const back = rToF({ ...r, created_at: 'x', updated_at: 'y' });
  assert.equal(back.type, 'MESSAGE'); assert.equal(back.remindMin, 30); assert.equal(back.projectName, 'Citizen');
  assert.equal(fToR({ ...f, purpose: 'OTHER', purposeOther: 'Loan' }).purpose_other, 'Loan');
});

test('buckets: before today is missed, any time today is today, after is upcoming', () => {
  const now = new Date(2026, 10, 10, 14, 0);
  const at = (d, h) => new Date(2026, 10, d, h, 0).toISOString();
  assert.equal(followBucket(at(9, 23), now), 'missed');
  assert.equal(followBucket(at(10, 9), now), 'today', 'earlier today is still today');
  assert.equal(followBucket(at(10, 23), now), 'today');
  assert.equal(followBucket(at(11, 0), now), 'upcoming');
  assert.equal(followBucket('', now), null);
});

test('the query twins use the same day bounds, at every status', () => {
  const b = dayBounds(new Date(2026, 10, 10, 14, 0));
  const today = KPI.followToday(b), missed = KPI.followMissed(b), up = KPI.followUpcoming(b);
  assert.ok(today.includes(`next_followup.gte."${b.start}"`) && today.includes(`next_followup.lte."${b.end}"`));
  assert.ok(missed.includes(`next_followup.lt."${b.start}"`));
  assert.ok(up.includes(`next_followup.gt."${b.end}"`));
  for (const q of [today, missed, up]) assert.ok(!q.includes('status'), 'no status filter');
  assert.equal(ORDER.followup, 'next_followup.asc.nullslast');
});

test('activity summary: counts by type and the change against the period before', () => {
  const s = activitySummary([{ type: 'CALL' }, { type: 'CALL' }, { type: 'MESSAGE' }], [{ type: 'CALL' }, { type: 'CALL' }]);
  assert.deepEqual(s, { total: 3, before: 2, change: 50, byType: { CALL: 2, MESSAGE: 1 } });
  assert.equal(activitySummary([{ type: 'CALL' }], []).change, null, 'no base, no percentage');
});

test('labels: Other shows the typed text; unknown type reads as a call', () => {
  assert.equal(purposeText({ purpose: 'OTHER', purposeOther: ' Loan papers ' }), 'Loan papers');
  assert.equal(purposeText({ purpose: 'SITE_VISIT' }), 'Site visit planning');
  assert.equal(noteText({ noteCode: 'DECISION' }), 'Ask for the decision');
  assert.equal(noteText({ noteCode: 'OTHER', note: 'Bring NID' }), 'Bring NID');
  assert.equal(typeOf('NOPE').label, 'Phone call');
  assert.equal(followupLine({ type: 'PROJECT_VISIT', purpose: 'BOOKING', projectName: 'Citizen', noteCode: 'CONFIRM_VISIT' }, 'Tue 10:30'),
    'Project visit · Booking · Citizen · Tue 10:30 · Confirm site visit');
});

test('dirty check: the opening values are clean, any change is dirty', () => {
  const start = { type: 'CALL', remindMin: 15, purpose: '', purposeOther: '', projectId: 'p1', noteCode: '', note: '', outcome: '', date: '2026-11-11', time: '10:00' };
  const def = { ...start, defDate: start.date, defTime: start.time };
  assert.equal(followupDirty({ ...start, newNote: '', customerAsked: false }, def), false);
  for (const [k, v] of [['type', 'MESSAGE'], ['remindMin', 60], ['purpose', 'BUDGET'], ['projectId', ''], ['noteCode', 'OTHER'], ['note', 'x'], ['outcome', 'Talked'], ['time', '11:00']]) {
    assert.equal(followupDirty({ ...start, [k]: v }, def), true, k);
  }
  const pre = { ...start, noteCode: 'OTHER', note: 'Bring NID' };
  assert.equal(followupDirty(pre, { ...pre, defDate: pre.date, defTime: pre.time }), false, 'a prefilled Other note is not a change');
});
