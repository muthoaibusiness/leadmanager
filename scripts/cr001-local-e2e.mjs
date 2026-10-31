// node scripts/cr001-local-e2e.mjs — CR-001 D1 against the isolated local
// stack only (CR001_* env from that stack's `supabase status -o env`; loopback
// URLs only). Needs migration 0054 applied and `supabase functions serve` with
// empty provider tokens, so wa-send cannot reach Wasender and nothing is sent.
// Creates throwaway Auth users and CRM rows, removes them at the end.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const API = process.env.CR001_API_URL; const DB = process.env.CR001_DB_URL;
const ANON = process.env.CR001_ANON_KEY; const SVC = process.env.CR001_SERVICE_ROLE_KEY;
if (!API || !DB || !ANON || !SVC) throw new Error('set CR001_* (local stack only)');
for (const u of [API, DB]) if (!['127.0.0.1', 'localhost'].includes(new URL(u.replace(/^postgres(ql)?:/, 'http:')).hostname)) throw new Error(`refusing ${u}`);

const sql = (q) => execFileSync('psql', [DB, '-v', 'ON_ERROR_STOP=1', '-Atqc', q], { encoding: 'utf8' }).trim();
const fn = (name, body, tok) => fetch(`${API}/functions/v1/${name}`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify(body) });
const rest = (path, tok, init = {}) => fetch(`${API}/rest/v1/${path}`, { ...init, headers: { apikey: ANON, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
const signIn = async (email, password) => (await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })).json();
const authUser = async (email, password) => (await (await fetch(`${API}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, email_confirm: true }) })).json()).id;

// `supabase functions serve` reloads its workers after a code change and the
// gateway answers 502 meanwhile, even while OPTIONS already succeeds. Wait
// until an unauthenticated POST gets the function's own 401, three in a row.
for (const name of ['access-admin', 'finance', 'ai-trainer', 'wa-send']) {
  let streak = 0;
  for (let i = 0; streak < 3; i++) {
    const r = await fetch(`${API}/functions/v1/${name}`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: '{"action":"send"}' });
    // 429 is ai-trainer's per-IP lockout after earlier refusals: also its own answer.
    streak = r.status === 401 || r.status === 429 ? streak + 1 : 0;
    if (i > 120) throw new Error(`${name} not ready (HTTP ${r.status})`);
    await new Promise((ok) => setTimeout(ok, 500));
  }
}

const results = [];
const check = async (name, f) => { try { await f(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]); } };

const tag = 'e2e' + Date.now();
const pw = 'local-only-' + tag;
const em = (k) => `${tag}-${k}@local.test`;
const ids = { mgr: await authUser(em('m'), pw), ag: await authUser(em('a'), pw), other: await authUser(em('o'), pw) };
sql(`insert into public.users (id,name,email,password,role,company_id,team_id,is_active,auth_user_id) values
  ('${tag}m','Mgr','${em('m')}','x','MANAGEMENT','c1',null,true,'${ids.mgr}'),
  ('${tag}m2','Mgr2','${tag}-m2@local.test','x','MANAGEMENT','c1',null,true,null),
  ('${tag}a','Ag','${em('a')}','x','AGENT','c1','t1',true,'${ids.ag}'),
  ('${tag}o','Other','${em('o')}','x','MANAGEMENT','c2',null,true,'${ids.other}')`);
const tMgr = (await signIn(em('m'), pw)).access_token;
const sAg = await signIn(em('a'), pw);
const tOther = (await signIn(em('o'), pw)).access_token;

await check('login: right password signs in, wrong one does not', async () => {
  assert.ok(tMgr);
  assert.equal((await signIn(em('m'), 'wrong-password')).access_token, undefined);
});
await check('refresh: a refresh token yields a new access token', async () => {
  const r = await (await fetch(`${API}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: sAg.refresh_token }) })).json();
  assert.ok(r.access_token); sAg.refresh_token = r.refresh_token;
});
await check('anon key: users unreadable, unwritable', async () => {
  assert.equal((await rest(`users?select=id&id=eq.${tag}m`, ANON)).status, 401);
  assert.ok([401, 403].includes((await rest(`users?id=eq.${tag}a`, ANON, { method: 'PATCH', body: '{"role":"MANAGEMENT"}' })).status));
});
await check('forged userId in body without a session: access-admin, finance, ai-trainer, wa-send all 401', async () => {
  for (const [name, body] of [['access-admin', { action: 'features.set', userId: `${tag}a`, features: ['accounts'] }], ['finance', { userId: `${tag}m`, action: 'budget.list' }], ['ai-trainer', { user_id: `${tag}m`, action: 'items.list' }], ['wa-send', { action: 'send', userId: `${tag}m`, to: '1', clientRef: 'x', conversationId: 'x' }]]) {
    // ai-trainer locks an IP out (429) after 10 refused sign-ins in 10 minutes;
    // every local run shares one IP, so 429 is the same refusal.
    for (const tok of [undefined, ANON]) {
      const st = (await fn(name, body, tok)).status;
      assert.ok(st === 401 || (name === 'ai-trainer' && st === 429), `${name} ${tok ? 'anon' : 'none'}: ${st}`);
    }
  }
});
await check("agent's real session claiming the manager's id: still the agent (403/401)", async () => {
  const t = (await signIn(em('a'), pw)).access_token;
  // An agent is no account manager, so even its own row is refused before the self rule.
  assert.equal((await fn('access-admin', { action: 'features.set', userId: `${tag}a`, features: ['accounts'] }, t)).status, 403, 'self-grant refused');
  assert.equal(sql(`select allowed_features is null from public.users where id='${tag}a'`), 't', 'nothing written');
  assert.equal((await fn('finance', { userId: `${tag}m`, action: 'budget.list' }, t)).status, 403);
  assert.ok([401, 429].includes((await fn('ai-trainer', { user_id: `${tag}m`, action: 'items.list' }, t)).status));
});
await check('wa-send set-credentials is 410 (CR-001 CR-3)', async () => {
  assert.equal((await fn('wa-send', { action: 'set-credentials', apiToken: 'x' }, tMgr)).status, 410);
});
await check('feature grant/revoke persists: read back by a fresh session', async () => {
  let r = await (await fn('access-admin', { action: 'features.set', userId: `${tag}a`, features: ['leads', 'calendar'] }, tMgr)).json();
  assert.deepEqual(r.user.allowed_features, ['leads', 'calendar']);
  const t = (await signIn(em('a'), pw)).access_token;
  assert.deepEqual((await (await rest(`users?select=allowed_features&id=eq.${tag}a`, t)).json())[0].allowed_features, ['leads', 'calendar']);
  r = await (await fn('access-admin', { action: 'features.set', userId: `${tag}a`, features: null }, tMgr)).json();
  assert.equal(r.user.allowed_features, null);
  assert.equal(sql(`select allowed_features is null from public.users where id='${tag}a'`), 't');
  assert.ok(+sql(`select count(*) from public.access_audit where target_id='${tag}a'`) >= 2, 'audited');
});
await check('cross-tenant: c2 manager cannot touch a c1 account', async () => {
  assert.equal((await fn('access-admin', { action: 'features.set', userId: `${tag}a`, features: [] }, tOther)).status, 403);
});
await check('zero-row PATCH: agent editing another row changes nothing and gets []', async () => {
  const t = (await signIn(em('a'), pw)).access_token;
  const r = await rest(`users?id=eq.${tag}m&select=id`, t, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: '{"name":"pwned"}' });
  assert.deepEqual(await r.json(), []);
  assert.equal(sql(`select name from public.users where id='${tag}m'`), 'Mgr');
});
await check('own profile edit allowed; own role/features not', async () => {
  const t = (await signIn(em('a'), pw)).access_token;
  assert.equal((await (await rest(`users?id=eq.${tag}a&select=phone`, t, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: '{"phone":"+8800"}' })).json())[0]?.phone, '+8800');
  assert.ok([401, 403].includes((await rest(`users?id=eq.${tag}a`, t, { method: 'PATCH', body: '{"role":"MANAGEMENT"}' })).status));
});
await check('Management is admin: creates a Management account that can sign in', async () => {
  const r = await fn('access-admin', { action: 'create', name: 'New Boss', email: em('nb'), role: 'MANAGEMENT', password: pw }, tMgr);
  assert.equal(r.status, 200);
  assert.ok((await signIn(em('nb'), pw)).access_token);
  assert.equal(sql(`select password from public.users where email='${em('nb')}'`), '!auth', 'no real password stored in users');
});
await check('deactivate: session can no longer refresh, account blocked', async () => {
  const s = await signIn(em('a'), pw);
  assert.equal((await fn('access-admin', { action: 'active.set', userId: `${tag}a`, active: false }, tMgr)).status, 200);
  const r = await fetch(`${API}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: s.refresh_token }) });
  assert.equal(r.ok, false);
  // Edge Functions ask GoTrue, which refuses a token whose session was revoked (401).
  const fin = await fn('finance', { action: 'budget.list' }, s.access_token);
  assert.ok([401, 403].includes(fin.status), `deactivated account's token refused by functions (got ${fin.status})`);
  // PostgREST checks only the JWT signature until it expires; the users policy
  // still hides every row from an inactive account.
  assert.deepEqual(await (await rest(`users?select=id&id=like.${tag}*`, s.access_token)).json(), [], 'inactive account reads no users');
});
await check('last Management account of a company cannot be removed', async () => {
  sql(`update public.users set is_active=false where id in ('${tag}m2') or email='${em('nb')}'`);
  assert.equal((await fn('access-admin', { action: 'delete', userId: `${tag}m` }, tOther)).status, 403, 'other tenant');
  // the only manager left in c1 is the caller itself: self-delete is refused too
  assert.equal((await fn('access-admin', { action: 'delete', userId: `${tag}m` }, tMgr)).status, 409);
});

// cleanup
const authIds = sql(`select coalesce(string_agg(auth_user_id::text, ','), '') from public.users where id like '${tag}%' or email like '${tag}%'`).split(',').filter(Boolean);
sql(`delete from public.access_audit where target_id like '${tag}%' or actor_id like '${tag}%' or target_id in (select id from public.users where email like '${tag}%')`);
sql(`delete from public.users where id like '${tag}%' or email like '${tag}%'`);
for (const id of new Set([...authIds, ...Object.values(ids)])) await fetch(`${API}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: { apikey: SVC, Authorization: `Bearer ${SVC}` } });

for (const r of results) console.log(r.join('  '));
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);
