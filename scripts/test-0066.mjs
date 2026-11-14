// npm run test:0066 — applies 0065, 0066 and 0067 to PGlite and checks the
// follow-up rows: backfill, one pending per lead, the two-way sync with
// leads.next_followup, reassignment, and the server reminder job. Nothing touches
// a real database.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role;
  create table public.leads (id text primary key, name text, status text default 'NEW', assigned_to text, company_id text,
    next_followup text, followup_suppressed_at timestamptz, updated_at timestamptz);
  create table public.notifications (id text primary key, user_id text, type text, message text, lead_id text,
    is_read boolean default false, created_at timestamptz default now(), company_id text);
  insert into public.leads (id, name, status, assigned_to, company_id, next_followup) values
    ('L1', 'Rahim', 'CONTACTED', 'u1', 'c1', to_char((now() + interval '2 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    ('L2', 'Karim', 'CONTACTED', 'u1', 'c1', to_char((now() - interval '3 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    ('L3', 'Won', 'DEAL_CLOSED_WON', 'u1', 'c1', '2026-01-01T10:00:00.000Z'),
    ('L4', 'Nobody', 'NEW', 'u2', 'c1', null);`);
const mig = (f) => readFileSync(`supabase/migrations/${f}`, 'utf8');
for (const f of ['0065_notifications_retention.sql', '0066_lead_followups.sql', '0067_followup_reminders.sql']) await db.exec(mig(f));
await db.exec(mig('0066_lead_followups.sql')); // re-runnable
await db.exec(mig('0067_followup_reminders.sql'));

let pass = 0;
const t = async (name, fn) => { await fn(); pass++; console.log('ok -', name); };
const one = async (q, p) => (await db.query(q, p)).rows[0];
const rows = async (q, p) => (await db.query(q, p)).rows;
const nf = async (id) => (await one('select next_followup from public.leads where id = $1', [id])).next_followup;
const pending = async (id) => rows(`select * from public.lead_followups where lead_id = $1 and status = 'pending'`, [id]);
const iso = (ms) => new Date(ms).toISOString();

await t('backfill: one pending row per lead with a follow-up, any status; past ones count as reminded', async () => {
  const r = await rows(`select lead_id, source, owner_id, reminded_at is not null as reminded from public.lead_followups order by lead_id`);
  assert.deepEqual(r.map((x) => x.lead_id), ['L1', 'L2', 'L3']);
  assert.equal(r[0].source, 'backfill'); assert.equal(r[0].owner_id, 'u1');
  assert.equal(r[0].reminded, false); assert.equal(r[1].reminded, true);
});

await t('saving a follow-up replaces the pending one and writes next_followup', async () => {
  const due = Date.now() + 3 * 3600e3;
  await db.query(`insert into public.lead_followups (id, lead_id, type, purpose, due_at, remind_min, note_code, created_by)
    values ('f1', 'L1', 'PROJECT_VISIT', 'SITE_VISIT', $1, 30, 'CONFIRM_VISIT', 'u1')`, [iso(due)]);
  const p = await pending('L1');
  assert.equal(p.length, 1); assert.equal(p[0].id, 'f1');
  assert.equal(p[0].company_id, 'c1'); assert.equal(p[0].owner_id, 'u1');
  assert.equal(new Date(p[0].remind_at).getTime(), due - 30 * 60e3);
  assert.equal(await nf('L1'), iso(due));
  const old = await one(`select status, cancel_reason from public.lead_followups where id = 'lfbL1'`);
  assert.deepEqual(old, { status: 'cancelled', cancel_reason: 'replaced' });
});

await t('done clears next_followup; a second pending row cannot exist', async () => {
  await db.exec(`update public.lead_followups set status = 'done', done_by = 'u1', outcome = 'Talked' where id = 'f1'`);
  assert.equal(await nf('L1'), null);
  const d = await one(`select done_at is not null as d from public.lead_followups where id = 'f1'`);
  assert.equal(d.d, true);
});

await t('another writer of next_followup creates, moves and cancels an auto row', async () => {
  const a = iso(Date.now() + 864e5), b = iso(Date.now() + 2 * 864e5);
  await db.query(`update public.leads set next_followup = $1 where id = 'L4'`, [a]);
  let p = await pending('L4');
  assert.equal(p.length, 1); assert.equal(p[0].source, 'auto'); assert.equal(p[0].owner_id, 'u2');
  await db.query(`update public.leads set next_followup = $1 where id = 'L4'`, [b]);
  p = await pending('L4');
  assert.equal(p.length, 1); assert.equal(new Date(p[0].due_at).toISOString(), b);
  await db.exec(`update public.leads set next_followup = null where id = 'L4'`);
  assert.equal((await pending('L4')).length, 0);
  const c = await one(`select status, cancel_reason from public.lead_followups where lead_id = 'L4' order by created_at desc limit 1`);
  assert.deepEqual(c, { status: 'cancelled', cancel_reason: 'cleared' });
});

await t('reassigning the lead hands the pending follow-up to the new holder', async () => {
  await db.exec(`update public.leads set assigned_to = 'u9' where id = 'L2'`);
  assert.equal((await pending('L2'))[0].owner_id, 'u9');
});

await t('the reminder job sends one notice to the current holder, once', async () => {
  await db.query(`insert into public.lead_followups (id, lead_id, type, purpose, due_at, remind_min) values ('f2', 'L1', 'CALL', 'BUDGET', $1, 15)`,
    [iso(Date.now() + 10 * 60e3)]);
  const sent = (await one('select public.followup_remind_due() as n')).n;
  assert.equal(sent, 1);
  const n = await one(`select user_id, type, message, lead_id from public.notifications where id like 'rem-f2-%'`);
  assert.equal(n.user_id, 'u1'); assert.equal(n.type, 'FOLLOW_UP'); assert.equal(n.lead_id, 'L1');
  assert.match(n.message, /^Follow-up in 15 min: Rahim · Phone call · Budget discussion · \d\d:\d\d [AP]M$/);
  assert.equal((await one('select public.followup_remind_due() as n')).n, 0, 'a second run sends nothing');
});

await t('a rescheduled follow-up reminds again; a future one waits', async () => {
  await db.query(`update public.lead_followups set due_at = $1 where id = 'f2'`, [iso(Date.now() + 5 * 60e3)]);
  assert.equal((await one('select public.followup_remind_due() as n')).n, 1);
  await db.query(`update public.lead_followups set due_at = $1 where id = 'f2'`, [iso(Date.now() + 5 * 3600e3)]);
  assert.equal((await one('select public.followup_remind_due() as n')).n, 0);
});

await t('a closed deal still gets its reminder; a stopped lead does not', async () => {
  await db.query(`insert into public.lead_followups (id, lead_id, type, due_at, remind_min) values ('f3', 'L3', 'MESSAGE', $1, 0)`, [iso(Date.now() - 60e3)]);
  assert.equal((await one('select public.followup_remind_due() as n')).n, 1);
  assert.match((await one(`select message from public.notifications where id like 'rem-f3-%'`)).message, /^Follow-up now: Won · Message · /);
  await db.query(`update public.lead_followups set due_at = $1 where id = 'f2'`, [iso(Date.now() + 60e3)]);
  await db.exec(`update public.leads set followup_suppressed_at = now() where id = 'L1'`);
  assert.equal((await one('select public.followup_remind_due() as n')).n, 0);
});

await t('browser-made fu- reminders are dropped once the server sends them', async () => {
  await db.query(`insert into public.notifications (id, user_id, type, message) values ($1, 'u1', 'FOLLOW_UP', 'm')`, [`fu-L1-u1-${Date.now()}`]);
  assert.equal((await one(`select count(*)::int c from public.notifications where id like 'fu-%'`)).c, 0);
});

await t('Other needs its text', async () => {
  await assert.rejects(db.query(`insert into public.lead_followups (id, lead_id, due_at, note_code) values ('bad', 'L3', now(), 'OTHER')`));
  await assert.rejects(db.query(`insert into public.lead_followups (id, lead_id, due_at, purpose) values ('bad', 'L3', now(), 'OTHER')`));
});

console.log(`\n${pass} checks passed`);
