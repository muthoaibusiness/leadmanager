// Applies 0037 then 0045 (twice) to PGlite with its pgvector build and checks
// ai_trainer_chunks and ai_match_chunks: immutability, scope filtering before
// ranking, model pinning, snapshot pinning and grants.
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite({ extensions: { vector } });
await db.exec(`create role anon; create role authenticated; create role service_role;
  create table notifications (id text primary key, user_id text, type text, message text, lead_id text, is_read boolean, created_at timestamptz, company_id text);
  create table preleads (id bigint generated always as identity primary key, phone text unique, takeover boolean default false);`);
await db.exec(readFileSync('supabase/migrations/0037_ai_trainer.sql', 'utf8'));
const m = readFileSync('supabase/migrations/0045_ai_trainer_chunks.sql', 'utf8');
await db.exec(m); await db.exec(m);

let pass = 0;
const ok = async (name, fn) => { await fn(); pass++; console.log('ok', name); };
const fails = async (sql, params, re) => {
  let err; try { await db.query(sql, params); } catch (e) { err = e; }
  assert.ok(err, `expected failure: ${sql}`);
  if (re) assert.match(err.message, re);
};
const v = (...xs) => `[${xs.join(',')}]`;
const item = async (kind, bots, project) => (await db.query(
  `select (ai_item_save($1::jsonb, 0, 'A', null))->>'id' as id`,
  [JSON.stringify({ kind, bots, project_ref: project, body: { topic: 't', text: Math.random().toString() }, content_hash: Math.random().toString() })])).rows[0].id;
const chunk = async (itemId, n, emb, model = 'm1', bots = ['eyad'], project = null) => (await db.query(
  `insert into ai_trainer_chunks (item_id, item_revision, chunk_no, chunk_text, bots, project_ref, embedding_model, embedding_dim, embedding, text_sha256)
   values ($1, 1, $2, 'text', $3, $4, $5, 3, $6::vector, 'h') returning id`, [itemId, n, bots, project, model, emb])).rows[0].id;
const match = async (ids, q, bot, projects, k = 5, model = 'm1') => (await db.query(
  `select id, item_id, score from ai_match_chunks($1::uuid[], $2, $3::vector, $4, $5::uuid[], $6)`, [ids, model, q, bot, projects, k])).rows;

const pA = await db.query(`select (ai_item_save($1::jsonb, 0, 'A', null))->>'id' as id`,
  [JSON.stringify({ kind: 'project', bots: ['eyad', 'dubai'], project_ref: null, body: { name: 'A' }, content_hash: 'pa' })]).then((r) => r.rows[0].id);
const pB = await db.query(`select (ai_item_save($1::jsonb, 0, 'A', null))->>'id' as id`,
  [JSON.stringify({ kind: 'project', bots: ['eyad', 'dubai'], project_ref: null, body: { name: 'B' }, content_hash: 'pb' })]).then((r) => r.rows[0].id);
const fA = await item('fact', ['eyad'], pA), fB = await item('fact', ['eyad'], pB), fCo = await item('fact', ['eyad'], null), fDu = await item('fact', ['dubai'], null);
const cA = await chunk(fA, 0, v(1, 0, 0), 'm1', ['eyad'], pA);
const cB = await chunk(fB, 0, v(1, 0, 0), 'm1', ['eyad'], pB);
const cCo = await chunk(fCo, 0, v(0.9, 0.1, 0), 'm1', ['eyad'], null);
const cDu = await chunk(fDu, 0, v(1, 0, 0), 'm1', ['dubai'], null);
const cM2 = await chunk(fCo, 1, v(1, 0, 0), 'm2', ['eyad'], null);
const all = [cA, cB, cCo, cDu, cM2];

await ok('scope is filtered before ranking: other project and other bot never returned', async () => {
  const r = await match(all, v(1, 0, 0), 'eyad', [pA]);
  assert.deepEqual(r.map((x) => x.id).sort(), [cA, cCo].sort());
  assert.equal(r[0].id, cA, 'nearest first');
});

await ok('no resolved project: only company-wide chunks', async () => {
  assert.deepEqual((await match(all, v(1, 0, 0), 'eyad', [])).map((x) => x.id), [cCo]);
});

await ok('only the snapshot-pinned chunk ids are eligible', async () => {
  assert.deepEqual((await match([cCo], v(1, 0, 0), 'eyad', [pA])).map((x) => x.id), [cCo]);
});

await ok('a query embedded with another model never matches', async () => {
  assert.deepEqual((await match(all, v(1, 0, 0), 'eyad', [], 5, 'm2')).map((x) => x.id), [cM2]);
});

await ok('chunks are immutable and never deleted', async () => {
  await fails(`update ai_trainer_chunks set chunk_text = 'x' where id = $1`, [cA], /append-only/);
  await fails(`delete from ai_trainer_chunks where id = $1`, [cA], /append-only/);
});

await ok('one chunk number per item revision and model; dimension must match', async () => {
  await fails(`insert into ai_trainer_chunks (item_id, item_revision, chunk_no, chunk_text, bots, embedding_model, embedding_dim, embedding, text_sha256)
    values ($1, 1, 0, 't', '{eyad}', 'm1', 3, '[1,0,0]', 'h')`, [fA]);
  await fails(`insert into ai_trainer_chunks (item_id, item_revision, chunk_no, chunk_text, bots, embedding_model, embedding_dim, embedding, text_sha256)
    values ($1, 1, 9, 't', '{eyad}', 'm1', 4, '[1,0,0]', 'h')`, [fA]);
  await fails(`insert into ai_trainer_chunks (item_id, item_revision, chunk_no, chunk_text, bots, embedding_model, embedding_dim, embedding, text_sha256)
    values ($1, 7, 0, 't', '{eyad}', 'm1', 3, '[1,0,0]', 'h')`, [fA], /revision/);
});

await ok('k is bounded', async () => {
  await fails(`select * from ai_match_chunks($1::uuid[], 'm1', '[1,0,0]'::vector, 'eyad', '{}'::uuid[], 0)`, [all]);
  await fails(`select * from ai_match_chunks($1::uuid[], 'm1', '[1,0,0]'::vector, 'eyad', '{}'::uuid[], 51)`, [all]);
});

await ok('anon and authenticated cannot read chunks or call the match function', async () => {
  const g = await db.query(`select count(*)::int as n from information_schema.role_table_grants where grantee in ('anon','authenticated') and table_name = 'ai_trainer_chunks'`);
  assert.equal(g.rows[0].n, 0);
  for (const role of ['anon', 'authenticated']) {
    assert.equal((await db.query(`select has_function_privilege('${role}', 'ai_match_chunks(uuid[],text,vector,text,uuid[],int)', 'execute') as x`)).rows[0].x, false, role);
  }
  assert.equal((await db.query(`select relrowsecurity as r from pg_class where relname = 'ai_trainer_chunks'`)).rows[0].r, true);
});

console.log(`\n${pass} passed`);
