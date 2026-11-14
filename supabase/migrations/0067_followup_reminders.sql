-- 0067 — Follow-up reminders come from the server: every minute, each pending
-- follow-up whose reminder time has come gets one bell notification for the
-- agent who holds the lead now, whether or not anyone has the app open.
--   "Follow-up in 15 min: Rahim · Phone call · Budget discussion · 10:30 AM"
-- Needs 0065 (crm_job_log) and 0066 (lead_followups). Safe to re-run.
--
-- Each follow-up is claimed once (reminded_at), and the notification id is fixed
-- by follow-up and due time ("rem-<id>-<dueMs>"), so a retry never sends twice;
-- a reschedule clears reminded_at (0066 lf_before) and reminds again.
-- Any lead status gets a reminder. Skipped: reminders more than 12 h late (the job
-- was down), leads whose follow-ups are stopped (0049), leads with nobody assigned.

create or replace function public.followup_remind_due()
returns int language plpgsql security definer set search_path = public, pg_catalog as $$
declare n int := 0;
begin
  with due as (
    update public.lead_followups f
       set reminded_at = now()
     where f.status = 'pending' and f.reminded_at is null and f.remind_at <= now()
    returning f.*
  )
  insert into public.notifications (id, user_id, type, message, lead_id, is_read, created_at, company_id)
  select 'rem-' || d.id || '-' || (extract(epoch from d.due_at) * 1000)::bigint,
         l.assigned_to, 'FOLLOW_UP',
         'Follow-up ' ||
           case when d.remind_min = 0 then 'now'
                when d.remind_min < 60 then 'in ' || d.remind_min || ' min'
                when d.remind_min < 1440 then 'in ' || (d.remind_min / 60) || ' h'
                when d.remind_min = 1440 then 'tomorrow'
                else 'in ' || (d.remind_min / 1440) || ' days' end
           || ': ' || coalesce(nullif(btrim(l.name), ''), 'Lead')
           || ' · ' || case d.type when 'CALL' then 'Phone call' when 'MESSAGE' then 'Message'
                           when 'PROJECT_VISIT' then 'Project visit' when 'OFFICE_VISIT' then 'Office visit'
                           when 'MEETING' then 'Client meeting' else d.type end
           || coalesce(' · ' || case d.purpose when 'BUDGET' then 'Budget discussion' when 'PRICE_PLAN' then 'Price & payment plan'
                           when 'PROJECT_DETAILS' then 'Project details' when 'SITE_VISIT' then 'Site visit planning'
                           when 'DOCUMENTS' then 'Documents' when 'BOOKING' then 'Booking'
                           when 'OTHER' then nullif(btrim(d.purpose_other), '') end, '')
           || ' · ' || to_char(d.due_at at time zone 'Asia/Dhaka',
                               case when d.remind_min >= 720 then 'DD Mon, HH12:MI AM' else 'HH12:MI AM' end),
         l.id, false, now(), l.company_id
    from due d
    join public.leads l on l.id = d.lead_id
   where d.remind_at > now() - interval '12 hours'
     and l.assigned_to is not null
     and (to_jsonb(l) ->> 'followup_suppressed_at') is null
  on conflict (id) do nothing;
  get diagnostics n = row_count;
  return n;
exception when others then
  insert into public.crm_job_log (job, finished_at, ok, detail)
  values ('followup_remind', now(), false, jsonb_build_object('error', sqlerrm));
  return -1;
end $$;
revoke all on function public.followup_remind_due() from public, anon, authenticated;
grant execute on function public.followup_remind_due() to service_role;

-- The browser made "fu-…" reminders when the follow-up was already due. The server
-- does it now, before the time; drop the browser's so nobody gets two.
create or replace function public.notif_insert_guard()
returns trigger language plpgsql as $$
begin
  if new.id like 'fu-%' then return null; end if;
  return new;
end $$;

do $job$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice '0067: pg_cron not installed; reminder job skipped (local/PGlite only)';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'followup-remind') then perform cron.unschedule('followup-remind'); end if;
  perform cron.schedule('followup-remind', '* * * * *', $c$ select public.followup_remind_due(); $c$);
end $job$;

notify pgrst, 'reload schema';
