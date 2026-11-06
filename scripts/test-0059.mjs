// node scripts/test-0059.mjs — applies 0059 (twice) to PGlite and checks the
// publish guard: before lockdown (no crm_admin) a change is allowed; after it,
// only an admin or the service role may publish or unpublish, and saves that
// leave the flag alone are never blocked. Nothing here touches a real database.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table public.who (role text, admin boolean);
  insert into public.who values ('anon', false);
  create function auth.role() returns text language sql stable as $$ select role from public.who $$;
  create table public.properties (id text primary key, name text, company_id text);
  insert into public.properties values ('p1', 'One', 'c1');`);

const m = readFileSync('supabase/migrations/0059_public_project_publish.sql', 'utf8');
await db.exec(m);
await db.exec(m); // re-runnable

let pass = 0;
const t = async (name, fn) => { await fn(); pass++; console.log('ok -', name); };
const flag = async () => (await db.query(`select public_published from public.properties where id = 'p1'`)).rows[0].public_published;
const as = (role, admin) => db.exec(`update public.who set role = '${role}', admin = ${admin}`);
const refused = (sql) => assert.rejects(db.exec(sql), /only an admin can publish/);

await t('new column defaults to unpublished', async () => assert.equal(await flag(), false));

await t('pre-lockdown (no crm_admin): change allowed', async () => {
  await db.exec(`update public.properties set public_published = true where id = 'p1'`);
  assert.equal(await flag(), true);
  await db.exec(`update public.properties set public_published = false where id = 'p1'`);
});

// Lockdown (0055) adds crm_admin().
await db.exec(`create function public.crm_admin() returns boolean language sql stable as $$ select admin from public.who $$;`);

await t('non-admin cannot publish', async () => {
  await as('authenticated', false);
  await refused(`update public.properties set public_published = true where id = 'p1'`);
  assert.equal(await flag(), false);
});

await t('non-admin cannot insert a published row', async () => {
  await refused(`insert into public.properties (id, name, public_published) values ('p2', 'Two', true)`);
});

await t('non-admin save that leaves the flag alone still works', async () => {
  await db.exec(`update public.properties set name = 'One b' where id = 'p1'`);
  await db.exec(`insert into public.properties (id, name) values ('p3', 'Three')`);
});

await t('admin can publish and unpublish', async () => {
  await as('authenticated', true);
  await db.exec(`update public.properties set public_published = true where id = 'p1'`);
  assert.equal(await flag(), true);
  await as('authenticated', false);
  await refused(`update public.properties set public_published = false where id = 'p1'`);
  assert.equal(await flag(), true);
});

await t('service role bypasses the guard', async () => {
  await as('service_role', false);
  await db.exec(`update public.properties set public_published = false where id = 'p1'`);
  assert.equal(await flag(), false);
});

console.log(`test-0059 PASS: ${pass} checks`);
