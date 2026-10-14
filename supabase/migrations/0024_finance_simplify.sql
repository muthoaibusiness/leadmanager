-- 0024 · Finance: no approval step, several projects per budget, line extras.
--
-- Budgets no longer go through submit → approve. A budget's amount is its
-- envelope from the moment it is saved, so every budget still mid-workflow is
-- moved to APPROVED (the one status the app now writes). The request/approval
-- tables stay as history and are no longer written.
--
-- A budget can span several projects: `projects` holds [{ id, name }].
-- property_id / property_name keep the first one, for older readers.
--
-- Statement lines get `extra` for template-specific columns, e.g. a Meta
-- statement's { impressions, cpm }.

alter table public.finance_budgets
  add column if not exists projects jsonb not null default '[]'::jsonb;

update public.finance_budgets
   set projects = jsonb_build_array(jsonb_build_object('id', property_id, 'name', property_name))
 where property_id is not null and projects = '[]'::jsonb;

update public.finance_budgets
   set status = 'APPROVED', updated_at = now()
 where status in ('DRAFT', 'SUBMITTED', 'REVISION');

alter table public.finance_invoice_lines
  add column if not exists extra jsonb not null default '{}'::jsonb;
