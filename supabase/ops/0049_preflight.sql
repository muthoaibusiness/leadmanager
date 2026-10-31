-- Read-only. Run before applying 0049. Every row should say ok.
select 'next_followup is text' as check, case when data_type = 'text' then 'ok' else 'STOP: ' || data_type end as result
  from information_schema.columns where table_schema = 'public' and table_name = 'leads' and column_name = 'next_followup';
select 'every next_followup is in toISOString() form' as check,
       case when count(*) = 0 then 'ok' else 'STOP: ' || count(*) || ' rows in another form (0049 leaves them as they are, but look first)' end as result
  from public.leads where next_followup is not null and next_followup !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$';
select 'activities.id is the primary key' as check, case when count(*) = 1 then 'ok' else 'STOP' end as result
  from pg_constraint where conrelid = 'public.activities'::regclass and contype = 'p';
select 'no other user trigger on leads' as check, case when count(*) = 0 then 'ok' else 'LOOK: ' || string_agg(tgname, ',') end as result
  from pg_trigger where tgrelid = 'public.leads'::regclass and not tgisinternal and tgname <> 'leads_followup_guard';
select 'new columns not taken' as check, case when count(*) = 0 then 'ok' else 'LOOK: ' || string_agg(column_name, ',') || ' already exist' end as result
  from information_schema.columns where table_schema = 'public' and table_name = 'leads'
   and column_name in ('ni_count', 'followup_suppressed_at', 'followup_suppressed_reason', 'followup_not_before');
select 'schema followup_internal free' as check, case when count(*) = 0 then 'ok' else 'LOOK: exists' end as result
  from pg_namespace where nspname = 'followup_internal';
select 'PostgREST exposes only public' as check, 'LOOK: confirm followup_internal is not in Settings > API > Exposed schemas' as result;
