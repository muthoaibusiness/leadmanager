-- 0024 backup · run just before applying migration 0024.
--
-- Copies every finance_* table into the schema finance_backup_0024. That
-- schema is not exposed to the API (only `public` is), and the copies have no
-- grants for anon or authenticated. Receipt files in the finance-media bucket
-- are not touched by 0024 and are not copied.
--
-- It fails if finance_backup_0024 already exists, so an older copy is never
-- overwritten by accident. Rename or drop that schema first only if you mean
-- to replace it.
--
-- Also, before deploying: check Database → Backups in the Supabase dashboard
-- for a recent daily backup (or point-in-time recovery), and note its time.

create schema finance_backup_0024;
revoke all on schema finance_backup_0024 from public, anon, authenticated;

create table finance_backup_0024.finance_budgets          as table public.finance_budgets;
create table finance_backup_0024.finance_budget_requests  as table public.finance_budget_requests;
create table finance_backup_0024.finance_budget_approvals as table public.finance_budget_approvals;
create table finance_backup_0024.finance_expenses         as table public.finance_expenses;
create table finance_backup_0024.finance_invoices         as table public.finance_invoices;
create table finance_backup_0024.finance_invoice_lines    as table public.finance_invoice_lines;
create table finance_backup_0024.finance_comments         as table public.finance_comments;
create table finance_backup_0024.finance_events           as table public.finance_events;

-- Row counts of the copies: they must equal section B of the pre-flight.
select 'finance_budgets' as copy, count(*) from finance_backup_0024.finance_budgets
union all select 'finance_budget_requests', count(*) from finance_backup_0024.finance_budget_requests
union all select 'finance_budget_approvals', count(*) from finance_backup_0024.finance_budget_approvals
union all select 'finance_expenses', count(*) from finance_backup_0024.finance_expenses
union all select 'finance_invoices', count(*) from finance_backup_0024.finance_invoices
union all select 'finance_invoice_lines', count(*) from finance_backup_0024.finance_invoice_lines
union all select 'finance_comments', count(*) from finance_backup_0024.finance_comments
union all select 'finance_events', count(*) from finance_backup_0024.finance_events;
