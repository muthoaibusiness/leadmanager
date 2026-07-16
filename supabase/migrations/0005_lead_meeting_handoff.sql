-- ============================================================================
-- LeadManager / WEPRO CRM — Lead meeting hand-off + visit/deal fields
-- Fixes: when an Initial Agent forwards a lead to a Meeting Agent, the meeting
--        details were set in the browser but never reached Supabase — the columns
--        did not exist, so PostgREST rejected them (PGRST204), the client silently
--        stripped them, and the Meeting Agent (on another device / after reload)
--        saw no meeting on their calendar.
--
-- The calendar builds a meeting event from leads.meeting_at + leads.meeting_type
-- (src/components/views/calendar/events.js), so those two are the load-bearing
-- columns for "Meeting Agent should see the meeting".
--
--   meeting_at           timestamptz  the hand-off meeting date/time (calendar event)
--   meeting_type         text         'ONLINE' | 'OFFLINE'
--   meeting_link         text         join URL for online meetings
--   meeting_shared       jsonb        string[] of what was already shared with the client
--   meeting_attended     boolean      MA marked the meeting attended → calendar "confirmed"
--   meeting_attended_at  timestamptz  when it was marked attended
--   visit_projects       jsonb        [{id,name}] projects tied to a scheduled site visit
--   deal_project_id      text         project chosen on a Team Lead forward
--   deal_project_name    text         its name (denormalised for display)
--
-- Safe to run multiple times (ADD COLUMN IF NOT EXISTS).
-- Run in: Supabase Dashboard → SQL Editor → New query → Run.
-- ============================================================================

-- 1) columns (mirror src/lib/supabase.js lToR/rToL) --------------------------
alter table public.leads add column if not exists meeting_at          timestamptz;
alter table public.leads add column if not exists meeting_type        text;
alter table public.leads add column if not exists meeting_link        text;
alter table public.leads add column if not exists meeting_shared      jsonb;
alter table public.leads add column if not exists meeting_attended    boolean;
alter table public.leads add column if not exists meeting_attended_at timestamptz;
alter table public.leads add column if not exists visit_projects      jsonb;
alter table public.leads add column if not exists deal_project_id     text;
alter table public.leads add column if not exists deal_project_name   text;

-- 2) Reload PostgREST schema cache so the new columns are accepted -----------
notify pgrst, 'reload schema';
