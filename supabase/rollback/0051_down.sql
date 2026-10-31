-- Rollback of 0051_meta_capi_qualified_limiter: back to exactly 0050.
--
-- Run only if 0051 has to come out. Redeploy meta-capi v1 first
-- (supabase/deployed/2026-10-30/meta-capi-v1/): the 0051 function calls
-- capi_acquire, capi_throttle and capi_set_bot, which this drops.
--
-- Data: rows written with outcome 'rate_limited' are relabelled 'rejected'
-- (both mean "Meta did not accept it") so the 0050 check can be restored.
-- capi_send_permits holds only the last minute of permits and is dropped.
-- The limit columns on capi_settings are dropped. Nothing else changes.
-- Tested on the local Docker database: apply 0050, 0051, this, 0051 again.

begin;

drop function if exists public.capi_acquire(text, text, integer);
drop function if exists public.capi_throttle(integer);
drop function if exists public.capi_set_bot(text, boolean);
drop table if exists public.capi_send_permits;

update public.capi_event_attempts set outcome = 'rejected' where outcome = 'rate_limited';
alter table public.capi_event_attempts drop constraint if exists capi_event_attempts_outcome_check;
alter table public.capi_event_attempts add constraint capi_event_attempts_outcome_check
  check (outcome in ('accepted', 'rejected', 'timeout', 'network', 'ambiguous', 'skipped'));

alter table public.capi_settings drop constraint if exists capi_settings_limits_check;
alter table public.capi_settings
  drop column if exists rate_window_seconds,
  drop column if exists rate_max_sends,
  drop column if exists max_concurrent_sends,
  drop column if exists throttled_until,
  drop column if exists throttle_strikes;

-- capi_record_attempt and capi_lead_status as 0050 created them. The view
-- loses the columns 0051 appended, so it is dropped and recreated.
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
end $$;

drop view if exists public.capi_lead_status;
create view public.capi_lead_status with (security_invoker = true) as
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
where l.source = 'WHATSAPP_ADS' or coalesce(l.ctwa_clid, '') <> '';

revoke all on public.capi_lead_status from anon, authenticated;
grant select on public.capi_lead_status to service_role;
revoke all on function public.capi_record_attempt(text, text, text, text, text, integer, integer, integer, integer, text, text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.capi_record_attempt(text, text, text, text, text, integer, integer, integer, integer, text, text, text, jsonb, uuid) to service_role;

commit;

notify pgrst, 'reload schema';
