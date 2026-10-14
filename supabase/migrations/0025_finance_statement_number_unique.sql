-- 0025 · Finance: a statement number is used once per company.
-- The finance function numbers a new statement after the highest existing one;
-- this index makes a clash (two saves at the same moment) fail instead of
-- producing a duplicate.

create unique index if not exists finance_invoices_company_number_key
  on public.finance_invoices (company_id, number);
