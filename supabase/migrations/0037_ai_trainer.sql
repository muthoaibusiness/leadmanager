-- AI Trainer (docs/superpowers/specs/2026-10-18-wecon-ai-trainer-design.md).
-- Additive only: no existing table is changed. Every table has RLS on and no
-- policy, so the browser never reads or writes them over PostgREST; the
-- ai-trainer Edge Function does, with the service role. Both bot pointers are
-- seeded as 'legacy', so the bots keep their current behaviour until a
-- deliberate, tested cutover. gen_random_uuid() is built into Postgres 13+,
-- so no extension is needed.

-- ── content ────────────────────────────────────────────────────────────────
create table if not exists ai_trainer_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('project','fact','rule','behaviour','example')),
  revision int not null default 1,
  status text not null default 'active' check (status in ('active','retired')),
  bots text[] not null check (cardinality(bots) between 1 and 2 and bots <@ array['eyad','dubai']),
  project_ref uuid references ai_trainer_items(id),
  body jsonb not null check (jsonb_typeof(body) = 'object'),
  content_hash text not null,
  retired_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (project_ref is null or kind in ('fact','rule','example')),
  check (status = 'active' or coalesce(retired_reason, '') <> '')
);
create unique index if not exists ai_trainer_items_active_hash on ai_trainer_items (kind, content_hash) where status = 'active';

create table if not exists ai_trainer_item_revisions (
  item_id uuid not null references ai_trainer_items(id),
  revision int not null,
  kind text not null,
  status text not null,
  bots text[] not null,
  project_ref uuid,
  body jsonb not null,
  content_hash text not null,
  created_at timestamptz not null default now(),
  primary key (item_id, revision)
);

create table if not exists ai_trainer_audit (
  id bigint generated always as identity primary key,
  entity text not null,
  entity_id text not null,
  action text not null,
  before jsonb,
  after jsonb,
  reason text,
  actor_claimed text not null,
  auth_method text not null default 'trainer_key',
  verified_user_id text,
  at timestamptz not null default now()
);

-- ── tests ──────────────────────────────────────────────────────────────────
create table if not exists ai_tests (
  id uuid primary key default gen_random_uuid(),
  revision int not null default 1,
  status text not null default 'active' check (status in ('active','retired')),
  bots text[] not null check (cardinality(bots) between 1 and 2 and bots <@ array['eyad','dubai']),
  spec jsonb not null check (jsonb_typeof(spec) = 'object'),
  origin text not null check (origin in ('playground','real','handwritten')),
  retired_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status = 'active' or coalesce(retired_reason, '') <> '')
);

create table if not exists ai_test_revisions (
  test_id uuid not null references ai_tests(id),
  revision int not null,
  status text not null,
  bots text[] not null,
  spec jsonb not null,
  change_reason text,
  created_at timestamptz not null default now(),
  primary key (test_id, revision)
);

-- ── snapshots and pointers ─────────────────────────────────────────────────
create table if not exists ai_snapshots (
  id uuid primary key default gen_random_uuid(),
  version_no int not null unique,
  status text not null default 'candidate' check (status in ('candidate','published')),
  content jsonb not null,
  checksum text not null,
  core_version_frozen text not null,
  created_by_claimed text not null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  published_by_claimed text
);

create table if not exists ai_bot_pointers (
  bot text primary key check (bot in ('eyad','dubai')),
  mode text not null default 'legacy' check (mode in ('legacy','snapshot')),
  snapshot_id uuid references ai_snapshots(id),
  changed_at timestamptz not null default now(),
  changed_by_claimed text,
  reason text,
  check ((mode = 'legacy' and snapshot_id is null) or (mode = 'snapshot' and snapshot_id is not null))
);
insert into ai_bot_pointers (bot) values ('eyad'), ('dubai') on conflict do nothing;

-- ── runs ───────────────────────────────────────────────────────────────────
create table if not exists ai_test_runs (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references ai_snapshots(id),
  snapshot_checksum text not null,
  bot text not null check (bot in ('eyad','dubai')),
  core_version text not null,
  reply_model text not null,
  judge_model text not null,
  prompt_version text not null,
  rubric_version text not null,
  status text not null default 'running' check (status in ('running','complete','incomplete','aborted')),
  test_ids uuid[] not null,
  counts jsonb not null default '{}',
  cost_usd numeric not null default 0,
  started_by_claimed text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists ai_test_results (
  id bigint generated always as identity primary key,
  run_id uuid not null references ai_test_runs(id),
  test_id uuid not null,
  test_revision int not null,
  reply jsonb not null,
  checks jsonb not null,
  judge jsonb not null,
  verdict text not null check (verdict in ('PASS','FAIL','INCONCLUSIVE')),
  created_at timestamptz not null default now(),
  unique (run_id, test_id)
);

create table if not exists ai_trainer_imports (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  report jsonb not null,
  actor_claimed text not null,
  at timestamptz not null default now()
);

-- ── runtime tables used at bot cutover (created now, unused in the MVP) ────
create table if not exists ai_conversation_state (
  conversation_id text primary key,
  bot text not null check (bot in ('eyad','dubai')),
  state jsonb not null default '{}',
  paused boolean not null default false,
  lease_turn_id uuid,
  lease_until timestamptz,
  revision int not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists ai_turns (
  id uuid primary key default gen_random_uuid(),
  bot text not null,
  conversation_id text not null,
  snapshot_id uuid,
  snapshot_checksum text,
  core_version text not null,
  model text,
  trace jsonb,
  outcome text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists ai_handoffs (
  id uuid primary key default gen_random_uuid(),
  conversation_id text not null,
  bot text not null,
  reason text not null,
  turn_id uuid,
  status text not null default 'open' check (status in ('open','closed')),
  notify_status text not null default 'pending' check (notify_status in ('pending','sent','failed')),
  notify_attempts int not null default 0,
  notify_last_error text,
  customer_msg_status text not null default 'pending' check (customer_msg_status in ('pending','sent','failed','skipped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists ai_handoffs_one_open on ai_handoffs (conversation_id) where status = 'open';

-- ── budget ─────────────────────────────────────────────────────────────────
create table if not exists ai_budget_days (
  pool text not null check (pool in ('trainer','live')),
  day date not null,
  limit_usd numeric not null,
  reserved_usd numeric not null default 0,
  spent_usd numeric not null default 0,
  primary key (pool, day)
);

create table if not exists ai_budget_reservations (
  id uuid primary key default gen_random_uuid(),
  pool text not null,
  day date not null,
  estimate_usd numeric not null check (estimate_usd > 0),
  actual_usd numeric,
  status text not null default 'reserved' check (status in ('reserved','settled','released')),
  created_at timestamptz not null default now()
);

-- One statement, row-locked: concurrent callers serialise on the day row, so
-- reserved + spent can never exceed the limit. Reservations older than 10
-- minutes that were never settled are first counted as spent at their
-- estimate, so a crash only ever makes the budget stricter.
create or replace function ai_budget_reserve(p_pool text, p_estimate numeric, p_limit numeric)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_day date := (now() at time zone 'Asia/Dhaka')::date; v_id uuid; v_ok int;
begin
  insert into ai_budget_days (pool, day, limit_usd) values (p_pool, v_day, p_limit) on conflict do nothing;
  perform 1 from ai_budget_days where pool = p_pool and day = v_day for update;
  with stale as (
    update ai_budget_reservations set status = 'settled', actual_usd = estimate_usd
     where pool = p_pool and day = v_day and status = 'reserved' and created_at < now() - interval '10 minutes'
     returning estimate_usd)
  update ai_budget_days set reserved_usd = reserved_usd - coalesce((select sum(estimate_usd) from stale), 0),
                            spent_usd = spent_usd + coalesce((select sum(estimate_usd) from stale), 0)
   where pool = p_pool and day = v_day;
  update ai_budget_days set reserved_usd = reserved_usd + p_estimate
   where pool = p_pool and day = v_day and spent_usd + reserved_usd + p_estimate <= limit_usd;
  get diagnostics v_ok = row_count;
  if v_ok = 0 then return null; end if;
  insert into ai_budget_reservations (pool, day, estimate_usd) values (p_pool, v_day, p_estimate) returning id into v_id;
  return v_id;
end $$;

create or replace function ai_budget_settle(p_id uuid, p_actual numeric)
returns void language plpgsql security definer set search_path = public as $$
declare r ai_budget_reservations;
begin
  update ai_budget_reservations set status = 'settled', actual_usd = p_actual
   where id = p_id and status = 'reserved' returning * into r;
  if not found then return; end if;
  update ai_budget_days set reserved_usd = reserved_usd - r.estimate_usd, spent_usd = spent_usd + p_actual
   where pool = r.pool and day = r.day;
end $$;

create or replace function ai_budget_release(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r ai_budget_reservations;
begin
  update ai_budget_reservations set status = 'released' where id = p_id and status = 'reserved' returning * into r;
  if not found then return; end if;
  update ai_budget_days set reserved_usd = reserved_usd - r.estimate_usd where pool = r.pool and day = r.day;
end $$;

-- ── item save: revision check, revision copy and audit in one transaction ──
-- p_item: {id?, kind, bots, project_ref, body, content_hash, status?}.
-- p_expected_revision: 0 for a new item, else the revision the editor loaded.
-- Raises 'revision_conflict' on a stale save and 'duplicate_content' on a
-- second active item with the same content.
create or replace function ai_item_save(p_item jsonb, p_expected_revision int, p_actor text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_before ai_trainer_items; v_after ai_trainer_items; v_status text := coalesce(p_item->>'status', 'active');
begin
  if v_status = 'retired' and coalesce(p_reason, '') = '' then raise exception 'reason_required'; end if;
  if p_expected_revision = 0 then
    insert into ai_trainer_items (kind, bots, project_ref, body, content_hash, status, retired_reason)
    values (p_item->>'kind', array(select jsonb_array_elements_text(p_item->'bots')),
            nullif(p_item->>'project_ref', '')::uuid, p_item->'body', p_item->>'content_hash', v_status,
            case when v_status = 'retired' then p_reason end)
    returning * into v_after;
  else
    select * into v_before from ai_trainer_items where id = (p_item->>'id')::uuid for update;
    if not found then raise exception 'not_found'; end if;
    if v_before.revision <> p_expected_revision then raise exception 'revision_conflict'; end if;
    update ai_trainer_items set
      bots = array(select jsonb_array_elements_text(p_item->'bots')),
      project_ref = nullif(p_item->>'project_ref', '')::uuid,
      body = p_item->'body', content_hash = p_item->>'content_hash', status = v_status,
      retired_reason = case when v_status = 'retired' then p_reason end,
      revision = revision + 1, updated_at = now()
    where id = v_before.id returning * into v_after;
  end if;
  insert into ai_trainer_item_revisions (item_id, revision, kind, status, bots, project_ref, body, content_hash)
  values (v_after.id, v_after.revision, v_after.kind, v_after.status, v_after.bots, v_after.project_ref, v_after.body, v_after.content_hash);
  insert into ai_trainer_audit (entity, entity_id, action, before, after, reason, actor_claimed)
  values ('item', v_after.id::text, case when v_before.id is null then 'create' when v_status = 'retired' then 'retire' else 'update' end,
          to_jsonb(v_before), to_jsonb(v_after), p_reason, p_actor);
  return jsonb_build_object('id', v_after.id, 'revision', v_after.revision);
exception when unique_violation then raise exception 'duplicate_content';
end $$;

-- ── immutability triggers ──────────────────────────────────────────────────
create or replace function ai_reject_change() returns trigger language plpgsql as $$
begin raise exception '% is append-only', tg_table_name; end $$;

do $$ declare t text; begin
  foreach t in array array['ai_trainer_item_revisions','ai_trainer_audit','ai_test_revisions','ai_test_results','ai_trainer_imports'] loop
    execute format('drop trigger if exists %I_append_only on %I', t, t);
    execute format('create trigger %I_append_only before update or delete on %I for each row execute function ai_reject_change()', t, t);
  end loop;
end $$;

-- A snapshot's content and checksum never change. The only allowed update is
-- publishing it once: status candidate → published with publisher and time.
create or replace function ai_snapshot_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'ai_snapshots cannot be deleted'; end if;
  if new.content is distinct from old.content or new.checksum is distinct from old.checksum
     or new.version_no is distinct from old.version_no or new.core_version_frozen is distinct from old.core_version_frozen
     or new.created_by_claimed is distinct from old.created_by_claimed or new.created_at is distinct from old.created_at then
    raise exception 'ai_snapshots content is immutable';
  end if;
  if old.status = 'published' and (new.status <> 'published' or new.published_at is distinct from old.published_at
     or new.published_by_claimed is distinct from old.published_by_claimed) then
    raise exception 'ai_snapshots publish fields are set once';
  end if;
  return new;
end $$;
drop trigger if exists ai_snapshots_guard on ai_snapshots;
create trigger ai_snapshots_guard before update or delete on ai_snapshots for each row execute function ai_snapshot_guard();

-- A run is finalised once; after that it cannot change.
create or replace function ai_run_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'ai_test_runs cannot be deleted'; end if;
  if old.status <> 'running' then raise exception 'ai_test_runs is final'; end if;
  return new;
end $$;
drop trigger if exists ai_test_runs_guard on ai_test_runs;
create trigger ai_test_runs_guard before update or delete on ai_test_runs for each row execute function ai_run_guard();

-- Pointer in snapshot mode must reference a published snapshot.
create or replace function ai_pointer_guard() returns trigger language plpgsql as $$
begin
  if new.mode = 'snapshot' and not exists (select 1 from ai_snapshots where id = new.snapshot_id and status = 'published') then
    raise exception 'pointer must reference a published snapshot';
  end if;
  return new;
end $$;
drop trigger if exists ai_bot_pointers_guard on ai_bot_pointers;
create trigger ai_bot_pointers_guard before insert or update on ai_bot_pointers for each row execute function ai_pointer_guard();

-- ── access: service role only ──────────────────────────────────────────────
do $$ declare t text; begin
  foreach t in array array['ai_trainer_items','ai_trainer_item_revisions','ai_trainer_audit','ai_tests','ai_test_revisions',
    'ai_snapshots','ai_bot_pointers','ai_test_runs','ai_test_results','ai_trainer_imports','ai_conversation_state','ai_turns',
    'ai_handoffs','ai_budget_days','ai_budget_reservations'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon, authenticated', t);
  end loop;
end $$;
revoke all on function ai_budget_reserve(text, numeric, numeric), ai_budget_settle(uuid, numeric), ai_budget_release(uuid),
  ai_item_save(jsonb, int, text, text) from public, anon, authenticated;
grant execute on function ai_budget_reserve(text, numeric, numeric), ai_budget_settle(uuid, numeric), ai_budget_release(uuid),
  ai_item_save(jsonb, int, text, text) to service_role;
