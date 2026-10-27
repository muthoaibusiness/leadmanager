-- Rolls back 0049's behaviour. Run only with approval, and roll the app back
-- first (the new app calls lead_log_no_answer; the old one does not).
-- The four added columns are KEPT: dropping them would lose suppression
-- history, and the old app ignores them. Drop them in a separate, reviewed
-- step if they are truly unwanted.
begin;
drop trigger if exists leads_followup_guard on public.leads;
drop function if exists followup_internal.leads_followup_guard();
drop function if exists public.lead_log_no_answer(text, text, text, text);
drop function if exists followup_internal.fu_parse(text);
drop function if exists followup_internal.fu_format(timestamptz);
drop schema if exists followup_internal;
alter table public.leads drop constraint if exists leads_followup_suppressed_reason_chk;
commit;
notify pgrst, 'reload schema';
