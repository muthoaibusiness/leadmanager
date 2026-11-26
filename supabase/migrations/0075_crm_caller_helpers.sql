-- 0075 — The "who is calling" helpers, on their own.
--
-- crm_me() (0054) and crm_my_company / crm_is_master / crm_active / crm_admin
-- (0055) were only ever created as part of the RLS lockdown. On a database where
-- that lockdown is not applied they do not exist, and the functions that call
-- them fail when used: crm_set_company_design (0073: "the server refused the
-- change") and push_subscribe / push_unsubscribe (0074).
--
-- This creates the five helpers and nothing else: no RLS, no policy, no grant on
-- any table is changed. They only read the caller's own users row, found by the
-- Supabase Auth session (users.auth_user_id = auth.uid()). The definitions are
-- the ones in 0054 / 0055, so applying those later changes nothing here.
-- Safe to re-run.

create or replace function public.crm_me()
returns table (id text, role text, company_id text, is_active boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select u.id, u.role, u.company_id, u.is_active from public.users u where u.auth_user_id = auth.uid()
$$;

create or replace function public.crm_my_company()
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select m.company_id from public.crm_me() m where m.is_active is not false
$$;
create or replace function public.crm_is_master()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.crm_me() m where m.is_active is not false and m.role = 'MASTER')
$$;
create or replace function public.crm_active()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.crm_me() m where m.is_active is not false)
$$;
create or replace function public.crm_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.crm_me() m where m.is_active is not false and m.role in ('MANAGEMENT', 'MASTER'))
$$;

revoke all on function public.crm_me(), public.crm_my_company(), public.crm_is_master(), public.crm_active(), public.crm_admin() from public, anon;
grant execute on function public.crm_me(), public.crm_my_company(), public.crm_is_master(), public.crm_active(), public.crm_admin() to authenticated;

notify pgrst, 'reload schema';
