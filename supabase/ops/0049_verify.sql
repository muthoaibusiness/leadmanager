-- Read-only. Run after applying 0049. Every row should say ok.
select 'guard trigger enabled' as check, case when count(*) = 1 then 'ok' else 'STOP' end as result
  from pg_trigger where tgrelid = 'public.leads'::regclass and tgname = 'leads_followup_guard' and tgenabled = 'O';
select 'lead_log_no_answer callable by anon' as check,
       case when has_function_privilege('anon', 'public.lead_log_no_answer(text,text,text,text)', 'execute') then 'ok' else 'STOP' end as result;
select 'nothing in 0049 is SECURITY DEFINER' as check, case when count(*) = 0 then 'ok' else 'STOP' end as result
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where p.prosecdef and (n.nspname = 'followup_internal' or p.proname = 'lead_log_no_answer');
select 'fu_format round-trips toISOString()' as check,
       case when followup_internal.fu_format(followup_internal.fu_parse('2026-03-09T23:59:59.999Z')) = '2026-03-09T23:59:59.999Z' then 'ok' else 'STOP' end as result;
select 'no suppressed lead keeps a follow-up' as check, case when count(*) = 0 then 'ok' else 'STOP: ' || count(*) end as result
  from public.leads where followup_suppressed_at is not null and next_followup is not null;
select 'no follow-up before a requested time' as check, case when count(*) = 0 then 'ok' else 'STOP: ' || count(*) end as result
  from public.leads where followup_not_before is not null
   and followup_internal.fu_parse(next_followup) < followup_not_before;
select 'every next_followup still in toISOString() form' as check, case when count(*) = 0 then 'ok' else 'LOOK: ' || count(*) end as result
  from public.leads where next_followup is not null and next_followup !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$';
select 'existing rows untouched (no suppression yet)' as check,
       case when count(*) filter (where followup_suppressed_at is not null and followup_suppressed_at < now() - interval '1 minute') = 0
            then 'ok' else 'LOOK' end as result
  from public.leads;
