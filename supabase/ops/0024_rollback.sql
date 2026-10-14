-- 0024 rollback. Read all of this before running anything.
--
-- Order to roll Phase 2 back:
--   1. App: on Netlify, publish the previous deploy (Deploys → the deploy
--      before Phase 2 → "Publish deploy").
--   2. Function: redeploy the Phase 1 build. Dashboard: paste
--      D:\WEPPRO CRM\tools\finance-function-single-file.phase1.ts as the
--      function's index.ts (JWT verification stays off). CLI: deploy the
--      commit before Phase 2.
--   3. Database: run PART 1 below. Usually that is all.
--
-- What the Phase 1 function does with Phase 2 data:
--   · It brings budget approval back. Budgets created or edited under
--     Phase 2 have status ACTIVE, which Phase 1 treats as "not approved":
--     their figures show approved 0, and new expenses on them are refused
--     until they go through approval.
--   · It ignores finance_invoices.category, finance_budgets.archived_at and
--     .projects, and finance_invoice_lines.extra, so archived budgets show
--     again as normal budgets and Meta / Supabase statements show in the
--     plain layout. 0025's unique index can stay: Phase 1 numbering never
--     reuses a number while no statement is deleted.
--   · Statements, expenses, comments and history written under Phase 2 stay
--     and remain readable.

-- PART 1 · Remove the append-only triggers. Phase 1 never updates or deletes
-- history either, so this is only needed if the triggers themselves cause a
-- problem. The columns stay: dropping them would lose categories and archive
-- marks, and an older function does not mind them.
drop trigger if exists finance_events_append_only on public.finance_events;
drop trigger if exists finance_events_no_truncate on public.finance_events;
drop trigger if exists finance_comments_append_only on public.finance_comments;
drop trigger if exists finance_comments_no_truncate on public.finance_comments;
drop function if exists public.finance_history_append_only();
notify pgrst, 'reload schema';

-- PART 2 · Only to remove the 0024 columns as well. This DELETES every
-- statement category, archive mark, multi-project list and template line
-- column (Meta impressions, campaigns) written since 0024. Left commented out
-- on purpose.
-- alter table public.finance_invoices drop column if exists category;
-- alter table public.finance_budgets drop column if exists archived_at;
-- alter table public.finance_budgets drop column if exists projects;
-- alter table public.finance_invoice_lines drop column if exists extra;
-- notify pgrst, 'reload schema';

-- PART 3 · Only to put the data back exactly as it was before 0024, from
-- supabase/ops/0024_backup.sql. This DISCARDS everything written since the
-- backup (budgets, expenses, statements, comments, history). Run it in one
-- transaction, after PART 1 (the triggers would block the history tables),
-- and only on a deliberate decision. Left commented out on purpose.
-- begin;
-- set local finance.history_maintenance = 'on';
-- truncate public.finance_invoice_lines, public.finance_invoices, public.finance_expenses,
--          public.finance_budget_approvals, public.finance_budget_requests, public.finance_budgets,
--          public.finance_comments, public.finance_events;
-- insert into public.finance_budgets          select * from finance_backup_0024.finance_budgets;
-- insert into public.finance_budget_requests  select * from finance_backup_0024.finance_budget_requests;
-- insert into public.finance_budget_approvals select * from finance_backup_0024.finance_budget_approvals;
-- insert into public.finance_expenses         select * from finance_backup_0024.finance_expenses;
-- insert into public.finance_invoices (id, company_id, budget_id, number, title, status, issued_on, from_name, bill_to, notes, layout, share_token, created_by, created_by_name, created_at, updated_at, finalized_at)
--   select id, company_id, budget_id, number, title, status, issued_on, from_name, bill_to, notes, layout, share_token, created_by, created_by_name, created_at, updated_at, finalized_at from finance_backup_0024.finance_invoices;
-- insert into public.finance_invoice_lines    select * from finance_backup_0024.finance_invoice_lines;
-- insert into public.finance_comments         select * from finance_backup_0024.finance_comments;
-- insert into public.finance_events           select * from finance_backup_0024.finance_events;
-- commit;
