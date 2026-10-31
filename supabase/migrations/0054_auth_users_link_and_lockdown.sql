-- 0054 — link CRM accounts to Supabase Auth and close the users table to the
-- anon key (CR-001 D1).
--
-- NOT APPLIED. Needs: a staging rehearsal, the account migration (one Auth
-- sign-in per active user, auth_user_id filled in), the client and Edge
-- Functions from the same change deployed first, and an explicit approval.
-- Rollback: supabase/ops/0054_rollback.sql. scripts/test-0054.mjs runs it.
--
-- What it does
-- ------------
-- * users.auth_user_id: the Supabase Auth user id of the account's sign-in.
--   Unique, nullable (an account without a sign-in yet cannot log in).
-- * anon loses every privilege on users. The browser no longer reads or writes
--   it with the anon key: signed-in requests carry the session JWT, so they run
--   as `authenticated`.
-- * authenticated may SELECT every column except password, and may UPDATE only
--   its own profile fields (name, phone, avatar). Role, feature access, active
--   status, company and team change only through the access-admin function.
-- * RLS on users with three policies: read your company's accounts (Master:
--   all), and update your own row. The service role bypasses RLS.
-- * users.password stays in place, unread and unwritten by the app, so the
--   rollback has something to restore. Dropping it is a later migration, after
--   the cutover has held.
--
-- What it does NOT do: change any other table. leads, activities and the rest
-- stay reachable with the anon key until their own migration (see the CR-001
-- D1 report, "remaining unprotected").

alter table public.users add column if not exists auth_user_id uuid;
create unique index if not exists users_auth_user_id_key on public.users (auth_user_id) where auth_user_id is not null;

-- The verified caller's CRM row, for policies. security definer so it can read
-- users under RLS without recursing into its own policies.
create or replace function public.crm_me()
returns table (id text, role text, company_id text, is_active boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select u.id, u.role, u.company_id, u.is_active from public.users u where u.auth_user_id = auth.uid()
$$;
revoke all on function public.crm_me() from public, anon;
grant execute on function public.crm_me() to authenticated;

revoke all on public.users from anon;
revoke all on public.users from authenticated;
grant select (id, name, email, phone, role, team_id, company_id, is_active, avatar, projects, allowed_features, auth_user_id)
  on public.users to authenticated;
grant update (name, phone, avatar) on public.users to authenticated;

alter table public.users enable row level security;

drop policy if exists users_read_own_company on public.users;
create policy users_read_own_company on public.users for select to authenticated
  using (exists (select 1 from public.crm_me() m where m.is_active is not false
                   and (m.role = 'MASTER' or m.company_id = users.company_id or m.id = users.id)));

drop policy if exists users_update_self on public.users;
create policy users_update_self on public.users for update to authenticated
  using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());

-- Every change made through access-admin: who, to whom, before and after.
-- Written with the service role only; no password value is ever stored.
create table if not exists public.access_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  action text not null,
  actor_id text not null,
  target_id text not null,
  company_id text,
  before jsonb,
  after jsonb
);
create index if not exists access_audit_target_at on public.access_audit (target_id, at desc);
alter table public.access_audit enable row level security;
revoke all on public.access_audit from public, anon, authenticated;

-- Sign an account out everywhere (deactivation, password reset). Deleting its
-- auth.sessions rows cascades to their refresh tokens, so no refresh succeeds
-- afterwards. Service role only.
create or replace function public.crm_revoke_sessions(p_auth_user_id uuid)
returns integer language plpgsql security definer set search_path = auth, pg_temp as $$
declare n integer;
begin
  delete from auth.sessions where user_id = p_auth_user_id;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.crm_revoke_sessions(uuid) from public, anon, authenticated;
grant execute on function public.crm_revoke_sessions(uuid) to service_role;

notify pgrst, 'reload schema';
