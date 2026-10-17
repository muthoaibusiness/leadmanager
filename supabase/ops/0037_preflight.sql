-- Read-only. Run before applying 0037. Every row should say ok.
select 'no ai_ tables yet' as check, case when count(*) = 0 then 'ok' else 'STOP: ' || string_agg(table_name, ',') end as result
  from information_schema.tables where table_schema = 'public' and table_name like 'ai\_%';
select 'postgres 13 or later' as check, case when current_setting('server_version_num')::int >= 130000 then 'ok' else 'STOP' end;
