// Runs supabase/ops/project_aliases_and_crm_links.sql against PGlite seeded with the 11 project items as
// they are in production today (names, aliases, revision 1). Proves the script
// only adds, writes a revision and audit row per item, refuses a link outside
// company c1, and changes nothing on a stale revision.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const OPS = readFileSync('supabase/ops/project_aliases_and_crm_links.sql', 'utf8').replace(/^begin;$/m, '').replace(/^-- Review the output[\s\S]*$/m, '');
const PROJECTS = [
  ['5a7991e8-80a8-4bf1-b226-e28992181cfb', 'Wecon Dakshinayan', ['dakshinayan', 'dakhsinayan']],
  ['74af220f-7de5-4262-81d6-094f814a8d9b', 'Wecon JM Heritage Mall', ['heritage', 'molla']],
  ['7a35fb8b-7dbc-4141-9202-6cbfa0891e83', 'Wecon Iqbal Orchid', ['orchid', 'iqbal']],
  ['c934b614-9161-4e57-a3da-eb60bd23ef03', 'Momtaz Manor', ['momtaz']],
  ['c31db120-c934-4e6d-bb7a-bcdfcc8e89bf', 'Wecon Summer Breeze', ['summer breeze', 'summer']],
  ['5d3405cd-edb6-4675-91d6-810e36f297df', 'Wecon Chowdhury Arcade', ['chowdhury arcade', 'arcade', 'dokan bikroy', 'bikroy utsob']],
  ['e61b9c19-96ed-4f52-9c63-a13e4941de86', 'Wecon South Dale', ['south dale', 'southdale']],
  ['b93886bc-4c46-4fc7-b79e-2a6b3e0ab516', 'Shafiq Sapphire', ['shafiq', 'sapphire']],
  ['44410a77-c89c-42b2-a3e2-7c1c4594c39b', 'Wecon Osman Bellevue', ['osman', 'bellevue']],
  ['52126834-95bd-4a31-b93d-36c6dff4252a', 'P2P Helthcare', ['p2p', 'healthcare', 'helthcare']],
  ['e056e330-3f1b-4c62-99af-0dc170c3d375', 'Wecon Nuznan', ['nuznan']],
];
const PROPS = ['px4dl1be7mtb5mqdv', 'pxz4w57qtmrbz2gvm', 'pxmb7qyr9mv9gcxd4', 'px45mvl4ymqq7png2', 'pxeroye6lmrbx4wsr', 'pxbxg3k4tmtibp5iq', 'pxs45x1f2mv93hjsw'];

async function fresh({ propCompany = 'c1' } = {}) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table notifications (id text primary key, user_id text, type text, message text, lead_id text, is_read boolean, created_at timestamptz, company_id text);
    create table preleads (id bigint generated always as identity primary key, phone text unique, takeover boolean default false);
    create table properties (id text primary key, name text, company_id text);`);
  await db.exec(readFileSync('supabase/migrations/0037_ai_trainer.sql', 'utf8'));
  for (const id of PROPS) await db.query(`insert into properties values ($1, 'x', $2)`, [id, propCompany]);
  for (const [id, name, banglish] of PROJECTS) {
    const body = { name, aliases: { en: [name.toLowerCase()], banglish }, media: { photos: ['https://x/p.jpg'] }, legacy_wa_project_id: 1 };
    await db.query(`insert into ai_trainer_items (id, kind, bots, body, content_hash) values ($1, 'project', '{eyad,dubai}', $2, $3)`, [id, body, `h-${id}`]);
    await db.query(`insert into ai_trainer_item_revisions (item_id, revision, kind, status, bots, body, content_hash) values ($1, 1, 'project', 'active', '{eyad,dubai}', $2, $3)`, [id, body, `h-${id}`]);
  }
  return db;
}
let pass = 0;
const ok = async (name, fn) => { await fn(); pass++; console.log('ok', name); };
const items = async (db) => Object.fromEntries((await db.query(`select id, revision, body from ai_trainer_items`)).rows.map((r) => [r.id, r]));

await ok('adds Bengali and Banglish aliases and links only the six verified projects', async () => {
  const db = await fresh();
  await db.exec(OPS);
  const it = await items(db);
  const nz = it['e056e330-3f1b-4c62-99af-0dc170c3d375'];
  assert.equal(nz.revision, 2);
  assert.deepEqual(nz.body.aliases.bn, ['নুজনান', 'নুযনান']);
  assert.ok(nz.body.aliases.banglish.includes('nuznan') && nz.body.aliases.banglish.includes('nujnan'), 'old alias kept, new added');
  assert.deepEqual(nz.body.media, { photos: ['https://x/p.jpg'] }, 'other fields untouched');
  assert.equal(nz.body.legacy_wa_project_id, 1);
  const linked = Object.values(it).filter((r) => r.body.crm_property_id).map((r) => r.body.name).sort();
  assert.deepEqual(linked, ['Shafiq Sapphire', 'Wecon Dakshinayan', 'Wecon JM Heritage Mall', 'Wecon Nuznan', 'Wecon Osman Bellevue', 'Wecon South Dale']);
  assert.equal(it['c934b614-9161-4e57-a3da-eb60bd23ef03'].body.crm_property_id, undefined, 'Momtaz Manor stays unlinked');
});

await ok('every change is a new revision with an audit row', async () => {
  const db = await fresh();
  await db.exec(OPS);
  assert.equal((await db.query(`select count(*)::int n from ai_trainer_item_revisions where revision = 2`)).rows[0].n, 11);
  const a = (await db.query(`select actor_claimed, reason from ai_trainer_audit where action = 'update'`)).rows;
  assert.equal(a.length, 11); assert.ok(a.every((r) => r.actor_claimed === 'ops project aliases (owner reviewed)'));
});

await ok('a link to a property outside company c1 stops the whole script', async () => {
  const db = await fresh({ propCompany: 'c2' });
  await assert.rejects(db.exec(OPS), /company c1/);
  assert.ok(Object.values(await items(db)).every((r) => r.revision === 1), 'nothing changed');
});

await ok('an item edited since the review raises revision_conflict and nothing changes', async () => {
  const db = await fresh();
  await db.query(`update ai_trainer_items set revision = 2 where id = 'e056e330-3f1b-4c62-99af-0dc170c3d375'`);
  await assert.rejects(db.exec(`begin; ${OPS} commit;`), /revision_conflict/);
  await db.exec('rollback').catch(() => {});
  assert.equal((await db.query(`select count(*)::int n from ai_trainer_audit`)).rows[0].n, 0);
});

console.log(`\n${pass} passed`);
