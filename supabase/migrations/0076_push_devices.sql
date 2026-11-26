-- 0076 — Push notifications for the native app (Android / iOS, mobile/).
--
-- 0074 covers the installed web app (Web Push subscriptions). The native app
-- registers an Expo push token instead; push-send sends to it through Expo's
-- push service, which holds the FCM / APNs credentials. Same idea as 0074:
-- one more way a notifications row is delivered, nothing else is pushed.
--
-- Needs 0074 (push_notify_new, the hook key) and the crm_me() helper (0054, or
-- 0075 on its own). Redeploy push-send with this. Safe to re-run.

-- One row per installed app. The token is Expo's address for that install.
-- Not readable or writable by the app directly: only through the two functions
-- below, so a row is always the caller's own.
create table if not exists public.push_devices (
  token text primary key,
  user_id text not null,
  company_id text,
  platform text,
  name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_devices_user_idx on public.push_devices (user_id);
alter table public.push_devices enable row level security;
revoke all on public.push_devices from anon, authenticated;
grant select, insert, update, delete on public.push_devices to service_role;

-- Register this phone for the signed-in account. An install has one token
-- whoever is signed in, so signing in as somebody else moves the row to them.
create or replace function public.push_register_device(p_token text, p_platform text default null, p_name text default null)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare me record;
begin
  select * into me from public.crm_me();
  if me.id is null or me.is_active is not true then
    raise exception 'Sign in required' using errcode = '42501';
  end if;
  if p_token is null or p_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$' or length(p_token) > 200 then
    raise exception 'Invalid push token' using errcode = '22023';
  end if;
  insert into public.push_devices (token, user_id, company_id, platform, name)
  values (p_token, me.id, me.company_id, left(p_platform, 20), left(p_name, 100))
  on conflict (token) do update
    set user_id = excluded.user_id, company_id = excluded.company_id, platform = excluded.platform,
        name = excluded.name, updated_at = now();
  -- Ten phones per account; the least recently used go first.
  delete from public.push_devices d
  where d.user_id = me.id
    and d.token not in (select k.token from public.push_devices k where k.user_id = me.id order by k.updated_at desc, k.token limit 10);
  return true;
end $$;

-- Sign-out: this phone stops receiving. Only the caller's own row.
create or replace function public.push_unregister_device(p_token text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare me record; n int;
begin
  select * into me from public.crm_me();
  if me.id is null then return false; end if;
  delete from public.push_devices where token = p_token and user_id = me.id;
  get diagnostics n = row_count;
  return n > 0;
end $$;

revoke all on function public.push_register_device(text, text, text), public.push_unregister_device(text) from public, anon;
grant execute on function public.push_register_device(text, text, text), public.push_unregister_device(text) to authenticated;

-- The 0074 trigger function, now also for accounts whose only phone is a
-- native one. Everything else about it is unchanged.
create or replace function public.push_notify_new()
returns trigger language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_rows jsonb;
  v_key text;
begin
  select jsonb_agg(jsonb_build_object('id', n.id, 'user_id', n.user_id, 'type', n.type, 'message', left(n.message, 300), 'lead_id', n.lead_id))
    into v_rows
  from (
    select r.id, r.user_id, r.type, r.message, r.lead_id from new_rows r
    where exists (select 1 from public.push_subscriptions s where s.user_id = r.user_id)
       or exists (select 1 from public.push_devices d where d.user_id = r.user_id)
    limit 200
  ) n;
  if v_rows is null then return null; end if;
  select value into v_key from public.app_secrets where name = 'push_hook_key';
  if v_key is null then return null; end if;
  perform net.http_post(
    url := 'https://sbqmougcvnplgjgihpwe' || '.supabase.co/functions/v1/push-send',
    body := jsonb_build_object('rows', v_rows),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-key', v_key),
    timeout_milliseconds := 10000);
  return null;
exception when others then
  raise warning 'push_notify_new: %', sqlerrm;
  return null;
end $$;
revoke all on function public.push_notify_new() from public, anon, authenticated;

notify pgrst, 'reload schema';
