-- 0069 — Email one-time codes: verify your email (Profile) and reset a forgotten
-- password (login page). The codes are made, mailed (Gmail API) and checked by the
-- email-otp Edge Function; the browser never sees a stored code.
--
--   users.email_verified_at  when the account proved it owns its email. Only the
--                            server may set it; changing the email clears it.
--   email_otps               one row per code sent: a salted SHA-256 of the code,
--                            never the code. 10 minutes, 5 tries, single use.
-- Safe to re-run.

alter table public.users add column if not exists email_verified_at timestamptz;

create table if not exists public.email_otps (
  id bigint generated always as identity primary key,
  email text not null,
  user_id text,
  purpose text not null check (purpose in ('verify', 'reset')),
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists email_otps_lookup on public.email_otps (email, purpose, created_at desc);
alter table public.email_otps enable row level security;
revoke all on public.email_otps from anon, authenticated;
grant select, insert, update, delete on public.email_otps to service_role;

-- Server-only settings the Edge Functions write themselves. The google-oauth
-- function stores the Gmail refresh token and sender address here after the
-- one-time Google sign-in; email-otp reads them. Never readable by the app.
create table if not exists public.app_secrets (
  name text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;
grant select, insert, update, delete on public.app_secrets to service_role;

-- One row per Google sign-in started, checked when Google calls back.
create table if not exists public.oauth_states (
  state text primary key,
  created_at timestamptz not null default now()
);
alter table public.oauth_states enable row level security;
revoke all on public.oauth_states from anon, authenticated;
grant select, insert, update, delete on public.oauth_states to service_role;

-- The app's own requests (anon / authenticated) cannot mark an email verified;
-- a new email address is unverified until it is proved again.
create or replace function public.users_email_verified_guard()
returns trigger language plpgsql as $$
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    if tg_op = 'INSERT' then
      new.email_verified_at := null;
    elsif new.email_verified_at is distinct from old.email_verified_at then
      new.email_verified_at := old.email_verified_at;
    end if;
  end if;
  if tg_op = 'UPDATE' and lower(coalesce(new.email, '')) is distinct from lower(coalesce(old.email, '')) then
    new.email_verified_at := null;
  end if;
  return new;
end $$;
drop trigger if exists users_email_verified_guard on public.users;
create trigger users_email_verified_guard before insert or update on public.users
  for each row execute function public.users_email_verified_guard();

-- Old codes are kept a day for rate limiting, then dropped by the nightly job (0065).
create or replace function public.email_otps_purge() returns void
language sql security definer set search_path = public as $$
  delete from public.email_otps where created_at < now() - interval '1 day';
$$;
revoke all on function public.email_otps_purge() from public, anon, authenticated;

do $job$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then return; end if;
  if exists (select 1 from cron.job where jobname = 'email-otp-purge') then perform cron.unschedule('email-otp-purge'); end if;
  perform cron.schedule('email-otp-purge', '30 21 * * *', $c$ select public.email_otps_purge(); $c$);
end $job$;

notify pgrst, 'reload schema';
