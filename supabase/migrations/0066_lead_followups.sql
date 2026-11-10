-- 0066 — A follow-up becomes a row: type, date+time, reminder, purpose, project
-- and note, with a pending → done / cancelled life (the "Setup next follow-up"
-- modal and the Agent Smart To-Do).
--
-- leads.next_followup stays, now as a cache the database keeps equal to the lead's
-- pending follow-up time, so every existing queue, KPI card, badge and bot that
-- reads it keeps working unchanged:
--   * lead_followups → leads   (lf_sync_lead): any change to a lead's rows writes
--     the earliest pending due_at into next_followup, in toISOString() text form.
--   * leads → lead_followups   (leads_fu_mirror): anything else that writes
--     next_followup (No Answer, imports, bots, an older app build) creates or moves
--     an 'auto' pending row; clearing it cancels the row (never counts as done); a
--     new assignee takes the pending row over.
-- The two triggers never re-enter each other (the wepro.lf_sync setting).
--
-- One pending row per lead. Inserting a new pending row replaces (cancels) the
-- previous one, so "reschedule" is simply "save a new one".
--
-- Writes no activities: the app writes exactly one FOLLOW_UP activity per user
-- action, which Prospects contacted counts (src/lib/contactPerf.js).
-- Safe to re-run.

create table if not exists public.lead_followups (
  id text primary key,
  company_id text,
  lead_id text not null references public.leads(id) on delete cascade,
  owner_id text,
  created_by text,
  created_by_name text,
  type text not null default 'CALL' check (type in ('CALL', 'MESSAGE', 'PROJECT_VISIT', 'OFFICE_VISIT', 'MEETING')),
  purpose text check (purpose is null or purpose in ('BUDGET', 'PRICE_PLAN', 'PROJECT_DETAILS', 'SITE_VISIT', 'DOCUMENTS', 'BOOKING', 'OTHER')),
  purpose_other text,
  project_id text,
  project_name text,
  due_at timestamptz not null,
  remind_min int not null default 15 check (remind_min between 0 and 10080),
  remind_at timestamptz,
  note_code text check (note_code is null or note_code in ('CALL_BACK', 'PRICE_PLAN', 'BROCHURE', 'CONFIRM_VISIT', 'DECISION', 'DOCUMENTS', 'OTHER')),
  note text,
  status text not null default 'pending' check (status in ('pending', 'done', 'cancelled')),
  source text not null default 'app' check (source in ('app', 'auto', 'backfill')),
  reminded_at timestamptz,
  done_at timestamptz,
  done_by text,
  outcome text,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lf_other_note check (note_code is distinct from 'OTHER' or coalesce(btrim(note), '') <> ''),
  constraint lf_other_purpose check (purpose is distinct from 'OTHER' or coalesce(btrim(purpose_other), '') <> '')
);
create unique index if not exists lf_one_pending on public.lead_followups (lead_id) where status = 'pending';
create index if not exists lf_owner_due on public.lead_followups (owner_id, due_at) where status = 'pending';
create index if not exists lf_remind_due on public.lead_followups (remind_at) where status = 'pending' and reminded_at is null;
create index if not exists lf_done on public.lead_followups (done_by, done_at) where status = 'done';
create index if not exists lf_company on public.lead_followups (company_id);

-- next_followup text form, the same as toISOString() (and 0049's fu_format).
create or replace function public.lf_iso(ts timestamptz) returns text
language sql immutable set search_path = pg_catalog as $$
  select to_char(ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;
create or replace function public.lf_parse(t text) returns timestamptz
language plpgsql immutable set search_path = pg_catalog as $$
begin
  if t is null or btrim(t) = '' then return null; end if;
  return t::timestamptz;
exception when others then return null;
end $$;

-- ── before: reminder time, timestamps, one pending per lead ────────────────
create or replace function public.lf_before() returns trigger
language plpgsql set search_path = public, pg_catalog as $$
begin
  new.updated_at := now();
  new.remind_at := new.due_at - make_interval(mins => new.remind_min);
  if tg_op = 'UPDATE' and (new.due_at is distinct from old.due_at or new.remind_min is distinct from old.remind_min) then
    new.reminded_at := null; -- a rescheduled follow-up reminds again
  end if;
  if new.status = 'pending' and (tg_op = 'INSERT' or old.status is distinct from 'pending') then
    update public.lead_followups
       set status = 'cancelled', cancelled_at = now(), cancel_reason = 'replaced'
     where lead_id = new.lead_id and status = 'pending' and id <> new.id;
  end if;
  if new.status = 'done' and new.done_at is null then new.done_at := now(); end if;
  if new.status = 'cancelled' and new.cancelled_at is null then new.cancelled_at := now(); end if;
  if new.company_id is null or new.owner_id is null then
    select coalesce(new.company_id, l.company_id), coalesce(new.owner_id, l.assigned_to)
      into new.company_id, new.owner_id
      from public.leads l where l.id = new.lead_id;
  end if;
  return new;
end $$;
drop trigger if exists lf_before on public.lead_followups;
create trigger lf_before before insert or update on public.lead_followups
  for each row execute function public.lf_before();

-- ── after: leads.next_followup = earliest pending due_at ───────────────────
create or replace function public.lf_sync_lead() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
declare lid text := coalesce(new.lead_id, old.lead_id); v text;
begin
  select public.lf_iso(min(due_at)) into v from public.lead_followups where lead_id = lid and status = 'pending';
  perform set_config('wepro.lf_sync', 'on', true);
  update public.leads set next_followup = v where id = lid and next_followup is distinct from v;
  perform set_config('wepro.lf_sync', 'off', true);
  return null;
end $$;
revoke all on function public.lf_sync_lead() from public, anon, authenticated;
drop trigger if exists lf_sync_lead on public.lead_followups;
create trigger lf_sync_lead after insert or update or delete on public.lead_followups
  for each row execute function public.lf_sync_lead();

-- ── leads → rows: any other writer of next_followup ────────────────────────
create or replace function public.leads_fu_mirror() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
declare due timestamptz; pend public.lead_followups%rowtype;
begin
  if coalesce(current_setting('wepro.lf_sync', true), 'off') = 'on' then return null; end if;
  select * into pend from public.lead_followups where lead_id = new.id and status = 'pending';

  if new.assigned_to is distinct from old.assigned_to and pend.id is not null then
    perform set_config('wepro.lf_sync', 'on', true);
    update public.lead_followups set owner_id = new.assigned_to where id = pend.id;
    perform set_config('wepro.lf_sync', 'off', true);
  end if;

  if new.next_followup is not distinct from old.next_followup then return null; end if;
  due := public.lf_parse(new.next_followup);
  perform set_config('wepro.lf_sync', 'on', true);
  if due is null then
    update public.lead_followups set status = 'cancelled', cancel_reason = 'cleared' where id = pend.id;
  elsif pend.id is not null then
    update public.lead_followups set due_at = due where id = pend.id and due_at is distinct from due;
  else
    insert into public.lead_followups (id, company_id, lead_id, owner_id, type, due_at, source, created_by, created_by_name)
    values ('lf' || replace(gen_random_uuid()::text, '-', ''), new.company_id, new.id, new.assigned_to, 'CALL', due, 'auto', 'system', 'System');
  end if;
  perform set_config('wepro.lf_sync', 'off', true);
  return null;
end $$;
revoke all on function public.leads_fu_mirror() from public, anon, authenticated;
drop trigger if exists leads_fu_mirror on public.leads;
create trigger leads_fu_mirror after update of next_followup, assigned_to on public.leads
  for each row execute function public.leads_fu_mirror();

-- ── backfill: one pending row per lead that has a follow-up now ────────────
-- A follow-up already past is marked reminded, so applying this sends nothing.
do $bf$
begin
  perform set_config('wepro.lf_sync', 'on', true);
  insert into public.lead_followups (id, company_id, lead_id, owner_id, type, due_at, source, created_by, created_by_name, reminded_at)
  select 'lfb' || l.id, l.company_id, l.id, l.assigned_to, 'CALL', public.lf_parse(l.next_followup), 'backfill', 'system', 'System',
         case when public.lf_parse(l.next_followup) <= now() then now() end
    from public.leads l
   where public.lf_parse(l.next_followup) is not null
     and not exists (select 1 from public.lead_followups f where f.lead_id = l.id and f.status = 'pending')
  on conflict (id) do nothing;
  perform set_config('wepro.lf_sync', 'off', true);
end $bf$;

-- ── access: the same open app policy as the other company tables ───────────
alter table public.lead_followups enable row level security;
grant select, insert, update, delete on public.lead_followups to anon, authenticated, service_role;
drop policy if exists lead_followups_app on public.lead_followups;
create policy lead_followups_app on public.lead_followups for all to anon, authenticated using (true) with check (true);

do $rt$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'lead_followups') then
    alter publication supabase_realtime add table public.lead_followups;
  end if;
end $rt$;

notify pgrst, 'reload schema';
