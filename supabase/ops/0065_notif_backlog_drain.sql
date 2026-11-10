-- One-time cleanup of the notifications backlog. Run AFTER migration 0065, at night
-- (fewest people online), in the Supabase SQL editor, ONE STEP AT A TIME: paste a
-- step, run it, check its output, then the next. VACUUM (step 6) cannot run inside
-- a multi-statement run.
--
-- Numbers on 2026-11-10: 781,180 rows, 236 MB of a 321 MB database.
--   774,178 FOLLOW_UP rows with random ids ("Follow-up reminder: <name>") came from
--   the old client reminder bug (22 Jun – 31 Oct 2026). They are copies: only 1,467
--   distinct (user, lead) pairs. The 90-day rule alone would keep most of them until
--   January, so step 3 keeps the newest row per (user, lead) and deletes the copies.
--   Nobody loses a reminder they could act on.
--
-- If anything fails midway, run step 5 (re-attach realtime) before stopping, or the
-- bell stops updating live.

-- STEP 1 — preflight (read-only).
select count(*) as total,
       count(*) filter (where type = 'FOLLOW_UP' and id not like 'fu-%') as legacy_followup,
       count(distinct (user_id, lead_id)) filter (where type = 'FOLLOW_UP' and id not like 'fu-%') as legacy_keep,
       pg_size_pretty(pg_total_relation_size('public.notifications')) as size
from public.notifications;
select jobname, schedule from cron.job where jobname = 'notif-retention';  -- expect 1 row (migration applied)

-- STEP 2 — detach notifications from realtime so the bulk delete is not streamed
-- to every open browser (old app builds still listen for deletes).
alter publication supabase_realtime drop table public.notifications;

-- STEP 3 — remove legacy duplicate reminders, keeping the newest per (user, lead).
set statement_timeout = '15min';
delete from public.notifications n
using (
  select id from (
    select id, row_number() over (partition by user_id, lead_id order by created_at desc, id desc) as rn
    from public.notifications
    where type = 'FOLLOW_UP' and id not like 'fu-%'
  ) d where d.rn > 1
) dup
where n.id = dup.id;

-- STEP 4 — apply the 30/90-day rule now instead of waiting for the nightly job.
-- Re-run until budget_hit is false and all three counts are 0.
set statement_timeout = '15min';
select public.notif_purge(50000, '600 seconds');

-- STEP 5 — re-attach realtime (ALWAYS run this, even if a step above failed).
alter publication supabase_realtime add table public.notifications;
select pubname from pg_publication_tables where tablename = 'notifications';  -- expect supabase_realtime

-- STEP 6 — reclaim space. Plain VACUUM frees space for reuse with no lock. VACUUM
-- FULL returns it to the disk but locks the table while it rewrites; with only a
-- few thousand rows left that takes seconds. Run one of them, on its own.
vacuum (analyze) public.notifications;
-- vacuum full analyze public.notifications;

-- STEP 7 — verify.
select count(*) as total,
       count(*) filter (where type = 'FOLLOW_UP') as follow_up,
       pg_size_pretty(pg_total_relation_size('public.notifications')) as size,
       pg_size_pretty(pg_database_size(current_database())) as db
from public.notifications;
select started_at, ok, detail from public.crm_job_log order by id desc limit 5;
