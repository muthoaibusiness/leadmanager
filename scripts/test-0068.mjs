// npm run test:0068 — applies 0049 then 0068 (twice) to PGlite and checks that an
// Attempt / No Answer no longer books a follow-up for tomorrow, while the count,
// the cap, the retry guard and the two activity rows stay as they were.
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
  grant all on public.leads, public.activities to anon, authenticated, service_role;`);
await db.exec(readFileSync('supabase/migrations/0049_followup_rules.sql', 'utf8'));
const m = readFileSync('supabase/migrations/0068_no_answer_no_auto_followup.sql', 'utf8');
await db.exec(m);
await db.exec(m); // re-runnable

let pass = 0;
const t = async (name, fn) => { await fn(); pass++; console.log('ok -', name); };
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const lead = (id) => one(`select * from public.leads where id = $1`, [id]);
const addLead = (id, nf = null) => db.query(`insert into public.leads (id, name, company_id, assigned_to, next_followup) values ($1, 'n', 'c1', 'u1', $2)`, [id, nf]);
const logNA = async (id, req) => {
  await db.exec('set role anon');
  try { return (await db.query(`select * from public.lead_log_no_answer($1, 'u1', 'Agent', $2)`, [id, ('req-' + req).padEnd(12, '0')])).rows[0]; }
  finally { await db.exec('reset role'); }
};
const acts = async (id) => (await db.query(`select type, description from public.activities where lead_id = $1 order by id`, [id])).rows;

await t('an attempt books no follow-up', async () => {
  await addLead('A1');
  const r = await logNA('A1', 'a1');
  assert.deepEqual({ ...r }, { attempts: 1, counted: true, next_followup: null, suppressed_reason: null });
  assert.equal((await lead('A1')).next_followup, null);
});

await t('a follow-up already booked stays exactly as it was', async () => {
  await addLead('A2', '2026-12-01T10:00:00.000Z');
  const r = await logNA('A2', 'a2');
  assert.equal(r.next_followup, '2026-12-01T10:00:00.000Z');
  assert.equal((await lead('A2')).next_followup, '2026-12-01T10:00:00.000Z');
});

await t('still one CALL row and one FOLLOW_UP row per attempt (Prospects contacted counts it)', async () => {
  const a = await acts('A1');
  assert.deepEqual(a.map((x) => x.type).sort(), ['CALL', 'FOLLOW_UP']);
  assert.equal(a.find((x) => x.type === 'FOLLOW_UP').description, 'No answer (1/5) — no follow-up booked');
  assert.equal(a.find((x) => x.type === 'CALL').description, 'Call attempt · No Answer (1/5)');
});

await t('a retry with the same request id counts nothing', async () => {
  const r = await logNA('A1', 'a1');
  assert.equal(r.counted, false); assert.equal(r.attempts, 1);
  assert.equal((await acts('A1')).length, 2);
});

await t('the 5th attempt still stops follow-ups and clears the booked one', async () => {
  await addLead('A5', '2026-12-01T10:00:00.000Z');
  for (let i = 1; i <= 4; i++) await logNA('A5', 'a5-' + i);
  assert.equal((await lead('A5')).next_followup, '2026-12-01T10:00:00.000Z', 'four attempts leave it alone');
  const r = await logNA('A5', 'a5-5');
  assert.equal(r.attempts, 5); assert.equal(r.suppressed_reason, 'ATTEMPTS_EXHAUSTED');
  assert.equal((await lead('A5')).next_followup, null);
  const fu = (await acts('A5')).filter((x) => x.type === 'FOLLOW_UP').map((x) => x.description);
  assert.ok(fu.includes('5 attempts reached — follow-ups stopped'));
  assert.equal((await logNA('A5', 'a5-6')).counted, false, 'a 6th is refused');
});

console.log(`\n${pass} checks passed`);
