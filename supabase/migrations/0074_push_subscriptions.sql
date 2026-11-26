-- 0074 — Push notifications for the installed app (Android + iOS home screen).
--
-- A phone that installed the app and allowed notifications registers a Web Push
-- subscription here. Every new notifications row is then handed to the push-send
-- Edge Function, which sends it to the recipient's phones, so it arrives with
-- the app closed. The bell in the app is unchanged: push is one more way the
-- same row is delivered, and nothing is pushed that is not a notifications row.
--
-- Order: deploy the push-send function first, then run this. Before the function
-- exists the trigger's call fails quietly and no notification is affected.
-- Nothing to configure: the key the trigger and the function share is made
-- below, and the function makes its own VAPID key pair on first use; both live
-- in app_secrets (service role only).
-- Needs pg_net (already used by 0052). Safe to re-run.

-- 0069 creates this; repeated so this file stands on its own.
create table if not exists public.app_secrets (
  name text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;
grant select, insert, update, delete on public.app_secrets to service_role;

-- The shared key push-send requires in x-push-key. Made once, never replaced.
insert into public.app_secrets (name, value)
values ('push_hook_key', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (name) do nothing;

-- One row per installed app (browser profile). The endpoint is the address at
-- the browser vendor's push service; p256dh and auth are the keys only that
-- browser can decrypt with. Not readable or writable by the app directly: it
-- goes through the two functions below, so a row is always the caller's own.
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id text not null,
  company_id text,
  p256dh text not null,
  auth text not null,
  ua text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions to service_role;

-- Register this phone for the signed-in account. A phone has one subscription
-- whoever is signed in, so signing in as somebody else moves the row to them:
-- the previous account's notifications stop arriving on this phone.
create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_ua text default null)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare me record;
begin
  select * into me from public.crm_me();
  if me.id is null or me.is_active is not true then
    raise exception 'Sign in required' using errcode = '42501';
  end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or length(p_endpoint) > 2000
     or coalesce(p_p256dh, '') = '' or length(p_p256dh) > 200
     or coalesce(p_auth, '') = '' or length(p_auth) > 100 then
    raise exception 'Invalid push subscription' using errcode = '22023';
  end if;
  insert into public.push_subscriptions (endpoint, user_id, company_id, p256dh, auth, ua)
  values (p_endpoint, me.id, me.company_id, p_p256dh, p_auth, left(p_ua, 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, company_id = excluded.company_id, p256dh = excluded.p256dh,
        auth = excluded.auth, ua = excluded.ua, updated_at = now();
  -- Ten devices per account; the least recently used go first.
  delete from public.push_subscriptions s
  where s.user_id = me.id
    and s.endpoint not in (select k.endpoint from public.push_subscriptions k where k.user_id = me.id order by k.updated_at desc, k.endpoint limit 10);
  return true;
end $$;

-- Sign-out: this phone stops receiving. Only the caller's own row.
create or replace function public.push_unsubscribe(p_endpoint text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare me record; n int;
begin
  select * into me from public.crm_me();
  if me.id is null then return false; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = me.id;
  get diagnostics n = row_count;
  return n > 0;
end $$;

revoke all on function public.push_subscribe(text, text, text, text), public.push_unsubscribe(text) from public, anon;
grant execute on function public.push_subscribe(text, text, text, text), public.push_unsubscribe(text) to authenticated;

-- After each INSERT statement on notifications: the new rows whose recipient has
-- a phone registered go to push-send in one call. A statement that reaches no
-- such recipient costs one index probe and no network. An insert the BEFORE
-- triggers dropped (the "fu-" guard of 0067) or an upsert that only updated
-- existing rows is not in new_rows, so it is not pushed again.
-- pg_net queues the call and returns at once; whatever goes wrong here, the
-- notification itself is still written.
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

drop trigger if exists push_notify_new on public.notifications;
create trigger push_notify_new after insert on public.notifications
  referencing new table as new_rows
  for each statement execute function public.push_notify_new();

notify pgrst, 'reload schema';
