// node scripts/cr001-ui-snapshot.mjs — saves the rendered Users & Accounts ›
// Access tab, with its CSS inlined and scripts removed, to
// /tmp/cr001-ui/states/access-tab.html, so the state-contrast gate
// (verify_states.mjs, file:// only) can measure the real UI. Local stack only
// (CR001_* env); throwaway accounts are removed at the end.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const { chromium } = await import(`${process.env.PLAYWRIGHT_DIR}/playwright/index.mjs`);
const API = process.env.CR001_API_URL; const DB = process.env.CR001_DB_URL; const SVC = process.env.CR001_SERVICE_ROLE_KEY;
const APP = 'http://127.0.0.1:5174';
for (const u of [API, DB, APP]) if (!['127.0.0.1', 'localhost'].includes(new URL(u.replace(/^postgres(ql)?:/, 'http:')).hostname)) throw new Error(`refusing ${u}`);
const sql = (q) => execFileSync('psql', [DB, '-v', 'ON_ERROR_STOP=1', '-Atqc', q], { encoding: 'utf8' }).trim();
const tag = 'snap' + Date.now(); const pw = 'local-only-' + tag;
const mk = async (k) => (await (await fetch(`${API}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${tag}-${k}@local.test`, password: pw, email_confirm: true }) })).json()).id;
const ids = [await mk('m'), await mk('a')];
sql(`insert into public.users (id,name,email,password,role,company_id,is_active,auth_user_id) values
  ('${tag}m','Admin','${tag}-m@local.test','x','MANAGEMENT','${tag}c',true,'${ids[0]}'),
  ('${tag}a','Agent','${tag}-a@local.test','x','AGENT','${tag}c',true,'${ids[1]}')`);
try {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  await p.goto(APP);
  await p.getByRole('button', { name: 'Sign in', exact: true }).first().click();
  await p.locator('#login input.msi-input[type="email"]').fill(`${tag}-m@local.test`);
  await p.locator('#login input.msi-input[type="password"]').fill(pw);
  await p.locator('#login input.msi-input[type="password"]').press('Enter');
  await p.waitForFunction(() => !!localStorage.getItem('pcrm_auth'), null, { timeout: 20000 });
  await p.goto(`${APP}/#/accounts`);
  await p.getByRole('tab', { name: 'Access' }).click();
  await p.getByText('Feature access').waitFor();
  await p.waitForTimeout(800);
  const html = await p.evaluate(() => {
    const css = [...document.styleSheets].map((s) => { try { return [...s.cssRules].map((r) => r.cssText).join('\n'); } catch { return ''; } }).join('\n');
    const root = document.documentElement.cloneNode(true);
    root.querySelectorAll('script, link[rel="stylesheet"], style').forEach((n) => n.remove());
    const st = document.createElement('style'); st.textContent = css; root.querySelector('head').appendChild(st);
    return '<!doctype html>' + root.outerHTML;
  });
  mkdirSync('/tmp/cr001-ui/states', { recursive: true });
  writeFileSync('/tmp/cr001-ui/states/access-tab.html', html);
  await b.close();
  console.log(`saved /tmp/cr001-ui/states/access-tab.html (${html.length} bytes)`);
} finally {
  sql(`delete from public.users where id like '${tag}%'`);
  for (const id of ids) await fetch(`${API}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: { apikey: SVC, Authorization: `Bearer ${SVC}` } });
}
