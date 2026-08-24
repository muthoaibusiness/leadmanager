-- ============================================================================
-- LeadManager / WEPRO CRM — tenant scoping
--
-- Until now every browser downloaded every table in full (sbLoad in
-- src/lib/supabase.js) and the tenant filter was applied client-side, after the
-- download, by sameCompany()/getLeads() in src/lib/db.js. This migration is the
-- server-side half of moving that filter into the query itself.
--
-- Three tables had no tenant column at all, so they could not be filtered:
--   activities     — only lead_id / user_id
--   notifications  — only user_id / lead_id
--   targets        — only user_id
-- Adding company_id to them is far cheaper than chunking `lead_id=in.(...)`
-- across thousands of ids, and unlike a PostgREST embedded-resource filter it
-- does not depend on a foreign key that was never declared in this repo.
--
-- It also backfills the company_id nulls that migrateTenancy() has been papering
-- over in the browser, so the query filters can eventually stop tolerating null.
--
-- Safe to run multiple times.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> Run.
-- ============================================================================

-- 1) tenant column on the three tables that lacked one -----------------------
alter table public.activities    add column if not exists company_id text;
alter table public.notifications add column if not exists company_id text;
alter table public.targets       add column if not exists company_id text;

-- 2) backfill the new columns from their parent row --------------------------
update public.activities a
   set company_id = l.company_id
  from public.leads l
 where a.lead_id = l.id
   and a.company_id is null
   and l.company_id is not null;

-- notifications: prefer the recipient's company, fall back to the lead's
update public.notifications n
   set company_id = u.company_id
  from public.users u
 where n.user_id = u.id
   and n.company_id is null
   and u.company_id is not null;

update public.notifications n
   set company_id = l.company_id
  from public.leads l
 where n.lead_id = l.id
   and n.company_id is null
   and l.company_id is not null;

update public.targets t
   set company_id = u.company_id
  from public.users u
 where t.user_id = u.id
   and t.company_id is null
   and u.company_id is not null;

-- 3) backfill pre-existing company_id nulls ----------------------------------
-- Derive a lead's company from whoever it is assigned to. This is exact, so it
-- runs regardless of how many companies exist.
update public.leads l
   set company_id = u.company_id
  from public.users u
 where l.assigned_to = u.id
   and l.company_id is null
   and u.company_id is not null;

update public.bookings b
   set company_id = u.company_id
  from public.users u
 where b.agent_id = u.id
   and b.company_id is null
   and u.company_id is not null;

update public.hold_requests h
   set company_id = u.company_id
  from public.users u
 where h.agent_id = u.id
   and h.company_id is null
   and u.company_id is not null;

-- Whatever is still null can only be resolved by assumption, so do it ONLY when
-- there is exactly one company and the assumption is therefore not a guess.
-- This is what migrateTenancy() (src/lib/db.js) does client-side with 'c1';
-- doing it here means it actually persists and the client copy can be deleted.
do $$
declare cid text;
begin
  select id into cid from public.companies limit 1;
  if (select count(*) from public.companies) = 1 then
    update public.users         set company_id = cid where company_id is null and role <> 'MASTER';
    update public.teams         set company_id = cid where company_id is null;
    update public.leads         set company_id = cid where company_id is null;
    update public.properties    set company_id = cid where company_id is null;
    update public.bookings      set company_id = cid where company_id is null;
    update public.hold_requests set company_id = cid where company_id is null;
    update public.activities    set company_id = cid where company_id is null;
    update public.notifications set company_id = cid where company_id is null;
    update public.targets       set company_id = cid where company_id is null;
  else
    raise notice 'More than one company (or none) — skipping the blanket company_id backfill. Resolve the remaining nulls by hand.';
  end if;
end $$;

-- 4) indexes — without these every scoped read is a seq scan -----------------
create index if not exists idx_users_company         on public.users (company_id);
create index if not exists idx_teams_company         on public.teams (company_id);
create index if not exists idx_leads_company         on public.leads (company_id);
create index if not exists idx_activities_company    on public.activities (company_id);
create index if not exists idx_activities_lead       on public.activities (lead_id);
create index if not exists idx_notifications_company on public.notifications (company_id);
create index if not exists idx_notifications_user    on public.notifications (user_id);
create index if not exists idx_targets_company       on public.targets (company_id);
create index if not exists idx_properties_company    on public.properties (company_id);
create index if not exists idx_bookings_company      on public.bookings (company_id);
create index if not exists idx_hold_requests_company on public.hold_requests (company_id);

-- 5) email uniqueness --------------------------------------------------------
-- createCompany()/bulkCreateUsers() check for a duplicate email client-side
-- against db.users. Once that array only holds one company, the check can no
-- longer see the other tenants, so the database has to be the one enforcing it.
-- loginRemote() matches on `email=ilike.<addr>` and takes the first row whose
-- password matches, so two accounts sharing an address is an auth bug, not just
-- untidy data.
-- Guarded: if duplicates already exist the index cannot be built, and aborting
-- the whole migration over it would be worse than reporting them.
do $$
begin
  create unique index if not exists idx_users_email_lower on public.users (lower(email));
exception when unique_violation then
  raise notice 'Duplicate emails present in public.users — unique index NOT created. Find them with: select lower(email), count(*) from public.users group by 1 having count(*) > 1;';
end $$;

-- 6) reload PostgREST schema cache -------------------------------------------
notify pgrst, 'reload schema';
