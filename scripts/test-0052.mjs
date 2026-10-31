// npm run test:0052 — applies 0052 (after 0050, 0051) to PGlite and checks the
// retention purge: old accepted attempts and old legacy tracking rows are
// deleted, recent / failed attempts stay, leads are untouched, the rate
// limiter's permit rows are untouched, reruns are safe, and the cron install is
// skipped when pg_cron/pg_net are absent (as on PGlite). Nothing touches a real
// database.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite();
// Minimal mirror of the live shapes (verified 2026-10-30): leads, activities,
// wa_bot_settings, and the legacy capi_events tracking table.
await db.exec(`create role anon; create role authenticated; create role service_role;
  create table public.leads (
    id text primary key, name text, phone text, source text, company_id text, property_interest text, status text default 'NEW',
    ctwa_clid text, "CAPI_STATUS" text, created_at timestamptz default now(), updated_at timestamptz default now());
  create table public.activities (id text primary key, lead_id text, type text, description text, user_id text, user_name text,
    duration_seconds integer, "timestamp" timestamptz default now(), company_id text);
  create table public.wa_bot_settings (bot text primary key, display_name text not null, meta_capi_enabled boolean not null default true);
  create table public.capi_events (
    id bigint primary key, company_id text, phone text, lead_id text, event_name text, event_time timestamptz,
    payload jsonb, sent_at timestamptz, attempts integer, fb_trace_id text, last_error text, created_at timestamptz default now());
  insert into public.wa_bot_settings values ('eyad', 'Eyad Bot', true), ('dubai', 'Dubai Bot', true);
  grant all on public.leads, public.activities, public.wa_bot_settings, public.capi_events to anon, authenticated, service_role;`);

for (const f of ['0050_meta_capi_attempts.sql', '0051_meta_capi_qualified_limiter.sql', '0052_meta_capi_retention_and_scheduler.sql']) {
  const m = readFileSync(`supabase/migrations/${f}`, 'utf8');
  await db.exec(m);
}
// Re-runnable: a second pass must not fail on the view or the constraints.
await db.exec(readFileSync('supabase/migrations/0052_meta_capi_retention_and_scheduler.sql', 'utf8'));

let pass = 0;
const t = async (name, fn) => { await fn(); pass++; console.log('ok -', name); };
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const rows = async (sql, params) => (await db.query(sql, params)).rows;
const addLead = (id, created) => db.query(
  `insert into public.leads (id, name, source, company_id, ctwa_clid, "CAPI_STATUS", created_at) values ($1, 'n', 'WHATSAPP_ADS', 'c1', 'clid-' || $1, null, $2)`,
  [id, created]);
const attempt = (lead, outcome, acceptedAt) => db.query(
  `select * from public.capi_record_attempt($1, $1, 'scheduled', $2, $3, $4, $5, null, null, null, null, 'fbt', null, null)`,
  [lead, null, outcome, outcome === 'accepted' ? 200 : 400, outcome === 'accepted' ? 1 : 0]).then((r) => r.rows[0]).then(async (a) => {
    if (acceptedAt && outcome === 'accepted') {
      await db.query(`update public.capi_event_attempts set accepted_at = $1, attempted_at = $1 where id = $2`, [acceptedAt, a.attempt_id]);
    }
    return a;
  });

await t('purge deletes accepted attempts older than 45 days, keeps recent and failed', async () => {
  await addLead('P1', '2026-09-01T00:00:00Z');
  await attempt('P1', 'accepted', '2026-08-01T00:00:00Z'); // 89 days old
  await attempt('P1', 'accepted', '2026-10-20T00:00:00Z'); // recent
  await attempt('P1', 'rejected', '2026-07-01T00:00:00Z'); // old but failed: kept
  await db.query(`select public.capi_purge()`);
  const left = await rows(`select outcome, accepted_at from public.capi_event_attempts where lead_id = 'P1' order by attempt_no`);
  assert.equal(left.length, 2, 'only the old accepted attempt is purged');
  const outcomes = left.map((r) => r.outcome).sort();
  assert.deepEqual(outcomes, ['accepted', 'rejected']);
});

await t('purge deletes legacy capi_events older than 15 days, keeps recent', async () => {
  await db.query(`insert into public.capi_events (id, company_id, lead_id, event_name, created_at) values
    (1, 'c1', 'P1', 'LeadSubmitted', '2026-09-01T00:00:00Z'),
    (2, 'c1', 'P1', 'LeadSubmitted', '2026-10-25T00:00:00Z')`);
  await db.query(`select public.capi_purge()`);
  const left = (await rows(`select id from public.capi_events order by id`)).map((r) => r.id);
  assert.deepEqual(left, [2]);
});

await t('purge never touches leads or rate-limiter permit rows', async () => {
  await db.query(`insert into public.capi_send_permits (lead_id, source) values ('P1', 'scheduled')`);
  const before = await one(`select count(*)::int n from public.leads`);
  await db.query(`select public.capi_purge()`);
  const after = await one(`select count(*)::int n from public.leads`);
  assert.equal(after.n, before.n, 'lead count unchanged');
  assert.equal((await one(`select count(*)::int n from public.capi_send_permits`)).n, 1, 'permits untouched');
});

await t('purge rerun is safe and reports zero deletions on the second pass', async () => {
  const r1 = await one(`select public.capi_purge() as r`);
  const r2 = await one(`select public.capi_purge() as r`);
  assert.equal(r2.r.accepted_attempts_deleted, 0);
  assert.equal(r2.r.capi_events_deleted, 0);
  assert.equal(typeof r1.r.accepted_attempts_deleted, 'number');
});

await t('cron jobs are not installed when pg_cron/pg_net are absent', async () => {
  const ext = await rows(`select extname from pg_extension where extname in ('pg_cron', 'pg_net')`);
  assert.equal(ext.length, 0, 'PGlite has neither extension');
  // The 0052 DO block warned and skipped; the migration already applied cleanly.
});

await t('rollback removes 0052 artifacts and restores the original source constraint; reapply restores them', async () => {
  // Production has zero attempts, so no 'scheduled' rows exist at rollback time.
  // Drop the ones this test created to mirror that state before the constraint is
  // restored (a strict re-add rejects any existing row violating it).
  await db.query(`delete from public.capi_event_attempts where source = 'scheduled'`);
  const rollback = `
    alter table public.capi_event_attempts drop constraint if exists capi_event_attempts_source_check;
    alter table public.capi_event_attempts add constraint capi_event_attempts_source_check
      check (source in ('ui_retry', 'bot', 'backfill', 'manual'));
    drop function if exists public.capi_purge();
    drop table if exists public.capi_job_log;`;
  await db.exec(rollback);
  const fn = await rows(`select 1 from pg_proc where proname = 'capi_purge'`);
  assert.equal(fn.length, 0, 'purge function dropped');
  const tbl = await rows(`select 1 from information_schema.tables where table_schema = 'public' and table_name = 'capi_job_log'`);
  assert.equal(tbl.length, 0, 'job log table dropped');
  const src = await rows(`select pg_get_constraintdef(oid) def from pg_constraint where conname = 'capi_event_attempts_source_check'`);
  assert.ok(!src[0].def.includes('scheduled'), 'scheduled source removed on rollback');
  await assert.rejects(db.query(`select * from public.capi_record_attempt('P1', 'P1', 'scheduled', null, 'accepted', 200, 1, null, null, null, null, 'fbt', null, null)`));
  // Reapply 0052 and verify the new state is back.
  await db.exec(readFileSync('supabase/migrations/0052_meta_capi_retention_and_scheduler.sql', 'utf8'));
  const fn2 = await rows(`select 1 from pg_proc where proname = 'capi_purge'`);
  assert.equal(fn2.length, 1, 'purge function restored');
  const src2 = await rows(`select pg_get_constraintdef(oid) def from pg_constraint where conname = 'capi_event_attempts_source_check'`);
  assert.ok(src2[0].def.includes('scheduled'), 'scheduled source restored');
});


console.log(`\n${pass} checks passed`);
