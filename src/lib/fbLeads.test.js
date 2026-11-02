import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyForm, validateForm, formToRow, rowToForm, keysOf, cleanFormId, validateSettings, ago, FIELD_TARGETS } from './fbLeads.js';

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

test('a stored row reads back as a form, with default field keys filled in', () => {
  const back = rowToForm({ id: 'x', form_id: '99', label: 'L', project: 'P', assign_mode: 'team', assign_team_id: 't1', field_map: { phone: ['mobile'] }, status: null });
  assert.equal(back.assign_team_id, 't1');
  assert.deepEqual(back.field_map.phone, ['mobile']);        // the saved key wins
  assert.deepEqual(back.field_map.name, ['full_name', 'name']); // a missing one gets the default
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
