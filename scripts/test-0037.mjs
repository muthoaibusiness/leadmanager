// Applies migration 0037 to an in-memory Postgres (PGlite) and checks the
// guarantees the AI Trainer relies on: immutability, scope constraints,
// pointer rules, revision conflicts and atomic budget reservation.
// PGlite has no Supabase roles, so the script creates stand-ins first.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role;
  create table notifications (id text primary key, user_id text, type text, message text, lead_id text, is_read boolean, created_at timestamptz, company_id text);
  create table preleads (id bigint generated always as identity primary key, phone text unique, takeover boolean default false);`);
await db.exec(readFileSync('supabase/migrations/0037_ai_trainer.sql', 'utf8'));

let pass = 0;
const ok = async (name, fn) => { await fn(); pass++; console.log('ok', name); };
const rejects = async (sql, params = []) => {
  let threw = false;
  try { await db.query(sql, params); } catch { threw = true; }
  assert.ok(threw, `expected failure: ${sql}`);
};

await ok('pointers seeded legacy', async () => {
  const r = await db.query(`select bot, mode, snapshot_id from ai_bot_pointers order by bot`);
  assert.deepEqual(r.rows, [{ bot: 'dubai', mode: 'legacy', snapshot_id: null }, { bot: 'eyad', mode: 'legacy', snapshot_id: null }]);
});

await ok('bots constraint', async () => {
  await rejects(`insert into ai_trainer_items (kind, bots, body, content_hash) values ('fact', '{}', '{}', 'h')`);
  await rejects(`insert into ai_trainer_items (kind, bots, body, content_hash) values ('fact', '{both}', '{}', 'h')`);
});

await ok('item_save creates revision 1 and audit', async () => {
  const r = await db.query(`select ai_item_save($1::jsonb, 0, 'Asad', null) as res`, [JSON.stringify({ kind: 'fact', bots: ['eyad'], project_ref: null, body: { topic: 't', text: 'x' }, content_hash: 'h1' })]);
  const res = r.rows[0].res;
  assert.equal(res.revision, 1);
  const a = await db.query(`select actor_claimed, auth_method, verified_user_id from ai_trainer_audit where entity_id = $1`, [res.id]);
  assert.deepEqual(a.rows[0], { actor_claimed: 'Asad', auth_method: 'trainer_key', verified_user_id: null });
  const rev = await db.query(`select count(*)::int as n from ai_trainer_item_revisions where item_id = $1`, [res.id]);
  assert.equal(rev.rows[0].n, 1);
});

await ok('item_save stale revision conflicts', async () => {
  const id = (await db.query(`select id from ai_trainer_items limit 1`)).rows[0].id;
  await db.query(`select ai_item_save($1::jsonb, 1, 'A', null)`, [JSON.stringify({ id, kind: 'fact', bots: ['eyad'], project_ref: null, body: { topic: 't', text: 'y' }, content_hash: 'h2' })]);
  await rejects(`select ai_item_save($1::jsonb, 1, 'A', null)`, [JSON.stringify({ id, kind: 'fact', bots: ['eyad'], project_ref: null, body: { topic: 't', text: 'z' }, content_hash: 'h3' })]);
});

await ok('duplicate active content rejected', async () => {
  await rejects(`select ai_item_save($1::jsonb, 0, 'A', null)`, [JSON.stringify({ kind: 'fact', bots: ['eyad'], project_ref: null, body: { topic: 't', text: 'y' }, content_hash: 'h2' })]);
});

await ok('retire needs reason', async () => {
  const id = (await db.query(`select id from ai_trainer_items limit 1`)).rows[0].id;
  await rejects(`select ai_item_save($1::jsonb, 2, 'A', null)`, [JSON.stringify({ id, kind: 'fact', bots: ['eyad'], project_ref: null, body: { topic: 't', text: 'y' }, content_hash: 'h2', status: 'retired' })]);
});

await ok('revisions and audit are append-only', async () => {
  await rejects(`update ai_trainer_item_revisions set revision = 9`);
  await rejects(`delete from ai_trainer_item_revisions`);
  await rejects(`update ai_trainer_audit set reason = 'x'`);
  await rejects(`delete from ai_trainer_audit`);
});

await ok('snapshot immutability', async () => {
  const s = (await db.query(`insert into ai_snapshots (version_no, content, checksum, core_version_frozen, created_by_claimed) values (1, '{"a":1}', 'c1', '1.0.0', 'A') returning id`)).rows[0].id;
  await rejects(`update ai_snapshots set content = '{"a":2}' where id = $1`, [s]);
  await rejects(`update ai_snapshots set checksum = 'x' where id = $1`, [s]);
  await rejects(`delete from ai_snapshots where id = $1`, [s]);
  await db.query(`update ai_snapshots set status = 'published', published_at = now(), published_by_claimed = 'A' where id = $1`, [s]);
  await rejects(`update ai_snapshots set published_by_claimed = 'B' where id = $1`, [s]);
});

await ok('pointer snapshot mode needs published snapshot', async () => {
  const cand = (await db.query(`insert into ai_snapshots (version_no, content, checksum, core_version_frozen, created_by_claimed) values (2, '{}', 'c2', '1.0.0', 'A') returning id`)).rows[0].id;
  await rejects(`update ai_bot_pointers set mode = 'snapshot', snapshot_id = $1 where bot = 'eyad'`, [cand]);
  await rejects(`update ai_bot_pointers set mode = 'snapshot', snapshot_id = null where bot = 'eyad'`);
});

await ok('budget reservations never exceed the limit under concurrency', async () => {
  const calls = Array.from({ length: 20 }, () => db.query(`select ai_budget_reserve('trainer', 0.1, 1.0) as id`));
  const res = await Promise.all(calls);
  const granted = res.filter(r => r.rows[0].id !== null).length;
  assert.equal(granted, 10);
  const d = (await db.query(`select reserved_usd::float as r from ai_budget_days where pool = 'trainer'`)).rows[0];
  assert.ok(Math.abs(d.r - 1.0) < 1e-9);
});

await ok('settle and release', async () => {
  const id = (await db.query(`select id from ai_budget_reservations where status = 'reserved' limit 1`)).rows[0].id;
  await db.query(`select ai_budget_settle($1, 0.05)`, [id]);
  const id2 = (await db.query(`select id from ai_budget_reservations where status = 'reserved' limit 1`)).rows[0].id;
  await db.query(`select ai_budget_release($1)`, [id2]);
  const d = (await db.query(`select reserved_usd::float as r, spent_usd::float as s from ai_budget_days where pool = 'trainer'`)).rows[0];
  assert.ok(Math.abs(d.r - 0.8) < 1e-9 && Math.abs(d.s - 0.05) < 1e-9);
});

await ok('anon has no grants', async () => {
  const r = await db.query(`select count(*)::int as n from information_schema.role_table_grants where grantee in ('anon','authenticated') and table_name like 'ai_%'`);
  assert.equal(r.rows[0].n, 0);
});

await ok('rollback drops everything', async () => {
  await db.exec(readFileSync('supabase/ops/0037_rollback.sql', 'utf8'));
  const r = await db.query(`select count(*)::int as n from information_schema.tables where table_name like 'ai\\_%'`);
  assert.equal(r.rows[0].n, 0);
  await db.exec(readFileSync('supabase/migrations/0037_ai_trainer.sql', 'utf8'));
});

console.log(`\n${pass} passed`);
