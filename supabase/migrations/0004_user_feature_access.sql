-- ============================================================================
-- LeadManager / WEPRO CRM — Per-user feature access + project assignment
-- Fixes: editing an agent's Feature Access / Projects worked in the session but
--        reverted on refresh. The columns never existed, so PostgREST rejected
--        them (PGRST204), the client silently stripped them, and the next
--        sbLoad() overwrote the local edit with the cloud row.
--
--   users.allowed_features  jsonb  — string[] of nav keys; overrides role defaults.
--                                    [] is meaningful ("may see nothing").
--                                    NULL = no override, fall back to the role.
--   users.projects          jsonb  — 'ALL' | string[] of property ids.
--                                    Referenced by uToR/rToU but never migrated.
--
-- Safe to run multiple times (ADD COLUMN IF NOT EXISTS).
-- Run in: Supabase Dashboard → SQL Editor → New query → Run.
-- ============================================================================

-- 1) columns (mirror src/lib/supabase.js uToR/rToU) --------------------------
--    jsonb, not text[]: `projects` holds EITHER the string 'ALL' or an array of
--    ids, and jsonb represents both.
alter table public.users add column if not exists allowed_features jsonb;
alter table public.users add column if not exists projects         jsonb;

-- 2) Reload PostgREST schema cache so the new columns are accepted -----------
notify pgrst, 'reload schema';
