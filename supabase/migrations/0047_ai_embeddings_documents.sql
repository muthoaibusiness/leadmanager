-- AI Trainer embeddings and Markdown documents. Needs 0043 (model configs,
-- Vault key functions) and 0045 (pgvector, ai_trainer_chunks).
--
-- 1. ai_model_configs gains scope 'embedding': provider, base URL, model id
--    and dimension for the embedding model, with its own Vault key
--    (ai_model_key_embedding) bound to its own host.
-- 2. ai_trainer_documents: one Markdown/text (or reviewed PDF text) document
--    per row, versioned. Status: draft, reviewed, indexing, indexed, failed,
--    needs_reindex. Only a reviewed document is indexed; editing it bumps the
--    version and marks it needs_reindex.
-- 3. ai_trainer_chunks gains company_id, document_id and document_version so
--    a chunk is tied to one company, one document version and one model.
--    item_id/item_revision become optional (a chunk comes from an item or a
--    document, never both).
-- 4. ai_match_doc_chunks: scope-first similarity search over document chunks
--    of one company, one model and one dimension.
--
-- RLS on, no anon/authenticated grant, service role only. Safe to re-run.

alter table ai_model_configs drop constraint if exists ai_model_configs_scope_check;
alter table ai_model_configs add constraint ai_model_configs_scope_check check (scope in ('playground', 'embedding'));
alter table ai_model_configs add column if not exists embedding_dim int check (embedding_dim is null or embedding_dim between 1 and 4096);
alter table ai_model_configs add column if not exists company_id text not null default 'c1';
-- The chat scope never carries a dimension; the embedding scope always does.
alter table ai_model_configs drop constraint if exists ai_model_configs_dim_scope;
alter table ai_model_configs add constraint ai_model_configs_dim_scope
  check ((scope = 'embedding') = (embedding_dim is not null));

create table if not exists ai_trainer_documents (
  id uuid primary key default gen_random_uuid(),
  company_id text not null default 'c1',
  title text not null check (length(title) between 1 and 200),
  format text not null check (format in ('markdown', 'text', 'pdf_text')),
  source_name text check (source_name is null or length(source_name) <= 200),
  body text not null check (length(body) between 1 and 200000),
  version int not null default 1 check (version >= 1),
  status text not null default 'draft' check (status in ('draft','reviewed','indexing','indexed','failed','needs_reindex')),
  bots text[] not null default array['eyad','dubai'] check (cardinality(bots) between 1 and 2 and bots <@ array['eyad','dubai']),
  project_ref uuid,
  index_model text,
  index_dim int,
  indexed_version int,
  index_error text,
  reviewed_by_claimed text,
  reviewed_at timestamptz,
  created_by_claimed text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Indexed means: the current version, for a named model and dimension.
  check (status <> 'indexed' or (index_model is not null and index_dim is not null and indexed_version = version)),
  check (status <> 'failed' or index_error is not null)
);
create index if not exists ai_trainer_documents_company on ai_trainer_documents (company_id, status);

alter table ai_trainer_chunks add column if not exists company_id text not null default 'c1';
alter table ai_trainer_chunks add column if not exists document_id uuid references ai_trainer_documents(id);
alter table ai_trainer_chunks add column if not exists document_version int;
alter table ai_trainer_chunks add column if not exists section text check (section is null or length(section) <= 300);
alter table ai_trainer_chunks alter column item_id drop not null;
alter table ai_trainer_chunks alter column item_revision drop not null;
alter table ai_trainer_chunks drop constraint if exists ai_trainer_chunks_one_source;
alter table ai_trainer_chunks add constraint ai_trainer_chunks_one_source check (
  (item_id is not null and item_revision is not null and document_id is null and document_version is null)
  or (item_id is null and item_revision is null and document_id is not null and document_version is not null));
create unique index if not exists ai_trainer_chunks_doc_unique
  on ai_trainer_chunks (document_id, document_version, embedding_model, chunk_no) where document_id is not null;
create index if not exists ai_trainer_chunks_company_model on ai_trainer_chunks (company_id, embedding_model);

-- Similarity over the chunks of indexed documents, one company, one model, one
-- dimension. Scope is filtered before ranking: bot, project, and the exact
-- document versions that are indexed now (a stale version never answers).
create or replace function ai_match_doc_chunks(p_company text, p_model text, p_query vector, p_bot text, p_projects uuid[], p_k int)
returns table (id uuid, document_id uuid, document_version int, chunk_no int, section text, chunk_text text, title text, score double precision)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_k is null or p_k < 1 or p_k > 50 then raise exception 'k must be between 1 and 50'; end if;
  return query
    select c.id, c.document_id, c.document_version, c.chunk_no, c.section, c.chunk_text, d.title, 1 - (c.embedding <=> p_query)
      from ai_trainer_chunks c
      join ai_trainer_documents d on d.id = c.document_id and d.indexed_version = c.document_version
     where c.company_id = p_company and d.company_id = p_company
       and d.status = 'indexed' and d.index_model = p_model
       and c.embedding_model = p_model
       and c.embedding_dim = vector_dims(p_query)
       and p_bot = any(c.bots)
       and (c.project_ref is null or c.project_ref = any(coalesce(p_projects, '{}')))
     order by c.embedding <=> p_query, c.id
     limit p_k;
end $$;

alter table ai_trainer_documents enable row level security;
revoke all on ai_trainer_documents from anon, authenticated;
revoke all on function ai_match_doc_chunks(text, text, vector, text, uuid[], int) from public, anon, authenticated;
grant execute on function ai_match_doc_chunks(text, text, vector, text, uuid[], int) to service_role;

notify pgrst, 'reload schema';
