-- 0027 · Finance: Meta statements' Invoice no. is issued once too.
--
-- The Invoice no. on a Meta statement (layout.invoiceNo, e.g. FBADS-634-…) is
-- copied from Meta's receipt, never generated. Like the Transaction ID and
-- Reference ID (0026) it goes into finance_statement_ids on the first save
-- that carries one, so the same number can't be on two statements, and it is
-- locked from then on. This only widens the kind check; no row changes.
--
-- Needs 0026. Safe to run more than once. Apply BEFORE deploying the finance
-- function that records invoice numbers (without it, a save that carries an
-- Invoice no. is refused with a message naming this migration; saves without
-- one work).
--
-- Rollback (only while no 'invoice' row exists):
--   alter table public.finance_statement_ids drop constraint finance_statement_ids_kind_check;
--   alter table public.finance_statement_ids add constraint finance_statement_ids_kind_check check (kind in ('transaction', 'reference'));

begin;

alter table public.finance_statement_ids drop constraint if exists finance_statement_ids_kind_check;
alter table public.finance_statement_ids add constraint finance_statement_ids_kind_check
  check (kind in ('transaction', 'reference', 'invoice'));

commit;
