-- 0024 pre-flight · READ-ONLY. Changes nothing.
--
-- Run in the Supabase SQL editor of the CRM project before applying migration
-- 0024, and keep the output with the deploy notes. It returns one table of
-- (section, item, value) rows: counts only, no names or amounts of people.
--
-- What each section tells you:
--   A  0023 tables are there; whether 0024 / 0025 were already (partly)
--      applied, including the removed 0024_finance_simplify draft
--   B  rows per finance table (how much existing data Phase 2 meets)
--   C  budgets per status: every non-ACTIVE status is a pre-Phase-2 budget;
--      its first edit moves it to ACTIVE
--   D  approved budgets: their limit stays the latest approved amount.
--      "differs" = draft_amount is not that amount (the edit form starts at
--      the approved amount, so the limit carries over). "no record" = status
--      APPROVED without an approval row: the limit is draft_amount
--   E  budgets with amount <= 0: any expense on them shows as an overrun
--      until someone edits the amount (edits require > 0)
--   F  expense categories in use: values outside Meta, Supabase, Claude, CRM,
--      Marketing, Events, Software, Travel, Office show as "Others · <text>"
--   G  statements per status, and statement numbers used twice (0025's
--      unique index fails while any number is used twice: renumber those
--      drafts first)
--   H  statement lines whose amount differs from their linked expense: such
--      a draft can't be finalized until the line is fixed
--   I  history rows whose record no longer exists (already orphaned)
--   K  accounts holding the finance_approve grant, shown as
--      "Manage all budgets" from Phase 2 on

select * from (
  select 'A tables' as section, t.name as item,
         case when exists (select 1 from information_schema.tables x where x.table_schema = 'public' and x.table_name = t.name) then 'present' else 'MISSING' end as value
  from (values ('finance_budgets'), ('finance_budget_requests'), ('finance_budget_approvals'), ('finance_expenses'),
               ('finance_invoices'), ('finance_invoice_lines'), ('finance_comments'), ('finance_events')) t(name)
  union all
  -- projects / extra present without category / archived_at = the removed
  -- 0024_finance_simplify draft ran (it also set mid-workflow budgets to APPROVED).
  select 'A 0024 already applied?', table_name || '.' || column_name, 'column present'
  from information_schema.columns
  where table_schema = 'public' and ((table_name = 'finance_invoices' and column_name = 'category') or (table_name = 'finance_budgets' and column_name in ('archived_at', 'projects'))
                                     or (table_name = 'finance_invoice_lines' and column_name = 'extra'))
  union all
  select 'A 0025 already applied?', indexname, 'index present'
  from pg_indexes where schemaname = 'public' and indexname = 'finance_invoices_company_number_key'
  union all
  -- pg_trigger, not information_schema.triggers: that view repeats a trigger
  -- once per event and leaves TRUNCATE triggers out.
  select 'A 0024 already applied?', c.relname || ' · ' || t.tgname, 'trigger present'
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in ('finance_events', 'finance_comments') and not t.tgisinternal

  union all select 'B rows', 'finance_budgets', count(*)::text from public.finance_budgets
  union all select 'B rows', 'finance_budget_requests', count(*)::text from public.finance_budget_requests
  union all select 'B rows', 'finance_budget_approvals', count(*)::text from public.finance_budget_approvals
  union all select 'B rows', 'finance_expenses', count(*)::text from public.finance_expenses
  union all select 'B rows', 'finance_invoices', count(*)::text from public.finance_invoices
  union all select 'B rows', 'finance_invoice_lines', count(*)::text from public.finance_invoice_lines
  union all select 'B rows', 'finance_comments', count(*)::text from public.finance_comments
  union all select 'B rows', 'finance_events', count(*)::text from public.finance_events

  union all
  select 'C budgets by status', coalesce(status, '(null)'), count(*)::text from public.finance_budgets group by status

  union all
  select 'D approved budgets', 'status APPROVED', count(*)::text from public.finance_budgets where status = 'APPROVED'
  union all
  select 'D approved budgets', 'approved amount differs from draft_amount', count(*)::text
  from public.finance_budgets b
  join lateral (select a.approved_amount from public.finance_budget_approvals a
                where a.budget_id = b.id and a.decision = 'APPROVED' order by a.decided_at desc limit 1) a on true
  where b.status = 'APPROVED' and a.approved_amount is distinct from b.draft_amount
  union all
  select 'D approved budgets', 'APPROVED with no approval record', count(*)::text
  from public.finance_budgets b
  where b.status = 'APPROVED' and not exists (select 1 from public.finance_budget_approvals a where a.budget_id = b.id and a.decision = 'APPROVED')

  union all
  select 'E amount <= 0', 'budgets', count(*)::text from public.finance_budgets where draft_amount <= 0

  union all
  select 'F expense categories', coalesce(nullif(category, ''), '(empty)'), count(*)::text from public.finance_expenses group by category

  union all
  select 'G statements by status', coalesce(status, '(null)'), count(*)::text from public.finance_invoices group by status
  union all
  select 'G duplicate numbers', number, count(*)::text from public.finance_invoices group by company_id, number having count(*) > 1

  union all
  select 'H lines not matching their expense', 'on ' || i.status || ' statements', count(*)::text
  from public.finance_invoice_lines l
  join public.finance_expenses e on e.id = l.expense_id
  join public.finance_invoices i on i.id = l.invoice_id
  where round(l.qty * l.unit_price, 2) <> round(e.amount, 2)
  group by i.status

  union all
  select 'I orphaned history', 'events · ' || e.entity_type, count(*)::text
  from public.finance_events e
  where (e.entity_type = 'budget' and not exists (select 1 from public.finance_budgets x where x.id = e.entity_id))
     or (e.entity_type = 'expense' and not exists (select 1 from public.finance_expenses x where x.id = e.entity_id))
     or (e.entity_type = 'invoice' and not exists (select 1 from public.finance_invoices x where x.id = e.entity_id))
  group by e.entity_type
  union all
  select 'I orphaned history', 'comments · ' || c.entity_type, count(*)::text
  from public.finance_comments c
  where (c.entity_type = 'budget' and not exists (select 1 from public.finance_budgets x where x.id = c.entity_id))
     or (c.entity_type = 'expense' and not exists (select 1 from public.finance_expenses x where x.id = c.entity_id))
     or (c.entity_type = 'invoice' and not exists (select 1 from public.finance_invoices x where x.id = c.entity_id))
  group by c.entity_type

  union all
  select 'K grant holders', 'finance_approve (Manage all budgets)', count(*)::text
  from public.users where allowed_features::text like '%finance_approve%'
) r
order by section, item;
