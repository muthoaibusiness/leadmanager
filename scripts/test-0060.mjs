// node scripts/test-0060.mjs — applies 0059 + 0060 (twice) to PGlite and checks
// the public read path: published projects only, a fixed field whitelist, no
// hold metadata / rates / prices / company ids, statuses resolved to
// available | booked | sold, and anon can call only the two public functions.
// Nothing here touches a real database.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.role() returns text language sql stable as $$ select 'service_role' $$;
  create table public.properties (
    id text primary key, name text, purpose text, address text, handover text, storeys text,
    land_area text, size_text text, facing text, details text, company_id text,
    media jsonb, images jsonb, variants jsonb, floor_plans jsonb, unit_statuses jsonb);`);

const held = { id: 'A2', status: 'hold', size: 1500, clientName: 'Karim Secret', clientId: 'l9', heldBy: 'u1', heldByName: 'Agent Rahim', holdUntil: '2026-12-01', note: 'pays cash', price: 9999999 };
await db.query(`insert into public.properties values ($1,$2,'Residential','Road 1','2027','G+9','5 Katha','1500 sft','South','Lake view',
  'c1',$3,'[]',$4,$5,$6)`, ['p1', 'Alpha Tower',
  JSON.stringify({ images: [{ url: 'https://cdn.example/a.jpg' }, { url: 'javascript:alert(1)' }, 'https://cdn.example/b.jpg'], docs: [{ label: 'Brochure', url: 'https://cdn.example/a.pdf' }, { url: 'http://insecure/x.pdf' }], links: [{ label: 'More', url: 'https://example.com/p' }, { label: 'Bad', url: 'javascript:alert(1)' }] }),
  JSON.stringify([{ id: 'v1', name: '3 Bed', size: 1500, beds: 3, baths: 3, listRate: 12000, floorRate: 200, unitPrefix: 'A', units: [
    { id: 'A1', status: 'available' }, held, { id: 'A3', status: 'sold', size: 1600 }, { id: 'A4', status: 'available', tag: 'cs1' }, { id: 'A5', status: 'weird' }] }]),
  JSON.stringify([{ id: 'f1', name: 'Typical', order: 1, updatedBy: 'u1', updatedAt: 'x', image: { url: 'https://cdn.example/plan.png', width: 2000, height: 1000 }, boxes: [{ id: 'b1', x: 0.1, y: 0.1, w: 0.2, h: 0.2, unitId: 'A1' }] },
                  { id: 'f2', name: 'Bad', image: { url: 'data:image/png;base64,AAA', width: 1, height: 1 }, boxes: [] }]),
  JSON.stringify([{ id: 'cs1', name: 'Reserved for VIP', base: 'hold', color: '#7C3AED' }])]);
await db.query(`insert into public.properties (id, name, company_id, variants) values ('p2', 'Beta Hidden', 'c1', '[]')`);
await db.query(`insert into public.properties (id, name, company_id, variants, media) values ('p3', 'Gamma Plain', 'c2', '[{"id":"v","units":[{"id":"G1","status":"sold"}]}]', '{}')`);

for (const f of ['0059_public_project_publish.sql', '0060_public_project_read.sql', '0061_public_project_facts.sql']) {
  const m = readFileSync(`supabase/migrations/${f}`, 'utf8');
  await db.exec(m); await db.exec(m); // re-runnable
}
await db.exec(`update public.properties set public_published = true where id in ('p1', 'p3')`);

let pass = 0;
const t = async (name, fn) => { await fn(); pass++; console.log('ok -', name); };
const call = async (sql, params) => (await db.query(sql, params)).rows[0].r;
const PRIVATE = ['clientName', 'clientId', 'heldBy', 'heldByName', 'holdUntil', 'note', 'pays cash', 'Karim', 'Rahim',
  'listRate', 'floorRate', 'price', '9999999', 'company_id', 'companyId', 'c1', 'updatedBy', 'unitPrefix', 'Reserved for VIP', '#7C3AED'];

await t('portfolio lists published projects only, by name', async () => {
  const list = await call(`select public.public_projects() r`);
  assert.deepEqual(list.map(p => p.id), ['p1', 'p3']);
});

await t('portfolio card: counts, size range and https cover', async () => {
  const [a] = await call(`select public.public_projects() r`);
  assert.deepEqual(a.counts, { available: 1, booked: 2, sold: 2, minSize: 1500, maxSize: 1600 });
  assert.equal(a.cover, 'https://cdn.example/a.jpg');
  assert.equal(a.type, 'Residential');
});

await t('detail: an unpublished or unknown project returns null', async () => {
  assert.equal(await call(`select public.public_project('p2') r`), null);
  assert.equal(await call(`select public.public_project('nope') r`), null);
});

await t('detail: statuses resolve (custom tag -> base, hold -> booked, unknown -> sold)', async () => {
  const p = await call(`select public.public_project('p1') r`);
  assert.deepEqual(p.variants[0].units.map(u => [u.id, u.status]),
    [['A1', 'available'], ['A2', 'booked'], ['A3', 'sold'], ['A4', 'booked'], ['A5', 'sold']]);
  assert.deepEqual(p.variants[0].units.map(u => u.size), [1500, 1500, 1600, 1500, 1500]);
});

await t('detail: whitelisted keys only', async () => {
  const p = await call(`select public.public_project('p1') r`);
  assert.deepEqual(Object.keys(p.variants[0].units[0]).sort(), ['id', 'size', 'status']);
  assert.deepEqual(Object.keys(p.variants[0]).sort(), ['baths', 'beds', 'id', 'name', 'size', 'units']);
  assert.deepEqual(Object.keys(p.plans[0]).sort(), ['boxes', 'id', 'image', 'name', 'order']);
  assert.deepEqual(Object.keys(p.plans[0].boxes[0]).sort(), ['h', 'id', 'unitId', 'w', 'x', 'y']);
});

await t('detail: no private value anywhere in the payload', async () => {
  for (const sql of [`select public.public_project('p1') r`, `select public.public_projects() r`]) {
    const s = JSON.stringify(await call(sql));
    for (const k of PRIVATE) assert.ok(!s.includes(k), `leaked ${k} via ${sql}`);
  }
});

await t('detail: only https media and plans survive', async () => {
  const p = await call(`select public.public_project('p1') r`);
  assert.deepEqual(p.photos, ['https://cdn.example/a.jpg', 'https://cdn.example/b.jpg']);
  assert.deepEqual(p.brochures, [{ label: 'Brochure', url: 'https://cdn.example/a.pdf' }]);
  assert.deepEqual(p.plans.map(f => f.id), ['f1']);
  assert.deepEqual(p.links, [{ label: 'More', url: 'https://example.com/p' }]);
});

await t('detail: project fields come through as stored', async () => {
  const p = await call(`select public.public_project('p1') r`);
  assert.equal(p.storeys, 'G+9'); assert.equal(p.landArea, '5 Katha'); assert.equal(p.details, 'Lake view');
});

await t('a project with empty media still works', async () => {
  const p = await call(`select public.public_project('p3') r`);
  assert.deepEqual(p.photos, []); assert.deepEqual(p.brochures, []); assert.equal(p.cover, null);
});

await t('facts: tabs pass through cleaned; malformed rows and tabs are dropped', async () => {
  await db.query(`update public.properties set public_facts = $1 where id = 'p1'`, [JSON.stringify([
    { tab: 'Property Information', rows: [['Type', 'Shopping Cum Commercial'], ['Status', 'On going'], ['Bad'], 'x', ['', 'empty']] },
    { tab: '', rows: [['a', 'b']] }, { tab: 'Empty', rows: [] }, 'junk',
    { tab: 'Building Specifications', rows: [['Elevators', '4 Nos.']] }])]);
  const p = await call(`select public.public_project('p1') r`);
  assert.deepEqual(p.facts, [
    { tab: 'Property Information', rows: [['Type', 'Shopping Cum Commercial'], ['Status', 'On going']] },
    { tab: 'Building Specifications', rows: [['Elevators', '4 Nos.']] }]);
  assert.deepEqual((await call(`select public.public_project('p3') r`)).facts, []);
});

await t('anon may call the two public functions and nothing else', async () => {
  const can = async (fn) => (await db.query(`select has_function_privilege('anon', $1, 'execute') ok`, [fn])).rows[0].ok;
  assert.equal(await can('public.public_projects()'), true);
  assert.equal(await can('public.public_project(text)'), true);
  assert.equal(await can('public.public_unit_status(jsonb, jsonb)'), false);
  assert.equal(await can('public.public_media(jsonb, text)'), false);
  assert.equal(await can('public.public_project_card(public.properties)'), false);
  assert.equal(await can('public.public_facts_clean(jsonb)'), false);
});

await t('anon runs the functions without reading properties itself', async () => {
  await db.exec(`revoke all on public.properties from anon; grant usage on schema public to anon;`);
  await db.exec(`set role anon`);
  try {
    assert.equal((await call(`select public.public_projects() r`)).length, 2);
    await assert.rejects(db.query(`select id from public.properties`), /permission denied/);
  } finally { await db.exec(`reset role`); }
});

console.log(`test-0060 PASS: ${pass} checks`);
