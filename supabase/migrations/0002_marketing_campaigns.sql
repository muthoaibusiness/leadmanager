-- ============================================================================
-- LeadManager / WEPRO CRM — Marketing Campaigns & Costing
-- Adds:
--   public.campaigns            marketing campaigns + their cost
--   public.ads                  ads belonging to a campaign
--   leads.campaign_id/ad_id     lead → ad/campaign attribution (cost per lead)
--
-- Safe to run multiple times (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
-- Run in: Supabase Dashboard → SQL Editor → New query → Run.
-- ============================================================================

-- 1) campaigns table (mirrors src/lib/supabase.js cmToR) ---------------------
create table if not exists public.campaigns (
  id         text primary key,
  name       text,
  platform   text,
  cost       numeric default 0,
  start_date timestamptz,
  end_date   timestamptz,
  status     text default 'ACTIVE',
  company_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2) ads table (mirrors src/lib/supabase.js adToR) ---------------------------
--    ad_id is the ad's EXTERNAL id (entered by hand, e.g. the Meta ad id) and is
--    deliberately not unique — `id` is this row's own key.
create table if not exists public.ads (
  id              text primary key,
  title           text,
  body            text,
  sourceurl       text,
  greetingmessage text,
  sourceapp       text,
  ad_id           text,
  campaign_id     text references public.campaigns(id) on delete set null,
  company_id      text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists ads_campaign_id_idx on public.ads (campaign_id);

-- 3) leads: attribution columns ---------------------------------------------
--    No FK: a lead must survive its campaign/ad being deleted, and leads rows
--    can arrive before the campaign exists locally.
alter table public.leads add column if not exists campaign_id text;
alter table public.leads add column if not exists ad_id       text;

create index if not exists leads_campaign_id_idx on public.leads (campaign_id);
create index if not exists leads_ad_id_idx       on public.leads (ad_id);

-- 4) Access for the anon REST key (identical to companies/properties/bookings)
alter table public.campaigns enable row level security;
alter table public.ads       enable row level security;

drop policy if exists "anon all campaigns" on public.campaigns;
drop policy if exists "anon all ads"       on public.ads;

create policy "anon all campaigns" on public.campaigns for all to anon, authenticated using (true) with check (true);
create policy "anon all ads"       on public.ads       for all to anon, authenticated using (true) with check (true);

grant all on public.campaigns, public.ads to anon, authenticated;

-- 5) Realtime: sbSubscribeAll() listens on these tables ----------------------
--    `alter publication ... add table` errors if the table is already a member,
--    so only add what's missing (keeps this file re-runnable).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'campaigns'
  ) then
    alter publication supabase_realtime add table public.campaigns;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ads'
  ) then
    alter publication supabase_realtime add table public.ads;
  end if;
exception
  when undefined_object then
    raise notice 'publication supabase_realtime not found — enable Realtime for campaigns/ads in the dashboard.';
end $$;

-- 6) Reload PostgREST schema cache so new columns/tables are picked up -------
notify pgrst, 'reload schema';
