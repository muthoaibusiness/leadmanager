-- 0051 — Meta CAPI: agent-qualified leads, one shared send limiter, Meta throttle.
--
-- NOT APPLIED. Review and an explicit approval come first. Needs 0050, which
-- is applied in production (2026-10-29). scripts/test-0050.mjs runs both on
-- PGlite.
--
-- Why
-- ---
-- * Which leads may be reported. A lead is reported to Meta only after an
--   agent qualified it: the agent pressed Connected (status CONTACTED) or
--   Interested. Either is enough; both are still one lead. The proof is the
--   STATUS_CHANGE row changeStatus() writes ("Status → Contacted" /
--   "Status → Interested", see CLAUDE.md "Lead status changes — always
--   logged"), or a manual correction to one of them, written by a person
--   (not 'system', not empty). The lead's current status is not used: 171 ad
--   leads were marked and have moved on since, and no lead is CONTACTED or
--   INTERESTED without such a row (verified 2026-10-29). A call's talk time
--   (leads.talked) is not an agent's choice and does not qualify.
-- * One limiter for every sender. Manual sends from the CRM and any later
--   scheduled sender take the same permit from capi_acquire(): the lead lock,
--   a cap on sends in flight and a cap on sends per window, decided in one
--   transaction under one lock, so two callers can never both pass the last
--   permit. Meta documents no rate limit for the Conversions API ("There is
--   no specific rate limit for the Conversions API", using-the-api; see
--   docs/research/2026-10-29-meta-capi-limits.md). The figures below are the
--   project's own: ad leads average 5.4 a day, peak 116 in one day, and a
--   manual batch is at most 50. 60 sends a minute and 2 at once clears a
--   full batch in about a minute and keeps the app far below Meta's general
--   Marketing API budget. Change them in capi_settings, not in code.
-- * Meta throttling. When Meta answers with a throttling error, the sender
--   calls capi_throttle(): every sender stops until the wait passes. The wait
--   is Meta's own hint when it gives one, otherwise a bounded exponential
--   backoff with jitter computed here (throttle_strikes counts consecutive
--   throttles; an accepted send resets it).
-- * Outcomes. 'rate_limited' records a send Meta throttled: the lead stays
--   failed and can be retried. A send refused by our own limiter makes no
--   request to Meta and is not an attempt, so nothing is logged for it.
--
-- Additive and re-runnable. Existing rows are left as they are.

-- ── settings: explicit limits and the shared throttle ──────────────────────
alter table public.capi_settings
  add column if not exists rate_window_seconds integer not null default 60,
  add column if not exists rate_max_sends integer not null default 60,
  add column if not exists max_concurrent_sends integer not null default 2,
  add column if not exists throttled_until timestamptz,
  add column if not exists throttle_strikes integer not null default 0;
alter table public.capi_settings drop constraint if exists capi_settings_limits_check;
alter table public.capi_settings add constraint capi_settings_limits_check
  check (rate_window_seconds between 1 and 3600 and rate_max_sends >= 1 and max_concurrent_sends >= 1 and throttle_strikes >= 0);

-- One row per permit granted, kept for one window. The limiter counts these.
create table if not exists public.capi_send_permits (
  id bigint generated always as identity primary key,
  lead_id text not null,
  source text not null,
  granted_at timestamptz not null default now()
);
create index if not exists capi_send_permits_time_idx on public.capi_send_permits (granted_at desc);
alter table public.capi_send_permits enable row level security;
revoke all on public.capi_send_permits from anon, authenticated;
grant select, insert, delete on public.capi_send_permits to service_role;

-- ── outcomes: Meta throttled this send ──────────────────────────────────────
alter table public.capi_event_attempts drop constraint if exists capi_event_attempts_outcome_check;
alter table public.capi_event_attempts add constraint capi_event_attempts_outcome_check
  check (outcome in ('accepted', 'rejected', 'timeout', 'network', 'ambiguous', 'skipped', 'rate_limited'));

-- ── the one gate every sender passes ────────────────────────────────────────
-- Returns {result: ok | locked | rate_limited, reason, retry_at}. On ok the
-- caller holds the lead lock (release it with capi_unlock) and one permit.
create or replace function public.capi_acquire(p_lead text, p_source text, p_ttl_seconds integer)
returns jsonb language plpgsql security invoker set search_path = public, pg_catalog as $$
declare s public.capi_settings%rowtype; inflight int; recent int; oldest timestamptz; got int;
begin
  -- One caller at a time decides; the row lock is held to the end of this call.
  select * into s from public.capi_settings where id = 'default' for update;
  if s.throttled_until is not null and s.throttled_until > now() then
    return jsonb_build_object('result', 'rate_limited', 'reason', 'throttled', 'retry_at', s.throttled_until);
  end if;
  if exists (select 1 from public.capi_send_locks where lead_id = p_lead and expires_at >= now()) then
    return jsonb_build_object('result', 'locked');
  end if;
  select count(*) into inflight from public.capi_send_locks where expires_at >= now();
  if inflight >= s.max_concurrent_sends then
    return jsonb_build_object('result', 'rate_limited', 'reason', 'concurrency', 'retry_at', now() + interval '5 seconds');
  end if;
  delete from public.capi_send_permits where granted_at < now() - make_interval(secs => s.rate_window_seconds);
  select count(*), min(granted_at) into recent, oldest from public.capi_send_permits;
  if recent >= s.rate_max_sends then
    return jsonb_build_object('result', 'rate_limited', 'reason', 'window',
      'retry_at', oldest + make_interval(secs => s.rate_window_seconds));
  end if;
  insert into public.capi_send_locks (lead_id, token, source, expires_at)
  values (p_lead, gen_random_uuid(), p_source, now() + make_interval(secs => greatest(p_ttl_seconds, 1)))
  on conflict (lead_id) do update
     set token = excluded.token, source = excluded.source, locked_at = now(), expires_at = excluded.expires_at
   where public.capi_send_locks.expires_at < now();
  get diagnostics got = row_count;
  if got <> 1 then return jsonb_build_object('result', 'locked'); end if;
  insert into public.capi_send_permits (lead_id, source) values (p_lead, p_source);
  return jsonb_build_object('result', 'ok');
end $$;

-- Meta said slow down: stop every sender (never shortens a longer wait already
-- set). The wait is Meta's own hint (Retry-After) when the caller has one;
-- otherwise 30 s doubling per consecutive throttle, ±25% jitter, at most
-- 15 minutes. Returns the time sending may resume.
create or replace function public.capi_throttle(p_hint_seconds integer)
returns timestamptz language plpgsql security invoker set search_path = public, pg_catalog as $$
declare n int; wait double precision; u timestamptz;
begin
  select throttle_strikes into n from public.capi_settings where id = 'default' for update;
  wait := coalesce(p_hint_seconds, least(900, 30 * power(2, least(n, 10)) * (0.75 + random() * 0.5)));
  update public.capi_settings
     set throttled_until = greatest(coalesce(throttled_until, now()), now() + make_interval(secs => greatest(wait, 1))),
         throttle_strikes = n + 1
   where id = 'default'
  returning throttled_until into u;
  return u;
end $$;

-- An accepted send ends a throttle streak. Same body as 0050 plus that reset.
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
    update public.capi_settings set throttle_strikes = 0 where id = 'default' and throttle_strikes <> 0;
  end if;
  return query select rid, n, p_outcome;
end $$;

-- ── per-lead status, now agent-qualified ────────────────────────────────────
-- Same columns as 0050, then (appended, so create or replace keeps the
-- existing ones): qualified / qualified_at; unsure, true when an earlier send
-- got no clear answer from Meta (timeout, no connection, 200 without
-- events_received), so Meta may already have the event; and ctwa_clid, which
-- the sender needs. A lead with a click id but no agent action is
-- 'ineligible': nothing to report yet.
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
    when coalesce(l.ctwa_clid, '') = '' or q.qualified_at is null then 'ineligible'
    when l.created_at + interval '7 days' <= now() then 'expired'
    when coalesce(s.attempts, 0) > 0 then 'failed'
    else 'pending'
  end as status,
  (q.qualified_at is not null) as qualified,
  q.qualified_at,
  coalesce(s.unsure, false) as unsure,
  l.ctwa_clid
from public.leads l
left join lateral (
  select min(a."timestamp") as qualified_at
  from public.activities a
  where a.lead_id = l.id and a.type = 'STATUS_CHANGE'
    and coalesce(a.user_id, '') not in ('', 'system')
    and (a.description in ('Status → Contacted', 'Status → Interested')
         or a.description ~ '^Status corrected: [A-Z_]+ → (CONTACTED|INTERESTED)( |$)')
) q on true
left join lateral (
  select count(*) as attempts, min(a.attempted_at) as first_attempt_at, max(a.attempted_at) as last_attempt_at,
    max(a.accepted_at) as accepted_at, bool_or(a.outcome in ('timeout', 'network', 'ambiguous')) as unsure
  from public.capi_event_attempts a where a.lead_id = l.id
) s on true
left join lateral (
  select a.* from public.capi_event_attempts a where a.lead_id = l.id order by a.attempt_no desc limit 1
) lt on true
where l.source = 'WHATSAPP_ADS' or coalesce(l.ctwa_clid, '') <> '';

revoke all on public.capi_lead_status from anon, authenticated;
grant select on public.capi_lead_status to service_role;

-- ── bot switch, set only through the meta-capi function ─────────────────────
-- wa_bot_settings.meta_capi_enabled already exists (0034) and the bots read
-- it (getBotSettings in _shared/wa.ts). Returns the row's new state, or no row
-- for an unknown bot.
create or replace function public.capi_set_bot(p_bot text, p_enabled boolean)
returns table (bot text, meta_capi_enabled boolean)
language sql security invoker set search_path = public, pg_catalog as $$
  update public.wa_bot_settings w set meta_capi_enabled = p_enabled where w.bot = p_bot
  returning w.bot, w.meta_capi_enabled;
$$;

revoke all on function public.capi_acquire(text, text, integer), public.capi_throttle(integer), public.capi_set_bot(text, boolean),
  public.capi_record_attempt(text, text, text, text, text, integer, integer, integer, integer, text, text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.capi_acquire(text, text, integer), public.capi_throttle(integer), public.capi_set_bot(text, boolean),
  public.capi_record_attempt(text, text, text, text, text, integer, integer, integer, integer, text, text, text, jsonb, uuid) to service_role;

notify pgrst, 'reload schema';
