// npm run test:0050 — applies 0050 and 0051 (each twice) to PGlite on a minimal
// copy of the live leads shape (verified 2026-10-29: id text, ctwa_clid text,
// "CAPI_STATUS" text, created_at timestamptz) and checks the Meta CAPI attempt
// log, agent qualification, the per-lead summary, the shared limiter, the send
// lock and the grants. Nothing here touches a real database.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite();
// activities and wa_bot_settings mirror the live columns (verified 2026-10-29).
await db.exec(`create role anon; create role authenticated; create role service_role;
  create table public.leads (
    id text primary key, name text, phone text, source text, company_id text, property_interest text, status text default 'NEW',
    ctwa_clid text, "CAPI_STATUS" text, created_at timestamptz default now(), updated_at timestamptz default now());
  create table public.activities (id text primary key, lead_id text, type text, description text, user_id text, user_name text,
    duration_seconds integer, "timestamp" timestamptz default now(), company_id text);
  create table public.wa_bot_settings (bot text primary key, display_name text not null, meta_capi_enabled boolean not null default true);
  insert into public.wa_bot_settings values ('eyad', 'Eyad Bot', true), ('dubai', 'Dubai Bot', true);
  grant all on public.leads, public.activities, public.wa_bot_settings to anon, authenticated, service_role;`);

// 0050 as applied in production, then 0051 on top. Each twice: re-runnable.
for (const f of ['0050_meta_capi_attempts.sql', '0051_meta_capi_qualified_limiter.sql']) {
  const m = readFileSync(`supabase/migrations/${f}`, 'utf8');
  await db.exec(m);
  await db.exec(m);
}
// 0050 run again after 0051 (a manual re-run) must not fail on the view
// ("cannot drop columns from view") nor undo 0051: every 0051 test below runs on this.
await db.exec(readFileSync('supabase/migrations/0050_meta_capi_attempts.sql', 'utf8'));

let pass = 0;
const t = async (name, fn) => { await fn(); pass++; console.log('ok -', name); };
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const rows = async (sql, params) => (await db.query(sql, params)).rows;
const asRole = async (role, sql, params) => {
  await db.exec(`set role ${role}`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
};
const refused = async (role, sql) => {
  try { await asRole(role, sql); } catch { return true; }
  return false;
};
const addLead = (id, over = {}) => db.query(
  `insert into public.leads (id, name, source, company_id, ctwa_clid, "CAPI_STATUS", created_at) values ($1, 'n', $2, 'c1', $3, $4, coalesce($5::timestamptz, now()))`,
  [id, over.source ?? 'WHATSAPP_ADS', over.clid ?? 'clid-' + id, over.status ?? null, over.created_at ?? null]);
const attempt = (lead, outcome, over = {}) => db.query(
  `select * from public.capi_record_attempt($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
  [lead, lead, over.source ?? 'ui_retry', over.actor ?? 'u1', outcome, over.http ?? (outcome === 'accepted' ? 200 : 400),
   over.received ?? (outcome === 'accepted' ? 1 : 0), over.code ?? null, over.subcode ?? null, over.type ?? null, over.message ?? null,
   over.trace ?? 'fbt', over.response ?? null, over.lock ?? null]).then((r) => r.rows[0]);

await t('timestamps are database-generated UTC, separate from the lead', async () => {
  await addLead('L1', { created_at: '2026-10-20T10:00:00Z' });
  const a = await attempt('L1', 'accepted');
  const row = await one(`select attempted_at, responded_at, accepted_at from public.capi_event_attempts where id = $1`, [a.attempt_id]);
  assert.ok(row.attempted_at instanceof Date && row.accepted_at instanceof Date);
  const lead = await one(`select created_at from public.leads where id = 'L1'`);
  assert.equal(lead.created_at.toISOString(), '2026-10-20T10:00:00.000Z', 'lead created_at untouched');
});

await t('attempt numbers count up per lead', async () => {
  await addLead('L2');
  const a = await attempt('L2', 'rejected', { code: 190, subcode: 464, message: 'not a confirmed user' });
  const b = await attempt('L2', 'accepted');
  assert.deepEqual([a.attempt_no, b.attempt_no], [1, 2]);
});

await t('accepted needs HTTP 200 and events_received >= 1; anything else is refused', async () => {
  await addLead('L3');
  await assert.rejects(attempt('L3', 'accepted', { http: 200, received: 0 }));
  await assert.rejects(attempt('L3', 'accepted', { http: 500, received: 1 }));
  assert.equal((await rows(`select 1 from public.capi_event_attempts where lead_id = 'L3'`)).length, 0);
});

await t('an accepted attempt marks the lead LeadSubmitted; a rejected one never touches the status', async () => {
  await addLead('L4');
  await attempt('L4', 'rejected');
  assert.equal((await one(`select "CAPI_STATUS" s from public.leads where id = 'L4'`)).s, null);
  await attempt('L4', 'accepted');
  assert.equal((await one(`select "CAPI_STATUS" s from public.leads where id = 'L4'`)).s, 'LeadSubmitted');
});

await t('a later failure never erases an earlier success, in the log or on the lead', async () => {
  await addLead('L5');
  await attempt('L5', 'accepted');
  await attempt('L5', 'timeout');
  const s = await one(`select status, latest_outcome, accepted_at is not null as has_acc, attempts from public.capi_lead_status where id = 'L5'`);
  assert.deepEqual({ ...s, attempts: Number(s.attempts) }, { status: 'success', latest_outcome: 'timeout', has_acc: true, attempts: 2 });
  assert.equal((await one(`select "CAPI_STATUS" s from public.leads where id = 'L5'`)).s, 'LeadSubmitted');
});

// An agent's own Connected / Interested click, as changeStatus writes it.
let actN = 0;
const mark = (lead, label, user = 'agent1', type = 'STATUS_CHANGE') => db.query(
  `insert into public.activities (id, lead_id, type, description, user_id, company_id) values ($1, $2, $3, $4, $5, 'c1')`,
  ['act' + ++actN, lead, type, label, user]);

await t('status: success, failed, pending, expired, ineligible are derived from the data', async () => {
  await addLead('P1'); await mark('P1', 'Status → Contacted');            // in window, qualified, never tried
  await addLead('F1'); await mark('F1', 'Status → Interested'); await attempt('F1', 'rejected'); // qualified, tried, failed
  await addLead('X1', { created_at: new Date(Date.now() - 8 * 864e5).toISOString() }); await mark('X1', 'Status → Contacted'); // past 7 days
  await addLead('N1', { clid: '' }); await mark('N1', 'Status → Contacted');                    // no click id
  await addLead('S1', { status: 'LeadSubmitted', created_at: '2026-09-20T00:00:00Z' }); // reported before the log existed
  await addLead('U1');                                                    // has a click id, no agent action yet
  const st = Object.fromEntries((await rows(`select id, status from public.capi_lead_status where id in ('P1','F1','X1','N1','S1','U1')`)).map((r) => [r.id, r.status]));
  assert.deepEqual(st, { P1: 'pending', F1: 'failed', X1: 'expired', N1: 'ineligible', S1: 'success', U1: 'ineligible' });
});

await t('qualified = an agent marked it Connected (CONTACTED) or Interested; nothing else counts', async () => {
  const q = async (id) => (await one(`select qualified, status from public.capi_lead_status where id = $1`, [id]));
  await addLead('QC'); await mark('QC', 'Status → Contacted');
  await addLead('QI'); await mark('QI', 'Status → Interested');
  await addLead('QB'); await mark('QB', 'Status → Contacted'); await mark('QB', 'Status → Interested');
  await addLead('QR'); await mark('QR', 'Status corrected: NOT_INTERESTED → CONTACTED (marked by mistake)');
  await addLead('QN'); await mark('QN', 'Status → Not Interested');
  await addLead('QM'); await mark('QM', 'Meeting set · Offline · Thu 15 Oct, 15:43');
  await addLead('QS'); await mark('QS', 'Status → Contacted', 'system');   // the system is not an agent
  await addLead('QE'); await mark('QE', 'Status → Contacted', '');
  await addLead('QK'); await mark('QK', 'Status → Contacted', 'agent1', 'NOTE'); // a note that quotes the words
  await addLead('QT', { status: null }); await db.query(`update public.leads set status = 'CONTACTED' where id = 'QT'`); // status set, no action row
  for (const id of ['QC', 'QI', 'QR']) assert.deepEqual(await q(id), { qualified: true, status: 'pending' }, id);
  for (const id of ['QN', 'QM', 'QS', 'QE', 'QK', 'QT']) assert.deepEqual(await q(id), { qualified: false, status: 'ineligible' }, id);
  assert.equal((await rows(`select 1 from public.capi_lead_status where id = 'QB'`)).length, 1, 'both actions still one lead');
  assert.equal((await q('QB')).qualified, true);
  const s = await one(`select qualified_at from public.capi_lead_status where id = 'QB'`);
  assert.ok(s.qualified_at instanceof Date, 'the first qualifying action is dated');
});

await t('a lead reported before the log existed shows no invented attempt or acceptance time', async () => {
  const s = await one(`select attempts, first_attempt_at, last_attempt_at, accepted_at, status from public.capi_lead_status where id = 'S1'`);
  assert.equal(Number(s.attempts), 0);
  assert.deepEqual([s.first_attempt_at, s.last_attempt_at, s.accepted_at], [null, null, null]);
});

await t('cutoff is created_at + 7 days', async () => {
  const s = await one(`select cutoff_at, created_at from public.capi_lead_status where id = 'P1'`);
  assert.equal(s.cutoff_at.getTime() - s.created_at.getTime(), 7 * 864e5);
});

await t('the send lock admits one sender per lead until it expires or is released', async () => {
  await addLead('K1');
  const a = await one(`select public.capi_try_lock('K1', 'ui_retry', 120) as ok`);
  const b = await one(`select public.capi_try_lock('K1', 'ui_retry', 120) as ok`);
  assert.deepEqual([a.ok, b.ok], [true, false], 'second sender is refused');
  await db.query(`select public.capi_unlock('K1')`);
  assert.equal((await one(`select public.capi_try_lock('K1', 'ui_retry', 120) as ok`)).ok, true);
  await db.query(`update public.capi_send_locks set expires_at = now() - interval '1 second' where lead_id = 'K1'`);
  assert.equal((await one(`select public.capi_try_lock('K1', 'bot', 120) as ok`)).ok, true, 'an expired lock is taken over');
});

await t('the browser roles can neither read nor write the log, the locks or the functions', async () => {
  for (const role of ['anon', 'authenticated']) {
    assert.ok(await refused(role, `select * from public.capi_event_attempts`), `${role} read attempts`);
    assert.ok(await refused(role, `select * from public.capi_lead_status`), `${role} read status`);
    assert.ok(await refused(role, `insert into public.capi_event_attempts (lead_id, event_id, attempt_no, source, outcome) values ('L1','L1',9,'bot','accepted')`), `${role} insert`);
    assert.ok(await refused(role, `select public.capi_try_lock('L1', 'ui_retry', 60)`), `${role} lock`);
    assert.ok(await refused(role, `select * from public.capi_record_attempt('L1','L1','ui_retry','u',
      'accepted',200,1,null,null,null,null,'x',null,null)`), `${role} record`);
    assert.ok(await refused(role, `select public.capi_summary(null)`), `${role} summary`);
    assert.ok(await refused(role, `select * from public.capi_settings`), `${role} settings`);
  }
  assert.ok((await asRole('service_role', `select count(*) from public.capi_event_attempts`)).rows.length === 1, 'service_role reads');
});

await t('unknown outcome and source values are refused', async () => {
  await assert.rejects(attempt('L1', 'maybe'));
  await assert.rejects(attempt('L1', 'rejected', { source: 'someone' }));
});

await t('the error message is capped and the log keeps no token-like field', async () => {
  await addLead('E1');
  await attempt('E1', 'rejected', { message: 'x'.repeat(5000) });
  const r = await one(`select length(error_message) n from public.capi_event_attempts where lead_id = 'E1'`);
  assert.ok(r.n <= 500);
  const cols = (await rows(`select column_name from information_schema.columns where table_name = 'capi_event_attempts'`)).map((c) => c.column_name);
  assert.ok(!cols.some((c) => /token|secret|key/.test(c)), cols.join(','));
});

await t('the Meta response is kept as given (sanitised by the caller), and the error type with it', async () => {
  await addLead('R1');
  await attempt('R1', 'rejected', { code: 190, subcode: 464, type: 'OAuthException', response: JSON.stringify({ error: { code: 190, is_transient: false } }) });
  const r = await one(`select error_type, meta_response from public.capi_event_attempts where lead_id = 'R1'`);
  assert.equal(r.error_type, 'OAuthException');
  assert.deepEqual(r.meta_response, { error: { code: 190, is_transient: false } });
});

await t('capi_summary counts lead status and attempts from the data, per company or across all', async () => {
  await db.exec(`delete from public.capi_event_attempts; delete from public.leads;`);
  await addLead('a1'); await mark('a1', 'Status → Contacted');
  await addLead('a2'); await mark('a2', 'Status → Interested'); await attempt('a2', 'rejected'); await attempt('a2', 'accepted');
  await addLead('a3'); await mark('a3', 'Status → Contacted'); await attempt('a3', 'timeout');
  await addLead('a4', { created_at: new Date(Date.now() - 9 * 864e5).toISOString() }); await mark('a4', 'Status → Contacted');
  await addLead('a5', { clid: '' });
  await db.query(`insert into public.leads (id, source, company_id, ctwa_clid, created_at) values ('o1', 'WHATSAPP_ADS', 'c2', 'k', now())`);
  const s = (await one(`select public.capi_summary('c1') as s`)).s;
  assert.deepEqual(s.by_status, { success: 1, failed: 1, pending: 1, expired: 1, ineligible: 1 });
  assert.equal(s.total, 5);
  assert.deepEqual([s.attempts, s.accepted_attempts], [3, 1]);
  assert.ok(s.last_accepted_at);
  assert.equal(s.oldest_pending.id, 'a1', 'oldest lead still to report (pending a1 is older than failed a3), with its cutoff');
  assert.ok(s.oldest_pending.cutoff_at);
  assert.equal((await one(`select public.capi_summary(null) as s`)).s.total, 6, 'null company = all companies (Master)');
});

await t('capi_settings has one row; recovery starts unpaused', async () => {
  const r = await rows(`select id, ui_recovery_paused from public.capi_settings`);
  assert.deepEqual(r, [{ id: 'default', ui_recovery_paused: false }]);
});

// ── 0051: one limiter for every sender ──────────────────────────────────────
const acquire = async (lead, source = 'ui_retry') => (await one(`select public.capi_acquire($1, $2, 120) as r`, [lead, source])).r;
const resetLimiter = () => db.exec(`delete from public.capi_send_locks; delete from public.capi_send_permits;
  update public.capi_settings set rate_window_seconds = 60, rate_max_sends = 60, max_concurrent_sends = 2, throttled_until = null, throttle_strikes = 0;`);

await t('limits are explicit settings: 60 sends per 60 s, 2 at once, no throttle', async () => {
  const s = await one(`select rate_window_seconds, rate_max_sends, max_concurrent_sends, throttled_until, throttle_strikes from public.capi_settings`);
  assert.deepEqual(s, { rate_window_seconds: 60, rate_max_sends: 60, max_concurrent_sends: 2, throttled_until: null, throttle_strikes: 0 });
  await assert.rejects(db.exec(`update public.capi_settings set max_concurrent_sends = 0`), 'a limit of zero is refused');
  await assert.rejects(db.exec(`update public.capi_settings set rate_max_sends = 0`));
});

await t('acquire grants the lead lock and a permit; a second sender on the same lead is told it is locked', async () => {
  await resetLimiter();
  assert.equal((await acquire('A1')).result, 'ok');
  assert.equal((await acquire('A1', 'bot')).result, 'locked');
  assert.equal(Number((await one(`select count(*) n from public.capi_send_permits`)).n), 1, 'a refused call takes no permit');
  await db.query(`select public.capi_unlock('A1')`);
  assert.equal((await acquire('A1')).result, 'ok', 'free again once released');
});

await t('acquire refuses past the concurrent limit, across sources', async () => {
  await resetLimiter();
  assert.equal((await acquire('C1')).result, 'ok');
  assert.equal((await acquire('C2', 'bot')).result, 'ok');
  const r = await acquire('C3');
  assert.equal(r.result, 'rate_limited'); assert.equal(r.reason, 'concurrency');
  await db.exec(`update public.capi_send_locks set expires_at = now() - interval '1 second' where lead_id = 'C1'`);
  assert.equal((await acquire('C3')).result, 'ok', 'an expired lock no longer counts');
});

await t('acquire refuses past the per-window limit and says when the window frees', async () => {
  await resetLimiter();
  await db.exec(`update public.capi_settings set rate_max_sends = 3, max_concurrent_sends = 10`);
  for (const id of ['W1', 'W2', 'W3']) { assert.equal((await acquire(id)).result, 'ok'); await db.query(`select public.capi_unlock($1)`, [id]); }
  const r = await acquire('W4');
  assert.equal(r.result, 'rate_limited'); assert.equal(r.reason, 'window');
  assert.ok(Date.parse(r.retry_at) > Date.now(), 'retry time is in the future');
  await db.exec(`update public.capi_send_permits set granted_at = now() - interval '61 seconds'`);
  assert.equal((await acquire('W4')).result, 'ok', 'permits older than the window no longer count');
});

await t('without a hint the wait is 30 s doubling per throttle, with jitter, capped at 15 minutes', async () => {
  const wait = async (strikes) => {
    await db.exec(`update public.capi_settings set throttled_until = null, throttle_strikes = ${strikes}`);
    const u = (await one(`select public.capi_throttle(null) as u`)).u;
    return (u.getTime() - Date.now()) / 1000;
  };
  const w0 = await wait(0), w3 = await wait(3), w20 = await wait(20);
  assert.ok(w0 >= 21 && w0 <= 38, `first wait ${w0}`);
  assert.ok(w3 >= 179 && w3 <= 301, `fourth wait ${w3}`);
  assert.ok(w20 <= 901, `capped ${w20}`);
  await resetLimiter();
});

await t('a Meta throttle stops every sender until it passes; an accepted send resets the strike count', async () => {
  await resetLimiter();
  const until = (await one(`select public.capi_throttle(120) as u`)).u;
  assert.ok(until.getTime() > Date.now() + 100e3);
  const r = await acquire('T1', 'bot');
  assert.equal(r.result, 'rate_limited'); assert.equal(r.reason, 'throttled');
  assert.equal((await one(`select throttle_strikes from public.capi_settings`)).throttle_strikes, 1);
  await db.query(`select public.capi_throttle(5)`);
  assert.equal((await one(`select throttled_until from public.capi_settings`)).throttled_until.getTime(), until.getTime(), 'a shorter hint never shortens a longer wait');
  await db.exec(`update public.capi_settings set throttled_until = now() - interval '1 second'`);
  assert.equal((await acquire('T1')).result, 'ok');
  await addLead('T1'); await mark('T1', 'Status → Contacted');
  await attempt('T1', 'accepted');
  assert.equal((await one(`select throttle_strikes from public.capi_settings`)).throttle_strikes, 0);
});

await t('a throttled attempt is recorded as rate_limited and leaves the lead to retry', async () => {
  await addLead('RL'); await mark('RL', 'Status → Interested');
  await attempt('RL', 'rate_limited', { http: 429, code: 4 });
  const s = await one(`select status, latest_outcome, unsure from public.capi_lead_status where id = 'RL'`);
  assert.deepEqual(s, { status: 'failed', latest_outcome: 'rate_limited', unsure: false });
  assert.equal((await one(`select "CAPI_STATUS" s from public.leads where id = 'RL'`)).s, null);
});

await t('unsure marks a lead whose earlier send got no clear answer, so it is never resent blindly', async () => {
  await addLead('UN'); await mark('UN', 'Status → Contacted');
  await attempt('UN', 'rejected');
  assert.equal((await one(`select unsure from public.capi_lead_status where id = 'UN'`)).unsure, false);
  await attempt('UN', 'timeout', { http: null, received: null });
  assert.equal((await one(`select unsure from public.capi_lead_status where id = 'UN'`)).unsure, true);
});

await t('the browser roles can neither acquire, throttle, switch a bot nor read the permits', async () => {
  for (const role of ['anon', 'authenticated']) {
    assert.ok(await refused(role, `select public.capi_acquire('L1', 'ui_retry', 60)`), `${role} acquire`);
    assert.ok(await refused(role, `select public.capi_throttle(null)`), `${role} throttle`);
    assert.ok(await refused(role, `select * from public.capi_set_bot('eyad', false)`), `${role} set bot`);
    assert.ok(await refused(role, `select * from public.capi_send_permits`), `${role} permits`);
  }
});

await t('capi_set_bot persists one bot\'s switch, leaves the other alone, and ignores an unknown bot', async () => {
  const set = (bot, on) => rows(`select * from public.capi_set_bot($1, $2)`, [bot, on]);
  assert.deepEqual(await set('eyad', false), [{ bot: 'eyad', meta_capi_enabled: false }]);
  const all = Object.fromEntries((await rows(`select bot, meta_capi_enabled from public.wa_bot_settings`)).map((r) => [r.bot, r.meta_capi_enabled]));
  assert.deepEqual(all, { eyad: false, dubai: true });
  assert.deepEqual(await set('nobody', false), []);
  assert.deepEqual(await set('eyad', true), [{ bot: 'eyad', meta_capi_enabled: true }]);
});

console.log(`\n${pass} passed`);
