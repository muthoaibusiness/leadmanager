-- 0065 — Notifications clean themselves: a read notification is deleted after 30
-- days, an unread one after 90, every night at 03:00 Dhaka.
--
-- Why: notifications held ~643k rows (228 MB of the 271 MB database), nearly all
-- FOLLOW_UP reminders an old client bug created, and nothing ever deleted by age.
-- The browser applies the same rule to its cached copy (src/lib/notifRetention.js),
-- and no longer subscribes to notification DELETE events (src/lib/supabase.js
-- rtConfig), so the purge does not stream every deleted row to every browser.
-- Ship that client release first, at least a day before this runs.
--
-- The two indexes below hold up notification writes while they build (the
-- Supabase SQL editor runs everything in a transaction, so CONCURRENTLY is not
-- available there). With the backlog still in place that is roughly 10–30 s; run
-- step 3 of the ops drain first and it is instant. Run at a quiet time.
-- Safe to re-run.
--
-- The first nights work through the backlog in batches under a time budget; to
-- clear it at once, see supabase/ops/0065_notif_backlog_drain.sql.

create index if not exists idx_notifications_read_created on public.notifications (is_read, created_at);
create index if not exists idx_notifications_user_created on public.notifications (user_id, created_at desc);

-- Run log for the CRM's scheduled jobs (this one, and the follow-up reminder job to come).
create table if not exists public.crm_job_log (
  id bigint generated always as identity primary key,
  job text not null check (job in ('notif_retention', 'followup_remind')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean not null default false,
  detail jsonb
);
create index if not exists crm_job_log_time_idx on public.crm_job_log (started_at desc);
alter table public.crm_job_log enable row level security;
revoke all on public.crm_job_log from anon, authenticated;
grant select, insert, update, delete on public.crm_job_log to service_role;

-- Deletes in batches of p_batch, oldest first, until nothing is left or p_budget
-- runs out (the rest waits for the next night). Unread and never-marked rows go
-- after 90 days, read rows after 30.
create or replace function public.notif_purge(p_batch int default 5000, p_budget interval default '200 seconds')
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  t0 timestamptz := clock_timestamp();
  rules text[] := array[
    'is_read = false and created_at < now() - interval ''90 days''',
    'is_read is null and created_at < now() - interval ''90 days''',
    'is_read = true and created_at < now() - interval ''30 days'''
  ];
  counts bigint[] := array[0, 0, 0];
  i int; n int; batches int := 0; hit boolean := false; log_id bigint; v_detail jsonb;
begin
  insert into public.crm_job_log (job) values ('notif_retention') returning id into log_id;
  <<rules_loop>>
  for i in 1 .. array_length(rules, 1) loop
    loop
      execute format('delete from public.notifications where id in (select id from public.notifications where %s order by created_at limit %s)', rules[i], p_batch);
      get diagnostics n = row_count;
      counts[i] := counts[i] + n;
      batches := batches + 1;
      exit when n < p_batch;
      if clock_timestamp() - t0 > p_budget then hit := true; exit rules_loop; end if;
    end loop;
  end loop;

  -- Housekeeping for the scheduler itself: pg_cron keeps every run's row forever.
  if to_regclass('cron.job_run_details') is not null then
    execute 'delete from cron.job_run_details where end_time < now() - interval ''7 days''';
  end if;
  delete from public.crm_job_log where started_at < now() - interval '90 days';

  v_detail := jsonb_build_object('unread_deleted', counts[1], 'unmarked_deleted', counts[2], 'read_deleted', counts[3], 'batches', batches, 'budget_hit', hit);
  update public.crm_job_log set finished_at = now(), ok = true, detail = v_detail where id = log_id;
  return v_detail;
exception when others then
  -- The block's work is rolled back with the error; record the failure on its own row.
  insert into public.crm_job_log (job, finished_at, ok, detail)
  values ('notif_retention', now(), false, jsonb_build_object('error', sqlerrm));
  return jsonb_build_object('error', sqlerrm);
end $$;
revoke all on function public.notif_purge(int, interval) from public, anon, authenticated;
grant execute on function public.notif_purge(int, interval) to service_role;

-- An old browser bundle re-creates a follow-up reminder ("fu-<lead>-<user>-<dueMs>")
-- on every load for any overdue follow-up, so a reminder the purge removed could
-- come straight back as unread. Reminders for a follow-up due more than 7 days ago
-- are dropped on insert; the current client never makes them (FU_CLIENT_WINDOW_MS).
create or replace function public.notif_insert_guard()
returns trigger language plpgsql as $$
declare due_ms bigint;
begin
  if new.id like 'fu-%' then
    due_ms := ((regexp_match(new.id, '-([0-9]{12,14})$'))[1])::bigint;
    if due_ms is not null and due_ms < (extract(epoch from now() - interval '7 days') * 1000)::bigint then
      return null;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.notif_insert_guard() from public, anon, authenticated;
drop trigger if exists notifications_insert_guard on public.notifications;
create trigger notifications_insert_guard before insert on public.notifications
  for each row execute function public.notif_insert_guard();

-- Every night at 21:00 UTC = 03:00 Asia/Dhaka. pg_cron is absent on PGlite, so guarded.
do $job$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice '0065: pg_cron not installed; retention job skipped (local/PGlite only)';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'notif-retention') then perform cron.unschedule('notif-retention'); end if;
  perform cron.schedule('notif-retention', '0 21 * * *', $c$ set statement_timeout = '300s'; select public.notif_purge(); $c$);
end $job$;

notify pgrst, 'reload schema';
