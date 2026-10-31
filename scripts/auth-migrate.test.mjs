// node scripts/auth-migrate.test.mjs — the account migration (plan §8.4) on the
// isolated local stack only (CR001_* env, loopback). Throwaway rows only.
//   * dry run (default): reports what it would do, writes nothing
//   * --apply: one Auth user per active CRM account without a sign-in, with NO
//     usable password (no shared test password, nothing carried over), linked
//     by auth_user_id; each user gets a one-time recovery link to set their own
//   * the links are written only to a 0600 file, never to stdout
//   * already-linked accounts and inactive accounts are left alone
//   * a re-run is a no-op; an email already in Auth is linked, not duplicated
//   * users.password is never read or written
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, statSync, rmSync, existsSync } from 'node:fs';

const API = process.env.CR001_API_URL; const DB = process.env.CR001_DB_URL;
const ANON = process.env.CR001_ANON_KEY; const SVC = process.env.CR001_SERVICE_ROLE_KEY;
if (!API || !DB) throw new Error('set CR001_* (local stack only)');
for (const u of [API, DB]) if (!['127.0.0.1', 'localhost'].includes(new URL(u.replace(/^postgres(ql)?:/, 'http:')).hostname)) throw new Error(`refusing ${u}`);
const sql = (q) => execFileSync('psql', [DB, '-v', 'ON_ERROR_STOP=1', '-Atqc', q], { encoding: 'utf8' }).trim();
const OUT = '/tmp/cr001-sb/auth-links.tsv';
const run = (args) => spawnSync('node', ['scripts/auth-migrate.mjs', ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, SUPABASE_URL: API, SUPABASE_SERVICE_ROLE_KEY: SVC } });
const admin = (path, init = {}) => fetch(`${API}/auth/v1/admin/${path}`, { ...init, headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });

const tag = 'am' + Date.now();
const co = `${tag}C`;
sql(`insert into public.companies (id,name,plan,is_active) values ('${co}','Migrate Co','Starter',true)`);
sql(`insert into public.users (id,name,email,password,role,company_id,is_active) values
  ('${tag}1','One','${tag}-1@local.test','old-plaintext-1','AGENT','${co}',true),
  ('${tag}2','Two','${tag}-2@LOCAL.test','old-plaintext-2','MANAGEMENT','${co}',true),
  ('${tag}3','Gone','${tag}-3@local.test','old-plaintext-3','AGENT','${co}',false)`);
// An Auth user that already exists for account 2's email (e.g. made by break-glass), not yet linked.
const pre = (await (await admin('users', { method: 'POST', body: JSON.stringify({ email: `${tag}-2@local.test`, password: 'pre-existing-' + tag, email_confirm: true }) })).json()).id;
if (existsSync(OUT)) rmSync(OUT);

try {
  let r = run(['--company', co, '--confirm', API]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /DRY RUN/); assert.match(r.stdout, /would create 1, link 1, skip 1 inactive/);
  assert.equal(sql(`select count(*) from public.users where id like '${tag}%' and auth_user_id is not null`), '0', 'dry run writes nothing');
  assert.ok(!existsSync(OUT));

  r = run(['--company', co, '--apply', '--out', OUT]);
  assert.notEqual(r.status, 0, 'apply without --confirm is refused'); assert.match(r.stderr, /--confirm/);

  r = run(['--company', co, '--apply', '--confirm', API, '--out', OUT, '--redirect', 'http://127.0.0.1:5174/']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /created 1, linked 1, skipped 1 inactive/);
  assert.ok(!/token=|access_token|#/.test(r.stdout), 'no link on stdout');
  assert.equal((statSync(OUT).mode & 0o777).toString(8), '600', 'links file is 0600');
  const lines = readFileSync(OUT, 'utf8').trim().split('\n');
  assert.equal(lines.length, 2, 'one link per migrated account');
  for (const l of lines) assert.match(l, /^[^\t]+@local\.test\t\S+$/i);

  assert.equal(sql(`select string_agg(id || '=' || (auth_user_id is not null)::text, ',' order by id) from public.users where id like '${tag}%'`), `${tag}1=true,${tag}2=true,${tag}3=false`);
  assert.equal(sql(`select auth_user_id::text from public.users where id='${tag}2'`), pre, 'existing Auth user linked, not duplicated');
  assert.equal(sql(`select count(*) from auth.users where lower(email) like '${tag}-%'`), '2');
  assert.equal(sql(`select string_agg(password, ',' order by id) from public.users where id like '${tag}%'`), 'old-plaintext-1,old-plaintext-2,old-plaintext-3', 'users.password untouched');

  // The new account has no usable password: neither its old plaintext nor anything shared works.
  for (const p of ['old-plaintext-1', 'local-only', '1234', '']) {
    const t = await (await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${tag}-1@local.test`, password: p }) })).json();
    assert.equal(t.access_token, undefined, `no sign-in with "${p}"`);
  }
  // The recovery link is a real one-time link from GoTrue.
  assert.match(lines.find((l) => l.startsWith(`${tag}-1@`)).split('\t')[1], /^http:\/\/127\.0\.0\.1:56401\/auth\/v1\/verify\?token=/);

  r = run(['--company', co, '--apply', '--confirm', API, '--out', OUT]);
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /created 0, linked 0, skipped 1 inactive, already linked 2/);
  console.log('auth-migrate PASS: dry run writes nothing; apply needs --confirm; no usable password and no shared password; existing Auth user linked not duplicated; inactive skipped; links only in a 0600 file; re-run is a no-op; users.password untouched');
} finally {
  const ids = sql(`select coalesce(string_agg(id::text, ','), '') from auth.users where lower(email) like '${tag}-%'`).split(',').filter(Boolean);
  for (const id of ids) await admin(`users/${id}`, { method: 'DELETE' });
  sql(`delete from public.users where id like '${tag}%'`); sql(`delete from public.companies where id='${co}'`);
  if (existsSync(OUT)) rmSync(OUT);
}
