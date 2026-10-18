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

// 0040 Playground history: applied on top of 0037, twice (idempotent).
await db.exec(readFileSync('supabase/migrations/0040_ai_playground_history.sql', 'utf8'));
await db.exec(readFileSync('supabase/migrations/0040_ai_playground_history.sql', 'utf8'));

await ok('0040: playground turns are unique per conversation by seq and by client_turn_id', async () => {
  const c = (await db.query(`insert into ai_playground_conversations (bot, source, created_by_claimed) values ('eyad','drafts','t') returning id`)).rows[0].id;
  await db.query(`insert into ai_playground_turns (conversation_id, seq, client_turn_id, customer_text, outcome) values ($1, 1, 'turn-0001', 'hi', 'ok')`, [c]);
  await rejects(`insert into ai_playground_turns (conversation_id, seq, client_turn_id, customer_text, outcome) values ($1, 1, 'turn-0002', 'x', 'ok')`, [c]);
  await rejects(`insert into ai_playground_turns (conversation_id, seq, client_turn_id, customer_text, outcome) values ($1, 2, 'turn-0001', 'x', 'ok')`, [c]);
  await rejects(`insert into ai_playground_turns (conversation_id, seq, client_turn_id, customer_text, outcome) values ($1, 2, 'short', 'x', 'ok')`, [c]);
});

await ok('0040: a snapshot conversation needs a snapshot id; drafts must not have one', async () => {
  await rejects(`insert into ai_playground_conversations (bot, source, created_by_claimed) values ('eyad','snapshot','t')`);
  await rejects(`insert into ai_playground_conversations (bot, source, created_by_claimed) values ('both','drafts','t')`);
});

await ok('0040: anon has no grants on the playground tables', async () => {
  const r = await db.query(`select count(*)::int as n from information_schema.role_table_grants where grantee in ('anon','authenticated') and table_name like 'ai_playground_%'`);
  assert.equal(r.rows[0].n, 0);
  const rls = await db.query(`select count(*)::int as n from pg_class where relname like 'ai_playground_%' and relkind = 'r' and relrowsecurity`);
  assert.equal(rls.rows[0].n, 2);
});

// 0041/0042 were renumbered from duplicate 0037/0038 files. Production already
// has them (applied by hand), so they must stay no-ops when run again.
await ok('0041/0042: renumbered migrations apply twice and never overwrite an office address', async () => {
  await db.exec(`create table wa_projects (id text primary key, region text)`);
  await db.exec(`insert into wa_projects values ('d1','Dhaka'), ('c1','Chattogram'), ('x1','Sylhet')`);
  for (let i = 0; i < 2; i++) {
    await db.exec(readFileSync('supabase/migrations/0041_wa_followup_flow.sql', 'utf8'));
    await db.exec(readFileSync('supabase/migrations/0042_wa_projects_office_address.sql', 'utf8'));
    if (i === 0) await db.exec(`update wa_projects set office_address = 'custom' where id = 'd1'`);
  }
  const r = await db.query(`select id, office_address from wa_projects order by id`);
  assert.deepEqual(r.rows, [{ id: 'c1', office_address: '687 Mehedibag, Chattogram 4203' }, { id: 'd1', office_address: 'custom' }, { id: 'x1', office_address: null }]);
  const c = await db.query(`select count(*)::int as n from information_schema.columns where table_name = 'preleads' and column_name in ('flow_stage','stage_at','stage_msg_count')`);
  assert.equal(c.rows[0].n, 3);
});

// 0043 Playground model config. PGlite has no supabase_vault, so a minimal
// stand-in with the same function signatures stores secrets in a plain table.
await db.exec(`create schema vault;
  create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, description text, secret text);
  create view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
  create function vault.create_secret(s text, n text, d text) returns uuid language sql as $$ insert into vault.secrets (secret, name, description) values (s, n, d) returning id $$;
  create function vault.update_secret(i uuid, s text) returns void language sql as $$ update vault.secrets set secret = s where id = i $$;`);
await db.exec(readFileSync('supabase/migrations/0043_ai_model_config.sql', 'utf8'));
await db.exec(readFileSync('supabase/migrations/0043_ai_model_config.sql', 'utf8'));

await ok('0043: settings table refuses bad scope, provider, protocol and model ids', async () => {
  await rejects(`insert into ai_model_configs (scope, provider, base_url, model, updated_by_claimed) values ('live','openrouter','https://openrouter.ai/api/v1','m','t')`);
  await rejects(`insert into ai_model_configs (scope, provider, base_url, model, updated_by_claimed) values ('playground','anthropic','https://x.example/v1','m','t')`);
  await rejects(`insert into ai_model_configs (scope, provider, base_url, model, updated_by_claimed) values ('playground','custom','http://x.example/v1','m','t')`);
  await rejects(`insert into ai_model_configs (scope, provider, base_url, model, updated_by_claimed) values ('playground','custom','https://x.example/v1','bad model','t')`);
});

await ok('0043: the key goes to the vault, the row keeps only its id and last 4, rotation reuses the secret', async () => {
  await rejects(`select ai_model_key_set('playground', 'sk-0000-1111', 't')`);
  await db.exec(`insert into ai_model_configs (scope, provider, base_url, model, updated_by_claimed) values ('playground','custom','https://x.example/v1','acme/m','t')`);
  await rejects(`select ai_model_key_set('playground', 'short', 't')`);
  await db.query(`select ai_model_key_set('playground', 'sk-first-KEY-1111', 'Asad')`);
  const row = (await db.query(`select to_jsonb(c) as j from ai_model_configs c`)).rows[0].j;
  assert.equal(row.key_last4, '1111');
  assert.ok(!JSON.stringify(row).includes('first-KEY'), 'plaintext key in the settings row');
  await db.query(`select ai_model_key_set('playground', 'sk-second-KEY-2222', 'Asad')`);
  assert.equal((await db.query(`select ai_model_key_get('playground') as k`)).rows[0].k, 'sk-second-KEY-2222');
  assert.equal((await db.query(`select count(*)::int as n from vault.secrets`)).rows[0].n, 1, 'rotation updates in place');
  assert.equal((await db.query(`select key_host from ai_model_configs`)).rows[0].key_host, 'x.example');
  await rejects(`select ai_model_key_set('playground', 'has a space in it', 't')`);
  // A deleted row leaves its vault secret; a new row reuses it by name instead of failing on the unique name.
  await db.exec(`delete from ai_model_configs; insert into ai_model_configs (scope, provider, base_url, model, updated_by_claimed) values ('playground','custom','https://[2606:4700::1111]/v1','acme/m','t')`);
  await db.query(`select ai_model_key_set('playground', 'sk-third-KEY-3333', 'Asad')`);
  assert.equal((await db.query(`select count(*)::int as n from vault.secrets`)).rows[0].n, 1);
  assert.equal((await db.query(`select key_host from ai_model_configs`)).rows[0].key_host, '[2606:4700::1111]');
  assert.equal((await db.query(`select ai_model_key_get('playground') as k`)).rows[0].k, 'sk-third-KEY-3333');
});

await ok('0043: anon and authenticated cannot read the table or call the key functions', async () => {
  const g = await db.query(`select count(*)::int as n from information_schema.role_table_grants where grantee in ('anon','authenticated') and table_name = 'ai_model_configs'`);
  assert.equal(g.rows[0].n, 0);
  for (const role of ['anon', 'authenticated']) {
    for (const fn of ['ai_model_key_set(text,text,text)', 'ai_model_key_get(text)']) {
      assert.equal((await db.query(`select has_function_privilege('${role}', '${fn}', 'execute') as x`)).rows[0].x, false, `${role} ${fn}`);
    }
  }
  assert.equal((await db.query(`select has_function_privilege('service_role', 'ai_model_key_get(text)', 'execute') as x`)).rows[0].x, true);
  assert.equal((await db.query(`select relrowsecurity as r from pg_class where relname = 'ai_model_configs'`)).rows[0].r, true);
});

console.log(`\n${pass} passed`);
