-- AI Trainer: tag the 10 project fact sheets with their project. NOT applied.
-- Not a migration (no schema change): a one-off, owner-run data update.
-- Owner review required; run in Supabase Dashboard → SQL Editor.
--
-- Why. The fact sheets in ai_trainer_documents were indexed with
-- project_ref = null, so ai_match_doc_chunks (migration 0047) returns them
-- for every project: on 2026-10-19 a Nuznan photo question retrieved two
-- Momtaz Manor sections. A tagged chunk answers only when its project is in
-- scope (c.project_ref = any(p_projects)).
--
-- What. ai_trainer_chunks is append-only (migration 0045), so chunks are not
-- edited. As the AI Trainer does on any change, each document gets a new
-- version with the project set, and the chunks of the old indexed version are
-- copied to the new version with the project. Text and embeddings are the
-- same, so nothing is re-embedded and the documents stay "indexed". The old
-- version's chunks stay as history and stop matching, because
-- ai_match_doc_chunks reads only d.indexed_version. One audit row per
-- document. "WECON sales offices" is about every project and stays untagged.
--
-- Pairs come from a read-only match on 2026-10-20: the title is
-- "<project name> fact sheet" and the name is the active project item's.
-- The check below stops if any id, title or project name no longer matches.

begin;

create temporary table _tag_plan (doc uuid, project uuid, title text) on commit drop;
insert into _tag_plan values
  ('8390fac2-afa5-413a-ab59-464d666fe72b', 'c934b614-9161-4e57-a3da-eb60bd23ef03', 'Momtaz Manor fact sheet'),
  ('1571754d-9cef-4c35-860b-84277954f444', 'b93886bc-4c46-4fc7-b79e-2a6b3e0ab516', 'Shafiq Sapphire fact sheet'),
  ('a9316afb-712c-4941-9a62-07f196a206bc', '5d3405cd-edb6-4675-91d6-810e36f297df', 'Wecon Chowdhury Arcade fact sheet'),
  ('68e12c90-18b2-47bd-826e-d6ab447ef1f4', '5a7991e8-80a8-4bf1-b226-e28992181cfb', 'Wecon Dakshinayan fact sheet'),
  ('ab29bd80-ac1e-49ec-9099-607c36c637a6', '7a35fb8b-7dbc-4141-9202-6cbfa0891e83', 'Wecon Iqbal Orchid fact sheet'),
  ('c1d58e46-e4ca-4453-b553-d69fbefb813e', '74af220f-7de5-4262-81d6-094f814a8d9b', 'Wecon JM Heritage Mall fact sheet'),
  ('0cd5ef6b-5aa5-4436-8c9b-3b918842dc4c', 'e056e330-3f1b-4c62-99af-0dc170c3d375', 'Wecon Nuznan fact sheet'),
  ('1674249d-9f21-4162-ae82-cf29648ac01b', '44410a77-c89c-42b2-a3e2-7c1c4594c39b', 'Wecon Osman Bellevue fact sheet'),
  ('13be784a-27a0-4b40-b4f6-48c6c5f2a70a', 'e61b9c19-96ed-4f52-9c63-a13e4941de86', 'Wecon South Dale fact sheet'),
  ('8f289a4a-0318-4130-88a9-049a55281689', 'c31db120-c934-4e6d-bb7a-bcdfcc8e89bf', 'Wecon Summer Breeze fact sheet');

-- Stop unless every pair still holds: the document exists with that title and
-- no project, and the project is active and named as the title says.
do $$ begin
  if (select count(*) from _tag_plan t
        join ai_trainer_documents d on d.id = t.doc and d.title = t.title and d.project_ref is null
        join ai_trainer_items i on i.id = t.project and i.kind = 'project' and i.status = 'active'
             and t.title = (i.body->>'name') || ' fact sheet') <> 10 then
    raise exception 'a document or project changed since 2026-10-20; re-read before tagging';
  end if;
end $$;

-- Also stop unless each document is indexed and its indexed chunks exist.
do $$ begin
  if exists (select 1 from _tag_plan t join ai_trainer_documents d on d.id = t.doc
              where d.status <> 'indexed' or d.indexed_version <> d.version
                 or not exists (select 1 from ai_trainer_chunks c where c.document_id = d.id and c.document_version = d.version)) then
    raise exception 'a fact sheet is not indexed for its current version; index it from the AI Trainer first';
  end if;
end $$;

create temporary table _tag_before on commit drop as
  select d.id, d.version from ai_trainer_documents d join _tag_plan t on t.doc = d.id;

insert into ai_trainer_chunks (company_id, document_id, document_version, chunk_no, section, chunk_text, bots, project_ref,
                               embedding_model, embedding_dim, embedding, text_sha256)
select c.company_id, c.document_id, b.version + 1, c.chunk_no, c.section, c.chunk_text, c.bots, t.project,
       c.embedding_model, c.embedding_dim, c.embedding, c.text_sha256
  from ai_trainer_chunks c
  join _tag_before b on b.id = c.document_id and c.document_version = b.version
  join _tag_plan t on t.doc = c.document_id;

update ai_trainer_documents d set project_ref = t.project, version = b.version + 1, indexed_version = b.version + 1, updated_at = now()
  from _tag_plan t join _tag_before b on b.id = t.doc where d.id = t.doc;

insert into ai_trainer_audit (entity, entity_id, action, before, after, reason, actor_claimed)
select 'document', t.doc::text, 'update', jsonb_build_object('project_ref', null, 'version', b.version),
       jsonb_build_object('project_ref', t.project, 'version', b.version + 1),
       'Tag the fact sheet with its project so retrieval is project-scoped (chunks copied, not re-embedded)', 'ops doc fact-sheet project tags (owner reviewed)'
  from _tag_plan t join _tag_before b on b.id = t.doc;

-- Expect 10 documents, each tagged with the project of its title, and every
-- chunk of its new indexed version carrying that project.
select d.title, i.body->>'name' as project, d.version, d.status,
       (select count(*) from ai_trainer_chunks c where c.document_id = d.id and c.document_version = d.indexed_version and c.project_ref = d.project_ref) as tagged_chunks,
       (select count(*) from ai_trainer_chunks c where c.document_id = d.id and c.document_version = d.indexed_version) as indexed_chunks
  from ai_trainer_documents d join ai_trainer_items i on i.id = d.project_ref
 order by d.title;

-- Review the output, then COMMIT; or ROLLBACK to leave everything unchanged.
