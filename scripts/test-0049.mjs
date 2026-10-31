// npm run test:0049 — applies 0049 (twice) to PGlite on a minimal copy of the
// live leads/activities shape (verified 2026-10-27: next_followup is TEXT in
// toISOString() form, activities.id is the primary key, mark_lead_talked
// updates leads from an activities trigger) and checks the follow-up rules.
// Nothing here touches a real database.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role;
  create table public.leads (
    id text primary key, name text, status text not null default 'NEW', company_id text,
    assigned_to text, next_followup text, no_answer_count integer not null default 0,
    no_answer_lock_until timestamptz, call_count integer default 0, talked boolean not null default false,
    region text, updated_at timestamptz default now());
  create table public.activities (
    id text primary key, lead_id text references public.leads(id), type text not null, description text,
    user_id text, user_name text, duration_seconds integer default 0, timestamp timestamptz default now(),
    company_id text);
  grant all on public.leads, public.activities to anon, authenticated, service_role;
  create function public.mark_lead_talked() returns trigger language plpgsql security definer set search_path = public as $$
  begin
    if new.type = 'CALL' and coalesce(new.duration_seconds, 0) > 0 and new.lead_id is not null then
      update public.leads set talked = true where id = new.lead_id and not talked;
    end if;
    return new;
  end $$;
  create trigger trg_activities_mark_talked after insert or update of type, duration_seconds on public.activities
    for each row execute function public.mark_lead_talked();`);

const m = readFileSync('supabase/migrations/0049_followup_rules.sql', 'utf8');
await db.exec(m);
await db.exec(m); // re-runnable

let pass = 0;
const t = async (name, fn) => { await fn(); pass++; console.log('ok -', name); };
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const lead = (id) => one(`select * from public.leads where id = $1`, [id]);
const addLead = (id, over = '') => db.exec(`insert into public.leads (id, name, company_id, assigned_to) values ('${id}', 'n', 'c1', 'u1'); ${over}`);
const asRole = async (role, sql, params) => {
  await db.exec(`set role ${role}`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
};
// The browser sends a crypto.randomUUID() per click; the label here is padded
// to the same shape so each test reads by name.
const logNA = (id, req, role = 'anon') => asRole(role, `select * from public.lead_log_no_answer($1, 'u1', 'Agent', $2)`, [id, ('req-' + req).padEnd(12, '0')]).then(r => r.rows[0]);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// ── text <-> timestamp helpers ──────────────────────────────────────────────
await t('fu_parse reads the canonical form and nothing else, never raising', async () => {
  const r = await one(`select
    followup_internal.fu_parse('2026-01-15T10:00:00.000Z') = '2026-01-15 10:00:00+00'::timestamptz as canon,
    followup_internal.fu_parse('2026-01-15T10:00:00Z') is null as no_ms,
    followup_internal.fu_parse('2026-01-15T16:00:00.000+06:00') is null as offset,
    followup_internal.fu_parse('') is null as empty, followup_internal.fu_parse(null) is null as nul,
    followup_internal.fu_parse('garbage') is null as junk,
    followup_internal.fu_parse('2026-02-31T10:00:00.000Z') is null as bad_day,
    followup_internal.fu_parse('2026-13-01T10:00:00.000Z') is null as bad_month,
    followup_internal.fu_parse('2026-01-15T25:00:00.000Z') is null as bad_hour`);
  assert.deepEqual(Object.values(r), Array(Object.keys(r).length).fill(true), JSON.stringify(r));
});

await t('fu_format writes exactly what toISOString() writes, in any session time zone', async () => {
  await db.exec(`set timezone = 'Asia/Dhaka'`);
  const r = await one(`select followup_internal.fu_format('2026-01-15 16:00:00.5+06'::timestamptz) as a,
                              followup_internal.fu_format('2026-07-01 00:00:00.123456+00'::timestamptz) as b,
                              followup_internal.fu_format(null) as c`);
  await db.exec(`reset timezone`);
  assert.equal(r.a, new Date('2026-01-15T10:00:00.500Z').toISOString());
  assert.equal(r.b, '2026-07-01T00:00:00.123Z');
  assert.equal(r.c, null);
  const rt = await one(`select followup_internal.fu_format(followup_internal.fu_parse('2026-03-09T23:59:59.999Z')) as x`);
  assert.equal(rt.x, '2026-03-09T23:59:59.999Z');
});

// ── call attempts ───────────────────────────────────────────────────────────
await t('No Answer counts up to 5, the 5th suppresses, the 6th is refused', async () => {
  await addLead('A1');
  for (let i = 1; i <= 5; i++) {
    const r = await logNA('A1', 'a1-' + i);
    assert.equal(r.attempts, i);
    assert.equal(r.counted, true);
  }
  let l = await lead('A1');
  assert.equal(l.no_answer_count, 5);
  assert.equal(l.followup_suppressed_reason, 'ATTEMPTS_EXHAUSTED');
  assert.equal(l.next_followup, null);
  assert.equal(l.status, 'NEW', 'status is never changed');
  const sixth = await logNA('A1', 'a1-6');
  assert.equal(sixth.counted, false);
  assert.equal(sixth.attempts, 5);
  l = await lead('A1');
  assert.equal(l.no_answer_count, 5);
  const calls = await one(`select count(*)::int n from public.activities where lead_id = 'A1' and type = 'CALL'`);
  assert.equal(calls.n, 5, 'a refused attempt logs no CALL');
});

await t('below the cap, the next follow-up is tomorrow, in canonical text', async () => {
  await addLead('A2');
  const before = Date.now();
  await logNA('A2', 'a2-1');
  const l = await lead('A2');
  assert.match(l.next_followup, ISO);
  const due = Date.parse(l.next_followup);
  assert.ok(due >= before + 86_400_000 - 5_000 && due <= Date.now() + 86_400_000 + 5_000);
  assert.equal(l.call_count, 1);
  const acts = await db.query(`select type, description, user_id, company_id, duration_seconds from public.activities where lead_id = 'A2' order by id`);
  assert.deepEqual(acts.rows.map(a => a.type).sort(), ['CALL', 'FOLLOW_UP']);
  for (const a of acts.rows) { assert.equal(a.user_id, 'u1'); assert.equal(a.company_id, 'c1'); assert.equal(a.duration_seconds, 0); }
  assert.match(acts.rows.find(a => a.type === 'CALL').description, /^Call attempt · No Answer \(1\/5\)$/);
});

await t('a retried request counts once and returns the same state', async () => {
  await addLead('A3');
  const first = await logNA('A3', 'same-req');
  const again = await logNA('A3', 'same-req');
  assert.equal(first.attempts, 1);
  assert.equal(again.attempts, 1);
  assert.equal(again.counted, false);
  assert.equal((await lead('A3')).no_answer_count, 1);
  const n = await one(`select count(*)::int n from public.activities where lead_id = 'A3'`);
  assert.equal(n.n, 2);
});

await t('two concurrent attempts both count; ten concurrent never pass 5', async () => {
  await addLead('A4');
  const r = await Promise.all([logNA('A4', 'c-1'), logNA('A4', 'c-2')]);
  assert.deepEqual(r.map(x => x.attempts).sort(), [1, 2]);
  await addLead('A5');
  await Promise.all(Array.from({ length: 10 }, (_, i) => logNA('A5', 'p-' + i)));
  const l = await lead('A5');
  assert.equal(l.no_answer_count, 5);
  const calls = await one(`select count(*)::int n from public.activities where lead_id = 'A5' and type = 'CALL'`);
  assert.equal(calls.n, 5);
});

await t('a plain PATCH past 5 (old tab) is held at 5 and suppresses', async () => {
  await addLead('A6');
  await asRole('anon', `update public.leads set no_answer_count = 4 where id = 'A6'`);
  await asRole('anon', `update public.leads set no_answer_count = 7, next_followup = '2026-12-01T10:00:00.000Z' where id = 'A6'`);
  const l = await lead('A6');
  assert.equal(l.no_answer_count, 5);
  assert.equal(l.followup_suppressed_reason, 'ATTEMPTS_EXHAUSTED');
  assert.equal(l.next_followup, null);
});

await t('existing leads at 6-7 attempts are untouched until their next attempt', async () => {
  // Rows that were already over the cap before 0049 (live: 25 leads at 6-7).
  await db.exec(`alter table public.leads disable trigger leads_followup_guard;
    insert into public.leads (id, name, company_id, assigned_to, no_answer_count, next_followup)
      values ('H7', 'n', 'c1', 'u1', 7, '2026-11-01T09:00:00.000Z');
    alter table public.leads enable trigger leads_followup_guard;`);
  await asRole('anon', `update public.leads set region = 'x' where id = 'H7'`);
  await db.exec(`insert into public.activities (id, lead_id, type, duration_seconds) values ('talk-H7', 'H7', 'CALL', 60)`);
  let l = await lead('H7');
  assert.equal(l.no_answer_count, 7, 'an unrelated write keeps the count');
  assert.equal(l.next_followup, '2026-11-01T09:00:00.000Z', 'byte-identical follow-up');
  assert.equal(l.followup_suppressed_at, null);
  assert.equal(l.talked, true, 'mark_lead_talked still works through the guard');
  const r = await logNA('H7', 'h7-next');
  assert.equal(r.counted, false);
  l = await lead('H7');
  assert.equal(l.no_answer_count, 7, 'refused, and the stored value is not rewritten');
  assert.equal(l.followup_suppressed_at, null, 'the function does not suppress existing rows either');
  // An old browser tab still PATCHes 7 -> 8 directly: held, and not suppressed.
  await asRole('anon', `update public.leads set no_answer_count = 8 where id = 'H7'`);
  l = await lead('H7');
  assert.equal(l.no_answer_count, 7);
  assert.equal(l.followup_suppressed_at, null);
  assert.equal(l.next_followup, '2026-11-01T09:00:00.000Z');
});

await t('status moves go through on every row, whatever its counters', async () => {
  for (const s of ['CONTACTED', 'INTERESTED', 'MEETING_SET', 'NOT_INTERESTED', 'DEAL_CLOSED_LOST']) {
    await asRole('anon', `update public.leads set status = $1 where id = 'H7'`, [s]);
    assert.equal((await lead('H7')).status, s);
  }
  // A suppressed lead's status still moves; suppression does not freeze it.
  await asRole('anon', `update public.leads set status = 'CONTACTED' where id = 'A1'`);
  const l = await lead('A1');
  assert.equal(l.status, 'CONTACTED');
  assert.equal(l.followup_suppressed_reason, 'ATTEMPTS_EXHAUSTED');
});

await t('a lead inserted already suppressed (import, bot) saves, without an audit row', async () => {
  await db.exec(`insert into public.leads (id, name, company_id, ni_count) values ('I2', 'n', 'c1', 2)`);
  const l = await lead('I2');
  assert.equal(l.followup_suppressed_reason, 'NOT_INTERESTED_X2');
  const n = await one(`select count(*)::int n from public.activities where lead_id = 'I2'`);
  assert.equal(n.n, 0);
});

await t('a status change still resets the attempt counter, as before', async () => {
  await addLead('A7');
  await logNA('A7', 'a7-1'); await logNA('A7', 'a7-2');
  await asRole('anon', `update public.leads set status = 'CONTACTED', no_answer_count = 0 where id = 'A7'`);
  const l = await lead('A7');
  assert.equal(l.no_answer_count, 0);
  assert.equal((await logNA('A7', 'a7-3')).attempts, 1);
});

await t('a suppressed lead takes no attempt and keeps no follow-up', async () => {
  await addLead('A8');
  await asRole('anon', `update public.leads set followup_suppressed_at = now(), followup_suppressed_reason = 'NO_LONGER_RESPONDING' where id = 'A8'`);
  const r = await logNA('A8', 'a8-1');
  assert.equal(r.counted, false);
  await asRole('anon', `update public.leads set next_followup = '2026-12-01T10:00:00.000Z' where id = 'A8'`);
  assert.equal((await lead('A8')).next_followup, null);
});

await t('closed leads take no attempt', async () => {
  await addLead('A9'); await addLead('A10');
  await asRole('anon', `update public.leads set status = 'DEAL_CLOSED_WON' where id = 'A9'`);
  await asRole('anon', `update public.leads set status = 'DEAL_CLOSED_LOST' where id = 'A10'`);
  assert.equal((await logNA('A9', 'a9')).counted, false);
  assert.equal((await logNA('A10', 'a10')).counted, false);
  assert.equal((await lead('A9')).no_answer_count, 0);
});

await t('an unknown lead returns no row and writes nothing', async () => {
  const r = await logNA('nope', 'nope-1');
  assert.equal(r, undefined);
  const n = await one(`select count(*)::int n from public.activities where lead_id = 'nope'`);
  assert.equal(n.n, 0);
});

// ── Not Interested ──────────────────────────────────────────────────────────
await t('two NOT_INTERESTED transitions suppress for good; one does not', async () => {
  await addLead('N1');
  await asRole('anon', `update public.leads set status = 'NOT_INTERESTED' where id = 'N1'`);
  let l = await lead('N1');
  assert.equal(l.ni_count, 1);
  assert.equal(l.followup_suppressed_at, null);
  await asRole('anon', `update public.leads set status = 'CONTACTED' where id = 'N1'`);
  await asRole('anon', `update public.leads set status = 'NOT_INTERESTED', next_followup = '2026-12-01T10:00:00.000Z' where id = 'N1'`);
  l = await lead('N1');
  assert.equal(l.ni_count, 2);
  assert.equal(l.followup_suppressed_reason, 'NOT_INTERESTED_X2');
  assert.equal(l.next_followup, null);
  assert.equal(l.status, 'NOT_INTERESTED', 'the lead and its status stay');
});

await t('re-saving NOT_INTERESTED without a transition does not count', async () => {
  await addLead('N2');
  await asRole('anon', `update public.leads set status = 'NOT_INTERESTED' where id = 'N2'`);
  await asRole('anon', `update public.leads set status = 'NOT_INTERESTED', region = 'y' where id = 'N2'`);
  assert.equal((await lead('N2')).ni_count, 1);
});

await t('anon cannot lift a NOT_INTERESTED_X2 suppression or lower the count; service_role can', async () => {
  await asRole('anon', `update public.leads set followup_suppressed_at = null, followup_suppressed_reason = null, ni_count = 0 where id = 'N1'`);
  let l = await lead('N1');
  assert.equal(l.followup_suppressed_reason, 'NOT_INTERESTED_X2');
  assert.equal(l.ni_count, 2);
  await asRole('authenticated', `update public.leads set followup_suppressed_at = null where id = 'N1'`);
  assert.equal((await lead('N1')).followup_suppressed_reason, 'NOT_INTERESTED_X2');
  await asRole('service_role', `update public.leads set followup_suppressed_at = null, followup_suppressed_reason = null where id = 'N1'`);
  l = await lead('N1');
  assert.equal(l.followup_suppressed_at, null);
});

await t('a lead inserted as NOT_INTERESTED counts once', async () => {
  await db.exec(`insert into public.leads (id, name, status, company_id) values ('N3', 'n', 'NOT_INTERESTED', 'c1')`);
  assert.equal((await lead('N3')).ni_count, 1);
});

await t('the 2+ NOT_INTERESTED history is not backfilled: existing rows start at 0', async () => {
  await db.exec(`alter table public.leads disable trigger leads_followup_guard;
    insert into public.leads (id, name, status, company_id) values ('N4', 'n', 'NOT_INTERESTED', 'c1');
    alter table public.leads enable trigger leads_followup_guard;
    insert into public.activities (id, lead_id, type, description) values
      ('h1', 'N4', 'STATUS_CHANGE', 'Status → Not Interested'), ('h2', 'N4', 'STATUS_CHANGE', 'Status → Not Interested');`);
  const l = await lead('N4');
  assert.equal(l.ni_count, 0);
  assert.equal(l.followup_suppressed_at, null);
});

// ── No Longer Respond and lifting ───────────────────────────────────────────
await t('NO_LONGER_RESPONDING and ATTEMPTS_EXHAUSTED can be lifted (UI decides who)', async () => {
  await addLead('S1');
  await asRole('anon', `update public.leads set followup_suppressed_at = now(), followup_suppressed_reason = 'NO_LONGER_RESPONDING' where id = 'S1'`);
  await asRole('anon', `update public.leads set followup_suppressed_at = null, followup_suppressed_reason = null where id = 'S1'`);
  assert.equal((await lead('S1')).followup_suppressed_at, null);
});

await t('an unknown suppression reason is rejected', async () => {
  await addLead('S2');
  await assert.rejects(asRole('anon', `update public.leads set followup_suppressed_at = now(), followup_suppressed_reason = 'WHATEVER' where id = 'S2'`));
});

await t('suppressing writes one system audit row; lifting writes another', async () => {
  const before = await one(`select count(*)::int n from public.activities where lead_id = 'S1' and user_id = 'system'`);
  assert.equal(before.n, 2, 'one for suppress, one for lift');
  const rows = await db.query(`select type, description, company_id from public.activities where lead_id = 'S1' and user_id = 'system' order by timestamp, id`);
  assert.ok(rows.rows.every(r => r.type === 'FOLLOW_UP' && r.company_id === 'c1'));
  assert.match(rows.rows[0].description, /^Follow-ups stopped: no longer responding$/);
  assert.match(rows.rows[1].description, /^Follow-ups resumed$/);
});

// ── customer-requested time ─────────────────────────────────────────────────
await t('a follow-up earlier than the requested time is moved to it, canonically', async () => {
  await addLead('R1');
  await asRole('anon', `update public.leads set followup_not_before = '2026-12-10 15:00:00+06', next_followup = '2026-12-01T10:00:00.000Z' where id = 'R1'`);
  assert.equal((await lead('R1')).next_followup, '2026-12-10T09:00:00.000Z');
  await asRole('anon', `update public.leads set next_followup = '2026-12-20T10:00:00.000Z' where id = 'R1'`);
  assert.equal((await lead('R1')).next_followup, '2026-12-20T10:00:00.000Z', 'later is kept');
});

await t('No Answer never schedules before the requested time', async () => {
  await addLead('R2');
  await asRole('anon', `update public.leads set followup_not_before = now() + interval '5 days' where id = 'R2'`);
  await logNA('R2', 'r2-1');
  const l = await lead('R2');
  assert.equal(Date.parse(l.next_followup), Date.parse(new Date(l.followup_not_before).toISOString()));
  assert.match(l.next_followup, ISO);
});

await t('a non-canonical follow-up passes through untouched and fails nothing', async () => {
  await addLead('R3');
  await asRole('anon', `update public.leads set next_followup = 'not a date' where id = 'R3'`);
  assert.equal((await lead('R3')).next_followup, 'not a date');
  await asRole('anon', `update public.leads set followup_not_before = now() where id = 'R3'`);
  assert.equal((await lead('R3')).next_followup, 'not a date');
});

// ── permissions ─────────────────────────────────────────────────────────────
await t('helpers sit outside public; nothing in 0049 runs with elevated rights', async () => {
  const r = await one(`select
    (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('fu_parse', 'fu_format', 'leads_followup_guard')) as in_public,
    has_function_privilege('anon', 'public.lead_log_no_answer(text,text,text,text)', 'execute') as anon_log,
    (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where p.prosecdef and (n.nspname = 'followup_internal' or p.proname = 'lead_log_no_answer')) as definers`);
  assert.equal(r.in_public, 0, 'not reachable as /rpc');
  assert.equal(r.anon_log, true);
  assert.equal(r.definers, 0, 'all SECURITY INVOKER');
});

// ── the ops scripts run, and the dry run writes nothing ─────────────────────
await t('verify passes, the dry run is read-only, rollback leaves data and columns', async () => {
  const verify = readFileSync('supabase/ops/0049_verify.sql', 'utf8');
  const rows = (await db.exec(verify)).flatMap(r => r.rows);
  const bad = rows.filter(r => !String(r.result).startsWith('ok')).map(r => r.check);
  // R3 holds 'not a date' on purpose, so the format check reports it (LOOK,
  // not STOP). Every other check must be ok.
  assert.deepEqual(bad, ['every next_followup still in toISOString() form']);
  assert.equal(rows.find(r => r.check === 'every next_followup still in toISOString() form').result, 'LOOK: 1');
  const before = await one(`select md5(string_agg(t::text, '|' order by t.id)) h from public.leads t`);
  await db.exec('begin read only');
  await db.exec(readFileSync('supabase/ops/0049_dryrun.sql', 'utf8'));
  await db.exec('rollback');
  const after = await one(`select md5(string_agg(t::text, '|' order by t.id)) h from public.leads t`);
  assert.equal(after.h, before.h);
  const n = await one(`select count(*)::int n from public.leads`);
  await db.exec(readFileSync('supabase/ops/0049_rollback.sql', 'utf8'));
  const r = await one(`select
    (select count(*)::int from public.leads) as leads,
    (select count(*)::int from pg_trigger where tgname = 'leads_followup_guard') as trg,
    (select count(*)::int from information_schema.columns where table_name = 'leads' and column_name = 'ni_count') as col`);
  assert.deepEqual(r, { leads: n.n, trg: 0, col: 1 });
  await db.exec(m); // re-apply after rollback
  assert.equal((await one(`select count(*)::int n from pg_trigger where tgname = 'leads_followup_guard'`)).n, 1);
});

console.log(`\n${pass} passed`);
