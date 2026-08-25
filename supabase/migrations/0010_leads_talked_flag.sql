-- 0010 — leads.talked: "somebody actually had a conversation with this lead"
--
-- Why this column exists
-- ----------------------
-- The dashboards' CONNECTED metric is "reached CONTACTED or beyond, OR some
-- CALL activity carries real talk time". The second half is the honest half:
-- logNoAnswer() writes a CALL activity with durationSeconds = 0 and still bumps
-- call_count, so `call_count > 0` counts seven unanswered rings as a connection.
--
-- That used to be computed in the browser, which was affordable only because
-- every lead and every activity was downloaded on login. They are not any more
-- (leads are paged, activities are fetched per lead), so the metric has to be a
-- server-side count — and PostgREST cannot express "has a related row matching
-- X" inside an OR with a base-table predicate, nor compare two columns.
--
-- Measured on live data, every row-only approximation is far off: for one agent
-- the true CONNECTED count is 155, while `call_count > 0` gives 225 and
-- `call_count > no_answer_count` gives 205. A 30% error on a headline KPI is
-- not a rounding difference, so the fact gets its own column.
--
-- The trigger is the single writer. The app never sets it: db.js writes
-- activities, and this keeps leads.talked in step. Once true it stays true —
-- a conversation that happened cannot un-happen, and deleting the activity row
-- (which only ever happens when the whole lead is deleted) must not silently
-- rewrite history.

alter table public.leads
  add column if not exists talked boolean not null default false;

-- Backfill from what is already recorded.
update public.leads l
   set talked = true
 where not l.talked
   and exists (
     select 1 from public.activities a
      where a.lead_id = l.id
        and a.type = 'CALL'
        and coalesce(a.duration_seconds, 0) > 0
   );

create or replace function public.mark_lead_talked()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.type = 'CALL' and coalesce(new.duration_seconds, 0) > 0 and new.lead_id is not null then
    update public.leads set talked = true where id = new.lead_id and not talked;
  end if;
  return new;
end $$;

drop trigger if exists trg_activities_mark_talked on public.activities;
create trigger trg_activities_mark_talked
  after insert or update of type, duration_seconds on public.activities
  for each row execute function public.mark_lead_talked();

-- The CONNECTED count filters on (status in (...) or talked), so an index on
-- the flag pays for itself on every dashboard load.
create index if not exists idx_leads_talked on public.leads (talked) where talked;

-- Filters the paged Leads list and every KPI count leans on.
create index if not exists idx_leads_assigned_to   on public.leads (assigned_to);
create index if not exists idx_leads_status        on public.leads (status);
create index if not exists idx_leads_created_at    on public.leads (created_at desc);
create index if not exists idx_leads_next_followup on public.leads (next_followup) where next_followup is not null;
-- previous_assignees is queried with jsonb containment (`cs`), which needs GIN.
create index if not exists idx_leads_prev_assignees on public.leads using gin (previous_assignees);

notify pgrst, 'reload schema';
