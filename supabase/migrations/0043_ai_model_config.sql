-- AI Trainer Playground model configuration.
--
-- One row per scope. Only 'playground' exists in this phase: the Playground
-- calls the provider, base URL and model stored here. Test runs, the judge,
-- test numbers and the live bots keep the OPENROUTER_* Edge Function secrets,
-- so nothing here changes what a WhatsApp customer receives. A 'live' scope
-- is a later, separately approved change.
--
-- The API key is never in this table. It is a Supabase Vault secret
-- (vault.secrets, encrypted at rest) named ai_model_key_<scope>; the row keeps
-- only its id, last 4 characters and the host it was entered for (key_host).
-- The handler sends the key only to that host, so changing base_url never
-- forwards a stored key elsewhere. The two functions below are the only way
-- in, and only the service role (the ai-trainer Edge Function, after its
-- Management check) may execute them.
--
-- Same table rule as every ai_ table (migration 0037): RLS on, no policy, no
-- anon/authenticated grant.
--
-- Additive and safe to run multiple times. Needs the supabase_vault
-- extension (installed by default on Supabase). Run in: Supabase Dashboard → SQL Editor.

create table if not exists ai_model_configs (
  scope text primary key check (scope in ('playground')),
  provider text not null check (provider in ('openrouter','openai','custom')),
  base_url text not null check (base_url ~ '^https://' and length(base_url) <= 300),
  model text not null check (model ~ '^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,127}$'),
  key_secret_id uuid,
  key_host text,
  key_last4 text check (key_last4 is null or length(key_last4) <= 4),
  key_set_at timestamptz,
  last_test jsonb,
  updated_at timestamptz not null default now(),
  updated_by_claimed text not null
);

-- Re-runs on a table created by an earlier draft of this file.
alter table ai_model_configs add column if not exists key_host text;

alter table ai_model_configs enable row level security;
revoke all on ai_model_configs from anon, authenticated;

-- Creates or rotates the scope's key and records its id, last 4 and host on
-- the row. The row must already exist (the handler saves the settings first).
-- Errors never include the key.
create or replace function ai_model_key_set(p_scope text, p_key text, p_actor text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare sid uuid; base text;
begin
  if p_key is null or length(p_key) < 8 or length(p_key) > 512 or p_key ~ '[^\x21-\x7e]' then
    raise exception 'invalid_key';
  end if;
  select key_secret_id, base_url into sid, base from public.ai_model_configs where scope = p_scope for update;
  if not found then raise exception 'no_config'; end if;
  -- Vault secret names are unique, so a secret left by a deleted row is reused.
  if sid is null or not exists (select 1 from vault.secrets where id = sid) then
    select id into sid from vault.secrets where name = 'ai_model_key_' || p_scope;
  end if;
  if sid is not null then
    perform vault.update_secret(sid, p_key);
  else
    sid := vault.create_secret(p_key, 'ai_model_key_' || p_scope, 'AI Trainer ' || p_scope || ' API key');
  end if;
  update public.ai_model_configs
     set key_secret_id = sid, key_last4 = right(p_key, 4), key_set_at = now(), last_test = null,
         key_host = rtrim(lower(substring(base from '^https://(\[[^]]+\]|[^/:?#]+)')), '.'),
         updated_at = now(), updated_by_claimed = left(coalesce(p_actor, 'unknown'), 120)
   where scope = p_scope;
end $$;

-- Returns the decrypted key for one scope, or null when none is set.
create or replace function ai_model_key_get(p_scope text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select d.decrypted_secret
    from public.ai_model_configs c
    join vault.decrypted_secrets d on d.id = c.key_secret_id
   where c.scope = p_scope
$$;

revoke all on function ai_model_key_set(text, text, text) from public, anon, authenticated;
revoke all on function ai_model_key_get(text) from public, anon, authenticated;
grant execute on function ai_model_key_set(text, text, text) to service_role;
grant execute on function ai_model_key_get(text) to service_role;

notify pgrst, 'reload schema';
