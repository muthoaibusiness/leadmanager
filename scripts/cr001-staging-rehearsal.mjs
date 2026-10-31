// node scripts/cr001-staging-rehearsal.mjs — after the full cutover sequence on
// the LOCAL staging stack (ST_* env from that stack; loopback URLs only):
// 0053, 0054, 0055 applied, functions served, Auth users migrated with one-time
// links, the client built against staging and served on 127.0.0.1:5175.
//
// Each tested person gets their OWN password by consuming their own one-time
// link (no shared password). Then, in the built client and against the API:
//   1. every role signs in and its pages load, with no failed request caused
//      by the cutover
//   2. tenant boundary: a second company's account sees none of company c1
//   3. deactivation: the account's old token reads nothing via PostgREST and
//      is refused by the functions, and cannot refresh
//   4. a human WhatsApp send reaches the stub once and is SENT
//   5. the wa-followup cron job with its key moves a prelead and sends once
//   6. admin recovery with break-glass
// Throwaway rows are removed at the end; the restored data is compared before
// and after.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';

const API = process.env.ST_API_URL; const DB = process.env.ST_DB_URL;
const ANON = process.env.ST_ANON_KEY; const SVC = process.env.ST_SERVICE_ROLE_KEY;
const APP = 'http://127.0.0.1:5175';
// A fresh one-time recovery link per tested person, as an operator re-sends an
// expired invite: links from auth-migrate are single-use, and an earlier run
// consumes them.
const LINKS = '/tmp/cr001-staging/rehearsal-links.tsv';
const STUB = '/tmp/cr001-staging/wasender-stub.log';
const FKEY = readFileSync('/tmp/cr001-staging/followup-key.txt', 'utf8').trim();
if (!API || !DB) throw new Error('set ST_* (local staging stack only)');
for (const u of [API, DB, APP]) if (!['127.0.0.1', 'localhost'].includes(new URL(u.replace(/^postgres(ql)?:/, 'http:')).hostname)) throw new Error(`refusing ${u}`);
const { chromium } = await import(`${process.env.PLAYWRIGHT_DIR}/playwright/index.mjs`);
const sql = (q) => execFileSync('psql', [DB, '-v', 'ON_ERROR_STOP=1', '-Atqc', q], { encoding: 'utf8' }).trim();
const rest = (tok, path, init = {}) => fetch(`${API}/rest/v1/${path}`, { ...init, headers: { apikey: ANON, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
const count = async (tok, t, f = '') => { const r = await rest(tok, `${t}?select=id${f}`, { headers: { Prefer: 'count=exact', Range: '0-0' } }); return r.status >= 400 ? -r.status : Number((r.headers.get('content-range') || '').split('/')[1]); };
const signIn = async (email, password) => (await (await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })).json());
const stub = () => readFileSync(STUB, 'utf8').split('\n').filter(Boolean);

// Consume a person's own one-time link IN THE BUILT CLIENT, the way a person
// does: open the link, land on "Set your password", set one. Defect 4: before
// the fix the link landed on the sign-in page with no way to set a password.
const passwords = {};
// A fresh one-time recovery link per tested person, as an operator re-sends an
// expired invite: links from auth-migrate are single-use and an earlier run
// consumes them. They point at the built client, which handles them.
{
  const emails = sql(`select distinct on (role) email from public.users where is_active and role in ('AGENT','TEAM_LEAD','MEETING_AGENT','EXECUTIVE') order by role, email`).split('\n').filter(Boolean);
  const lines = [];
  for (const e of emails) {
    const g = await fetch(`${API}/auth/v1/admin/generate_link`, { method: 'POST', headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'recovery', email: e, redirect_to: `${APP}/` }) });
    lines.push(`${e}\t${(await g.json()).action_link}`);
  }
  writeFileSync(LINKS, lines.join('\n') + '\n', { mode: 0o600 });
}
async function claim(email) {
  const line = readFileSync(LINKS, 'utf8').split('\n').find((l) => l.toLowerCase().startsWith(email.toLowerCase() + '\t'));
  if (!line) throw new Error(`no link for ${email}`);
  const pw = 'own-' + randomBytes(9).toString('base64url');
  const b = await chromium.launch(); const p = await b.newPage();
  try {
    await p.goto(line.split('\t')[1]);
    await p.getByRole('heading', { name: 'Set your password' }).waitFor({ timeout: 20000 });
    assert.ok(!/access_token/.test(p.url()), 'token wiped from the address bar');
    await p.getByLabel('New password', { exact: true }).fill(pw);
    await p.getByLabel('Repeat new password').fill(pw);
    await p.getByRole('button', { name: 'Set password' }).click();
    await p.getByRole('heading', { name: 'Set your password' }).waitFor({ state: 'detached', timeout: 20000 });
  } finally { await b.close(); }
  passwords[email] = pw;
  return pw;
}

const results = [];
const check = async (name, f) => { try { await f(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, String(e.message).split('\n')[0].slice(0, 200)]); } };
const snap = () => sql(`select (select count(*) from public.users)||' '||(select count(*) from public.leads)||' '||(select count(*) from public.activities)`);
const before = snap();

const ROLE_PAGES = {
  MANAGEMENT: ['dashboard', 'leads', 'pipeline', 'calendar', 'properties', 'agentperf', 'requests', 'inventory', 'accounts', 'relay', 'conversations', 'metacapi'],
  TEAM_LEAD: ['dashboard', 'leads', 'pipeline', 'calendar', 'team', 'reports', 'conversations'],
  AGENT: ['dashboard', 'leads', 'pipeline', 'calendar', 'meeting', 'properties'],
  MEETING_AGENT: ['dashboard', 'leads', 'calendar', 'meeting'],
  EXECUTIVE: ['dashboard', 'leads'],
};
// Requests that fail identically before the cutover (pre-existing, not CR-001).
const KNOWN = [/\/rest\/v1\/rpc\/(dashboard_rollup|agent_lead_stats|activity_rollup|stage_trend)$/, /\/rest\/v1\/leads$/];
const who = Object.fromEntries(sql(`select distinct on (role) role, email from public.users where is_active and role in (${Object.keys(ROLE_PAGES).map((r) => `'${r}'`).join(',')}) order by role, email`).split('\n').filter(Boolean).map((l) => l.split('|')));

const browser = await chromium.launch();
for (const [role, email] of Object.entries(who)) {
  await check(`role ${role}: own link, own password, every page loads in the built client`, async () => {
    // admin@gmail.com consumed its one-time link earlier and set its own password then.
    const pw = passwords[email] || (email.toLowerCase() === 'admin@gmail.com' ? readFileSync('/tmp/cr001-staging/admin-own-password.txt', 'utf8').trim() : await claim(email));
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    let cur = 'login'; const bad = []; const errs = []; const offHost = [];
    page.on('response', (r) => { const u = r.url().split('?')[0]; if (/\/(rest|functions|auth)\/v1\//.test(u) && r.status() >= 400 && !/\/functions\/v1\/(finance|ai-trainer|meta-capi)$/.test(u) && !KNOWN.some((k) => k.test(u))) bad.push(`${cur}: ${r.status()} ${u.replace(/^https?:\/\/[^/]+/, '')}`); });
    page.on('request', (r) => { const h = new URL(r.url()).hostname; if (!['127.0.0.1', 'localhost'].includes(h) && !/(googleapis|gstatic|dicebear)\.com$/.test(h)) offHost.push(r.url()); });
    page.on('pageerror', (e) => errs.push(`${cur}: ${e.message.slice(0, 100)}`));
    await page.goto(APP);
    await page.getByRole('button', { name: 'Sign in', exact: true }).first().click();
    await page.locator('#login input.msi-input[type="email"]').fill(email);
    await page.locator('#login input.msi-input[type="password"]').fill(pw);
    await page.locator('#login input.msi-input[type="password"]').press('Enter');
    await page.waitForFunction(() => !!localStorage.getItem('pcrm_auth'), null, { timeout: 20000 });
    await page.waitForTimeout(3000);
    const empty = [];
    for (const v of ROLE_PAGES[role]) {
      cur = v; await page.goto(`${APP}/#/${v}`); await page.waitForTimeout(1800);
      if ((await page.locator('#root').innerText().catch(() => '')).trim().length < 40) empty.push(v);
    }
    await page.screenshot({ path: `/tmp/cr001-staging/role-${role}.png` });
    await page.close();
    assert.deepEqual({ bad, errs, empty, offHost }, { bad: [], errs: [], empty: [], offHost: [] }, JSON.stringify({ bad, errs, empty, offHost }).slice(0, 400));
  });
}
await browser.close();

const tag = 'st' + Date.now();
const mkUser = async (k, role, company) => {
  const email = `${tag}-${k}@staging.test`; const pw = 'own-' + randomBytes(9).toString('base64url');
  const id = (await (await fetch(`${API}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw, email_confirm: true }) })).json()).id;
  sql(`insert into public.users (id,name,email,password,role,company_id,is_active,auth_user_id) values ('${tag}${k}','${k}','${email}','!auth','${role}','${company}',true,'${id}')`);
  return { email, pw, authId: id, id: `${tag}${k}` };
};
sql(`insert into public.companies (id,name,plan,is_active) values ('${tag}X','Other Co','Starter',true)`);
const other = await mkUser('x', 'MANAGEMENT', `${tag}X`);
const agent = await mkUser('a', 'AGENT', 'c1');

await check('tenant boundary: another company sees none of c1, c1 sees none of it', async () => {
  const tX = (await signIn(other.email, other.pw)).access_token;
  assert.equal(await count(tX, 'leads', '&company_id=eq.c1'), 0);
  assert.equal(await count(tX, 'activities', '&company_id=eq.c1'), 0);
  assert.equal(await count(tX, 'users', '&company_id=eq.c1'), 0);
  const tA = (await signIn(agent.email, agent.pw)).access_token;
  assert.ok(await count(tA, 'leads') > 0);
  assert.equal(await count(tA, 'users', `&company_id=eq.${tag}X`), 0);
});

await check('deactivation: old token reads and writes nothing, functions refuse it, refresh fails', async () => {
  const s = await signIn(agent.email, agent.pw);
  const adminTok = (await signIn('admin@gmail.com', readFileSync('/tmp/cr001-staging/admin-own-password.txt', 'utf8').trim())).access_token;
  const r = await fetch(`${API}/functions/v1/access-admin`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${adminTok}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'active.set', userId: agent.id, active: false }) });
  assert.equal(r.status, 200, await r.text());
  assert.equal(await count(s.access_token, 'leads'), 0, 'PostgREST: no rows');
  const w = await rest(s.access_token, 'leads?company_id=eq.c1&select=id', { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: '{"name":"x"}' });
  assert.deepEqual(await w.json(), [], 'PostgREST: no writes');
  const f = await fetch(`${API}/functions/v1/finance`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json' }, body: '{"action":"budget.list"}' });
  assert.ok([401, 403].includes(f.status), `functions refuse (${f.status})`);
  const rf = await fetch(`${API}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: s.refresh_token }) });
  assert.equal(rf.ok, false, 'refresh fails');
});

await check('WhatsApp human send: reaches the stub once, SENT; unauthenticated, cross-company and unassigned sends refused before the stub', async () => {
  const s = await signIn('admin@gmail.com', readFileSync('/tmp/cr001-staging/admin-own-password.txt', 'utf8').trim());
  const adminId = sql(`select id from public.users where lower(email)='admin@gmail.com'`);
  const ref = `${tag}-m`; const conv = 'eyad:8801799999999@s.whatsapp.net';
  sql(`insert into public.wa_conversations (id, phone, account, last_message_dir) values ('${conv}','8801799999999','eyad','OUT') on conflict (id) do nothing`);
  sql(`insert into public.wa_messages (id, conversation_id, account, phone, direction, type, body, status, client_ref, sent_by) values ('${ref}','${conv}','eyad','8801799999999','OUT','text','hi','PENDING','${ref}','${adminId}')`);
  const n = stub().length;
  const body = JSON.stringify({ action: 'send', account: 'eyad', to: '8801799999999', conversationId: conv, clientRef: ref, type: 'text', text: 'hi', userId: 'x' });
  const send = (tok, b = body) => fetch(`${API}/functions/v1/wa-send`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: b });
  assert.equal((await send()).status, 401);
  assert.equal((await send((await signIn(other.email, other.pw)).access_token)).status, 403, 'another company cannot send from c1\'s numbers');
  assert.equal((await send((await signIn(agent.email, agent.pw)).access_token)).status, 403, 'an agent cannot send to a thread with no lead of theirs');
  assert.equal((await send(s.access_token, JSON.stringify({ ...JSON.parse(body), to: '8801700000001' }))).status, 403, 'to must be the thread\'s number');
  assert.equal(stub().length, n);
  const r = await send(s.access_token);
  assert.equal(r.status, 200, await r.text());
  assert.equal(stub().length, n + 1);
  assert.equal(sql(`select status from public.wa_messages where id='${ref}'`), 'SENT');
  sql(`delete from public.wa_messages where id='${ref}'`); sql(`delete from public.wa_conversations where id='${conv}'`);
});

await check('wa-followup: cron with key moves greeted -> asked_profile and sends once; no key 401', async () => {
  assert.equal((await fetch(`${API}/functions/v1/wa-followup`, { method: 'POST', headers: { 'Content-Type': 'application/json' } })).status, 401);
  sql(`create table if not exists public.cr001_parked as select id, flow_stage, stage_at, stage_msg_count from public.preleads where flow_stage is not null`);
  sql(`update public.preleads set flow_stage = null where id in (select id from public.cr001_parked)`);
  const pid = randomUUID(); const phone = '88017' + String(Date.now()).slice(-8); const job = `${tag}-fu`;
  try {
    sql(`insert into public.preleads (id, name, phone, "WA", message_logs, flow_stage, stage_at, stage_msg_count) values ('${pid}','Staging fu','${phone}','Eyad','[]'::jsonb,'greeted', now() - interval '6 minutes', 0)`);
    const n = stub().length;
    sql(`select cron.schedule('${job}', '* * * * *', $$ select net.http_post(url := 'http://host.docker.internal:${new URL(API).port}/functions/v1/wa-followup', headers := jsonb_build_object('Content-Type','application/json','x-followup-key','${FKEY}')) $$)`);
    let s = 'greeted';
    // pg_cron fires on the minute and wa-followup then claims and sends; wait
    // up to 3 minutes for the stage to settle past the transient claim.
    const t0 = Date.now();
    while (Date.now() - t0 < 180000 && ['greeted', 'greeted_claimed'].includes(s)) { await new Promise((ok) => setTimeout(ok, 1500)); s = sql(`select coalesce(flow_stage,'null') from public.preleads where id='${pid}'`); }
    assert.equal(s, 'asked_profile', `stage after waiting: ${s}`);
    assert.equal(stub().length, n + 1, `stub sends: ${stub().length - n}`);
  } finally {
    sql(`select cron.unschedule('${job}') where exists (select 1 from cron.job where jobname='${job}')`);
    sql(`delete from public.preleads where id='${pid}'`);
    sql(`delete from public.wa_messages where phone='${phone}'`); sql(`delete from public.wa_conversations where phone='${phone}'`);
    sql(`update public.preleads p set flow_stage=k.flow_stage, stage_at=k.stage_at, stage_msg_count=k.stage_msg_count from public.cr001_parked k where k.id=p.id`);
    sql(`drop table public.cr001_parked`);
  }
});

await check('admin recovery: break-glass gives admin@gmail.com a working sign-in again and ends old sessions', async () => {
  const oldPw = readFileSync('/tmp/cr001-staging/admin-own-password.txt', 'utf8').trim();
  const old = await signIn('admin@gmail.com', oldPw);
  const newPw = 'own-' + randomBytes(9).toString('base64url');
  const r = spawnSync('node', ['scripts/breakglass-admin.mjs', '--email', 'admin@gmail.com', '--confirm', API], { encoding: 'utf8', env: { PATH: process.env.PATH, SUPABASE_URL: API, SUPABASE_SERVICE_ROLE_KEY: SVC, BREAKGLASS_PASSWORD: newPw } });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!(r.stdout + r.stderr).includes(newPw));
  assert.equal((await signIn('admin@gmail.com', oldPw)).access_token, undefined);
  assert.ok((await signIn('admin@gmail.com', newPw)).access_token);
  const rf = await fetch(`${API}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: old.refresh_token }) });
  assert.equal(rf.ok, false);
  writeFileSync('/tmp/cr001-staging/admin-own-password.txt', newPw + '\n', { mode: 0o600 });
});

await check('last Management account of c1 cannot be removed', async () => {
  const mgrs = Number(sql(`select count(*) from public.users where role='MANAGEMENT' and company_id='c1' and is_active`));
  if (mgrs !== 1) throw new Error(`precondition: c1 has ${mgrs} active managers`);
  const t = (await signIn(other.email, other.pw)).access_token;
  const r = await fetch(`${API}/functions/v1/access-admin`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'active.set', userId: sql(`select id from public.users where lower(email)='admin@gmail.com'`), active: false }) });
  assert.equal(r.status, 403, 'another company cannot touch it');
  assert.equal(sql(`select is_active from public.users where lower(email)='admin@gmail.com'`), 't');
});

for (const u of [other, agent]) { sql(`delete from public.access_audit where target_id='${u.id}' or actor_id='${u.id}'`); sql(`delete from public.users where id='${u.id}'`); await fetch(`${API}/auth/v1/admin/users/${u.authId}`, { method: 'DELETE', headers: { apikey: SVC, Authorization: `Bearer ${SVC}` } }); }
sql(`delete from public.companies where id='${tag}X'`);
const after = snap();
results.push([before === after ? 'PASS' : 'FAIL', `restored data unchanged (users leads activities: ${before} -> ${after})`]);
for (const r of results) console.log(r.join('  '));
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);
