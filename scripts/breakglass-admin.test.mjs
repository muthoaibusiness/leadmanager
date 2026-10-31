// node scripts/breakglass-admin.test.mjs — admin recovery (CR-001 D1 break-glass)
// against the isolated local stack only (CR001_* env, loopback URLs). Needs
// migration 0054 applied. Throwaway rows and sign-ins are removed at the end.
//   * Every Management account locked out (no sign-in, or the password lost):
//     scripts/breakglass-admin.mjs, run by an operator holding the service
//     role, gives the named Management account a working sign-in.
//   * It refuses without --confirm <the exact Supabase URL>, refuses a
//     non-Management or unknown account, and never prints the password.
//   * Re-running it resets the password and revokes every older session.
//   * It never writes users.password, role or access.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';

const API = process.env.CR001_API_URL; const DB = process.env.CR001_DB_URL;
const ANON = process.env.CR001_ANON_KEY; const SVC = process.env.CR001_SERVICE_ROLE_KEY;
if (!API || !DB || !ANON || !SVC) throw new Error('set CR001_* (local stack only)');
for (const u of [API, DB]) if (!['127.0.0.1', 'localhost'].includes(new URL(u.replace(/^postgres(ql)?:/, 'http:')).hostname)) throw new Error(`refusing ${u}`);
const sql = (q) => execFileSync('psql', [DB, '-v', 'ON_ERROR_STOP=1', '-Atqc', q], { encoding: 'utf8' }).trim();
const run = (args, pw) => spawnSync('node', ['scripts/breakglass-admin.mjs', ...args], {
  encoding: 'utf8', env: { PATH: process.env.PATH, SUPABASE_URL: API, SUPABASE_SERVICE_ROLE_KEY: SVC, ...(pw ? { BREAKGLASS_PASSWORD: pw } : {}) },
});
const signIn = async (e, p) => (await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e, password: p }) })).json();

const tag = 'bg' + Date.now();
const email = `${tag}@local.test`;
const pw = 'recovered-' + tag;
// The state of every account right after migration 0054: a Management row with no sign-in.
sql(`insert into public.users (id,name,email,password,role,company_id,is_active,allowed_features) values
  ('${tag}','Locked Admin','${email}','old-plain','MANAGEMENT','c1',true,'["leads"]'),
  ('${tag}a','Agent','${tag}a@local.test','x','AGENT','c1',true,null)`);

let r = run(['--email', email], pw);
assert.notEqual(r.status, 0); assert.match(r.stderr, /--confirm/, 'needs --confirm');
r = run(['--email', email, '--confirm', 'https://other.example'], pw);
assert.notEqual(r.status, 0); assert.match(r.stderr, /does not match/, 'confirm must equal SUPABASE_URL');
r = run(['--email', email, '--confirm', API]);
assert.notEqual(r.status, 0); assert.match(r.stderr, /BREAKGLASS_PASSWORD/, 'password comes from the environment only');
r = run(['--email', email, '--confirm', API], 'short');
assert.notEqual(r.status, 0); assert.match(r.stderr, /10 characters/);
r = run(['--email', `${tag}a@local.test`, '--confirm', API], pw);
assert.notEqual(r.status, 0); assert.match(r.stderr, /not a Management account/);
r = run(['--email', `nobody-${tag}@local.test`, '--confirm', API], pw);
assert.notEqual(r.status, 0); assert.match(r.stderr, /No CRM account/);

r = run(['--email', email, '--confirm', API], pw);
assert.equal(r.status, 0, r.stderr);
assert.ok(!(r.stdout + r.stderr).includes(pw), 'the password is never printed');
assert.match(r.stdout, /created and linked/);
const s1 = await signIn(email, pw);
assert.ok(s1.access_token, 'the recovered admin signs in');
assert.equal(sql(`select auth_user_id is not null and is_active from public.users where id='${tag}'`), 't');
assert.equal(sql(`select password from public.users where id='${tag}'`), 'old-plain', 'users.password untouched');
assert.equal(sql(`select role || ' ' || allowed_features::text from public.users where id='${tag}'`), 'MANAGEMENT ["leads"]', 'role and access untouched');
// A Management account is admin whatever its saved list (access-rules.js).
const users = await (await fetch(`${API}/rest/v1/users?select=id&id=like.${tag}*`, { headers: { apikey: ANON, Authorization: `Bearer ${s1.access_token}` } })).json();
assert.equal(users.length, 2, 'the recovered admin reads its company');

const pw2 = pw + '-2';
r = run(['--email', email, '--confirm', API], pw2);
assert.equal(r.status, 0, r.stderr);
assert.match(r.stdout, /password reset/);
assert.equal((await signIn(email, pw)).access_token, undefined, 'old password no longer works');
assert.ok((await signIn(email, pw2)).access_token, 'new password works');
const refresh = await fetch(`${API}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: s1.refresh_token }) });
assert.equal(refresh.ok, false, 'the session from before the reset cannot refresh');

// An inactive admin is reactivated: recovery must yield a usable account.
sql(`update public.users set is_active=false where id='${tag}'`);
r = run(['--email', email, '--confirm', API], pw2);
assert.equal(r.status, 0, r.stderr);
assert.equal(sql(`select is_active from public.users where id='${tag}'`), 't');
assert.match(r.stdout, /reactivated/);

const authId = sql(`select auth_user_id from public.users where id='${tag}'`);
sql(`delete from public.users where id like '${tag}%'`);
await fetch(`${API}/auth/v1/admin/users/${authId}`, { method: 'DELETE', headers: { apikey: SVC, Authorization: `Bearer ${SVC}` } });
console.log('breakglass-admin PASS: refuses without exact confirm / weak password / non-Management; recovers a locked-out admin; reset revokes old sessions; reactivates; never prints or stores the password');
