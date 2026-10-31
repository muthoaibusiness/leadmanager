-- 0050 — Meta CAPI attempt log, per-lead status and a send lock (Admin › Meta CAPI).
--
-- Applied in production 2026-10-29 (version 20261029122817), before review.
-- 0051 builds on it. scripts/test-0050.mjs runs both on PGlite.
--
-- Why
-- ---
-- Until now the only record of a Meta Conversions API send was the lead's
-- "CAPI_STATUS" column. It says nothing about when an event was sent, how many
-- times, what Meta answered, or why a send failed. 111 ad leads went unreported
-- for 8 days (2026-10-21 to 29) because Meta rejected the token, and nothing in
-- the CRM showed it.
--
-- What it adds
-- ------------
-- * capi_event_attempts: one row per send attempt. All times are written by the
--   database in UTC (now()), never by a client clock. accepted_at is set only
--   when Meta answered HTTP 200 with events_received >= 1; any other answer is
--   recorded as a failure. A failed attempt never deletes or overwrites an
--   earlier accepted one: the log is insert-only for everyone but the owner.
-- * capi_record_attempt(): the one way to write an attempt. On an accepted
--   attempt it also sets leads."CAPI_STATUS" = 'LeadSubmitted' (the value the
--   bots and the external backfill already use). It never clears the column.
-- * capi_send_locks + capi_try_lock()/capi_unlock(): one sender per lead at a
--   time, so a retry from the CRM cannot run at the same moment as another
--   retry. The bots and the n8n backfill do not take this lock yet; Meta's
--   event_id deduplication (event_id = lead id) still covers a collision with
--   them.
-- * capi_lead_status: per-lead view. status is one of success, failed, pending,
--   expired, ineligible. A lead reported before this log existed is 'success'
--   with no attempt or acceptance time: none is invented.
--
-- Access
-- ------
-- RLS on, no policy, no grant to anon or authenticated: the browser holds the
-- anon key, so these tables and functions are reachable only through the
-- meta-capi Edge Function (service role), which checks the acting user.
--
-- Existing rows are left as they are. No backfill. Additive and re-runnable.

create table if not exists public.capi_event_attempts (
  id bigint generated always as identity primary key,
  lead_id text not null,
  event_id text not null,
  event_name text not null default 'LeadSubmitted',
  attempt_no integer not null check (attempt_no >= 1),
  source text not null check (source in ('ui_retry', 'bot', 'backfill', 'manual')),
  initiated_by text,
  attempted_at timestamptz not null default now(),
  responded_at timestamptz,
  accepted_at timestamptz,
  outcome text not null check (outcome in ('accepted', 'rejected', 'timeout', 'network', 'ambiguous', 'skipped')),
  http_status integer,
  events_received integer,
  error_code integer,
  error_subcode integer,
  error_type text check (error_type is null or length(error_type) <= 100),
  error_message text check (error_message is null or length(error_message) <= 500),
  fbtrace_id text check (fbtrace_id is null or length(fbtrace_id) <= 100),
  -- Meta's answer as returned (events_received, messages, fbtrace_id, or the
  -- error object with is_transient, error_user_title/msg). The edge function
  -- strips anything token-like before it gets here; capped at 4 KB.
  meta_response jsonb check (meta_response is null or octet_length(meta_response::text) <= 4096),
  lock_id uuid,
  unique (lead_id, attempt_no),
  -- accepted means Meta confirmed it; nothing else can carry an acceptance time.
  check ((outcome = 'accepted') = (accepted_at is not null)),
  check (outcome <> 'accepted' or (http_status = 200 and coalesce(events_received, 0) >= 1))
);
create index if not exists capi_event_attempts_lead_idx on public.capi_event_attempts (lead_id, attempt_no desc);
create index if not exists capi_event_attempts_time_idx on public.capi_event_attempts (attempted_at desc);

create table if not exists public.capi_send_locks (
  lead_id text primary key,
  token uuid not null,
  source text not null,
  locked_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- Operational switch for CRM-triggered recovery. One row. The bots and the
-- external backfill do not read it.
create table if not exists public.capi_settings (
  id text primary key default 'default' check (id = 'default'),
  ui_recovery_paused boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text
);
insert into public.capi_settings (id) values ('default') on conflict (id) do nothing;

alter table public.capi_event_attempts enable row level security;
alter table public.capi_send_locks enable row level security;
alter table public.capi_settings enable row level security;
revoke all on public.capi_event_attempts, public.capi_send_locks, public.capi_settings from anon, authenticated;
grant select, insert, update on public.capi_settings to service_role;
grant select, insert on public.capi_event_attempts to service_role;
grant select, insert, update, delete on public.capi_send_locks to service_role;

-- One sender per lead. Returns true when this caller now holds the lock.
create or replace function public.capi_try_lock(p_lead text, p_source text, p_ttl_seconds integer)
returns boolean language plpgsql security invoker set search_path = public, pg_catalog as $$
declare got int;
begin
  insert into public.capi_send_locks (lead_id, token, source, expires_at)
  values (p_lead, gen_random_uuid(), p_source, now() + make_interval(secs => greatest(p_ttl_seconds, 1)))
  on conflict (lead_id) do update
     set token = excluded.token, source = excluded.source, locked_at = now(), expires_at = excluded.expires_at
   where public.capi_send_locks.expires_at < now();
  get diagnostics got = row_count;
  return got = 1;
end $$;

create or replace function public.capi_unlock(p_lead text)
returns void language sql security invoker set search_path = public, pg_catalog as $$
  delete from public.capi_send_locks where lead_id = p_lead;
$$;

-- The only writer of capi_event_attempts. Accepted only with HTTP 200 and
-- events_received >= 1 (enforced again by the table's checks); an accepted
-- attempt sets the lead's CAPI_STATUS, a failed one leaves it alone.
--
-- Re-run safety: 0051 replaces this function and capi_lead_status (it adds
-- columns to the view). Running this file again after 0051 must not take them
-- back: Postgres refuses with "cannot drop columns from view", and the older
-- function would lose 0051's throttle reset. Both are created only while 0051
-- is absent (no `qualified` column on the view yet).
drop function if exists public.capi_record_attempt(text, text, text, text, text, integer, integer, integer, integer, text, text, uuid);
do $only_before_0051$
begin
if exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'capi_lead_status' and column_name = 'qualified') then
  raise notice '0050: 0051 is applied; capi_record_attempt and capi_lead_status left as 0051 made them';
  return;
end if;
execute $fn$
create or replace function public.capi_record_attempt(
  p_lead text, p_event_id text, p_source text, p_actor text, p_outcome text,
  p_http integer, p_received integer, p_code integer, p_subcode integer, p_type text, p_message text, p_trace text,
  p_response jsonb, p_lock uuid)
returns table (attempt_id bigint, attempt_no integer, outcome text)
language plpgsql security invoker set search_path = public, pg_catalog as $$
declare n int; acc timestamptz; rid bigint;
begin
  if p_outcome = 'accepted' and not (p_http = 200 and coalesce(p_received, 0) >= 1) then
    raise exception 'an accepted event needs HTTP 200 and events_received >= 1';
  end if;
  perform pg_advisory_xact_lock(hashtext('capi:' || p_lead));
  select coalesce(max(a.attempt_no), 0) + 1 into n from public.capi_event_attempts a where a.lead_id = p_lead;
  acc := case when p_outcome = 'accepted' then now() end;
  insert into public.capi_event_attempts (lead_id, event_id, attempt_no, source, initiated_by, responded_at, accepted_at,
    outcome, http_status, events_received, error_code, error_subcode, error_type, error_message, fbtrace_id, meta_response, lock_id)
  values (p_lead, p_event_id, n, p_source, p_actor,
    case when p_http is not null then now() end, acc, p_outcome, p_http, p_received, p_code, p_subcode,
    left(p_type, 100), left(p_message, 500), left(p_trace, 100), p_response, p_lock)
  returning id into rid;
  if p_outcome = 'accepted' then
    update public.leads set "CAPI_STATUS" = 'LeadSubmitted' where id = p_lead;
  end if;
  return query select rid, n, p_outcome;
end $$
$fn$;

-- Per lead: the reporting status and the latest attempt, kept apart.
execute $view$
create or replace view public.capi_lead_status with (security_invoker = true) as
select l.id, l.name, l.company_id, l.source, l.property_interest, l.created_at,
  (coalesce(l.ctwa_clid, '') <> '') as has_clid,
  l."CAPI_STATUS" as capi_status_column,
  l.created_at + interval '7 days' as cutoff_at,
  coalesce(s.attempts, 0) as attempts,
  s.first_attempt_at, s.last_attempt_at, s.accepted_at,
  lt.outcome as latest_outcome, lt.http_status as latest_http, lt.events_received as latest_events_received,
  lt.error_code as latest_error_code, lt.error_subcode as latest_error_subcode, lt.error_message as latest_error_message,
  lt.fbtrace_id as latest_fbtrace_id, lt.source as latest_source, l.id as event_id,
  case
    when l."CAPI_STATUS" = 'LeadSubmitted' or s.accepted_at is not null then 'success'
    when coalesce(l.ctwa_clid, '') = '' then 'ineligible'
    when l.created_at + interval '7 days' <= now() then 'expired'
    when coalesce(s.attempts, 0) > 0 then 'failed'
    else 'pending'
  end as status
from public.leads l
left join lateral (
  select count(*) as attempts, min(a.attempted_at) as first_attempt_at, max(a.attempted_at) as last_attempt_at,
    max(a.accepted_at) as accepted_at
  from public.capi_event_attempts a where a.lead_id = l.id
) s on true
left join lateral (
  select a.* from public.capi_event_attempts a where a.lead_id = l.id order by a.attempt_no desc limit 1
) lt on true
-- Relevant leads: Meta ad leads, whether or not they carry a click id.
where l.source = 'WHATSAPP_ADS' or coalesce(l.ctwa_clid, '') <> ''
$view$;
end $only_before_0051$;

revoke all on public.capi_lead_status from anon, authenticated;
grant select on public.capi_lead_status to service_role;

-- Dashboard figures, from the data. p_company null = every company (Master).
-- Lead status (success/failed/pending/expired/ineligible) and attempt counts
-- are separate: a lead with a success and a later failed retry is a success.
create or replace function public.capi_summary(p_company text)
returns jsonb language sql stable security invoker set search_path = public, pg_catalog as $$
  with s as (select * from public.capi_lead_status where p_company is null or company_id = p_company),
       a as (select x.* from public.capi_event_attempts x join s on s.id = x.lead_id)
  select jsonb_build_object(
    'total', (select count(*) from s),
    'by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from s group by status) g), '{}'::jsonb),
    'attempts', (select count(*) from a),
    'accepted_attempts', (select count(*) from a where outcome = 'accepted'),
    'last_accepted_at', (select max(accepted_at) from a),
    'oldest_pending', (select jsonb_build_object('id', id, 'created_at', created_at, 'cutoff_at', cutoff_at)
                         from s where status in ('pending', 'failed') order by created_at asc limit 1)
  );
$$;

revoke all on function public.capi_try_lock(text, text, integer), public.capi_unlock(text), public.capi_summary(text),
  public.capi_record_attempt(text, text, text, text, text, integer, integer, integer, integer, text, text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.capi_try_lock(text, text, integer), public.capi_unlock(text), public.capi_summary(text),
  public.capi_record_attempt(text, text, text, text, text, integer, integer, integer, integer, text, text, text, jsonb, uuid) to service_role;

notify pgrst, 'reload schema';
