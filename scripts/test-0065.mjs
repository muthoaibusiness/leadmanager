// npm run test:0065 — applies 0065 to PGlite and checks the notification purge:
// the 30/90-day boundaries, never-marked rows treated as unread, batching, the time
// budget, the run log, the stale follow-up reminder guard, and that a rerun of the
// file and of the purge are safe. Nothing touches a real database.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite();
// The live shape of notifications (it predates the migrations folder).
await db.exec(`create role anon; create role authenticated; create role service_role;
  create table public.notifications (id text primary key, user_id text, type text, message text, lead_id text,
    is_read boolean default false, created_at timestamptz default now(), company_id text);
  grant all on public.notifications to anon, authenticated, service_role;`);
const sql = readFileSync('supabase/migrations/0065_notifications_retention.sql', 'utf8');
await db.exec(sql);
await db.exec(sql); // re-runnable

let pass = 0;
const t = async (name, fn) => { await fn(); pass++; console.log('ok -', name); };
const one = async (q, p) => (await db.query(q, p)).rows[0];
const add = (id, days, read) => db.query(
  `insert into public.notifications (id, user_id, type, message, is_read, created_at) values ($1, 'u1', 'X', 'm', $2, now() - make_interval(days => $3))`,
  [id, read, days]);
const ids = async () => (await db.query('select id from public.notifications order by id')).rows.map((r) => r.id);
const clear = () => db.exec('delete from public.notifications; delete from public.crm_job_log;');

await t('read rows go after 30 days, unread and unmarked after 90', async () => {
  await clear();
  await add('r29', 29, true); await add('r31', 31, true);
  await add('u89', 89, false); await add('u91', 91, false);
  await add('n89', 89, null); await add('n91', 91, null);
  const res = (await one('select public.notif_purge() as r')).r;
  assert.deepEqual(await ids(), ['n89', 'r29', 'u89']);
  assert.equal(res.read_deleted, 1); assert.equal(res.unread_deleted, 1); assert.equal(res.unmarked_deleted, 1);
  assert.equal(res.budget_hit, false);
});

await t('batches until done, and a rerun deletes nothing', async () => {
  await clear();
  for (let i = 0; i < 10; i++) await add('old' + i, 200, true);
  const res = (await one('select public.notif_purge(3) as r')).r;
  assert.equal(res.read_deleted, 10);
  assert.ok(res.batches >= 4);
  assert.equal((await ids()).length, 0);
  const again = (await one('select public.notif_purge(3) as r')).r;
  assert.equal(again.read_deleted + again.unread_deleted + again.unmarked_deleted, 0);
});

await t('a spent time budget stops early and says so', async () => {
  await clear();
  for (let i = 0; i < 10; i++) await add('old' + i, 200, false);
  const res = (await one(`select public.notif_purge(2, '0 seconds') as r`)).r;
  assert.equal(res.budget_hit, true);
  assert.ok((await ids()).length > 0, 'the rest waits for the next run');
});

await t('each run is logged', async () => {
  await clear();
  await one('select public.notif_purge() as r');
  const log = await one(`select job, ok, finished_at is not null as done, detail from public.crm_job_log order by id desc limit 1`);
  assert.equal(log.job, 'notif_retention'); assert.equal(log.ok, true); assert.equal(log.done, true);
});

await t('a stale follow-up reminder is dropped on insert; fresh ones and others are kept', async () => {
  await clear();
  const staleMs = Date.now() - 10 * 864e5, freshMs = Date.now() - 864e5;
  await db.query(`insert into public.notifications (id, user_id, type, message) values ($1, 'u1', 'FOLLOW_UP', 'm')`, [`fu-L1-u1-${staleMs}`]);
  await db.query(`insert into public.notifications (id, user_id, type, message) values ($1, 'u1', 'FOLLOW_UP', 'm')`, [`fu-L1-u1-${freshMs}`]);
  await db.query(`insert into public.notifications (id, user_id, type, message) values ('nabc123', 'u1', 'ASSIGNED', 'm')`);
  assert.deepEqual(await ids(), [`fu-L1-u1-${freshMs}`, 'nabc123']);
});

await t('ops step 3 keeps only the newest legacy reminder per user and lead', async () => {
  await clear();
  const ops = readFileSync('supabase/ops/0065_notif_backlog_drain.sql', 'utf8');
  const step3 = '--' + ops.split('-- STEP 3')[1].split('-- STEP 4')[0].replace(/^set statement_timeout.*$/m, '');
  const leg = (id, user, lead, days) => db.query(
    `insert into public.notifications (id, user_id, type, message, lead_id, created_at) values ($1, $2, 'FOLLOW_UP', 'Follow-up reminder: X', $3, now() - make_interval(days => $4))`,
    [id, user, lead, days]);
  await leg('a1', 'u1', 'L1', 5); await leg('a2', 'u1', 'L1', 3); await leg('a3', 'u1', 'L1', 9);
  await leg('b1', 'u2', 'L1', 4); await leg('c1', 'u1', 'L2', 6); await leg('c2', 'u1', 'L2', 2);
  await db.query(`insert into public.notifications (id, user_id, type, message, lead_id) values ('fu-L1-u1-${Date.now()}', 'u1', 'FOLLOW_UP', 'm', 'L1')`);
  await add('other', 1, false);
  await db.exec(step3);
  const left = await ids();
  assert.deepEqual(left.filter((i) => !i.startsWith('fu-')), ['a2', 'b1', 'c2', 'other']);
  assert.equal(left.filter((i) => i.startsWith('fu-')).length, 1, 'new-style reminders untouched');
});

await t('the job log is not open to the app roles', async () => {
  const g = await one(`select has_table_privilege('anon', 'public.crm_job_log', 'select') as a, has_function_privilege('anon', 'public.notif_purge(int, interval)', 'execute') as f`);
  assert.equal(g.a, false); assert.equal(g.f, false);
});

console.log(`\n${pass} checks passed`);
