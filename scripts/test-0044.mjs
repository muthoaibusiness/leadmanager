// Applies 0037 then 0044 (twice) to PGlite and checks ai_pointer_set:
// one-transaction publish/rollback, expected-pointer check, atomicity, grants.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role;
  create table notifications (id text primary key, user_id text, type text, message text, lead_id text, is_read boolean, created_at timestamptz, company_id text);
  create table preleads (id bigint generated always as identity primary key, phone text unique, takeover boolean default false);`);
await db.exec(readFileSync('supabase/migrations/0037_ai_trainer.sql', 'utf8'));
const m = readFileSync('supabase/migrations/0044_ai_pointer_set.sql', 'utf8');
await db.exec(m); await db.exec(m);

let pass = 0;
const ok = async (name, fn) => { await fn(); pass++; console.log('ok', name); };
const fails = async (sql, params, re) => {
  let err; try { await db.query(sql, params); } catch (e) { err = e; }
  assert.ok(err, `expected failure: ${sql}`);
  if (re) assert.match(err.message, re);
};
const snap = async (n) => (await db.query(`insert into ai_snapshots (version_no, content, checksum, core_version_frozen, created_by_claimed) values ($1, '{}', 'c', '1', 'A') returning id`, [n])).rows[0].id;
const SET = `select ai_pointer_set($1, $2, $3::uuid, $4, $5::uuid, $6, $7, $8, 'Asad') as r`;
const ptr = async (bot = 'eyad') => (await db.query(`select * from ai_bot_pointers where bot = $1`, [bot])).rows[0];
const audits = async () => (await db.query(`select * from ai_trainer_audit where entity = 'pointer' order by id`)).rows;
const s1 = await snap(1), s2 = await snap(2);

await ok('publish moves pointer, publishes snapshot, one audit row', async () => {
  const r = (await db.query(SET, ['eyad', 'snapshot', s1, true, null, true, 'publish', 'publish'])).rows[0].r;
  assert.equal(r.snapshot_id, s1);
  assert.equal((await ptr()).snapshot_id, s1);
  const s = (await db.query(`select status, published_by_claimed from ai_snapshots where id = $1`, [s1])).rows[0];
  assert.deepEqual(s, { status: 'published', published_by_claimed: 'Asad' });
  const a = await audits();
  assert.equal(a.length, 1);
  assert.equal(a[0].before.mode, 'legacy');
  assert.equal(a[0].after.version_no, 1);
  assert.equal(a[0].action, 'publish');
});

await ok('expected mismatch raises and changes nothing', async () => {
  await fails(SET, ['eyad', 'snapshot', s2, true, null, true, 'publish', 'publish'], /pointer_moved/);
  assert.equal((await ptr()).snapshot_id, s1);
  assert.equal((await db.query(`select status from ai_snapshots where id = $1`, [s2])).rows[0].status, 'candidate');
  assert.equal((await audits()).length, 1);
});

await ok('matching expected succeeds; absent check skips it', async () => {
  await db.query(SET, ['eyad', 'snapshot', s2, true, s1, true, 'publish', 'publish']);
  assert.equal((await ptr()).snapshot_id, s2);
  await db.query(SET, ['eyad', 'snapshot', s1, false, null, false, 'rollback', 'bad']);
  assert.equal((await ptr()).snapshot_id, s1);
});

await ok('legacy rollback', async () => {
  const r = (await db.query(SET, ['eyad', 'legacy', null, true, s1, false, 'rollback', 'back'])).rows[0].r;
  assert.equal(r.mode, 'legacy'); assert.equal(r.snapshot_id, null);
  const a = (await audits()).at(-1);
  assert.equal(a.action, 'rollback'); assert.equal(a.reason, 'back'); assert.equal(a.after.snapshot_id, null);
});

await ok('candidate cannot be targeted without publish', async () => {
  const s3 = await snap(3);
  const n = (await audits()).length;
  await fails(SET, ['dubai', 'snapshot', s3, false, null, false, 'rollback', 'x'], /published snapshot/);
  assert.equal((await ptr('dubai')).mode, 'legacy');
  assert.equal((await audits()).length, n);
});

await ok('audit failure rolls back pointer and snapshot', async () => {
  const s4 = await snap(4);
  await db.exec(`create function boom() returns trigger language plpgsql as $$ begin raise exception 'audit boom'; end $$;
    create trigger boom before insert on ai_trainer_audit for each row execute function boom();`);
  await fails(SET, ['dubai', 'snapshot', s4, true, null, true, 'publish', 'publish'], /audit boom/);
  await db.exec(`drop trigger boom on ai_trainer_audit`);
  assert.equal((await ptr('dubai')).mode, 'legacy');
  assert.equal((await db.query(`select status from ai_snapshots where id = $1`, [s4])).rows[0].status, 'candidate');
});

await ok('anon and authenticated cannot execute', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    await fails(SET, ['eyad', 'legacy', null, false, null, false, 'rollback', 'x'], /permission denied/);
    await db.exec(`reset role`);
  }
  await db.exec(`set role service_role`);
  await db.query(SET, ['eyad', 'legacy', null, false, null, false, 'rollback', 'x']);
  await db.exec(`reset role`);
});

console.log(`${pass} passed`);
