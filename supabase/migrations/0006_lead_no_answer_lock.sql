-- ============================================================================
-- LeadManager / WEPRO CRM — No-Answer attempt counter + 24h lock
-- Adds durable storage for the Initial/Meeting Agent "Attempt" (No Answer) flow.
--
-- Behaviour (src/lib/db.js logNoAnswer): each no-answer logs a 0-min call and a
-- next-day follow-up. After 7 attempts the lead is LOCKED for 24h — its status is
-- left unchanged (it is NOT auto-disqualified). Once the lock lifts the agent is
-- granted a fresh batch of 7 attempts.
--
-- These two fields drive that. Without the columns PostgREST rejected them
-- (PGRST204), the client stripped them, and the counter/lock lived only in the
-- browser's localStorage — so a page reload wiped the count and the lock was
-- trivially bypassed. See src/lib/supabase.js lToR/rToL.
--
--   no_answer_count      integer      attempts in the current batch (0..7)
--   no_answer_lock_until timestamptz  when the 24h cool-off lifts (null = not locked)
--
-- Safe to run multiple times (ADD COLUMN IF NOT EXISTS).
-- Run in: Supabase Dashboard → SQL Editor → New query → Run.
-- ============================================================================

-- 1) columns (mirror src/lib/supabase.js lToR/rToL) --------------------------
alter table public.leads add column if not exists no_answer_count      integer not null default 0;
alter table public.leads add column if not exists no_answer_lock_until timestamptz;

-- 2) Reload PostgREST schema cache so the new columns are accepted -----------
notify pgrst, 'reload schema';
