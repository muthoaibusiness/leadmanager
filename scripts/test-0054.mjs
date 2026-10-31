// node scripts/test-0054.mjs — migration 0054 and its rollback against an
// isolated local Supabase stack. Needs CR001_API_URL, CR001_DB_URL,
// CR001_ANON_KEY and CR001_SERVICE_ROLE_KEY from `supabase status -o env` of
// that stack. Refuses any non-loopback URL. Creates throwaway Auth users and
// CRM rows, checks what anon and a signed-in account can do, rolls back,
// checks again.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const API = process.env.CR001_API_URL;
const DB = process.env.CR001_DB_URL;
if (!API || !DB) throw new Error('set CR001_API_URL and CR001_DB_URL (local stack only)');
for (const u of [API, DB]) if (!['127.0.0.1', 'localhost'].includes(new URL(u.replace(/^postgres(ql)?:/, 'http:')).hostname)) throw new Error(`refusing non-local target ${u}`);
const keys = { anon: process.env.CR001_ANON_KEY, svc: process.env.CR001_SERVICE_ROLE_KEY };
const sql = (q) => execFileSync('psql', [DB, '-v', 'ON_ERROR_STOP=1', '-Atqc', q], { encoding: 'utf8' }).trim();
const file = (f) => execFileSync('psql', [DB, '-v', 'ON_ERROR_STOP=1', '-q', '-f', f], { encoding: 'utf8' });
const H = (tok) => ({ apikey: keys.anon, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' });
const rest = (tok, path, init = {}) => fetch(`${API}/rest/v1/${path}`, { ...init, headers: { ...H(tok), Prefer: 'return=representation', ...(init.headers || {}) } });

async function authUser(email, password) {
  const r = await fetch(`${API}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: keys.svc, Authorization: `Bearer ${keys.svc}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, email_confirm: true }) });
  const j = await r.json(); assert.ok(j.id, `auth user ${email}: ${JSON.stringify(j)}`); return j.id;
}
async function signIn(email, password) {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: keys.anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const j = await r.json(); assert.ok(j.access_token, `sign in ${email}`); return j.access_token;
}

const tag = 't0054' + Date.now();
const pw = 'local-only-' + tag;
sql(`delete from public.users where id like 't0054%'`);
const aMgr = await authUser(`${tag}-m@local.test`, pw);
const aAg = await authUser(`${tag}-a@local.test`, pw);
const aOther = await authUser(`${tag}-o@local.test`, pw);

file('supabase/migrations/0054_auth_users_link_and_lockdown.sql');
sql(`insert into public.users (id,name,email,password,role,company_id,is_active,auth_user_id) values
  ('${tag}m','M','${tag}-m@local.test','x','MANAGEMENT','c1',true,'${aMgr}'),
  ('${tag}a','A','${tag}-a@local.test','x','AGENT','c1',true,'${aAg}'),
  ('${tag}o','O','${tag}-o@local.test','x','AGENT','c2',true,'${aOther}')`);

// anon: nothing at all.
let r = await rest(keys.anon, `users?select=id&id=like.${tag}*`);
assert.equal(r.status, 401, 'anon cannot read users');
r = await rest(keys.anon, `users?id=eq.${tag}a`, { method: 'PATCH', body: JSON.stringify({ role: 'MANAGEMENT' }) });
assert.ok([401, 403].includes(r.status), 'anon cannot write users');
r = await rest(keys.anon, 'users', { method: 'POST', body: JSON.stringify({ id: tag + 'x', name: 'x', email: 'x@x', password: 'x', role: 'MANAGEMENT' }) });
assert.ok([401, 403].includes(r.status), 'anon cannot insert users');

const tMgr = await signIn(`${tag}-m@local.test`, pw);
const tAg = await signIn(`${tag}-a@local.test`, pw);

// password column is not readable by a signed-in account either.
r = await rest(tMgr, `users?select=password&id=eq.${tag}a`);
assert.ok([401, 403].includes(r.status), `password column hidden (got ${r.status})`);

// tenant scope: c1 sees c1, not c2.
r = await rest(tMgr, `users?select=id&id=like.${tag}*&order=id`);
assert.deepEqual((await r.json()).map((x) => x.id), [`${tag}a`, `${tag}m`]);

// self-escalation: an agent cannot change its own role or features...
r = await rest(tAg, `users?id=eq.${tag}a`, { method: 'PATCH', body: JSON.stringify({ role: 'MANAGEMENT' }) });
assert.ok([401, 403].includes(r.status), `role not writable (got ${r.status})`);
r = await rest(tAg, `users?id=eq.${tag}a`, { method: 'PATCH', body: JSON.stringify({ allowed_features: ['accounts'] }) });
assert.ok([401, 403].includes(r.status), 'features not writable');
// ...nor touch someone else's row; it may edit its own profile fields. The
// returned row must name its columns: `select=*` would include password.
r = await rest(tAg, `users?id=eq.${tag}m&select=id,name`, { method: 'PATCH', body: JSON.stringify({ name: 'pwned' }) });
assert.deepEqual(await r.json(), [], 'other row: zero rows changed');
assert.equal(sql(`select name from public.users where id='${tag}m'`), 'M');
r = await rest(tAg, `users?id=eq.${tag}a&select=id,phone`, { method: 'PATCH', body: JSON.stringify({ phone: '+8801' }) });
assert.equal((await r.json())[0]?.phone, '+8801', 'own phone is editable');
assert.equal(sql(`select role from public.users where id='${tag}a'`), 'AGENT');
r = await rest(tMgr, 'access_audit?select=id');
assert.ok([401, 403].includes(r.status), `access_audit is service-role only (got ${r.status})`);
console.log('0054 applied: anon locked out, password hidden, tenant scope and self-only profile edits hold');

file('supabase/ops/0054_rollback.sql');
r = await rest(keys.anon, `users?select=id&id=like.${tag}*`);
assert.equal(r.status, 200, 'rollback: anon reads again');
assert.equal(sql(`select relrowsecurity from pg_class where oid='public.users'::regclass`), 'f');
assert.equal(sql(`select count(*) from public.users where id like '${tag}%' and auth_user_id is not null`), '3', 'rollback keeps the Auth links');
console.log('0054 rollback: users back to the 0053 state, links kept');

// Re-apply is idempotent, then leave the stack in the 0054 state for the app tests.
file('supabase/migrations/0054_auth_users_link_and_lockdown.sql');
file('supabase/migrations/0054_auth_users_link_and_lockdown.sql');
sql(`delete from public.users where id like '${tag}%'`);
for (const id of [aMgr, aAg, aOther]) await fetch(`${API}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: { apikey: keys.svc, Authorization: `Bearer ${keys.svc}` } });
console.log('0054 re-apply twice: ok. test-0054 PASS');
