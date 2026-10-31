// node scripts/test-0046.mjs — applies 0046 (twice) to PGlite and checks the
// system prompt tables: immutability, pointer rules, bot isolation and grants.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite();
await db.exec('create role anon; create role authenticated; create role service_role;');
const m = readFileSync('supabase/migrations/0046_ai_system_prompts.sql', 'utf8');
await db.exec(m); await db.exec(m);

let pass = 0;
const ok = async (name, fn) => { await fn(); pass++; console.log('ok', name); };
const fails = async (sql, params, re) => {
  let err; try { await db.query(sql, params); } catch (e) { err = e; }
  assert.ok(err, `expected failure: ${sql}`);
  if (re) assert.match(err.message, re);
};
const add = async (bot, v, status, body = `prompt ${bot} ${v}`) => (await db.query(
  `insert into ai_system_prompts (bot, version_no, status, body, sha256, created_by_claimed) values ($1,$2,$3,$4,'h','A') returning id`,
  [bot, v, status, body])).rows[0].id;

await ok('pointers are seeded empty for both bots', async () => {
  const r = await db.query(`select bot, prompt_id from ai_system_prompt_pointers order by bot`);
  assert.deepEqual(r.rows, [{ bot: 'dubai', prompt_id: null }, { bot: 'eyad', prompt_id: null }]);
});

await ok('versions are immutable and unique per bot', async () => {
  const id = await add('eyad', 1, 'draft');
  await fails(`update ai_system_prompts set body = 'x' where id = $1`, [id], /immutable/);
  await fails(`delete from ai_system_prompts where id = $1`, [id], /immutable/);
  await fails(`insert into ai_system_prompts (bot, version_no, status, body, sha256, created_by_claimed) values ('eyad',1,'draft','y','h','A')`, []);
  await add('dubai', 1, 'draft');
});

await ok('a pointer names only a published prompt of the same bot', async () => {
  const draft = await add('eyad', 2, 'draft');
  await fails(`update ai_system_prompt_pointers set prompt_id = $1 where bot = 'eyad'`, [draft], /published/);
  const pub = await add('eyad', 3, 'published');
  await db.query(`update ai_system_prompt_pointers set prompt_id = $1 where bot = 'eyad'`, [pub]);
  await fails(`update ai_system_prompt_pointers set prompt_id = $1 where bot = 'dubai'`, [pub], /same bot/);
  assert.equal((await db.query(`select prompt_id from ai_system_prompt_pointers where bot='dubai'`)).rows[0].prompt_id, null);
});

await ok('empty or oversized bodies and unknown bots are refused', async () => {
  await fails(`insert into ai_system_prompts (bot, version_no, status, body, sha256, created_by_claimed) values ('eyad',9,'draft','','h','A')`, []);
  await fails(`insert into ai_system_prompts (bot, version_no, status, body, sha256, created_by_claimed) values ('eyad',10,'draft',$1,'h','A')`, ['x'.repeat(12001)]);
  await fails(`insert into ai_system_prompts (bot, version_no, status, body, sha256, created_by_claimed) values ('all',1,'draft','x','h','A')`, []);
});

await ok('RLS on, no anon or authenticated grant', async () => {
  const g = await db.query(`select count(*)::int as n from information_schema.role_table_grants where grantee in ('anon','authenticated') and table_name like 'ai_system_prompt%'`);
  assert.equal(g.rows[0].n, 0);
  const r = await db.query(`select count(*)::int as n from pg_class where relname in ('ai_system_prompts','ai_system_prompt_pointers') and relrowsecurity`);
  assert.equal(r.rows[0].n, 2);
});

console.log(`\n${pass} passed`);
