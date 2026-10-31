-- 0048: index lead_id on notifications and bookings.
--
-- Deleting leads (sbDeleteLeads in src/lib/supabase.js) first deletes child
-- rows with `notifications?lead_id=in.(...)` and `bookings?lead_id=in.(...)`.
-- activities has idx_activities_lead (0009/0011), but these two tables had no
-- lead_id index, so each delete scanned the whole table. On 2026-10-26 the
-- notifications delete hit the statement timeout (HTTP 500, code 57014) while
-- the leads themselves were still deleted, leaving orphaned notification rows.
--
-- CONCURRENTLY builds each index without blocking writes, but it cannot run
-- inside a transaction block: run each statement on its own (SQL editor: one
-- statement per run). Both are idempotent.

create index concurrently if not exists idx_notifications_lead on public.notifications (lead_id);
create index concurrently if not exists idx_bookings_lead      on public.bookings (lead_id);

-- Optional, after the indexes exist: remove notifications left behind by leads
-- that were deleted while the notifications delete timed out. Check the count
-- first:
--   select count(*) from public.notifications n
--   where n.lead_id is not null
--     and not exists (select 1 from public.leads l where l.id::text = n.lead_id::text);
-- then:
--   delete from public.notifications n
--   where n.lead_id is not null
--     and not exists (select 1 from public.leads l where l.id::text = n.lead_id::text);
