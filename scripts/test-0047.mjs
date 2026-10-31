// node scripts/test-0047.mjs — applies 0037, 0043 (stubbed Vault), 0045 and
// 0047 (twice) to PGlite with pgvector, and checks embedding config scope,
// document status rules, chunk source rules and company/model/version scoping.
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite({ extensions: { vector } });
await db.exec(`create role anon; create role authenticated; create role service_role;
  create table notifications (id text primary key, user_id text, type text, message text, lead_id text, is_read boolean, created_at timestamptz, company_id text);
  create table preleads (id bigint generated always as identity primary key, phone text unique, takeover boolean default false);
  create schema vault;
  create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, description text, secret text);
  create view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
  create function vault.create_secret(s text, n text, d text) returns uuid language sql as $$ insert into vault.secrets (secret, name, description) values (s, n, d) returning id $$;
  create function vault.update_secret(i uuid, s text) returns void language sql as $$ update vault.secrets set secret = s where id = i $$;`);
for (const f of ['0037_ai_trainer', '0043_ai_model_config', '0045_ai_trainer_chunks']) await db.exec(readFileSync(`supabase/migrations/${f}.sql`, 'utf8'));
const m = readFileSync('supabase/migrations/0047_ai_embeddings_documents.sql', 'utf8');
await db.exec(m); await db.exec(m);

let pass = 0;
const ok = async (name, fn) => { await fn(); pass++; console.log('ok', name); };
const fails = async (sql, params, re) => {
  let err; try { await db.query(sql, params); } catch (e) { err = e; }
  assert.ok(err, `expected failure: ${sql}`);
  if (re) assert.match(err.message, re);
};
const v = (...xs) => `[${xs.join(',')}]`;
const doc = async (o = {}) => (await db.query(
  `insert into ai_trainer_documents (title, format, body, created_by_claimed, company_id, status, version, index_model, index_dim, indexed_version, bots)
   values ($1, 'markdown', $2, 'A', $3, $4, $5, $6, $7, $8, $9) returning id`,
  [o.title || 'Doc', o.body || '# H\ntext', o.company || 'c1', o.status || 'draft', o.version || 1, o.model ?? null, o.dim ?? null, o.indexed ?? null, o.bots || ['eyad', 'dubai']])).rows[0].id;
const chunk = async (docId, ver, emb, o = {}) => (await db.query(
  `insert into ai_trainer_chunks (document_id, document_version, chunk_no, chunk_text, section, bots, project_ref, embedding_model, embedding_dim, embedding, text_sha256, company_id)
   values ($1, $2, $3, 'text', 'Location', $4, null, $5, $6, $7::vector, 'h', $8) returning id`,
  [docId, ver, o.n || 0, o.bots || ['eyad'], o.model || 'emb-1', o.dim || 3, emb, o.company || 'c1'])).rows[0].id;
const match = (company, model, q, bot = 'eyad') => db.query(`select title, document_id, score from ai_match_doc_chunks($1, $2, $3::vector, $4, null, 5)`, [company, model, q, bot]);

await ok('embedding scope is allowed and must carry a dimension; the chat scope must not', async () => {
  await db.query(`insert into ai_model_configs (scope, provider, base_url, model, embedding_dim, updated_by_claimed) values ('embedding','openai','https://api.openai.com/v1','text-embedding-3-small',1536,'A')`);
  await fails(`insert into ai_model_configs (scope, provider, base_url, model, updated_by_claimed) values ('other','openai','https://api.openai.com/v1','m','A')`, []);
  await db.exec(`delete from ai_model_configs where scope = 'embedding'`);
  await fails(`insert into ai_model_configs (scope, provider, base_url, model, updated_by_claimed) values ('embedding','openai','https://api.openai.com/v1','m','A')`, [], /dim_scope/);
  await fails(`insert into ai_model_configs (scope, provider, base_url, model, embedding_dim, updated_by_claimed) values ('playground','openai','https://api.openai.com/v1','m',3,'A')`, [], /dim_scope/);
});

await ok('the embedding scope has its own vault key bound to its own host', async () => {
  await db.query(`insert into ai_model_configs (scope, provider, base_url, model, embedding_dim, updated_by_claimed) values ('embedding','openai','https://api.openai.com/v1','text-embedding-3-small',1536,'A')`);
  await db.query(`select ai_model_key_set('embedding', 'sk-embed-KEY-1234', 'A', 'https://api.openai.com/v1')`);
  const r = await db.query(`select key_host, key_last4 from ai_model_configs where scope='embedding'`);
  assert.deepEqual(r.rows[0], { key_host: 'api.openai.com', key_last4: '1234' });
  assert.equal((await db.query(`select ai_model_key_get('embedding') as k`)).rows[0].k, 'sk-embed-KEY-1234');
  assert.equal((await db.query(`select count(*)::int n from vault.secrets where name = 'ai_model_key_embedding'`)).rows[0].n, 1);
});

await ok('a document is indexed only for its current version with a model, and failed needs an error', async () => {
  await fails(`insert into ai_trainer_documents (title, format, body, created_by_claimed, status) values ('x','markdown','b','A','indexed')`, []);
  await fails(`insert into ai_trainer_documents (title, format, body, created_by_claimed, status, version, index_model, index_dim, indexed_version) values ('x','markdown','b','A','indexed',2,'m',3,1)`, []);
  await fails(`insert into ai_trainer_documents (title, format, body, created_by_claimed, status) values ('x','markdown','b','A','failed')`, []);
  await fails(`insert into ai_trainer_documents (title, format, body, created_by_claimed) values ('x','docx','b','A')`, []);
  await doc({ status: 'indexed', model: 'emb-1', dim: 3, indexed: 1 });
});

await ok('a chunk comes from an item or a document version, never both or neither', async () => {
  const d = await doc();
  await fails(`insert into ai_trainer_chunks (chunk_no, chunk_text, bots, embedding_model, embedding_dim, embedding, text_sha256) values (0,'t',array['eyad'],'m',3,'[1,0,0]','h')`, [], /one_source/);
  await fails(`insert into ai_trainer_chunks (document_id, chunk_no, chunk_text, bots, embedding_model, embedding_dim, embedding, text_sha256) values ($1,0,'t',array['eyad'],'m',3,'[1,0,0]','h')`, [d], /one_source/);
  await chunk(d, 1, v(1, 0, 0));
  await fails(`insert into ai_trainer_chunks (document_id, document_version, chunk_no, chunk_text, bots, embedding_model, embedding_dim, embedding, text_sha256) values ($1,1,0,'t',array['eyad'],'emb-1',3,'[1,0,0]','h')`, [d], /unique|duplicate/);
});

await ok('matching is scoped to one company, one model, one dimension and the indexed version', async () => {
  const a = await doc({ title: 'A-c1', status: 'indexed', model: 'emb-1', dim: 3, indexed: 1 });
  await chunk(a, 1, v(1, 0, 0));
  const b = await doc({ title: 'B-c2', company: 'c2', status: 'indexed', model: 'emb-1', dim: 3, indexed: 1 });
  await chunk(b, 1, v(1, 0, 0), { company: 'c2' });
  const other = await doc({ title: 'C-other-model', status: 'indexed', model: 'emb-2', dim: 3, indexed: 1 });
  await chunk(other, 1, v(1, 0, 0), { model: 'emb-2' });
  const draft = await doc({ title: 'D-draft' });
  await chunk(draft, 1, v(1, 0, 0));
  const titles = (await match('c1', 'emb-1', v(1, 0, 0))).rows.map((r) => r.title);
  assert.ok(titles.includes('A-c1'));
  assert.ok(!titles.includes('B-c2'), 'another company never answers');
  assert.ok(!titles.includes('C-other-model'), 'another model never answers');
  assert.ok(!titles.includes('D-draft'), 'an unindexed document never answers');
  assert.equal((await match('c1', 'emb-1', v(1, 0))).rows.length, 0, 'a query of another dimension matches nothing');
  assert.equal((await match('c1', 'emb-1', v(1, 0, 0), 'dubai')).rows.length, 0, 'bot scope applies');
});

await ok('a stale document version never answers after an edit', async () => {
  const d = await doc({ title: 'Stale', status: 'indexed', model: 'emb-1', dim: 3, indexed: 1 });
  await chunk(d, 1, v(0, 1, 0));
  assert.ok((await match('c1', 'emb-1', v(0, 1, 0))).rows.some((r) => r.title === 'Stale'));
  await db.query(`update ai_trainer_documents set version = 2, status = 'needs_reindex', indexed_version = 1 where id = $1`, [d]);
  assert.ok(!(await match('c1', 'emb-1', v(0, 1, 0))).rows.some((r) => r.title === 'Stale'));
});

await ok('RLS on, no anon grants, match function service-only', async () => {
  const g = await db.query(`select count(*)::int as n from information_schema.role_table_grants where grantee in ('anon','authenticated') and table_name = 'ai_trainer_documents'`);
  assert.equal(g.rows[0].n, 0);
  assert.equal((await db.query(`select relrowsecurity r from pg_class where relname = 'ai_trainer_documents'`)).rows[0].r, true);
  for (const role of ['anon', 'authenticated']) {
    assert.equal((await db.query(`select has_function_privilege('${role}', 'ai_match_doc_chunks(text,text,vector,text,uuid[],int)', 'execute') x`)).rows[0].x, false);
  }
});

console.log(`\n${pass} passed`);
