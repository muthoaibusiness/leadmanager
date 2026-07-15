-- ============================================================================
-- LeadManager / WEPRO CRM — Drop Marketing Campaigns & Costing
-- Reverses 0002_marketing_campaigns.sql. Removes:
--   public.ads                  ads belonging to a campaign
--   public.campaigns            marketing campaigns + their cost
--   leads.campaign_id/ad_id     lead → ad/campaign attribution
--
-- DESTRUCTIVE: every campaign, ad and lead attribution is permanently lost.
-- Safe to run multiple times (IF EXISTS everywhere).
-- Run in: Supabase Dashboard → SQL Editor → New query → Run.
-- ============================================================================

-- 1) Realtime: drop from the publication before the tables go ----------------
--    `alter publication ... drop table` errors if the table is not a member,
--    so only drop what's actually there (keeps this file re-runnable).
do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ads'
  ) then
    alter publication supabase_realtime drop table public.ads;
  end if;
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'campaigns'
  ) then
    alter publication supabase_realtime drop table public.campaigns;
  end if;
exception
  when undefined_object then
    raise notice 'publication supabase_realtime not found — nothing to drop.';
end $$;

-- 2) Tables (ads first — it has an FK onto campaigns) ------------------------
--    Dropping the table takes its policies, grants and indexes with it.
drop table if exists public.ads;
drop table if exists public.campaigns;

-- 3) leads: attribution columns ----------------------------------------------
--    Indexes on these columns are dropped implicitly with the columns.
alter table public.leads drop column if exists campaign_id;
alter table public.leads drop column if exists ad_id;

-- 4) Reload PostgREST schema cache so the dropped columns/tables disappear ----
notify pgrst, 'reload schema';
