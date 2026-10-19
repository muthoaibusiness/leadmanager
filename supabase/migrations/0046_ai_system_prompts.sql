-- AI Trainer system prompt: the operator's own instructions to the model, one
-- per bot, edited as a draft and published as an immutable version.
--
-- ai_system_prompts holds every saved version (append-only). The draft is the
-- newest row with status 'draft'; Publish copies it into a new 'published'
-- row and moves ai_system_prompt_pointers to it. Rollback moves the pointer to
-- an older published row. A pointer never names a draft.
--
-- Only the Playground and trainer test-number turns read these. The live
-- customer bots use the legacy FAQ agent (_shared/ai.ts) and do not read this
-- table, so nothing here changes what a customer receives.
--
-- Same rule as every ai_ table: RLS on, no policy, no anon/authenticated grant.
-- Additive and safe to run more than once.

create table if not exists ai_system_prompts (
  id uuid primary key default gen_random_uuid(),
  bot text not null check (bot in ('eyad','dubai')),
  company_id text not null default 'c1',
  version_no int not null,
  status text not null check (status in ('draft','published')),
  body text not null check (length(body) between 1 and 12000),
  sha256 text not null,
  note text,
  created_at timestamptz not null default now(),
  created_by_claimed text not null,
  unique (bot, company_id, version_no)
);
create index if not exists ai_system_prompts_bot on ai_system_prompts (bot, company_id, version_no desc);

create table if not exists ai_system_prompt_pointers (
  bot text not null check (bot in ('eyad','dubai')),
  company_id text not null default 'c1',
  prompt_id uuid references ai_system_prompts(id),
  changed_at timestamptz not null default now(),
  changed_by_claimed text not null default 'system',
  reason text,
  primary key (bot, company_id)
);

-- Versions are immutable once written; a draft is replaced by a newer draft row.
create or replace function ai_system_prompt_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'ai_system_prompts rows are immutable';
end $$;
drop trigger if exists ai_system_prompts_immutable on ai_system_prompts;
create trigger ai_system_prompts_immutable before update or delete on ai_system_prompts
  for each row execute function ai_system_prompt_guard();

-- A pointer may only name a published version of the same bot and company.
create or replace function ai_system_prompt_pointer_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.prompt_id is not null and not exists (
    select 1 from public.ai_system_prompts p
     where p.id = new.prompt_id and p.status = 'published' and p.bot = new.bot and p.company_id = new.company_id) then
    raise exception 'pointer must reference a published prompt of the same bot and company';
  end if;
  return new;
end $$;
drop trigger if exists ai_system_prompt_pointers_guard on ai_system_prompt_pointers;
create trigger ai_system_prompt_pointers_guard before insert or update on ai_system_prompt_pointers
  for each row execute function ai_system_prompt_pointer_guard();

insert into ai_system_prompt_pointers (bot, company_id) values ('eyad','c1'), ('dubai','c1') on conflict do nothing;

do $$ declare t text; begin
  foreach t in array array['ai_system_prompts','ai_system_prompt_pointers'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon, authenticated', t);
  end loop;
end $$;
revoke all on function ai_system_prompt_guard() from public, anon, authenticated;
revoke all on function ai_system_prompt_pointer_guard() from public, anon, authenticated;

notify pgrst, 'reload schema';
