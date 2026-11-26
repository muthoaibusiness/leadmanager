// Walks the admin screens against the mock server (dev/mock.mjs):
// Users & accounts (roster, filters, open an account, target, access, delete,
// create), Hold requests (approve, held units, unhold) as Management, then
// Companies as a Master account. Returns what it saw and what the app wrote.
//
// Edge Function calls (access-admin) are answered by the mock and not kept in
// mock.writes, so this script listens for them itself and keeps only the action
// names (never the body: a create carries a password).
import { signInAs, tap, shot, text } from './mock.mjs';

const iso = (minsFromNow) => new Date(Date.now() + minsFromNow * 60000).toISOString();

// Project p1 with one type and three units: one free (requested), one on hold
// from an approved request, one on an admin hold.
const properties = (url, data) => data.properties.map((p, i) => (i !== 0 ? p : {
  ...p,
  variants: [{
    id: 'v1', name: 'Type A', beds: 3, baths: 2, size: 1200, listRate: 7000, floorRate: 6500, unitPrefix: 'A-',
    units: [
      { id: 'A-101', status: 'available' },
      { id: 'A-102', status: 'hold', heldBy: 'u1', heldByName: 'Ayesha Agent', clientId: 'L001', clientName: 'Karim Uddin 2', holdUntil: iso(1800), note: 'Booked by management', at: iso(-600) },
      { id: 'A-103', status: 'hold', adminHold: true, clientName: 'Owner reserve', note: 'Kept by the owner', at: iso(-9000) },
    ],
  }],
}));
const hr = (id, unit, status, extra = {}) => ({
  id, company_id: 'c1', property_id: 'p1', property_name: 'Lake View Tower', variant_id: 'v1', variant_name: 'Type A', unit_id: unit,
  agent_id: 'u1', agent_name: 'Ayesha Agent', client_name: 'Rahim Ahmed 1', client_phone: '8801710000000',
  deal_total: 8400000, offer_rate: 7000, status, hold_until: null, created_at: iso(-90), decided_at: null, decided_by: '', ...extra,
});
const hold_requests = [
  hr('hr1', 'A-101', 'pending'),
  hr('hr2', 'A-102', 'approved', { client_name: 'Karim Uddin 2', created_at: iso(-700), decided_at: iso(-600), decided_by: 'Mina Manager', hold_until: iso(1800) }),
  hr('hr3', 'A-101', 'rejected', { client_name: 'Nusrat Jahan 3', agent_id: 'u4', agent_name: 'Babul Agent', created_at: iso(-4000), decided_at: iso(-3900), decided_by: 'Mina Manager' }),
];

// The mock's team id is 't1', which the shared boot code removes as an old demo
// seed (purgeDemoSeed in src/lib/db.js), so the team is answered here under
// another id, with its members pointed at it.
const teams = [{ id: 'tm1', name: 'Team Alpha', lead_id: 'u2', company_id: 'c1' }];
const retag = (u) => ({ ...u, team_id: u.team_id ? 'tm1' : null });
const usersFor = (rows, me) => (url) => {
  const q = decodeURIComponent(url.search);
  if (/auth_user_id=eq\./.test(q)) return [me];
  const one = /[?&]id=eq\.([^&]+)/.exec(q);
  return one ? rows.filter((u) => u.id === one[1].replace(/"/g, '')) : rows;
};
const users = (url, data, me) => usersFor(data.users.map(retag), retag(me))(url);

export default async function run(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  const out = { steps: [] };
  const step = async (name, fn) => { try { await fn(); out.steps.push('ok ' + name); } catch (e) { out.steps.push('FAIL ' + name + ': ' + String(e.message || e).split('\n')[0]); } };
  const seen = (s) => page.getByText(s).locator('visible=true').last().waitFor({ timeout: 8000 });
  const fnCalls = [];
  page.on('request', (req) => {
    if (req.method() !== 'POST' || !req.url().includes('/functions/v1/')) return;
    try { fnCalls.push(req.url().split('/functions/v1/')[1] + ':' + (req.postDataJSON()?.action || '?')); } catch { /* not JSON */ }
  });
  const callsSince = (n) => fnCalls.slice(n);
  const chip = async (name) => { await page.getByRole('button', { name }).locator('visible=true').first().click(); await page.waitForTimeout(400); };

  const mock = await signInAs(page, 'MANAGEMENT', { properties, hold_requests, teams, users });

  // ── Users & accounts ──────────────────────────────────────────────────────
  await step('roster lists the company accounts', async () => {
    await tap(page, 'Menu');
    await tap(page, 'Users & accounts');
    await seen('Total accounts');
    await seen('4 accounts');
    await shot(page, 'admin-1-accounts');
    out.roster = (await text(page)).slice(0, 700);
  });
  await step('role filter narrows the roster', async () => {
    await chip(/^Team Lead\s*\d+$/);
    await seen('1 of 4 accounts');
    const body = await text(page);
    out.roleFilter = { tariq: body.includes('Tariq Lead'), ayeshaHidden: !/Ayesha Agent\n/.test(body.split('1 of 4 accounts')[1] || '') };
    await chip(/^All\s*\d+$/);
    await seen('4 accounts');
    await chip(/^No team$/);
    await seen('1 of 4 accounts');
    out.noTeam = (await text(page)).includes('Mina Manager');
    await chip(/^All teams$/);
    await seen('4 accounts');
  });
  await step('search finds nothing, then clears', async () => {
    await page.getByPlaceholder('Search name, email or phone').locator('visible=true').last().fill('zzzz');
    await seen('No account matches');
    await tap(page, 'Clear filters');
    await seen('4 accounts');
  });
  await step('open an account', async () => {
    await tap(page, 'Ayesha Agent');
    await seen('FEATURE ACCESS');
    await page.waitForTimeout(500);
    await shot(page, 'admin-2-account');
    out.account = (await text(page)).slice(0, 900);
  });
  await step('set a monthly target (targets write)', async () => {
    await tap(page, 'Site Visits Done');
    await page.getByPlaceholder('e.g. 15').fill('12');
    await shot(page, 'admin-3-target');
    await tap(page, 'Set target');
    await seen('Target updated');
    const w = mock.writes.find((x) => x.table === 'targets');
    out.targetWrite = w ? { method: w.method, body: w.body } : null;
    await seen('Target this month: 12');
  });
  await step('rename + feature toggle + project, saved through access-admin', async () => {
    const n = fnCalls.length;
    await page.getByRole('textbox').locator('visible=true').first().fill('Ayesha Akter');
    await tap(page, 'Lake View Tower');
    await tap(page, 'Pipeline');
    await page.waitForTimeout(300);
    await shot(page, 'admin-4-features');
    await tap(page, 'Save changes');
    await seen('User updated');
    out.saveCalls = callsSince(n);
  });
  await step('deactivate asks first, then calls access-admin', async () => {
    const n = fnCalls.length;
    await tap(page, 'Babul Agent');
    await seen('FEATURE ACCESS');
    await tap(page, 'Deactivate');
    await seen('Deactivating also signs it out everywhere.');
    await shot(page, 'admin-5-deactivate');
    await page.getByRole('button', { name: 'Deactivate' }).locator('visible=true').last().click();
    await seen('Account deactivated');
    out.deactivateCalls = callsSince(n);
    await page.goBack();
    await seen('4 accounts');
  });
  await step('own account: no access section, no delete', async () => {
    await tap(page, 'Mina Manager');
    await seen('Save changes');
    const body = await text(page);
    out.self = { noFeatureList: !body.includes('FEATURE ACCESS'), noDelete: !body.includes('Delete account'), noDeactivate: !body.includes('Deactivate') };
    await page.goBack();
    await seen('4 accounts');
  });
  await step('delete a team lead: confirm, access-admin, team dropped', async () => {
    const n = fnCalls.length;
    await tap(page, 'Tariq Lead');
    await seen('FEATURE ACCESS');
    await tap(page, 'Delete account');
    await seen('Remove Tariq Lead?');
    await shot(page, 'admin-6-delete');
    await page.getByRole('button', { name: 'Remove' }).locator('visible=true').last().click();
    await seen(/User removed/);
    await seen('3 accounts');
    out.deleteCalls = callsSince(n);
    out.teamDeleted = mock.writes.filter((w) => w.table === 'teams').map((w) => w.method + ' ' + w.query);
    out.tariqGone = !(await text(page)).includes('Tariq Lead');
  });
  await step('create an account: validation, then the one-time login card', async () => {
    const n = fnCalls.length;
    await page.getByLabel('Add user').locator('visible=true').last().click();
    await seen('Full name *');
    await tap(page, 'Create');
    await seen('Name, email and password required.');
    await page.getByPlaceholder('e.g. Masud Rahman').fill('Masud Rahman');
    await page.getByPlaceholder('user@company.com').fill('u1@demo.test');
    await page.getByPlaceholder('Set a password').fill('short');
    await tap(page, 'Create');
    await seen('Password must be at least 10 characters.');
    await page.getByPlaceholder('Set a password').fill('a-long-password-1');
    await tap(page, 'Create');
    await seen('Email already in use.');
    await page.getByPlaceholder('user@company.com').fill('masud@demo.test');
    await tap(page, 'Agent');
    await page.waitForTimeout(300);
    await shot(page, 'admin-7-create');
    out.createCallsBefore = callsSince(n).length;
    await tap(page, 'Create');
    await seen('Account created');
    await shot(page, 'admin-8-created');
    out.createCalls = callsSince(n);
    out.notifWrites = mock.writes.filter((w) => w.table === 'notifications' && JSON.stringify(w.body).includes('NEW_USER')).length;
    await tap(page, 'Done');
    await seen('Total accounts');
  });

  // ── Hold requests ─────────────────────────────────────────────────────────
  await step('hold requests queue', async () => {
    await page.goBack();
    await tap(page, 'Hold requests');
    await seen('Queue (1)');
    await seen('Rahim Ahmed 1');
    await shot(page, 'admin-9-requests');
    out.requests = (await text(page)).slice(0, 600);
  });
  await step('open a request', async () => {
    await tap(page, 'Rahim Ahmed 1');
    await seen('Set when approved (2 days)');
    await shot(page, 'admin-10-request');
    await page.getByLabel('Close').locator('visible=true').last().click();
    await page.waitForTimeout(500);
  });
  await step('approve writes the request and the unit', async () => {
    const before = mock.writes.length;
    await tap(page, 'Approve');
    await seen('Hold approved · Unit A-101');
    await page.waitForTimeout(600);
    const ws = mock.writes.slice(before);
    const req = ws.find((w) => w.table === 'hold_requests');
    const prop = ws.find((w) => w.table === 'properties');
    const unit = prop && JSON.stringify(prop.body).match(/\{"id":"A-101"[^}]*\}/);
    const days = req?.body?.hold_until ? Math.round((new Date(req.body.hold_until) - Date.now()) / 86400000) : null;
    out.approve = {
      request: req ? { method: req.method, query: req.query, status: req.body.status, decided_by: req.body.decided_by, holdDays: days } : null,
      unit: unit ? unit[0] : null,
      agentNotified: ws.some((w) => w.table === 'notifications' && JSON.stringify(w.body).includes('HOLD_APPROVED')),
    };
    await seen('Queue (0)');
    await seen('No pending requests');
  });
  await step('held units list, then unhold', async () => {
    await tap(page, /^Held units \(\d+\)$/, { exact: false });
    await seen('Unit A-103');
    await shot(page, 'admin-11-held');
    out.held = (await text(page)).slice(0, 700);
    const before = mock.writes.length;
    await page.getByRole('button', { name: 'Unhold' }).locator('visible=true').first().click();
    await seen(/^Unhold unit /);
    await page.getByRole('button', { name: 'Unhold' }).locator('visible=true').last().click();
    await seen(/is available again/);
    await page.waitForTimeout(500);
    out.unholdWrites = mock.writes.slice(before).map((w) => w.method + ' ' + w.table);
    await shot(page, 'admin-12-held-after');
  });

  // ── Companies (Master) ────────────────────────────────────────────────────
  // The mock has no Master account. signInAs falls back to its first user (u1),
  // so the users table is answered here with that row turned into a Master.
  let mock2 = null;
  await step('sign in as a Master account', async () => {
    const master = (d) => ({ ...d.users[0], name: 'Mona Master', role: 'MASTER', team_id: null, company_id: null });
    const users = (url, d) => usersFor([master(d), ...d.users.slice(1).map(retag)], master(d))(url);
    await page.goto('http://localhost:8099/', { waitUntil: 'domcontentloaded' });
    const companies = (url, d) => [d.company, { id: 'c2', name: 'Navana Realty', plan: 'Growth', is_active: false, created_at: iso(-20000) }];
    mock2 = await signInAs(page, 'MASTER', { users, companies, properties, teams });
    // The mock answers Edge Functions with { ok: true } only; creating a
    // company needs the account row back, as the real function returns it.
    await page.route(/\/functions\/v1\/access-admin/, async (route) => {
      const b = route.request().postDataJSON() || {};
      const user = b.action === 'create'
        ? { id: 'unew', name: b.name, email: b.email, phone: b.phone || '', role: b.role, team_id: null, company_id: b.companyId || null, is_active: true, avatar: null, projects: [], allowed_features: null }
        : undefined;
      await route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json' }, body: JSON.stringify({ ok: true, user }) });
    });
  });
  await step('companies overview', async () => {
    await tap(page, 'Menu');
    await tap(page, 'Companies');
    await seen('Demo Realty');
    await seen('Navana Realty');
    await page.waitForTimeout(500);
    await shot(page, 'admin-13-companies');
    out.companies = (await text(page)).slice(0, 700);
  });
  await step('suspend asks first, then writes the company', async () => {
    const before = mock2.writes.length;
    await tap(page, 'Suspend');
    await seen('Suspend Demo Realty?');
    await page.getByRole('button', { name: 'Suspend' }).locator('visible=true').last().click();
    await seen('Company suspended');
    await page.waitForTimeout(400);
    out.suspendWrite = mock2.writes.slice(before).filter((w) => w.table === 'companies').map((w) => ({ method: w.method, query: w.query, is_active: w.body.is_active }));
  });
  await step('activate writes at once', async () => {
    const before = mock2.writes.length;
    await page.getByRole('button', { name: 'Activate' }).locator('visible=true').last().click();
    await seen('Company activated');
    await page.waitForTimeout(400);
    out.activateWrite = mock2.writes.slice(before).filter((w) => w.table === 'companies').map((w) => ({ method: w.method, query: w.query, is_active: w.body.is_active }));
  });
  await step('create a company: validation, then company + first admin', async () => {
    const before = mock2.writes.length;
    const n = fnCalls.length;
    await tap(page, 'Add company');
    await seen('Company name *');
    await tap(page, 'Create company');
    await seen('Company name required.');
    await page.getByPlaceholder('e.g. Navana Realty').fill('Shanta Homes');
    await page.getByPlaceholder('e.g. Sadia Noor').fill('Sadia Noor');
    await page.getByPlaceholder('admin@company.com').fill('not-an-email');
    await tap(page, 'Create company');
    await seen('Valid admin email required.');
    await page.getByPlaceholder('admin@company.com').fill('sadia@shanta.test');
    await tap(page, 'Create company');
    await seen('Admin password must be at least 10 characters');
    await page.getByPlaceholder('10+ characters').fill('a-long-password-2');
    await tap(page, 'Growth');
    await shot(page, 'admin-14-company-form');
    await tap(page, 'Create company');
    await seen('Company created');
    await seen('Shanta Homes created.');
    await page.waitForTimeout(400);
    await shot(page, 'admin-15-company-created');
    out.companyWrite = mock2.writes.slice(before).filter((w) => w.table === 'companies').map((w) => ({ method: w.method, name: (Array.isArray(w.body) ? w.body[0] : w.body)?.name, plan: (Array.isArray(w.body) ? w.body[0] : w.body)?.plan }));
    out.companyCalls = callsSince(n);
  });

  out.writeCount = mock.writes.length + (mock2 ? mock2.writes.length : 0);
  return out;
}
