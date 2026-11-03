import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyForm, validateForm, formToRow, rowToForm, keysOf, cleanFormId, validateSettings, ago, validTag, cleanTag, summarizeEvents, FIELD_TARGETS } from './fbLeads.js';

const good = () => ({ ...emptyForm(), form_id: '1234567890123', label: 'Citizen form', project: 'Wecon Citizen Avenue' });

test('a complete form passes; each gap is named in plain words', () => {
  assert.deepEqual(validateForm(good()), []);
  assert.ok(validateForm({ ...good(), form_id: '12' })[0].includes('form id'));
  assert.ok(validateForm({ ...good(), label: '  ' }).some((m) => m.includes('name')));
  assert.ok(validateForm({ ...good(), project: '' }).some((m) => m.includes('project')));
  assert.ok(validateForm({ ...good(), field_map: { name: ['full_name'] } }).some((m) => m.includes('"Phone"')));
  assert.ok(validateForm(good(), { existingFormIds: ['1234567890123'] }).some((m) => m.includes('already')));
});

test('assignment needs what its mode needs', () => {
  assert.ok(validateForm({ ...good(), assign_mode: 'agent' }).some((m) => m.includes('agent')));
  assert.ok(validateForm({ ...good(), assign_mode: 'team' }).some((m) => m.includes('team')));
  assert.ok(validateForm({ ...good(), assign_mode: 'round_robin', assign_pool: ['a'] }).some((m) => m.includes('two agents')));
  assert.deepEqual(validateForm({ ...good(), assign_mode: 'round_robin', assign_pool: ['a', 'b'] }), []);
  assert.deepEqual(validateForm({ ...good(), assign_mode: 'agent', assign_agent_id: 'u1' }), []);
});

test('saving keeps only what the chosen mode uses and cleans the ids and keys', () => {
  const f = { ...good(), form_id: ' 1234 5678 9012 3 ', assign_mode: 'agent', assign_agent_id: 'u1', assign_team_id: 'tX', assign_pool: ['a', 'b'],
    field_map: { name: 'full_name, name', phone: ['phone_number'], email: '' } };
  const r = formToRow(f, 'c1', 'newid');
  assert.equal(r.id, 'newid');
  assert.equal(r.form_id, '1234567890123');
  assert.equal(r.assign_agent_id, 'u1');
  assert.equal(r.assign_team_id, null);
  assert.deepEqual(r.assign_pool, []);
  assert.deepEqual(r.field_map, { name: ['full_name', 'name'], phone: ['phone_number'] });   // empty email dropped
  assert.equal(formToRow({ ...f, id: 'old' }, 'c1', 'newid').id, 'old');
});

test('a forwarding form needs a tag, and only it sends the forward columns', () => {
  const fwd = { ...good(), assign_mode: 'forward', forward_tag: ' /FCTG ', notify_customer: true };
  assert.deepEqual(validateForm(fwd), []);
  assert.ok(validateForm({ ...fwd, forward_tag: '' }).some((m) => m.includes('forward tag')));
  assert.ok(validateForm({ ...fwd, forward_tag: 'fctg' }).some((m) => m.includes('forward tag')));   // must start with /f
  assert.ok(validTag('/fdu') && validTag('/fcml') && !validTag('/t') && !validTag('/f') && !validTag('/f ctg'));
  assert.equal(cleanTag(' /FCTG '), '/fctg');
  const r = formToRow(fwd, 'c1', 'newid');
  assert.equal(r.assign_mode, 'forward');
  assert.equal(r.forward_tag, '/fctg');
  assert.equal(r.notify_customer, true);
  assert.equal(formToRow({ ...fwd, notify_customer: false }, 'c1', 'x').notify_customer, false);
  // before migration 0060 these columns do not exist, so no other mode may send them
  assert.equal('forward_tag' in formToRow({ ...good(), assign_mode: 'agent', assign_agent_id: 'u1' }, 'c1', 'x'), false);
  assert.equal('notify_customer' in formToRow(good(), 'c1', 'x'), false);
  // and a row from before the migration reads back with the defaults
  const old = rowToForm({ id: 'x', form_id: '99', label: 'L', project: 'P', assign_mode: 'none' });
  assert.equal(old.forward_tag, '/fctg');
  assert.equal(old.notify_customer, true);
  assert.equal(rowToForm({ id: 'x', form_id: '99', label: 'L', project: 'P', assign_mode: 'forward', forward_tag: '/fdh', notify_customer: false }).notify_customer, false);
});

test('a stored row reads back as a form, with default field keys filled in', () => {
  const back = rowToForm({ id: 'x', form_id: '99', label: 'L', project: 'P', assign_mode: 'team', assign_team_id: 't1', field_map: { phone: ['mobile'] }, status: null });
  assert.equal(back.assign_team_id, 't1');
  assert.deepEqual(back.field_map.phone, ['mobile']);        // the saved key wins
  assert.deepEqual(back.field_map.name, ['full_name', 'name', 'first_name']); // a missing one gets the default
  assert.equal(back.status, '');
  assert.ok(FIELD_TARGETS.every((t) => t.key in back.field_map));
});

test('helpers: ids, keys, settings, time', () => {
  assert.equal(cleanFormId('form: 123-456'), '123456');
  assert.deepEqual(keysOf(' a, b ,,c '), ['a', 'b', 'c']);
  assert.deepEqual(validateSettings({ enabled: false, page_id: '' }), []);
  assert.equal(validateSettings({ enabled: true, page_id: '12' }).length, 1);
  assert.deepEqual(validateSettings({ enabled: true, page_id: '104718884272119' }), []);
  const now = Date.parse('2026-11-02T10:00:00Z');
  assert.equal(ago('2026-11-02T09:59:30Z', now), '30s ago');
  assert.equal(ago('2026-11-02T09:00:00Z', now), '1h ago');
  assert.equal(ago('2026-10-31T10:00:00Z', now), '2d ago');
});

test('the scoreboard counts, per form, what came in and what became of it', () => {
  const ev = [
    { leadgen_id: '1', form_id: 'A', status: 'created' }, { leadgen_id: '2', form_id: 'A', status: 'created' },
    { leadgen_id: '3', form_id: 'A', status: 'failed' }, { leadgen_id: '4', form_id: 'B', status: 'duplicate' },
    { leadgen_id: '5', form_id: 'B', status: 'skipped' },
  ];
  const queue = [{ leadgen_id: '3', form_id: 'A' }, { leadgen_id: '1', form_id: 'A' }, { leadgen_id: '9', form_id: 'B' }];
  const { rows, total } = summarizeEvents(ev, queue);
  assert.deepEqual(rows.find((r) => r.form_id === 'A'), { form_id: 'A', received: 3, distributed: 2, duplicate: 0, failed: 1, skipped: 0, queued: 1 });   // 1 is done, 3 still waits
  assert.deepEqual(rows.find((r) => r.form_id === 'B'), { form_id: 'B', received: 2, distributed: 0, duplicate: 1, failed: 0, skipped: 1, queued: 1 });
  assert.deepEqual(total, { received: 5, distributed: 2, duplicate: 1, failed: 1, skipped: 1, queued: 2 });
  assert.deepEqual(summarizeEvents([], []).total.received, 0);
});
