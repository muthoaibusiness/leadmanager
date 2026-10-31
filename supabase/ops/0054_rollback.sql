-- Rollback of 0054: the users table goes back to how 0053 left it (RLS off,
-- anon and authenticated with full privileges). auth_user_id and access_audit
-- are kept: harmless to the old client, and dropping them would lose the Auth
-- links and the record of who changed which account.
-- Run only together with redeploying the previous client and Edge Functions.

drop policy if exists users_read_own_company on public.users;
drop policy if exists users_update_self on public.users;
alter table public.users disable row level security;
grant all on public.users to anon, authenticated;
drop function if exists public.crm_me();
drop function if exists public.crm_revoke_sessions(uuid);
notify pgrst, 'reload schema';
