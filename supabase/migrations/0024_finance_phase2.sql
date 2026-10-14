-- 0024 · Finance Phase 2: statement category, statement templates (line
-- extras), several projects per budget, budget archiving, append-only history.
--
-- Additive only: four new columns, one trigger function, four triggers. No row
-- is rewritten or deleted. Safe to run more than once, and safe on a database
-- where the earlier draft of this migration (0024_finance_simplify, now
-- removed) already ran: every statement here is "if not exists" / replaceable.
-- Apply in the Supabase SQL editor.
--
-- Budget approval is off (the finance function no longer writes it), but no
-- budget's stored status is changed here: the function reads any status as
-- usable, and a budget approved before keeps its approved amount as its limit.
--
-- Production order:
--   1. supabase/ops/0024_preflight.sql   read-only; keep its output
--   2. supabase/ops/0024_backup.sql      copies every finance_* table
--   3. this file, then 0025_finance_statement_number_unique.sql
--   4. deploy the `finance` Edge Function (Phase 2 build)
--   5. deploy the app
-- Undo: supabase/ops/0024_rollback.sql (read its notes first).

-- 1. A statement's category: Meta, Supabase, Claude, CRM, Marketing, Events,
--    Software, Travel, Office, or any custom text (shown as "Others · <text>").
--    '' = uncategorised, which is what existing statements read as.
alter table public.finance_invoices add column if not exists category text not null default '';

-- 2. Budgets are archived, never deleted: a budget's history, comments and
--    approval records stay with it. null = in use.
alter table public.finance_budgets add column if not exists archived_at timestamptz;

-- 3. A budget can span several projects: [{ id, name }]. Older budgets keep
--    their single property_id / property_name and are read as a one-project
--    list by the app, so nothing is copied over here.
alter table public.finance_budgets add column if not exists projects jsonb not null default '[]'::jsonb;

-- 4. Statement lines carry template-specific columns, e.g. a Meta ad set's
--    { campaign, impressions, cpm }. The template itself and its fields
--    (currency, period, vendor reference) live in finance_invoices.layout.
alter table public.finance_invoice_lines add column if not exists extra jsonb not null default '{}'::jsonb;

-- 5. Append-only history. finance_events and finance_comments take inserts
--    only. UPDATE, DELETE and TRUNCATE raise an error, for the service role
--    too. A wrong history entry is answered by a new "corrected" event (the
--    function's history.correct action), never by changing the old one. No
--    app workflow updates or deletes these rows, and no foreign key cascades
--    into them.
--
--    Maintenance, for a database owner in the SQL editor only (the API can't
--    set it), e.g. a legally required erasure:
--      begin;
--      set local finance.history_maintenance = 'on';
--      -- the change
--      commit;
--    `set local` ends with the transaction, so the guard is back on after it.
create or replace function public.finance_history_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('finance.history_maintenance', true), '') = 'on' then
    if tg_level = 'STATEMENT' then return null; end if;
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  raise exception 'Finance history is append-only: % on % is not allowed. Add a correction instead.', tg_op, tg_table_name
    using errcode = '55000', hint = 'Migration 0024 describes the maintenance setting.';
end;
$$;

revoke all on function public.finance_history_append_only() from public, anon, authenticated;

drop trigger if exists finance_events_append_only on public.finance_events;
create trigger finance_events_append_only before update or delete on public.finance_events
  for each row execute function public.finance_history_append_only();
drop trigger if exists finance_events_no_truncate on public.finance_events;
create trigger finance_events_no_truncate before truncate on public.finance_events
  for each statement execute function public.finance_history_append_only();

drop trigger if exists finance_comments_append_only on public.finance_comments;
create trigger finance_comments_append_only before update or delete on public.finance_comments
  for each row execute function public.finance_history_append_only();
drop trigger if exists finance_comments_no_truncate on public.finance_comments;
create trigger finance_comments_no_truncate before truncate on public.finance_comments
  for each statement execute function public.finance_history_append_only();

notify pgrst, 'reload schema';
