-- 0070 — Keep the sign-in email equal to the CRM email.
--
-- People sign in with Supabase Auth (auth.users.email), but admins change an
-- account's email in the CRM (public.users.email). Until now the two drifted:
-- after an email change the person could only sign in with the OLD address, and
-- "Forgot password?" mailed the new address but reset a sign-in nobody could
-- reach by that name. Now a CRM email change updates the linked sign-in too, and
-- this file fixes the accounts that have already drifted.
-- Run in the SQL editor (it updates auth.users, which needs the postgres role).
-- Safe to re-run.

create or replace function public.users_sync_auth_email()
returns trigger language plpgsql security definer set search_path = public, auth, pg_catalog as $$
declare e text := lower(btrim(coalesce(new.email, '')));
begin
  if new.auth_user_id is null or e = '' or e !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then return new; end if;
  -- Another sign-in already owns this address: leave both alone rather than fail the CRM save.
  if exists (select 1 from auth.users a where lower(a.email) = e and a.id::text <> new.auth_user_id::text) then return new; end if;
  update auth.users
     set email = e, email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now()
   where id::text = new.auth_user_id::text and lower(coalesce(email, '')) <> e;
  update auth.identities
     set identity_data = jsonb_set(coalesce(identity_data, '{}'::jsonb), '{email}', to_jsonb(e)), updated_at = now()
   where user_id::text = new.auth_user_id::text and provider = 'email'
     and lower(coalesce(identity_data->>'email', '')) <> e;
  return new;
end $$;
revoke all on function public.users_sync_auth_email() from public, anon, authenticated;

drop trigger if exists users_sync_auth_email on public.users;
create trigger users_sync_auth_email after insert or update of email, auth_user_id on public.users
  for each row execute function public.users_sync_auth_email();

-- Fix the accounts that already differ (fires the trigger above for each).
update public.users u set email = u.email
  from auth.users a
 where a.id::text = u.auth_user_id::text
   and lower(coalesce(a.email, '')) <> lower(btrim(coalesce(u.email, '')));

-- Check: expect 0 rows.
select u.name, u.email as crm_email, a.email as sign_in_email
  from public.users u join auth.users a on a.id::text = u.auth_user_id::text
 where lower(a.email) <> lower(btrim(u.email));
