// node scripts/cr001-wa-send-e2e.mjs — human WhatsApp send through the real
// wa-send function on the isolated local stack (CR001_* env, loopback only).
// wa-send must run with WASENDER_BASE pointing at a local stub and a dummy
// token, so nothing reaches Wasender. STUB_LOG is the stub's request log.
//   * A signed-in agent's send reaches the stub once, marks the message SENT.
//   * The same request with no session, the anon key, or a forged userId is
//     refused before the stub is called.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const API = process.env.CR001_API_URL; const DB = process.env.CR001_DB_URL;
const ANON = process.env.CR001_ANON_KEY; const SVC = process.env.CR001_SERVICE_ROLE_KEY;
const STUB_LOG = process.env.STUB_LOG || '/tmp/cr001-sb/wasender-stub.log';
if (!API || !DB) throw new Error('set CR001_* (local stack only)');
for (const u of [API, DB]) if (!['127.0.0.1', 'localhost'].includes(new URL(u.replace(/^postgres(ql)?:/, 'http:')).hostname)) throw new Error(`refusing ${u}`);
const sql = (q) => execFileSync('psql', [DB, '-v', 'ON_ERROR_STOP=1', '-Atqc', q], { encoding: 'utf8' }).trim();
const stubCalls = () => readFileSync(STUB_LOG, 'utf8').split('\n').filter(Boolean).length;

const tag = 'wa' + Date.now(); const pw = 'local-only-' + tag; const email = `${tag}@local.test`;
const authId = (await (await fetch(`${API}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw, email_confirm: true }) })).json()).id;
sql(`insert into public.users (id,name,email,password,role,company_id,is_active,auth_user_id) values ('${tag}','Agent','${email}','x','AGENT','c1',true,'${authId}')`);
const tok = (await (await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw }) })).json()).access_token;

const ref = `${tag}-m1`; const conv = `eyad:8801700000000@s.whatsapp.net`;
sql(`insert into public.wa_messages (id, conversation_id, account, phone, direction, type, body, status, client_ref) values ('${ref}','${conv}','eyad','8801700000000','OUT','text','hello','PENDING','${ref}')`);
const body = { action: 'send', account: 'eyad', to: '8801700000000', conversationId: conv, clientRef: ref, type: 'text', text: 'hello', userId: tag };
const send = (auth) => fetch(`${API}/functions/v1/wa-send`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) }, body: JSON.stringify(body) });

const before = stubCalls();
for (const a of [undefined, `Bearer ${ANON}`, 'Bearer forged.jwt.token']) assert.equal((await send(a)).status, 401, String(a));
assert.equal(stubCalls(), before, 'refused sends never reached Wasender');

const r = await send(`Bearer ${tok}`);
assert.equal(r.status, 200, await r.clone().text());
assert.equal(stubCalls(), before + 1, 'exactly one send reached the stub');
const last = JSON.parse(readFileSync(STUB_LOG, 'utf8').trim().split('\n').at(-1));
assert.equal(last.path, '/send-message'); assert.equal(last.body.to, '8801700000000'); assert.equal(last.body.text, 'hello');
assert.equal(sql(`select status from public.wa_messages where id='${ref}'`), 'SENT');

sql(`delete from public.wa_messages where id='${ref}'`); sql(`delete from public.wa_conversations where id='${conv}'`);
sql(`delete from public.users where id='${tag}'`);
await fetch(`${API}/auth/v1/admin/users/${authId}`, { method: 'DELETE', headers: { apikey: SVC, Authorization: `Bearer ${SVC}` } });
console.log('wa-send e2e PASS: verified human send reached the stub once and is SENT; no-session, anon and forged sends refused before the stub');
