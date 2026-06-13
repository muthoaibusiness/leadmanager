-- ============================================================================
-- LeadManager / WEPRO CRM — Supabase schema fix
-- Fixes:
--   PGRST204  leads.cart column missing        (lead create / import)
--   PGRST205  public.properties table missing  (properties sync)
--   (same class) public.bookings table missing (bookings sync)
--   multi-tenant: company_id on leads/users/teams + companies table
--
-- Safe to run multiple times (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
-- Run in: Supabase Dashboard → SQL Editor → New query → Run.
-- ============================================================================

-- 1) leads: add the two missing columns -------------------------------------
alter table public.leads add column if not exists cart       jsonb;
alter table public.leads add column if not exists company_id text;

-- 2) multi-tenant company_id on existing tables -----------------------------
alter table public.users add column if not exists company_id text;
alter table public.teams add column if not exists company_id text;

-- 3) companies table --------------------------------------------------------
create table if not exists public.companies (
  id         text primary key,
  name       text not null,
  plan       text default 'Starter',
  is_active  boolean default true,
  created_at timestamptz default now()
);

-- 4) properties table (mirrors src/lib/supabase.js pToR) ---------------------
create table if not exists public.properties (
  id              text primary key,
  name            text,
  developer       text,
  type            text,
  district        text,
  address         text,
  status          text default 'AVAILABLE',
  units_available integer default 0,
  total_units     integer default 0,
  asking_price    numeric default 0,
  price_per_sqft  numeric default 0,
  size_min        numeric default 0,
  size_max        numeric default 0,
  images          jsonb  default '[]'::jsonb,
  loan            jsonb  default '{}'::jsonb,
  construction    numeric default 0,
  handover        text,
  amenities       jsonb  default '[]'::jsonb,
  documents       jsonb  default '[]'::jsonb,
  units           jsonb  default '[]'::jsonb,
  area            text,
  land_area       text,
  storeys         text,
  facing          text,
  total_sft       numeric default 0,
  unsold_sft      numeric default 0,
  saleable_units  text,
  drive_link      text,
  purpose         text,
  size_text       text,
  details         text,
  company_id      text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- 5) bookings table (mirrors src/lib/supabase.js bkToR) ----------------------
create table if not exists public.bookings (
  id            text primary key,
  lead_id       text,
  lead_name     text,
  property_id   text,
  property_name text,
  unit_no       text,
  agent_id      text,
  agent_name    text,
  total         numeric default 0,
  status        text default 'ACTIVE',
  schedule      jsonb default '[]'::jsonb,
  payments      jsonb default '[]'::jsonb,
  company_id    text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- 6) Access for the anon REST key (mirrors how leads/users already work) -----
--    The app talks to PostgREST with the anon key only. Allow it full access
--    to the new tables. (Tighten later if you add real auth.)
alter table public.companies  enable row level security;
alter table public.properties enable row level security;
alter table public.bookings   enable row level security;

drop policy if exists "anon all companies"  on public.companies;
drop policy if exists "anon all properties" on public.properties;
drop policy if exists "anon all bookings"   on public.bookings;

create policy "anon all companies"  on public.companies  for all to anon, authenticated using (true) with check (true);
create policy "anon all properties" on public.properties for all to anon, authenticated using (true) with check (true);
create policy "anon all bookings"   on public.bookings   for all to anon, authenticated using (true) with check (true);

grant all on public.companies, public.properties, public.bookings to anon, authenticated;

-- 7) Reload PostgREST schema cache so new columns/tables are picked up -------
notify pgrst, 'reload schema';
