-- AI Trainer vector retrieval (spec section 4.3, 5; the spec called this file
-- 0038, a number since taken). Additive. Creates the pgvector extension, the
-- immutable chunk table and the scope-first match function. Nothing reads it
-- until a snapshot is frozen in "vector" mode, which the trainer refuses until
-- the R0 retrieval gate passes (spec 5.4). Needs owner approval of pgvector.
--
-- The column has no fixed dimension, so a model change needs no table change;
-- embedding_dim is checked against the vector instead. Exact scan for now:
-- add an HNSW index on a dimension-cast expression above about 10,000 chunks.
--
-- Safe to run multiple times. Run in: Supabase Dashboard → SQL Editor.

create extension if not exists vector;

create table if not exists ai_trainer_chunks (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null,
  item_revision int not null,
  chunk_no int not null check (chunk_no >= 0),
  chunk_text text not null check (length(chunk_text) between 1 and 4000),
  bots text[] not null check (cardinality(bots) between 1 and 2 and bots <@ array['eyad','dubai']),
  project_ref uuid,
  embedding_model text not null check (embedding_model ~ '^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,127}$'),
  embedding_dim int not null check (embedding_dim between 1 and 4096),
  embedding vector not null,
  text_sha256 text not null,
  created_at timestamptz not null default now(),
  check (vector_dims(embedding) = embedding_dim),
  unique (item_id, item_revision, embedding_model, chunk_no),
  foreign key (item_id, item_revision) references ai_trainer_item_revisions (item_id, revision)
);
create index if not exists ai_trainer_chunks_model_idx on ai_trainer_chunks (embedding_model);

-- Chunks are referenced by snapshots by id, so they never change or go away.
drop trigger if exists ai_trainer_chunks_append_only on ai_trainer_chunks;
create trigger ai_trainer_chunks_append_only before update or delete on ai_trainer_chunks
  for each row execute function ai_reject_change();

-- Scope first, then rank: a chunk of another bot or an unresolved project can
-- never be returned, however similar. Only the snapshot's chunk ids and the
-- query's own model are eligible. Cosine distance; score = 1 - distance.
create or replace function ai_match_chunks(p_chunk_ids uuid[], p_model text, p_query vector, p_bot text, p_projects uuid[], p_k int)
returns table (id uuid, item_id uuid, item_revision int, chunk_no int, chunk_text text, score double precision)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_k is null or p_k < 1 or p_k > 50 then raise exception 'k must be between 1 and 50'; end if;
  return query
    select c.id, c.item_id, c.item_revision, c.chunk_no, c.chunk_text, 1 - (c.embedding <=> p_query)
      from ai_trainer_chunks c
     where c.id = any(p_chunk_ids)
       and c.embedding_model = p_model
       and c.embedding_dim = vector_dims(p_query)
       and p_bot = any(c.bots)
       and (c.project_ref is null or c.project_ref = any(coalesce(p_projects, '{}')))
     order by c.embedding <=> p_query, c.id
     limit p_k;
end $$;

alter table ai_trainer_chunks enable row level security;
revoke all on ai_trainer_chunks from anon, authenticated;
revoke all on function ai_match_chunks(uuid[], text, vector, text, uuid[], int) from public, anon, authenticated;
grant execute on function ai_match_chunks(uuid[], text, vector, text, uuid[], int) to service_role;

notify pgrst, 'reload schema';
