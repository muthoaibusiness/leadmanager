// vite-node scripts/rtconfig.test.mjs — the realtime subscription never asks for
// notification DELETE events (the nightly purge, migration 0065, would stream
// every deleted row to every browser), while other tables keep theirs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rtConfig } from '../src/lib/supabase.js';

const roles = [
  { id: 'm0', role: 'MASTER', companyId: null },
  { id: 'g1', role: 'MANAGEMENT', companyId: 'c1' },
  { id: 't1', role: 'TEAM_LEAD', companyId: 'c1', teamId: 'tm' },
  { id: 'a1', role: 'AGENT', companyId: 'c1', teamId: 'tm' },
];

for (const user of roles) {
  test(`${user.role}: no notification DELETE, other tables keep theirs`, () => {
    const specs = rtConfig(user);
    const notif = specs.filter((s) => s.table === 'notifications');
    assert.ok(notif.length >= 2, 'notifications still stream inserts and updates');
    assert.ok(notif.every((s) => s.event === 'INSERT' || s.event === 'UPDATE'), JSON.stringify(notif));
    if (user.role !== 'MASTER') assert.ok(notif.every((s) => s.filter === `user_id=eq.${user.id}`));
    const leads = specs.filter((s) => s.table === 'leads');
    assert.ok(leads.some((s) => s.event === 'DELETE' || s.event === '*'), 'leads still get deletes');
  });
}
