// node --test scripts/botcontrol.test.mjs — the Bots control card's view model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { botControlView, filterBots, BOT_FILTER_ALL } from '../src/lib/botControl.js';

const BOTS = [{ bot: 'eyad' }, { bot: 'dubai' }];
const snap = (id, version_no, status, extra = {}) => ({ id, version_no, status, created_at: `2026-10-1${version_no}`, ...extra });
const run = (snapshot_id, bot, status, counts = {}, started_at = '2026-10-19T01:00') => ({ snapshot_id, bot, status, counts, started_at });

test('filter: All Bots lists every bot, a choice lists only that bot', () => {
  assert.deepEqual(filterBots(BOTS, BOT_FILTER_ALL).map((b) => b.bot), ['eyad', 'dubai']);
  assert.deepEqual(filterBots(BOTS, 'dubai').map((b) => b.bot), ['dubai']);
  assert.deepEqual(filterBots(BOTS, 'nobody'), []);
});

test('today in production: legacy pointer, replies off, one untested candidate', () => {
  const v = botControlView({ bot: 'eyad', settings: { faq_agent_enabled: false }, pointer: { mode: 'legacy', snapshot_id: null }, snapshots: [snap('s1', 1, 'candidate')], runs: [] });
  assert.equal(v.replies, 'off');
  assert.deepEqual(v.live, { kind: 'none' }, 'replies off: customers get no automatic answer');
  assert.equal(v.pointer, null);
  assert.equal(v.candidate.version_no, 1);
  assert.equal(v.tests, 'not_run');
  assert.equal(v.canRunTests, true); assert.equal(v.canPublish, false); assert.equal(v.canRollback, false);
});

test('a published pointer is never shown as live while the bots do not read it', () => {
  const v = botControlView({ bot: 'dubai', settings: { faq_agent_enabled: true }, pointer: { mode: 'snapshot', snapshot_id: 's3' },
    snapshots: [snap('s3', 3, 'published', { published_at: '2026-10-19' })], runs: [] });
  assert.deepEqual(v.live, { kind: 'legacy' });
  assert.deepEqual(v.pointer, { version_no: 3, published_at: '2026-10-19' });
  assert.equal(v.canRollback, true);
  const wired = botControlView({ bot: 'dubai', settings: { faq_agent_enabled: true }, pointer: { mode: 'snapshot', snapshot_id: 's3' }, snapshots: [snap('s3', 3, 'published')], runs: [], pointersAreLive: true });
  assert.equal(wired.live.kind, 'version'); assert.equal(wired.live.version_no, 3);
});

test('candidate tests: running, failing, incomplete and passing decide whether Publish is enabled', () => {
  const base = { bot: 'eyad', settings: {}, pointer: { mode: 'legacy' }, snapshots: [snap('s2', 2, 'candidate')] };
  const at = (runs) => botControlView({ ...base, runs });
  assert.equal(at([run('s2', 'eyad', 'running')]).tests, 'running');
  assert.equal(at([run('s2', 'eyad', 'complete', { PASS: 3, FAIL: 1 })]).tests, 'failing');
  assert.equal(at([run('s2', 'eyad', 'complete', { PASS: 3, INCONCLUSIVE: 1 })]).tests, 'failing');
  assert.equal(at([run('s2', 'eyad', 'aborted')]).tests, 'incomplete');
  const ok = at([run('s2', 'eyad', 'complete', { PASS: 4 })]);
  assert.equal(ok.tests, 'passing'); assert.equal(ok.canPublish, true);
  // Another bot's run and an older run do not count.
  assert.equal(at([run('s2', 'dubai', 'complete', { PASS: 4 })]).tests, 'not_run');
  assert.equal(at([run('s2', 'eyad', 'complete', { PASS: 4 }, '2026-10-19T01:00'), run('s2', 'eyad', 'complete', { FAIL: 1 }, '2026-10-19T02:00')]).tests, 'failing');
});

test('a complete run that covered no tests is "no tests", never passing, and Publish stays off', () => {
  const base = { bot: 'eyad', settings: {}, pointer: { mode: 'legacy' }, snapshots: [snap('s2', 2, 'candidate')] };
  for (const counts of [{ PASS: 0, FAIL: 0, INCONCLUSIVE: 0 }, {}]) {
    const v = botControlView({ ...base, runs: [run('s2', 'eyad', 'complete', counts)] });
    assert.equal(v.tests, 'no_tests'); assert.equal(v.canPublish, false); assert.equal(v.canRunTests, true);
  }
});

test('no settings row reads as unknown, not off; an older candidate than the active version is not offered', () => {
  const v = botControlView({ bot: 'eyad', settings: null, pointer: { mode: 'snapshot', snapshot_id: 's5' },
    snapshots: [snap('s5', 5, 'published'), snap('s4', 4, 'candidate')], runs: [] });
  assert.equal(v.replies, 'unknown');
  assert.equal(v.candidate, null); assert.equal(v.tests, null); assert.equal(v.canRunTests, false);
});

test('run history unavailable (older server): cards still render, tests read unknown, Publish stays off', () => {
  const v = botControlView({ bot: 'eyad', settings: { faq_agent_enabled: true }, pointer: { mode: 'legacy' }, snapshots: [snap('s1', 1, 'candidate')], runs: null });
  assert.equal(v.tests, 'unknown');
  assert.equal(v.canRunTests, true); assert.equal(v.canPublish, false);
  assert.deepEqual(v.live, { kind: 'legacy' });
});

test('what customers get follows the reply switch: replies off means no automatic answer, not a live agent', () => {
  const on = botControlView({ bot: 'eyad', settings: { faq_agent_enabled: true }, pointer: { mode: 'legacy' }, snapshots: [], runs: [] });
  assert.deepEqual(on.live, { kind: 'legacy' });
  const off = botControlView({ bot: 'dubai', settings: { faq_agent_enabled: false }, pointer: { mode: 'legacy' }, snapshots: [], runs: [] });
  assert.deepEqual(off.live, { kind: 'none' });
  const unknown = botControlView({ bot: 'dubai', settings: null, pointer: { mode: 'legacy' }, snapshots: [], runs: [] });
  assert.deepEqual(unknown.live, { kind: 'global' });
});
