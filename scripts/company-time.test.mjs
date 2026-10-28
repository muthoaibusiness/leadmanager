// node --test scripts/company-time.test.mjs — reading and writing a wall-clock
// time in the company's time zone, whatever zone the browser runs in. The
// customer-requested follow-up time is entered as the company's local time
// (an agent in Dhaka, a client who said "Sunday 3 PM"), so the browser's own
// zone must not shift it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { zonedToUtcIso, utcIsoToZoned, companyTimeZone, isPast, DEFAULT_TZ } from '../src/lib/companyTime.js';

test('a time more than a minute ago is past; now and later are not', () => {
  const now = Date.parse('2026-12-10T09:00:00.000Z');
  assert.equal(isPast('2026-12-10T08:58:00.000Z', now), true);
  assert.equal(isPast('2026-12-10T08:59:30.000Z', now), false, 'a minute of slack');
  assert.equal(isPast('2026-12-11T09:00:00.000Z', now), false);
  assert.equal(isPast('garbage', now), false);
});

test('the default zone is Dhaka', () => {
  assert.equal(DEFAULT_TZ, 'Asia/Dhaka');
  assert.equal(companyTimeZone(null), 'Asia/Dhaka');
  assert.equal(companyTimeZone({ timeZone: 'Asia/Dubai' }), 'Asia/Dubai');
  assert.equal(companyTimeZone({ timeZone: 'Not/AZone' }), 'Asia/Dhaka', 'an invalid zone falls back');
});

test('a Dhaka wall-clock time becomes the right UTC instant, in toISOString() form', () => {
  assert.equal(zonedToUtcIso('2026-12-10T15:00', 'Asia/Dhaka'), '2026-12-10T09:00:00.000Z');
  assert.equal(zonedToUtcIso('2026-12-10T15:00', 'Asia/Dubai'), '2026-12-10T11:00:00.000Z');
  assert.equal(zonedToUtcIso('2026-12-10T00:30', 'Asia/Dhaka'), '2026-12-09T18:30:00.000Z', 'crosses midnight');
});

test('a UTC instant reads back as the same wall-clock time', () => {
  assert.equal(utcIsoToZoned('2026-12-10T09:00:00.000Z', 'Asia/Dhaka'), '2026-12-10T15:00');
  assert.equal(utcIsoToZoned('2026-12-10T11:00:00.000Z', 'Asia/Dubai'), '2026-12-10T15:00');
  assert.equal(utcIsoToZoned(zonedToUtcIso('2026-03-01T23:59', 'Asia/Dhaka'), 'Asia/Dhaka'), '2026-03-01T23:59');
});

test('the browser zone does not change the answer', () => {
  // The test process zone is whatever the machine runs; the result must not depend on it.
  const before = process.env.TZ;
  for (const tz of ['UTC', 'America/New_York', 'Asia/Dhaka']) {
    process.env.TZ = tz;
    assert.equal(zonedToUtcIso('2026-12-10T15:00', 'Asia/Dhaka'), '2026-12-10T09:00:00.000Z', tz);
  }
  process.env.TZ = before;
});

test('bad input is null, not an exception', () => {
  assert.equal(zonedToUtcIso('', 'Asia/Dhaka'), null);
  assert.equal(zonedToUtcIso('not a time', 'Asia/Dhaka'), null);
  assert.equal(zonedToUtcIso('2026-02-31T10:00', 'Asia/Dhaka'), null);
  assert.equal(utcIsoToZoned('garbage', 'Asia/Dhaka'), null);
});
