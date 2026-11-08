import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupByNumber, phoneKeyOf, mergeThreads } from './waGroup.js';

const c = (o) => ({ account: 'dubai', unreadCount: 0, lastMessageAt: '2026-11-02T06:00:00Z', lastMessagePreview: '', lastMessageDir: 'IN', source: 'WHATSAPP', adMeta: null, leadId: null, avatarUrl: '', ...o });

test('a LID thread and a phone thread of one number become one row, named and sendable', () => {
  const lid = c({ id: 'dubai:216797198422026@lid', phone: '96894363386', name: 'Tayab', source: 'AD', adMeta: { t: 1 }, leadId: 'L1', lastMessageAt: '2026-11-02T06:38:46Z', lastMessagePreview: 'Total cost', unreadCount: 2 });
  const jid = c({ id: 'dubai:96894363386@s.whatsapp.net', phone: '96894363386', name: '96894363386', lastMessageAt: '2026-11-02T06:38:52Z', lastMessagePreview: 'Thank you.', lastMessageDir: 'OUT', unreadCount: 1 });
  const other = c({ id: 'dubai:97144915737@s.whatsapp.net', phone: '97144915737', name: 'Zed' });
  const out = groupByNumber([lid, other, jid]);
  assert.equal(out.length, 2);
  const g = out.find((x) => x.memberIds.length === 2);
  assert.equal(g.id, 'dubai:96894363386@s.whatsapp.net');   // send on the phone thread
  assert.equal(g.name, 'Tayab');                             // the name, not the bare number
  assert.equal(g.source, 'AD');
  assert.equal(g.leadId, 'L1');
  assert.equal(g.unreadCount, 3);
  assert.equal(g.lastMessagePreview, 'Thank you.');         // the newest of the two
  assert.deepEqual(g.memberIds.sort(), [jid.id, lid.id].sort());
  assert.equal(out[0].id, g.id, 'the group keeps the place of its first thread in the list');
});

test('different accounts or unknown numbers are never merged', () => {
  const a = c({ id: 'eyad:8801700000001@s.whatsapp.net', phone: '8801700000001', account: 'eyad' });
  const b = c({ id: 'dubai:8801700000001@s.whatsapp.net', phone: '8801700000001', account: 'dubai' });
  const hidden1 = c({ id: 'dubai:111111111111111@lid', phone: '111111111111111' });
  const hidden2 = c({ id: 'dubai:222222222222222@lid', phone: '222222222222222' });
  assert.equal(groupByNumber([a, b, hidden1, hidden2]).length, 4);
  assert.equal(phoneKeyOf(hidden1), '');
  assert.equal(phoneKeyOf(c({ id: 'x', phone: '01712345678' })), '8801712345678');
});

test('threads merge into one transcript in time order', () => {
  const m = (id, t) => ({ id, waTimestamp: t });
  assert.deepEqual(mergeThreads([[m('b', '2026-11-02T06:02:00Z')], [m('a', '2026-11-02T06:01:00Z'), m('c', '2026-11-02T06:03:00Z')]]).map((x) => x.id), ['a', 'b', 'c']);
});
