-- 0059 — Facebook Lead Ads intake: configuration and receive log.
--
-- Admin > Facebook Leads (src/components/views/FbLeadsView.jsx) edits these two
-- tables; the intake function reads them. Secrets are NOT stored here: the Page
-- access token, the app secret and the webhook verify token are Edge Function
-- secrets (FB_PAGE_ACCESS_TOKEN, FB_APP_SECRET, FB_VERIFY_TOKEN), so no table the
-- browser can read ever holds a credential.
--
-- Like the other app tables today these carry company_id and no RLS of their
-- own; the company-scoped policies of the auth cutover (0055) are the place to
-- close them. Additive and safe to re-run.

create table if not exists public.fb_lead_settings (
  id text primary key default 'default' check (id = 'default'),
  company_id text,
  enabled boolean not null default false,
  page_id text,
  page_name text,
  -- what a lead starts as, and what happens when its phone is already a lead:
  -- note = add the new answers to the existing lead, new = a second lead, skip = ignore
  default_status text not null default 'NEW',
  duplicate_policy text not null default 'note' check (duplicate_policy in ('note', 'new', 'skip')),
  notify_agent boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by text
);
insert into public.fb_lead_settings (id) values ('default') on conflict (id) do nothing;

create table if not exists public.fb_lead_forms (
  id text primary key,
  company_id text,
  form_id text not null unique,
  label text not null default '',
  active boolean not null default true,
  project text not null default '',            -- leads.property_interest
  source text not null default 'META_ADS',      -- leads.source
  status text,                                  -- overrides fb_lead_settings.default_status
  assign_mode text not null default 'none' check (assign_mode in ('none', 'agent', 'team', 'round_robin')),
  assign_agent_id text,
  assign_team_id text,
  assign_pool jsonb not null default '[]'::jsonb,   -- user ids for round_robin
  -- CRM field -> Facebook form field keys, e.g. {"phone": ["phone_number"]}
  field_map jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fb_lead_events (
  leadgen_id text primary key,
  company_id text,
  form_id text,
  page_id text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  status text not null default 'received' check (status in ('received', 'created', 'duplicate', 'skipped', 'failed')),
  lead_id text,
  error text
);
create index if not exists fb_lead_events_received_idx on public.fb_lead_events (received_at desc);

-- Access. This project turns row level security on for every new table, and with
-- no policy the app (which reads and writes with the anon / signed-in key) is
-- refused: "new row violates row-level security policy". The app edits the
-- settings and forms and reads the log; the intake function writes the log with
-- the service role, which bypasses RLS. The policies are as open as the other app
-- tables are today (see 0053); the company-scoped policies of the auth cutover
-- (0055) are where to tighten them.
alter table public.fb_lead_settings enable row level security;
alter table public.fb_lead_forms enable row level security;
alter table public.fb_lead_events enable row level security;

grant select, insert, update, delete on public.fb_lead_settings, public.fb_lead_forms to anon, authenticated;
grant select on public.fb_lead_events to anon, authenticated;

drop policy if exists fb_lead_settings_app on public.fb_lead_settings;
create policy fb_lead_settings_app on public.fb_lead_settings for all to anon, authenticated using (true) with check (true);
drop policy if exists fb_lead_forms_app on public.fb_lead_forms;
create policy fb_lead_forms_app on public.fb_lead_forms for all to anon, authenticated using (true) with check (true);
drop policy if exists fb_lead_events_app on public.fb_lead_events;
create policy fb_lead_events_app on public.fb_lead_events for select to anon, authenticated using (true);
