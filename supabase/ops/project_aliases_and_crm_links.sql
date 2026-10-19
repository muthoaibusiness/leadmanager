-- AI Trainer: reviewed project aliases and CRM property links. NOT applied.
-- Not a migration (no schema change): a one-off, owner-run data update.
-- Owner review required; run in Supabase Dashboard → SQL Editor.
--
-- Changes only ai_trainer_items rows of kind 'project', through ai_item_save,
-- so each change is a new item revision with an audit row (actor below). It
-- changes drafts only: nothing a customer sees moves until a snapshot is
-- published and a bot reads it.
--
-- Aliases. Today's aliases have no Bengali script at all, so "নুজনান" resolved
-- to no project (2 of 16 checks passed; with these, 16 of 16). Generic words
-- (summer, arcade, mall, manor, heritage, ...) stay ignored on their own by
-- trainer-core's GENERIC list.
--
-- CRM links (crm_property_id → properties.id, company c1), from a read-only
-- match on 2026-10-19:
--   linked, name and address both match:  Dakshinayan, JM Heritage Mall,
--     Shafiq Sapphire, Osman Bellevue, Nuznan
--   linked, name matches and address matches except formatting: South Dale
--     (the CRM row omits "Plot - 32")
--   NOT linked:
--     Momtaz Manor: the name matches "WECON MOMTAZ MANOR" but that CRM row has
--       no address, so the second check is impossible. Link it after someone
--       confirms it is the same building (Wecon also has "WECON JAFAR MANOR"
--       on the same road).
--     Iqbal Orchid, Summer Breeze, Chowdhury Arcade, P2P Helthcare: no CRM
--       property row exists for them.
--   CRM rows with no trainer project: CHAIRMAN PALACE, CITIZEN AVENUE MALL,
--     WECON AHMED NORTHDALE, WECON JAFAR MANOR.
--
-- Each update is pinned to the revision read on 2026-10-19 (revision 1). If
-- an item was edited since, ai_item_save raises revision_conflict and nothing
-- changes for that item: re-read and re-review it.

begin;

create temporary table _alias_plan (id uuid, legacy int, crm text, bn text[], banglish_add text[]) on commit drop;
insert into _alias_plan values
  ('5a7991e8-80a8-4bf1-b226-e28992181cfb', 1,  'px4dl1be7mtb5mqdv', '{দক্ষিণায়ন,দক্ষিনায়ন}',            '{dakkhinayan,dokkhinayon,dakshinayon}'),
  ('74af220f-7de5-4262-81d6-094f814a8d9b', 2,  'pxz4w57qtmrbz2gvm', '{হেরিটেজ,জেএম হেরিটেজ,হেরিটেজ মল}',   '{jm heritage,heritage mall,jm mall}'),
  ('7a35fb8b-7dbc-4141-9202-6cbfa0891e83', 3,  null,                '{ইকবাল অর্কিড,অর্কিড}',               '{iqbal orchid,ikbal orchid,orkid}'),
  ('c934b614-9161-4e57-a3da-eb60bd23ef03', 4,  null,                '{মমতাজ,মমতাজ ম্যানর}',               '{momtaz manor,mumtaz manor,momtaj}'),
  ('c31db120-c934-4e6d-bb7a-bcdfcc8e89bf', 5,  null,                '{সামার ব্রিজ}',                     '{somar breeze,summerbreeze}'),
  ('5d3405cd-edb6-4675-91d6-810e36f297df', 6,  null,                '{চৌধুরী আর্কেড}',                   '{chowdhury market,chowdhuri arcade}'),
  ('e61b9c19-96ed-4f52-9c63-a13e4941de86', 7,  'pxmb7qyr9mv9gcxd4', '{সাউথ ডেল,সাউথডেল}',                '{south del,saudhdale}'),
  ('b93886bc-4c46-4fc7-b79e-2a6b3e0ab516', 8,  'px45mvl4ymqq7png2', '{শফিক স্যাফায়ার,স্যাফায়ার,শফিক}',     '{shafik,safiq sapphire,saphire,shafiq saphire}'),
  ('44410a77-c89c-42b2-a3e2-7c1c4594c39b', 9,  'pxeroye6lmrbx4wsr', '{ওসমান বেলভিউ,ওসমান}',              '{osman belle,belleview,usman bellevue}'),
  ('52126834-95bd-4a31-b93d-36c6dff4252a', 10, null,                '{পিটুপি,হেলথকেয়ার}',                 '{p2p healthcare}'),
  ('e056e330-3f1b-4c62-99af-0dc170c3d375', 11, 'pxbxg3k4tmtibp5iq', '{নুজনান,নুযনান}',                   '{nujnan,nuzhnan,nuznun,nusnan}');

-- Stop if a linked property is missing or belongs to another company.
do $$ begin
  if exists (select 1 from _alias_plan a where a.crm is not null
             and not exists (select 1 from properties p where p.id = a.crm and p.company_id = 'c1')) then
    raise exception 'a crm_property_id does not exist in company c1';
  end if;
end $$;

-- The new body keeps every existing field and alias; it only adds.
select a.legacy, i.body->>'name' as name,
       ai_item_save(
         jsonb_build_object('id', i.id, 'kind', i.kind, 'bots', to_jsonb(i.bots), 'project_ref', i.project_ref, 'status', 'active',
           'body', b.body, 'content_hash', encode(sha256(convert_to('project|' || b.body::text, 'utf8')), 'hex')),
         1, 'ops project aliases (owner reviewed)', 'Add Bengali and Banglish aliases and CRM link') as saved
  from _alias_plan a
  join ai_trainer_items i on i.id = a.id and i.kind = 'project'
  cross join lateral (select jsonb_set(
           jsonb_set(case when a.crm is null then i.body else i.body || jsonb_build_object('crm_property_id', a.crm) end,
             '{aliases,bn}', to_jsonb(a.bn)),
           '{aliases,banglish}',
           (select to_jsonb(array_agg(distinct x)) from unnest(array(select jsonb_array_elements_text(coalesce(i.body->'aliases'->'banglish', '[]'))) || a.banglish_add) x)
         ) as body) b
 order by a.legacy;

-- Review the output, then COMMIT; or ROLLBACK to leave everything unchanged.
-- Note: content_hash here is a SQL-side approximation used only for the
-- duplicate check; the next save from the AI Trainer UI recomputes it.
