// node scripts/test-ops-doc-tags.mjs — dry run of the owner-run
// supabase/ops/doc_fact_sheet_project_tags.sql on PGlite with the real
// migrations: the 10 fact sheets get their project, their chunks follow, a
// tagged chunk stops answering another project's question, and a changed row
// makes the whole script stop. Synthetic rows with the production ids only.
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const OPS = readFileSync('supabase/ops/doc_fact_sheet_project_tags.sql', 'utf8');
// The plan rows, read from the script itself so the test cannot drift from it.
const PLAN = [...OPS.matchAll(/\('([0-9a-f-]{36})', '([0-9a-f-]{36})', '([^']+)'\)/g)].map(([, doc, project, title]) => ({ doc, project, title }));
assert.equal(PLAN.length, 10);

async function fresh() {
  const db = new PGlite({ extensions: { vector } });
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table notifications (id text primary key, user_id text, type text, message text, lead_id text, is_read boolean, created_at timestamptz, company_id text);
    create table preleads (id bigint generated always as identity primary key, phone text unique, takeover boolean default false);
    create schema vault;
    create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, description text, secret text);
    create view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
    create function vault.create_secret(s text, n text, d text) returns uuid language sql as $$ insert into vault.secrets (secret, name, description) values (s, n, d) returning id $$;
    create function vault.update_secret(i uuid, s text) returns void language sql as $$ update vault.secrets set secret = s where id = i $$;`);
  for (const f of ['0037_ai_trainer', '0043_ai_model_config', '0045_ai_trainer_chunks', '0047_ai_embeddings_documents']) await db.exec(readFileSync(`supabase/migrations/${f}.sql`, 'utf8'));
  for (const [i, p] of PLAN.entries()) {
    await db.query(`insert into ai_trainer_items (id, kind, bots, body, content_hash) values ($1, 'project', '{eyad,dubai}', $2, $3)`,
      [p.project, JSON.stringify({ name: p.title.replace(/ fact sheet$/, ''), aliases: {}, media: {} }), `h${i}`]);
    await db.query(`insert into ai_trainer_documents (id, title, format, body, created_by_claimed, status, version, index_model, index_dim, indexed_version)
      values ($1, $2, 'markdown', '# x\ny', 'A', 'indexed', 1, 'emb', 3, 1)`, [p.doc, p.title]);
    // Every chunk points the same way, so only the project filter can tell them apart.
    await db.query(`insert into ai_trainer_chunks (document_id, document_version, chunk_no, chunk_text, section, bots, project_ref, embedding_model, embedding_dim, embedding, text_sha256)
      values ($1, 1, 0, $2, 'Location', '{eyad}', null, 'emb', 3, '[1,0,0]'::vector, 'h')`, [p.doc, p.title]);
  }
  return db;
}
const titlesFor = async (db, project) => (await db.query(`select title from ai_match_doc_chunks('c1', 'emb', '[1,0,0]'::vector, 'eyad', $1::uuid[], 50)`, [[project]])).rows.map((r) => r.title);

const nuz = PLAN.find((p) => p.title === 'Wecon Nuznan fact sheet');
let db = await fresh();
assert.equal((await titlesFor(db, nuz.project)).length, 10, 'before: untagged sheets answer every project, including Momtaz Manor for a Nuznan question');
await db.exec(OPS.replace(/\n-- Review the output[\s\S]*$/, '\ncommit;'));
assert.deepEqual(await titlesFor(db, nuz.project), ['Wecon Nuznan fact sheet'], 'after: a Nuznan question retrieves only the Nuznan sheet');
const docs = (await db.query(`select d.title, i.body->>'name' as project, d.status from ai_trainer_documents d join ai_trainer_items i on i.id = d.project_ref`)).rows;
assert.equal(docs.length, 10);
assert.ok(docs.every((d) => d.title === `${d.project} fact sheet` && d.status === 'indexed'), 'every sheet tagged with its own project and still indexed');
assert.equal((await db.query(`select count(*)::int n from ai_trainer_chunks c join ai_trainer_documents d on d.id = c.document_id and c.document_version = d.indexed_version where c.project_ref is distinct from d.project_ref`)).rows[0].n, 0, 'every chunk of the indexed version carries its document project');
assert.equal((await db.query(`select count(*)::int n from ai_trainer_chunks where document_version = 1`)).rows[0].n, 10, 'the old version chunks stay as history (append-only)');
assert.deepEqual((await db.query(`select count(*)::int n from ai_trainer_documents where version = 2 and indexed_version = 2 and status = 'indexed'`)).rows[0].n, 10, 'each of the 10 sheets moved to version 2, still indexed');
assert.equal((await db.query(`select count(*)::int n from ai_trainer_audit where entity = 'document' and action = 'update'`)).rows[0].n, 10, 'one audit row per document');
console.log('ok tags all 10 sheets, chunks follow, retrieval becomes project-scoped, audited');

// A row that changed since the read stops the whole script; nothing is written.
db = await fresh();
await db.query(`update ai_trainer_documents set title = 'Renamed' where id = $1`, [nuz.doc]);
await assert.rejects(() => db.exec(OPS.replace(/\n-- Review the output[\s\S]*$/, '\ncommit;')), /changed since 2026-10-20/);
await db.exec('rollback'); // what the SQL Editor does with a failed transaction
assert.equal((await db.query(`select count(*)::int n from ai_trainer_documents where project_ref is not null`)).rows[0].n, 0);
console.log('ok a changed document stops the script before any write');
console.log('2 passed');
