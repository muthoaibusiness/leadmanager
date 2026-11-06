-- 0059 · Public (shareable) project page — publish control.
--
-- Adds `properties.public_published`: the management toggle that decides whether
-- a project's public page (#/p/<id>) and its card on the portfolio (#/p) are
-- reachable without login. Default off, so nothing is exposed until an admin
-- publishes it. The public pages read the live row through the anon key; this
-- single boolean is the gate.
--
-- Only an admin may change it. The client already sends the column from one
-- place alone (patchPropertyChecked); this trigger is the server-side check.
-- It calls crm_admin() (migration 0055) through EXECUTE so the function body
-- still compiles on a database where 0055 has not been applied yet. Before
-- 0055 the whole table is anon-writable and there is no signed-in caller to
-- judge, so the change is allowed; from 0055 on, only MANAGEMENT / MASTER (or
-- the service role) can publish or unpublish.
--
-- Safe to run more than once. Apply in the Supabase SQL editor.
alter table public.properties
  add column if not exists public_published boolean not null default false;

create or replace function public.properties_guard_publish()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ok boolean;
begin
  if tg_op = 'UPDATE' and new.public_published is not distinct from old.public_published then
    return new;
  end if;
  if tg_op = 'INSERT' and new.public_published is not true then
    return new;
  end if;
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  if to_regprocedure('public.crm_admin()') is null then
    return new; -- pre-lockdown: see the header
  end if;
  execute 'select public.crm_admin()' into ok;
  if ok is not true then
    raise exception 'only an admin can publish or unpublish a project'
      using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.properties_guard_publish() from public, anon, authenticated;

drop trigger if exists properties_guard_publish on public.properties;
create trigger properties_guard_publish
  before insert or update of public_published on public.properties
  for each row execute function public.properties_guard_publish();

notify pgrst, 'reload schema';
