-- 0052 — Meta CAPI retention and scheduled qualification/sending.
--
-- Retention
--   capi_purge() deletes tracking rows only, never leads:
--     * capi_events (legacy tracking) older than 15 days;
--     * accepted capi_event_attempts older than 45 days (successful history).
--   Failed/timeout attempts are kept: they are the record of why a lead never
--   got reported. capi_send_permits is untouched — the rate limiter (0051)
--   prunes expired permits on every acquire, and pruning here could admit sends
--   the window still counts. capi_send_locks expire by their own expires_at and
--   are replaced on collision. The job runs daily 03:00 Asia/Dhaka.
--
-- Scheduler (Asia/Dhaka = UTC+6; expressions below are the matching UTC
-- instants, so intent does not depend on the database's TimeZone setting):
--   capi-qualify-1300  0 7 * * *   -> meta-capi-sched ?action=check (13:00 Dhaka)
--   capi-qualify-1800  0 12 * * *  -> meta-capi-sched ?action=check (18:00 Dhaka)
--   capi-send-2100     0 15 * * *  -> meta-capi-sched ?action=send  (21:00 Dhaka)
-- Real sending is OFF until CAPI_SCHED_SEND=true is set on the function and the
-- CR-001 D1 verified-sign-in blocker is resolved; until then the send job only
-- dry-runs (counts eligible queues, sends nothing).

alter table public.capi_event_attempts drop constraint if exists capi_event_attempts_source_check;
alter table public.capi_event_attempts add constraint capi_event_attempts_source_check
  check (source in ('ui_retry', 'bot', 'backfill', 'manual', 'scheduled'));

create or replace function public.capi_purge()
returns jsonb language plpgsql security invoker set search_path = public, pg_catalog as $$
declare n_events bigint; n_accepted bigint;
begin
  delete from public.capi_events where created_at < now() - interval '15 days';
  get diagnostics n_events = row_count;
  delete from public.capi_event_attempts where outcome = 'accepted' and accepted_at < now() - interval '45 days';
  get diagnostics n_accepted = row_count;
  return jsonb_build_object('capi_events_deleted', n_events, 'accepted_attempts_deleted', n_accepted);
end $$;

-- Execution log for the scheduled jobs, so runs and failures are visible.
create table if not exists public.capi_job_log (
  id bigint generated always as identity primary key,
  job text not null check (job in ('retention', 'qualify', 'send')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean not null default false,
  detail jsonb
);
create index if not exists capi_job_log_time_idx on public.capi_job_log (started_at desc);

alter table public.capi_job_log enable row level security;
revoke all on public.capi_job_log from anon, authenticated;
grant select, insert, update on public.capi_job_log to service_role;
revoke all on function public.capi_purge() from public, anon, authenticated;
grant execute on function public.capi_purge() to service_role;

-- Cron jobs. pg_cron / pg_net are absent on PGlite, so guard each install.
do $job$
declare u text := 'https://sbqmougcvnplgjgihpwe.supabase.co/functions/v1/meta-capi-sched';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice '0052: pg_cron/pg_net not installed; cron jobs skipped (local/PGlite only)';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'capi-retention') then perform cron.unschedule('capi-retention'); end if;
  perform cron.schedule('capi-retention', '0 21 * * *', $b1$ select public.capi_purge() $b1$);
  if exists (select 1 from cron.job where jobname = 'capi-qualify-1300') then perform cron.unschedule('capi-qualify-1300'); end if;
  perform cron.schedule('capi-qualify-1300', '0 7 * * *',
    format($b$ select net.http_post(url := '%s', headers := '{"Content-Type":"application/json"}'::jsonb, body := '{"action":"check"}'::jsonb) $b$, u));
  if exists (select 1 from cron.job where jobname = 'capi-qualify-1800') then perform cron.unschedule('capi-qualify-1800'); end if;
  perform cron.schedule('capi-qualify-1800', '0 12 * * *',
    format($b$ select net.http_post(url := '%s', headers := '{"Content-Type":"application/json"}'::jsonb, body := '{"action":"check"}'::jsonb) $b$, u));
  if exists (select 1 from cron.job where jobname = 'capi-send-2100') then perform cron.unschedule('capi-send-2100'); end if;
  perform cron.schedule('capi-send-2100', '0 15 * * *',
    format($b$ select net.http_post(url := '%s', headers := '{"Content-Type":"application/json"}'::jsonb, body := '{"action":"send"}'::jsonb) $b$, u));
end $job$;

notify pgrst, 'reload schema';
