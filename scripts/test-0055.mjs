// node scripts/test-0055.mjs — migration 0055 (lock the remaining anon-open
// tables) and its rollback, on the isolated local stack only (CR001_* env,
// loopback URLs) holding the restored backup copy with 0053 + 0054 applied.
// Throwaway accounts are removed at the end; the restored data is not changed.
//   * anon: no row of any of the 20 tables, and no write
//   * a signed-in active account: its own company's rows plus rows with no
//     company (the app's SCOPE_STRICT=false rule), never another company's
//   * WhatsApp chats: only the company that owns the numbers (wa_settings),
//     plus threads tagged with the caller's own company; never another's
//   * a deactivated account's still-valid access token: nothing (is_active is
//     checked on every request, closing the PostgREST revocation gap)
//   * service-only tables (preleads, app_state, wa_webhook_events) and the
//     credential-adjacent writes (wa_settings, wa_bot_settings) refuse the
//     browser; the Edge Functions keep working through the service role
//   * wa_bump_unread is no longer executable by anon or authenticated
//   * rollback restores anon access exactly
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const API = process.env.CR001_API_URL; const DB = process.env.CR001_DB_URL;
const ANON = process.env.CR001_ANON_KEY; const SVC = process.env.CR001_SERVICE_ROLE_KEY;
if (!API || !DB) throw new Error('set CR001_* (local stack only)');
for (const u of [API, DB]) if (!['127.0.0.1', 'localhost'].includes(new URL(u.replace(/^postgres(ql)?:/, 'http:')).hostname)) throw new Error(`refusing ${u}`);
const sql = (q) => execFileSync('psql', [DB, '-v', 'ON_ERROR_STOP=1', '-Atqc', q], { encoding: 'utf8' }).trim();
const file = (f) => execFileSync('psql', [DB, '-v', 'ON_ERROR_STOP=1', '-q', '-f', f], { encoding: 'utf8' });
const rest = (tok, path, init = {}) => fetch(`${API}/rest/v1/${path}`, { ...init, headers: { apikey: ANON, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
const count = async (tok, t, filter = '') => { const r = await rest(tok, `${t}?select=*${filter}`, { headers: { Prefer: 'count=exact', Range: '0-0' } }); return r.status >= 400 ? `HTTP ${r.status}` : Number((r.headers.get('content-range') || '').split('/')[1]); };

const TABLES = ['activities', 'agent_lead_quota', 'app_state', 'bookings', 'companies', 'hold_requests', 'leads', 'notifications', 'preleads', 'properties', 'targets', 'teams', 'wa_bot_settings', 'wa_conversations', 'wa_knowledge', 'wa_message_corrections', 'wa_messages', 'wa_projects', 'wa_settings', 'wa_webhook_events'];
const tag = 't0055' + Date.now(); const pw = 'local-only-' + tag;
const mk = async (k) => (await (await fetch(`${API}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${tag}-${k}@local.test`, password: pw, email_confirm: true }) })).json()).id;
const signIn = async (k) => (await (await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${tag}-${k}@local.test`, password: pw }) })).json()).access_token;

const ids = { a: await mk('a'), x: await mk('x'), off: await mk('off') };
sql(`insert into public.companies (id,name,plan,is_active) values ('${tag}X','Other Co','Starter',true)`);
sql(`insert into public.users (id,name,email,password,role,company_id,is_active,auth_user_id) values
  ('${tag}a','A','${tag}-a@local.test','!auth','AGENT','c1',true,'${ids.a}'),
  ('${tag}x','X','${tag}-x@local.test','!auth','MANAGEMENT','${tag}X',true,'${ids.x}'),
  ('${tag}off','Off','${tag}-off@local.test','!auth','AGENT','c1',true,'${ids.off}')`);
sql(`insert into public.leads (id, name, phone, source, status, company_id) values ('${tag}L','Other co lead','0','WHATSAPP_ADS','NEW','${tag}X')`);
const tA = await signIn('a'); const tX = await signIn('x'); const tOff = await signIn('off');

try {
  const truth = Object.fromEntries(TABLES.map((t) => [t, Number(sql(`select count(*) from public.${t}`))]));
  file('supabase/migrations/0055_lock_remaining_tables.sql');
  let r0;

  for (const t of TABLES) {
    const c = await count(ANON, t);
    assert.ok(c === 0 || String(c).startsWith('HTTP 4'), `anon reads nothing from ${t} (got ${c})`);
  }
  for (const [t, body] of [['leads', { name: 'x' }], ['activities', { type: 'NOTE' }], ['notifications', { message: 'x' }], ['wa_settings', { relay_url: 'https://evil' }]]) {
    const r = await rest(ANON, `${t}?id=eq.__none__`, { method: 'PATCH', body: JSON.stringify(body) });
    assert.ok([401, 403].includes(r.status), `anon cannot write ${t} (got ${r.status})`);
  }

  // c1 account: its company's rows plus shared (company_id null) rows, as the app loads them today.
  const c1Leads = Number(sql(`select count(*) from public.leads where company_id='c1' or company_id is null`));
  assert.equal(await count(tA, 'leads'), c1Leads, 'c1 sees c1 + unscoped leads');
  assert.equal(await count(tA, 'leads', `&id=eq.${tag}L`), 0, 'c1 does not see the other company\'s lead');
  assert.equal(await count(tX, 'leads', `&id=eq.${tag}L`), 1, 'the other company sees its own lead');
  assert.equal(await count(tX, 'leads', '&company_id=eq.c1'), 0, 'and none of c1');
  assert.equal(await count(tA, 'activities'), Number(sql(`select count(*) from public.activities where company_id='c1' or company_id is null`)));
  // Chats: company-scoped. A thread with no company belongs to the company that
  // owns the WhatsApp numbers (wa_settings.company_id), never to another one.
  const waCo = sql(`select company_id from public.wa_settings where id='default'`);
  assert.equal(waCo, 'c1', 'precondition: the numbers belong to c1');
  assert.equal(await count(tA, 'wa_conversations'), truth.wa_conversations, 'c1 sees every thread of its numbers');
  assert.equal(await count(tX, 'wa_conversations'), 0, 'another company sees none of c1\'s threads');
  assert.equal(await count(tX, 'wa_messages'), 0, 'nor their messages');
  const cid = sql(`select id from public.wa_conversations limit 1`);
  r0 = await rest(tX, `wa_messages?select=id`, { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ id: tag + 'wm', conversation_id: cid, phone: '0', direction: 'OUT', type: 'text', body: 'forged', status: 'PENDING' }) });
  assert.ok([401, 403].includes(r0.status), `another company cannot write into c1's thread (got ${r0.status})`);
  r0 = await rest(tX, `wa_messages?conversation_id=eq.${encodeURIComponent(cid)}&select=id`, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
  assert.deepEqual(await r0.json(), [], 'nor delete its history');
  r0 = await rest(tA, `wa_messages?select=id`, { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ id: tag + 'wo', conversation_id: cid, phone: '0', direction: 'OUT', type: 'text', body: 'own', status: 'PENDING' }) });
  assert.equal(r0.status, 201, `c1 still writes its own outgoing message (got ${r0.status})`);
  // Pre-claim: another company creates the thread id a new customer will use,
  // tagged with its own company, before the webhook ever sees that customer.
  const fresh = `eyad:88010${String(Date.now()).slice(-8)}@s.whatsapp.net`;
  r0 = await rest(tX, `wa_conversations?select=id`, { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ id: fresh, phone: fresh.slice(5, 18), account: 'eyad', company_id: tag + 'X' }) });
  assert.ok([401, 403].includes(r0.status), `another company cannot create a thread on c1's numbers (got ${r0.status})`);
  sql(`delete from public.wa_conversations where id='${fresh}'`);
  r0 = await rest(tA, `wa_conversations?id=eq.${encodeURIComponent(cid)}&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ company_id: tag + 'X' }) });
  assert.ok([401, 403].includes(r0.status) || (await r0.json()).length === 0, 'c1 cannot hand a thread to another company');
  assert.equal(sql(`select coalesce(company_id,'') from public.wa_conversations where id='${cid}'`), sql(`select coalesce(company_id,'') from public.wa_conversations where id='${cid}'`));

  // Config tables carry no company: another company's Management must not
  // rewrite them (wa_settings.company_id would hand it every thread).
  r0 = await rest(tX, `wa_settings?id=eq.default&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ company_id: tag + 'X' }) });
  assert.ok([401, 403].includes(r0.status) || (await r0.json()).length === 0, 'another company cannot take over wa_settings');
  assert.equal(sql(`select company_id from public.wa_settings where id='default'`), 'c1', 'wa_settings still c1\'s');
  r0 = await rest(tX, `wa_projects?id=not.is.null&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ address: 'pwned' }) });
  assert.ok([401, 403].includes(r0.status) || (await r0.json()).length === 0, 'nor the bot catalog');
  assert.equal(sql(`select count(*) from public.wa_projects where address='pwned'`), '0');
  r0 = await rest(tX, `wa_bot_settings?bot=not.is.null&select=bot`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ welcome_enabled: false }) });
  assert.ok([401, 403].includes(r0.status) || (await r0.json()).length === 0, 'nor the bot switches');

  // Defect 6: rows with no company are readable (SCOPE_STRICT=false) and must
  // stay updatable; an update may not move them into another company.
  // An update moves it into the caller's own company (crm_stamp_company);
  // it may not move into another. The lead is put back afterwards.
  const legacy = sql(`select id from public.leads where company_id is null limit 1`);
  assert.ok(legacy, 'precondition: the copy has a lead with no company');
  let r = await rest(tA, `leads?id=eq.${legacy}&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ company_id: tag + 'X' }) });
  assert.ok([401, 403].includes(r.status), `cannot move a no-company lead into another company (got ${r.status})`);
  assert.equal(sql(`select company_id is null from public.leads where id='${legacy}'`), 't');
  try {
    r = await rest(tA, `leads?id=eq.${legacy}&select=id,company_id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ city: sql(`select city from public.leads where id='${legacy}'`) || null }) });
    assert.equal(r.status, 200, `update of a no-company lead (got ${r.status}: ${await r.clone().text()})`);
    assert.deepEqual((await r.json()).map((x) => x.company_id), ['c1'], 'one row updated, now in the caller\'s company');
  } finally { sql(`update public.leads set company_id = null where id='${legacy}'`); }
  r = await rest(tA, 'notifications?select=id', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ id: tag + 'n', user_id: tag + 'a', type: 'NOTE', message: 'x', company_id: null }) });
  assert.equal(r.status, 201, `an active account may still write a no-company notification (got ${r.status})`);
  // ...but it is not left unscoped: it is stamped with the writer's company.
  assert.equal(sql(`select company_id from public.notifications where id='${tag}n'`), 'c1', 'a new no-company row is stamped with the caller\'s company');
  // Laundering: another company may not push its own row out to "no company"
  // (which every tenant reads) and so hand it across.
  r = await rest(tX, `leads?id=eq.${tag}L&select=id,company_id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ company_id: null }) });
  assert.ok([401, 403].includes(r.status) || (await r.json())[0]?.company_id === tag + 'X', `a company's row cannot be moved to no company (got ${r.status})`);
  assert.equal(sql(`select company_id from public.leads where id='${tag}L'`), tag + 'X');
  // The 0009 backfill gap: a notification with no company is its recipient's.
  assert.equal(sql(`select count(*) from public.notifications n join public.users u on u.id = n.user_id where n.company_id is null and u.company_id is not null`), '0', 'notifications backfilled from their recipient');

  // Writes inside the company work; across companies they do not.
  r = await rest(tA, `leads?id=eq.${tag}L&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ name: 'pwned' }) });
  assert.deepEqual(await r.json(), [], 'cross-company update changes nothing');
  r = await rest(tA, 'leads?select=id', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ id: tag + 'N', name: 'new', phone: '1', source: 'WHATSAPP_ADS', status: 'NEW', company_id: tag + 'X' }) });
  assert.ok([401, 403].includes(r.status), `cannot insert into another company (got ${r.status})`);
  r = await rest(tA, 'leads?select=id', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ id: tag + 'O', name: 'own', phone: '1', source: 'WHATSAPP_ADS', status: 'NEW', company_id: 'c1' }) });
  assert.equal(r.status, 201, `can insert into own company (got ${r.status})`);

  // Service-only and credential-adjacent tables.
  for (const t of ['preleads', 'app_state', 'wa_webhook_events']) assert.ok([0, 'HTTP 401', 'HTTP 403'].includes(await count(tA, t)), `${t} is service-role only`);
  r = await rest(tA, 'wa_settings?id=eq.default', { method: 'PATCH', body: JSON.stringify({ relay_url: 'https://evil' }) });
  assert.ok([401, 403].includes(r.status) || (await rest(tA, 'wa_settings?id=eq.default&select=relay_url').then((x) => x.json()))[0]?.relay_url !== 'https://evil', 'an agent cannot rewrite wa_settings');
  r = await rest(tA, 'wa_bot_settings?bot=eq.eyad&select=bot', { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ meta_capi_enabled: true }) });
  assert.ok([401, 403].includes(r.status) || (await r.json()).length === 0, 'an agent cannot switch Meta CAPI on');
  assert.equal(sql(`select count(*) from public.wa_bot_settings where meta_capi_enabled`), '0', 'CAPI still off');

  // Deactivation: the token is still a valid JWT, but every table answers nothing.
  assert.ok((await count(tOff, 'leads')) > 0, 'precondition: the account reads leads while active');
  sql(`update public.users set is_active=false where id='${tag}off'`);
  assert.equal(await count(tOff, 'leads'), 0, 'deactivated: no leads with the old token');
  assert.equal(await count(tOff, 'activities'), 0);
  r = await rest(tOff, `leads?company_id=eq.c1&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ name: 'x' }) });
  assert.deepEqual(await r.json(), [], 'deactivated: no writes');

  // The bell's query (user_id, newest first) must not read the whole user's
  // history: under RLS on a cold cache that took 3.8 s and hit the 8 s timeout.
  assert.equal(sql(`select count(*) from pg_indexes where schemaname='public' and tablename='notifications' and indexdef ilike '%(user_id, created_at DESC)%'`), '1', 'notifications (user_id, created_at desc) index');

  // Storage: no anonymous uploads to the public buckets (0007, 0021 policies).
  if (sql(`select to_regclass('storage.objects') is not null`) === 't') {
    assert.equal(sql(`select count(*) from pg_policies where schemaname='storage' and policyname in ('wa_media_anon_upload','project_media_anon_upload') and 'public' = any(roles)`), '0', 'anon upload policies are gone');
    assert.equal(sql(`select count(*) from pg_policies where schemaname='storage' and tablename='objects' and cmd='INSERT' and 'authenticated' = any(roles)`), '2', 'signed-in uploads still work');
  }

  // SECURITY DEFINER exposure.
  assert.equal(sql(`select has_function_privilege('anon','public.wa_bump_unread(text,text,timestamptz,text)','EXECUTE')`), 'f');
  assert.equal(sql(`select has_function_privilege('authenticated','public.wa_bump_unread(text,text,timestamptz,text)','EXECUTE')`), 'f');
  for (const f of ['wa_create_lead(text,text,text)', 'wa_upsert_prelead(text,text,text,text,text,text)', 'wa_book_visit(jsonb)', 'wa_visit_notified(bigint)']) {
    assert.equal(sql(`select has_function_privilege('authenticated','public.${f}','EXECUTE')`), 'f', `${f} is service-role only`);
  }
  assert.equal(sql(`select has_function_privilege('service_role','public.wa_bump_unread(text,text,timestamptz,text)','EXECUTE')`), 't', 'functions keep it');
  // Service role (the Edge Functions) still reads everything.
  // The test added one lead of its own (`${tag}O`) since the counts were taken.
  for (const t of TABLES) assert.equal(await count(SVC, t), Number(sql(`select count(*) from public.${t}`)), `service role still sees all of ${t}`);
  console.log('0055 applied: anon locked out of 20 tables; company scope with shared rows; cross-company writes refused; deactivated tokens read and write nothing; service-only tables and CAPI switch closed to the browser; definer RPCs service-only');

  file('supabase/ops/0055_rollback.sql');
  for (const t of TABLES) assert.equal(await count(ANON, t), Number(sql(`select count(*) from public.${t}`)), `rollback: anon reads ${t} again`);
  assert.equal(sql(`select has_function_privilege('anon','public.wa_bump_unread(text,text,timestamptz,text)','EXECUTE')`), 't');
  console.log('0055 rollback: anon access back to the 0054 state');
  file('supabase/migrations/0055_lock_remaining_tables.sql');
  file('supabase/migrations/0055_lock_remaining_tables.sql');
  console.log('0055 re-apply twice: ok. test-0055 PASS');
} finally {
  sql(`delete from public.wa_messages where id like '${tag}%'`);
  sql(`delete from public.wa_conversations where company_id like '${tag}%'`);
  sql(`delete from public.notifications where id like '${tag}%'`);
  sql(`delete from public.leads where id like '${tag}%'`);
  sql(`delete from public.users where id like '${tag}%'`);
  sql(`delete from public.companies where id like '${tag}%'`);
  for (const id of Object.values(ids)) await fetch(`${API}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: { apikey: SVC, Authorization: `Bearer ${SVC}` } });
}
