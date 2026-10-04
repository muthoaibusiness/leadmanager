-- ============================================================================
-- 0019 — per-agent lead quota (free-plan limit)
--
-- Agents on a limited team may work on 3 distinct leads, then are locked for 24h
-- (src/lib/leadQuota.js). Stored per agent so the count and the lock survive
-- reloads, other browsers and other devices.
--
--   lead_ids      text[]       leads opened in the current cycle
--   locked_until  timestamptz  when the lock lifts (null = not locked)
--
-- Safe to run multiple times.
-- Run in: Supabase Dashboard → SQL Editor → New query → Run.
-- ============================================================================
create table if not exists public.agent_lead_quota (
  user_id      text primary key,
  lead_ids     text[] not null default '{}',
  locked_until timestamptz
);

notify pgrst, 'reload schema';
