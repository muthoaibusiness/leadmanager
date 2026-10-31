// node scripts/cr001-roles-ui.mjs — signs in as one real account per role on
// the local restored copy (127.0.0.1:5174 against the isolated stack, with
// 0053-0055 applied) and opens the pages that role uses. Read-only: it clicks
// nothing that saves. Reports, per role and page, failed Supabase requests
// (4xx/5xx) and page errors. Local stack only; the password is the local test
// password in /tmp/cr001-sb/local-test-password.txt.
import { readFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const { chromium } = await import(`${process.env.PLAYWRIGHT_DIR}/playwright/index.mjs`);
const DB = process.env.CR001_DB_URL; const APP = 'http://127.0.0.1:5174';
for (const u of [DB, APP]) if (!['127.0.0.1', 'localhost'].includes(new URL(u.replace(/^postgres(ql)?:/, 'http:')).hostname)) throw new Error(`refusing ${u}`);
const pw = readFileSync('/tmp/cr001-sb/local-test-password.txt', 'utf8').trim();
const sql = (q) => execFileSync('psql', [DB, '-Atqc', q], { encoding: 'utf8' }).trim();
mkdirSync('/tmp/cr001-ui/roles', { recursive: true });

const PAGES = {
  MANAGEMENT: ['dashboard', 'leads', 'pipeline', 'calendar', 'properties', 'agentperf', 'requests', 'inventory', 'accounts', 'relay', 'conversations', 'metacapi'],
  TEAM_LEAD: ['dashboard', 'leads', 'pipeline', 'calendar', 'team', 'reports', 'conversations'],
  AGENT: ['dashboard', 'leads', 'pipeline', 'calendar', 'meeting', 'properties'],
  MEETING_AGENT: ['dashboard', 'leads', 'calendar', 'meeting'],
  EXECUTIVE: ['dashboard', 'leads'],
};
const who = Object.fromEntries(sql(`select distinct on (role) role, email from public.users where is_active and role in (${Object.keys(PAGES).map((r) => `'${r}'`).join(',')}) order by role, email`).split('\n').filter(Boolean).map((l) => l.split('|')));

const browser = await chromium.launch();
const report = [];
for (const [role, email] of Object.entries(who)) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  let cur = 'login'; const bad = []; const errs = [];
  page.on('response', (r) => { const u = r.url(); if (/\/(rest|functions|auth)\/v1\//.test(u) && r.status() >= 400 && !/\/functions\/v1\/(finance|ai-trainer|meta-capi)/.test(u)) bad.push(`${cur}: ${r.request().method()} ${r.status()} ${u.replace(/^https?:\/\/[^/]+/, '').split('?')[0]}`); });
  page.on('pageerror', (e) => errs.push(`${cur}: ${e.message.slice(0, 120)}`));
  await page.goto(APP);
  await page.getByRole('button', { name: 'Sign in', exact: true }).first().click();
  await page.locator('#login input.msi-input[type="email"]').fill(email);
  await page.locator('#login input.msi-input[type="password"]').fill(pw);
  await page.locator('#login input.msi-input[type="password"]').press('Enter');
  const ok = await page.waitForFunction(() => !!localStorage.getItem('pcrm_auth'), null, { timeout: 20000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(3500);
  const opened = [];
  if (ok) for (const v of PAGES[role]) {
    cur = v; await page.goto(`${APP}/#/${v}`); await page.waitForTimeout(2200);
    opened.push(`${v}:${(await page.locator('main, #root').first().innerText().catch(() => '')).trim().length > 40 ? 'ok' : 'EMPTY'}`);
  }
  await page.screenshot({ path: `/tmp/cr001-ui/roles/${role}.png` });
  report.push({ role, signedIn: ok, pages: opened, failedRequests: [...new Set(bad)], pageErrors: errs });
  await page.close();
}
await browser.close();
for (const r of report) {
  console.log(`${r.role.padEnd(14)} signedIn=${r.signedIn} pages=${r.pages.join(' ')}`);
  for (const b of r.failedRequests) console.log(`   FAILED ${b}`);
  for (const e of r.pageErrors) console.log(`   PAGEERROR ${e}`);
}
const failures = report.filter((r) => !r.signedIn || r.failedRequests.length || r.pageErrors.length || r.pages.some((p) => p.endsWith('EMPTY'))).length;
console.log(`\n${report.length - failures}/${report.length} roles clean`);
process.exit(failures ? 1 : 0);
