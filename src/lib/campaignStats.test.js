import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCampaign, botStep, periodWindow } from './campaignStats.js';

const NOW = Date.parse('2026-11-01T12:00:00Z');
const iso = (h) => new Date(NOW - h * 36e5).toISOString();
const users = [{ id: 'a', name: 'Ali', role: 'AGENT', teamId: 't1' }, { id: 'b', name: 'Bela', role: 'AGENT', teamId: 't1' }];
const teams = [{ id: 't1', name: 'Dubai Team' }];
const lead = (o) => ({ id: 'x' + Math.random(), phone: '971500000001', status: 'NEW', team_id: 't1', assigned_to: 'a', previous_assignees: [], created_at: iso(2), call_count: 0, whatsapp_count: 0, sms_count: 0, visit_count: 0, ...o });

test('counts, distribution and hand-offs', () => {
  const leads = [
    lead({ phone: '971500000001' }),
    lead({ phone: '971500000002', status: 'INTERESTED', assigned_to: 'b', previous_assignees: ['a'], call_count: 2 }),
    lead({ phone: '8801700000003', team_id: null, status: 'DEAL_CLOSED_WON', deal_value: 500, assigned_to: 'a', call_count: 1 }),
    lead({ phone: '971500000004', assigned_to: null }),
  ];
  const preleads = [
    { phone: '971500000001', WA: 'Jaber', created_at: iso(2), flow_stage: 'dubai_greeted' },
    { phone: '971500000002', WA: 'Jaber', created_at: iso(3), flow_stage: 'dubai_asked_docs' },
    { phone: '8801700000003', WA: 'Eyad', created_at: iso(1), flow_stage: null },
  ];
  const c = buildCampaign({ leads, preleads, users, teams, period: '7d', now: NOW });
  assert.equal(c.kpi.inquiries, 3);
  assert.equal(c.kpi.leads, 4);
  assert.equal(c.kpi.distributed, 3);
  assert.equal(c.kpi.unassigned, 1);
  assert.equal(c.kpi.interested, 2);        // INTERESTED + WON
  assert.equal(c.kpi.won, 1);
  assert.equal(c.kpi.revenue, 500);
  assert.equal(c.kpi.untouched, 2);
  const ali = c.agents.find(a => a.id === 'a'), bela = c.agents.find(a => a.id === 'b');
  assert.equal(ali.received, 3); assert.equal(ali.holding, 2); assert.equal(ali.handed, 1); assert.equal(ali.first, 3);
  assert.equal(bela.received, 1); assert.equal(bela.holding, 1);
  assert.deepEqual(c.flows, [{ from: 'Ali', to: 'Bela', n: 1 }]);
  assert.equal(c.channels.find(x => x.key === 'dubai').inquiries, 2);
  assert.equal(c.channels.find(x => x.key === 'eyad').inquiries, 1);
  assert.equal(c.channels.find(x => x.key === 'eyad').leads, 1);   // the 880 lead came in on the Eyad number
  assert.equal(c.bot.find(s => s.key === 'greeted').value, 1);
  assert.equal(c.bot.find(s => s.key === 'silent').value, 1);
});

test('period windows and prelead stages', () => {
  const old = lead({ created_at: iso(24 * 20) });
  const c7 = buildCampaign({ leads: [old], preleads: [], users, teams, period: '7d', now: NOW });
  const c30 = buildCampaign({ leads: [old], preleads: [], users, teams, period: '30d', now: NOW });
  assert.equal(c7.kpi.leads, 0); assert.equal(c30.kpi.leads, 0, 'before launch is not part of the campaign');
  assert.equal(periodWindow('all').prev, null);
  assert.equal(botStep({ flow_stage: 'dubai_brochure_sent' }), 'brochure');
  assert.equal(botStep({ flow_stage: 'dubai_done' }), 'done');
  assert.equal(botStep({ flow_stage: 'agent_assigned' }), 'human');
  assert.equal(botStep({ flow_stage: 'dubai_done', takeover: true }), 'human');
});
