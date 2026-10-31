-- Read-only. Run after applying 0037. Every row should say PASS.
select 'tables' as check, case when count(*) = 15 then 'PASS' else 'FAIL ' || count(*) end
  from information_schema.tables where table_schema = 'public' and table_name like 'ai\_%';
select 'rls on' as check, case when bool_and(relrowsecurity) then 'PASS' else 'FAIL' end
  from pg_class where relname like 'ai\_%' and relkind = 'r';
select 'no anon grants' as check, case when count(*) = 0 then 'PASS' else 'FAIL' end
  from information_schema.role_table_grants where grantee in ('anon','authenticated') and table_name like 'ai\_%';
select 'pointers legacy' as check, case when count(*) = 2 and bool_and(mode = 'legacy') then 'PASS' else 'FAIL' end
  from ai_bot_pointers;
select 'anon cannot reserve budget' as check,
  case when has_function_privilege('anon', 'ai_budget_reserve(text, numeric, numeric)', 'execute') then 'FAIL' else 'PASS' end;
