// node scripts/cr001-ui-check.mjs — the real app in headless Chromium, served
// by Vite on 127.0.0.1:5174 against the isolated local stack (CR001_* env).
// Refuses unless every Supabase request the page makes goes to loopback.
// Screenshots go to /tmp/cr001-ui/. Throwaway accounts are removed at the end.
//   * Sign in as a Management admin; the session is the Auth token pair, not
//     pcrm_sess. Users & Accounts shows a Users tab and an Access tab.
//   * Access: grant a feature, save, reload: still granted (server row).
//   * Sign in as an agent: Users & Accounts is not reachable; a hand-edited
//     pcrm_sess naming the admin opens nothing.
//   * Sign out clears the session.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const PW_DIR = process.env.PLAYWRIGHT_DIR;
const { chromium } = await import(`${PW_DIR}/playwright/index.mjs`);
const API = process.env.CR001_API_URL; const DB = process.env.CR001_DB_URL; const SVC = process.env.CR001_SERVICE_ROLE_KEY;
const APP = 'http://127.0.0.1:5174';
for (const u of [API, DB, APP]) if (!['127.0.0.1', 'localhost'].includes(new URL(u.replace(/^postgres(ql)?:/, 'http:')).hostname)) throw new Error(`refusing ${u}`);
const sql = (q) => execFileSync('psql', [DB, '-v', 'ON_ERROR_STOP=1', '-Atqc', q], { encoding: 'utf8' }).trim();
const OUT = '/tmp/cr001-ui'; mkdirSync(OUT, { recursive: true });

const tag = 'ui' + Date.now(); const pw = 'local-only-' + tag;
const mk = async (k) => (await (await fetch(`${API}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${tag}-${k}@local.test`, password: pw, email_confirm: true }) })).json()).id;
const ids = { m: await mk('m'), a: await mk('a') };
sql(`insert into public.companies (id,name,plan,is_active) values ('${tag}c','UI Co','Starter',true) on conflict do nothing`);
sql(`insert into public.users (id,name,email,password,role,company_id,team_id,is_active,auth_user_id) values
  ('${tag}m','Admin UI','${tag}-m@local.test','x','MANAGEMENT','${tag}c',null,true,'${ids.m}'),
  ('${tag}a','Agent UI','${tag}-a@local.test','x','AGENT','${tag}c',null,true,'${ids.a}')`);

const results = [];
const check = async (name, f) => { try { await f(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, String(e.message).split('\n')[0].slice(0, 160)]); } };
const browser = await chromium.launch();
const offHost = [];
const newPage = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  page.on('request', (r) => { const h = new URL(r.url()).hostname; if (!['127.0.0.1', 'localhost'].includes(h) && !/(googleapis|gstatic)\.com$/.test(h)) offHost.push(r.url()); });
  return { ctx, page };
};
// Landing page first; its "Sign in" opens the login form (.msi-input fields).
const signIn = async (page, who) => {
  await page.goto(APP);
  await page.getByRole('button', { name: 'Sign in', exact: true }).first().click();
  await page.locator('#login input.msi-input[type="email"]').fill(`${tag}-${who}@local.test`);
  await page.locator('#login input.msi-input[type="password"]').fill(pw);
  await page.locator('#login input.msi-input[type="password"]').press('Enter');
};

const { ctx, page } = await newPage();
await check('admin signs in with Supabase Auth; session is a token pair, no pcrm_sess', async () => {
  await signIn(page, 'm');
  await page.waitForFunction(() => !!localStorage.getItem('pcrm_auth'), null, { timeout: 15000 });
  const st = await page.evaluate(() => ({ auth: JSON.parse(localStorage.getItem('pcrm_auth') || 'null'), legacy: localStorage.getItem('pcrm_sess') }));
  assert.ok(st.auth?.access_token && st.auth?.refresh_token, 'token pair stored');
  assert.equal(st.legacy, null, 'no legacy id session');
  await page.screenshot({ path: `${OUT}/01-admin-signed-in.png` });
});
await check('Users & Accounts has Users and Access tabs', async () => {
  await page.goto(`${APP}/#/accounts`);
  await page.getByRole('tab', { name: 'Access' }).waitFor({ timeout: 15000 });
  assert.equal(await page.getByRole('tab', { name: 'Users' }).count(), 1);
  await page.screenshot({ path: `${OUT}/02-users-tab.png` });
});
await check('Access tab: revoke Leads from the agent, reload, still revoked (server row)', async () => {
  await page.getByRole('tab', { name: 'Access' }).click();
  await page.getByText('Feature access').waitFor();
  const grid = page.getByRole('group', { name: 'Feature access' });
  const chip = grid.getByRole('button', { name: 'Leads', exact: true });
  await chip.waitFor();
  const before = sql(`select coalesce(allowed_features::text,'null') from public.users where id='${tag}a'`);
  // Toggle Leads off: a real change from the role defaults.
  await chip.click();
  await page.getByRole('button', { name: /Save access/ }).click();
  await page.getByText('Access saved').first().waitFor({ timeout: 10000 });
  const after = sql(`select coalesce(allowed_features::text,'null') from public.users where id='${tag}a'`);
  assert.notEqual(after, before, 'the server row changed');
  assert.ok(!after.includes('"leads"'), `leads revoked in DB: ${after}`);
  await page.screenshot({ path: `${OUT}/03-access-saved.png` });
  await page.reload();
  await page.getByRole('tab', { name: 'Access' }).click();
  const chip2 = page.getByRole('group', { name: 'Feature access' }).getByRole('button', { name: 'Leads', exact: true });
  await chip2.waitFor();
  assert.equal(await chip2.getAttribute('aria-pressed'), 'false', 'still revoked after reload');
  await page.screenshot({ path: `${OUT}/04-access-after-reload.png` });
});
await check('sign out clears the session', async () => {
  await page.evaluate(() => document.querySelector('[aria-label*="account" i], .umenu-trigger, .user-menu, [data-umenu]')?.click());
  const out = page.getByRole('button', { name: 'Sign out' });
  if (await out.count() === 0) await page.locator('.umenu-item.umenu-danger').first().click({ force: true }).catch(() => {});
  else await out.click();
  await page.waitForFunction(() => !localStorage.getItem('pcrm_auth'), null, { timeout: 10000 });
});
await ctx.close();

const b = await newPage();
await check('agent cannot reach Users & Accounts', async () => {
  await signIn(b.page, 'a');
  await b.page.waitForFunction(() => !!localStorage.getItem('pcrm_auth'), null, { timeout: 15000 });
  await b.page.goto(`${APP}/#/accounts`);
  await b.page.waitForTimeout(2500);
  assert.equal(await b.page.getByRole('tab', { name: 'Access' }).count(), 0);
  await b.page.screenshot({ path: `${OUT}/05-agent-no-accounts.png` });
});
await check('tampered pcrm_sess naming the admin opens nothing', async () => {
  await b.page.evaluate((id) => { localStorage.clear(); localStorage.setItem('pcrm_sess', JSON.stringify({ id })); }, `${tag}m`);
  await b.page.goto(APP); await b.page.waitForTimeout(2500);
  assert.ok(await b.page.getByRole('button', { name: 'Sign in', exact: true }).count() > 0, 'back on the landing page');
  assert.equal(await b.page.locator('#login, .app-shell, [data-shell]').count() === 0 || await b.page.getByRole('button', { name: 'Sign in', exact: true }).count() > 0, true);
  assert.equal(await b.page.evaluate(() => localStorage.getItem('pcrm_sess')), null, 'legacy id dropped');
  await b.page.screenshot({ path: `${OUT}/06-tampered-session.png` });
});
await b.ctx.close();
await browser.close();

await check('no request left loopback (except the font CDN)', async () => { assert.deepEqual(offHost, []); });

sql(`delete from public.access_audit where target_id like '${tag}%' or actor_id like '${tag}%'`);
sql(`delete from public.users where id like '${tag}%'`); sql(`delete from public.companies where id='${tag}c'`);
for (const id of Object.values(ids)) await fetch(`${API}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: { apikey: SVC, Authorization: `Bearer ${SVC}` } });
for (const r of results) console.log(r.join('  '));
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} PASS  screenshots: ${OUT}`);
process.exit(failed ? 1 : 0);
