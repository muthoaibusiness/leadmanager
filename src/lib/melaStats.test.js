import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMela, sortAgents, fmtMins, regionOf, bn } from './melaStats.js';

const users = [{ id: 'a', name: 'Ali' }, { id: 'b', name: 'Bela' }];
const T = (min) => new Date(Date.parse('2026-11-01T06:00:00Z') + min * 60000).toISOString();
const lead = (o) => ({ id: 'L' + Math.random().toString(36).slice(2, 7), phone: '971500000001', status: 'NEW', assigned_to: 'a', created_at: T(0), ...o });
const act = (o) => ({ id: 'x' + Math.random().toString(36).slice(2, 8), timestamp: T(10), type: 'STATUS_CHANGE', user_id: 'a', description: 'Status → Contacted', ...o });

test('response time runs from assignment to the holder\'s first contact', () => {
  const l1 = lead({ status: 'CONTACTED' });
  const l2 = lead({ status: 'CONTACTED', assigned_to: 'b', phone: '8801700000001' });
  const acts = [
    act({ lead_id: l1.id, timestamp: T(10) }),                                   // 10 min after creation
    act({ lead_id: l1.id, timestamp: T(50), type: 'CALL', description: 'call' }), // later contact is ignored
    act({ lead_id: l2.id, type: 'FORWARDED', user_id: 'a', description: 'Forwarded to Bela (Agent)', timestamp: T(100) }),
    act({ lead_id: l2.id, user_id: 'b', timestamp: T(130) }),                    // 30 min after the hand-off, not after creation
    act({ lead_id: l2.id, user_id: 'a', timestamp: T(105), type: 'CALL' }),     // someone else's call does not count as Bela's response
  ];
  const m = buildMela({ leads: [l1, l2], acts, users });
  assert.equal(m.agents.find((x) => x.id === 'a').minutes, 10);
  assert.equal(m.agents.find((x) => x.id === 'b').minutes, 30);
  assert.equal(m.kpi.avgResponse, 20);
});

test('counts: contacted, invited, regions, percentages', () => {
  const l1 = lead({ status: 'CONTACTED' });
  const l2 = lead({ status: 'NEW', phone: '8801700000002' });
  const l3 = lead({ status: 'INTERESTED', phone: '01712345678' });
  const acts = [
    act({ lead_id: l1.id, id: `mela-invite-${l1.id}`, type: 'NOTE', description: 'Mela invitation sent on WhatsApp' }),
    act({ lead_id: l3.id, id: `mela-invite-${l3.id}`, type: 'NOTE', description: 'Mela invitation: sending…' }), // claim only: not sent
  ];
  const m = buildMela({ leads: [l1, l2, l3], acts, users });
  assert.deepEqual([m.kpi.total, m.kpi.contacted, m.kpi.invited], [3, 2, 1]);
  assert.deepEqual([m.kpi.contactedPct, m.kpi.invitedPct], [67, 33]);
  assert.deepEqual(m.dubai, { leads: 1, contacted: 1, invited: 1 });
  assert.deepEqual(m.bd, { leads: 2, contacted: 1, invited: 0 });
  assert.equal(regionOf('+880 1712-345678'), 'bd');
  assert.equal(regionOf('966500000000'), 'dubai');
});

test('Mela score: 70 x invited share + 30 x speed share, and the three sort orders', () => {
  const mk = (id, invited, minutes) => ({ id, name: id, leads: 5, contacted: 0, invited, minutes, score: 0 });
  const l = [];
  const acts = [];
  const spec = [['a', 4, 10], ['b', 2, 20], ['c', 0, null]];
  for (const [id, inv, min] of spec) {
    for (let i = 0; i < 5; i++) {
      const x = lead({ assigned_to: id, status: 'CONTACTED' });
      l.push(x);
      if (i < inv) acts.push(act({ lead_id: x.id, id: `mela-invite-${x.id}`, type: 'NOTE', description: 'Mela invitation sent on WhatsApp' }));
      if (min != null) acts.push(act({ lead_id: x.id, user_id: id, timestamp: T(min) }));
    }
  }
  const m = buildMela({ leads: l, acts, users: [{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }, { id: 'c', name: 'c' }] });
  const score = Object.fromEntries(m.agents.map((a) => [a.id, a.score]));
  assert.deepEqual(score, { a: 100, b: 50, c: 0 });   // a: 70 + 30*10/10 ; b: 70*2/4 + 30*10/20 = 35+15
  assert.deepEqual(sortAgents(m.agents, 'invited').map((a) => a.id), ['a', 'b', 'c']);
  assert.deepEqual(sortAgents(m.agents, 'response').map((a) => a.id), ['a', 'b', 'c']);
  assert.deepEqual(sortAgents(m.agents, 'score').map((a) => a.id), ['a', 'b', 'c']);
  void mk;
});

test('empty book and number formatting', () => {
  const m = buildMela({ leads: [], acts: [], users });
  assert.deepEqual([m.kpi.total, m.kpi.avgResponse, m.agents.length], [0, null, 0]);
  assert.equal(fmtMins(null), '—');
  assert.equal(fmtMins(0.2), '১ মি');
  assert.equal(fmtMins(95), '১ ঘ ৩৫ মি');
  assert.equal(fmtMins(180), '৩ ঘ');
  assert.equal(fmtMins(60 * 26), '১ দিন ২ ঘ');
  assert.equal(bn(2026), '২০২৬');
});
