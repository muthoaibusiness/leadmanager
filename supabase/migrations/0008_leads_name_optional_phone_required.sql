-- ============================================================================
-- LeadManager / WEPRO CRM — leads: name optional, phone required
--
-- Inserts were failing with:
--   null value in column "name" of relation "leads" violates not-null constraint
--
-- A lead arriving without a name is normal — WhatsApp/prelead sources often
-- carry only a number. The name can be filled in later. What must never be null
-- is phone: it is the lead's identity, the key every import and manual add
-- dedups on (src/lib/db.js leadDedupKey, normalizePhone; the Add Lead form
-- locks it after creation — src/components/modals/AddLeadModal.jsx canEditPhone).
--
-- Verified before writing this: leads has 0 rows with a null name, 0 with a null
-- phone and 0 with an empty phone, so neither change can fail on existing data.
--
-- Safe to run multiple times.
-- Run in: Supabase Dashboard → SQL Editor → New query → Run.
-- ============================================================================

-- 1) name becomes optional ---------------------------------------------------
alter table public.leads alter column name drop not null;

-- 2) phone becomes required --------------------------------------------------
alter table public.leads alter column phone set not null;

-- 3) Reload PostgREST schema cache -------------------------------------------
notify pgrst, 'reload schema';
