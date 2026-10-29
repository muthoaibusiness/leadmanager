-- 0049 — follow-up rules: a 5-attempt cap on No Answer calls, suppression of
-- follow-ups (two Not Interested outcomes, "No Longer Responding", attempts
-- used up) and a customer-requested earliest follow-up time.
--
-- NOT APPLIED. Review, preflight (supabase/ops/0049_preflight.sql) and an
-- explicit approval come first. scripts/test-0049.mjs runs it on PGlite.
--
-- What it does
-- ------------
-- * An attempt is a CALL with no answer, logged through lead_log_no_answer().
--   A connected call (LogCall) is not an attempt. At most 5 per lead; the 5th
--   stops follow-ups (ATTEMPTS_EXHAUSTED). Changing status still resets the
--   counter, as it did before.
-- * Moving a lead INTO NOT_INTERESTED adds 1 to ni_count. At 2, follow-ups stop
--   for good (NOT_INTERESTED_X2).
-- * "No Longer Responding" stops follow-ups (NO_LONGER_RESPONDING). The lead,
--   its status and its history stay.
-- * followup_not_before is the earliest time the customer asked to be
--   contacted. next_followup is never set earlier than that.
-- * Suppression only ever clears next_followup. Nothing is deleted, and status
--   is never changed here.
--
-- Existing rows are left exactly as they are
-- --------------------------------------------
-- No backfill. The 45 live leads already at 5+ attempts and the 47 with 2+
-- logged Not Interested transitions (preflight 2026-10-27) are not suppressed
-- and not rewritten. The guard acts only on a change it can see in the same
-- write: a count that goes up, a status that moves into NOT_INTERESTED. Any
-- backfill is a separate, reviewed script (supabase/ops/0049_dryrun.sql).
--
-- next_followup is TEXT
-- ---------------------
-- Live, every non-null value is JavaScript's toISOString() form,
-- 'YYYY-MM-DDTHH:MI:SS.mssZ' (853 of 853), and the app compares it as a string
-- (AgentDash: next_followup.lte.<iso>). So the column stays text, and:
--   followup_internal.fu_parse(text)   reads only that exact form; anything else is NULL,
--                            never an error, so a stray value cannot fail a write.
--   followup_internal.fu_format(ts)    writes only that exact form, whatever the session
--                            time zone.
-- The guard rewrites next_followup only when it has to (clear it, or move it to
-- the requested time), and then always through fu_format. A value it does not
-- change keeps its exact bytes; a value it cannot parse is left alone.
--
-- Identity: what this can and cannot enforce
-- ------------------------------------------
-- Every browser request runs as `anon` with the public key, and user ids in a
-- request are claims the browser makes. So this enforces row values only (the
-- cap, the requested time, a cleared follow-up when suppressed). It cannot tell
-- a manager from an agent. The one role test it makes is reliable for what it
-- is: NOT_INTERESTED_X2 can be lifted, and ni_count lowered, only by
-- postgres/service_role (an admin in the SQL editor), never through the app's
-- key. Who may lift the other two reasons is a UI rule until real sign-in
-- (Supabase Auth, decision D1) exists.
--
-- Safe to run more than once.

-- Helpers live in their own schema, which PostgREST does not expose (only
-- `public` is in the API's schema list), so none of them is reachable as
-- /rpc. The guard runs as whoever writes the lead (anon, for the app), so the
-- app roles need USAGE on the schema to reach the helpers. Every function in it
-- is a pure parse/format or the trigger body itself; none bypasses anything.
create schema if not exists followup_internal;
revoke all on schema followup_internal from public;
grant usage on schema followup_internal to anon, authenticated, service_role;

-- ── columns ─────────────────────────────────────────────────────────────────
alter table public.leads add column if not exists ni_count integer not null default 0;
alter table public.leads add column if not exists followup_suppressed_at timestamptz;
alter table public.leads add column if not exists followup_suppressed_reason text;
alter table public.leads add column if not exists followup_not_before timestamptz;

do $$ begin
  alter table public.leads add constraint leads_followup_suppressed_reason_chk
    check (followup_suppressed_reason is null
           or followup_suppressed_reason in ('NOT_INTERESTED_X2', 'NO_LONGER_RESPONDING', 'ATTEMPTS_EXHAUSTED'));
exception when duplicate_object then null; end $$;

-- ── next_followup text <-> timestamptz ─────────────────────────────────────
create or replace function followup_internal.fu_parse(t text) returns timestamptz
language plpgsql immutable set search_path = pg_catalog as $$
begin
  if t is null or t !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' then return null; end if;
  -- The cast below reads the trailing Z as UTC whatever the session zone.
  -- A shape that matches but names an impossible date (2026-02-31) is NULL.
  return t::timestamptz;
exception when invalid_datetime_format or datetime_field_overflow then
  return null;
end $$;

create or replace function followup_internal.fu_format(ts timestamptz) returns text
language sql immutable set search_path = pg_catalog as $$
  select to_char(ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

-- ── the guard ───────────────────────────────────────────────────────────────
create or replace function followup_internal.leads_followup_guard() returns trigger
language plpgsql set search_path = public, pg_catalog as $$
declare
  admin constant boolean := current_user in ('postgres', 'service_role', 'supabase_admin');
  was_suppressed boolean := false;
  nf timestamptz;
begin
  if tg_op = 'UPDATE' then
    was_suppressed := old.followup_suppressed_at is not null;

    -- Rows with nothing follow-up related in the change (mark_lead_talked,
    -- bot patches of region/phone, assignment) pass untouched.
    if new.status is not distinct from old.status
       and new.no_answer_count is not distinct from old.no_answer_count
       and new.next_followup is not distinct from old.next_followup
       and new.ni_count is not distinct from old.ni_count
       and new.followup_suppressed_at is not distinct from old.followup_suppressed_at
       and new.followup_suppressed_reason is not distinct from old.followup_suppressed_reason
       and new.followup_not_before is not distinct from old.followup_not_before then
      return new;
    end if;

    -- ni_count is the trigger's to keep. Only an admin may lower it.
    if not admin and new.ni_count < old.ni_count then new.ni_count := old.ni_count; end if;
    if new.status = 'NOT_INTERESTED' and old.status is distinct from 'NOT_INTERESTED' then
      new.ni_count := new.ni_count + 1;
    end if;

    -- A permanent suppression stays unless an admin lifts it.
    -- Either field cleared or changed counts as lifting it.
    if not admin and old.followup_suppressed_reason = 'NOT_INTERESTED_X2'
       and (new.followup_suppressed_reason is distinct from 'NOT_INTERESTED_X2'
            or new.followup_suppressed_at is distinct from old.followup_suppressed_at) then
      new.followup_suppressed_at := old.followup_suppressed_at;
      new.followup_suppressed_reason := old.followup_suppressed_reason;
    end if;

    -- The cap acts only on a count going up. A row that was already at 5 or
    -- more before this migration is held where it is and NOT suppressed: what
    -- to do with those rows is a separate decision (0049_dryrun.sql).
    if new.no_answer_count > old.no_answer_count and new.no_answer_count >= 5 then
      if old.no_answer_count >= 5 then
        new.no_answer_count := old.no_answer_count;
      else
        new.no_answer_count := 5;
        if new.followup_suppressed_at is null then
          new.followup_suppressed_at := now();
          new.followup_suppressed_reason := 'ATTEMPTS_EXHAUSTED';
        end if;
      end if;
    end if;
  else
    if new.status = 'NOT_INTERESTED' then new.ni_count := greatest(coalesce(new.ni_count, 0), 1); end if;
    if new.no_answer_count > 5 then new.no_answer_count := 5; end if;
  end if;

  if new.ni_count >= 2 and new.followup_suppressed_reason is distinct from 'NOT_INTERESTED_X2'
     and (tg_op = 'INSERT' or new.ni_count > old.ni_count) then
    new.followup_suppressed_at := now();
    new.followup_suppressed_reason := 'NOT_INTERESTED_X2';
  end if;

  -- A reason needs a time and a time needs a reason.
  if new.followup_suppressed_at is null then new.followup_suppressed_reason := null; end if;

  if new.followup_suppressed_at is not null then
    new.next_followup := null;
  elsif new.followup_not_before is not null then
    nf := followup_internal.fu_parse(new.next_followup);
    if nf is not null and nf < new.followup_not_before then
      new.next_followup := followup_internal.fu_format(new.followup_not_before);
    end if;
  end if;

  -- Audit: one system row when follow-ups stop or resume on an existing lead.
  -- The id is fixed by lead, event and time, so a replayed write cannot add a
  -- second row. On INSERT the lead row does not exist yet (activities has a
  -- foreign key to it) and a new lead has no follow-up history to stop, so
  -- nothing is logged there.
  if tg_op = 'INSERT' then
    return new;
  end if;
  if new.followup_suppressed_at is not null and not was_suppressed then
    insert into public.activities (id, lead_id, type, description, user_id, user_name, duration_seconds, timestamp, company_id)
    values ('fs-' || new.id || '-' || extract(epoch from new.followup_suppressed_at)::bigint, new.id, 'FOLLOW_UP',
            'Follow-ups stopped: ' || case new.followup_suppressed_reason
              when 'NOT_INTERESTED_X2' then 'not interested twice'
              when 'NO_LONGER_RESPONDING' then 'no longer responding'
              when 'ATTEMPTS_EXHAUSTED' then '5 attempts without an answer' end,
            'system', 'System', 0, now(), new.company_id)
    on conflict (id) do nothing;
  elsif new.followup_suppressed_at is null and was_suppressed then
    insert into public.activities (id, lead_id, type, description, user_id, user_name, duration_seconds, timestamp, company_id)
    values ('fr-' || new.id || '-' || extract(epoch from now())::bigint, new.id, 'FOLLOW_UP',
            'Follow-ups resumed', 'system', 'System', 0, now(), new.company_id)
    on conflict (id) do nothing;
  end if;

  return new;
end $$;

drop trigger if exists leads_followup_guard on public.leads;
create trigger leads_followup_guard
  before insert or update on public.leads
  for each row execute function followup_internal.leads_followup_guard();

-- ── No Answer, counted once ─────────────────────────────────────────────────
-- One atomic increment, so two devices never lose an attempt. p_request_id is
-- chosen by the browser per click; a retry with the same id finds its CALL row
-- and counts nothing. p_user_id/p_user_name are what the browser says: they are
-- recorded, not verified.
create or replace function public.lead_log_no_answer(p_lead_id text, p_user_id text, p_user_name text, p_request_id text)
returns table (attempts integer, counted boolean, next_followup text, suppressed_reason text)
language plpgsql security invoker set search_path = public, pg_catalog as $$
declare
  call_id constant text := 'na-' || p_request_id;
  l public.leads%rowtype;
begin
  if p_request_id is null or length(p_request_id) not between 8 and 80 then
    raise exception 'lead_log_no_answer: request id must be 8-80 characters';
  end if;

  -- A retry: this request already counted.
  if exists (select 1 from public.activities a where a.id = call_id) then
    return query select ld.no_answer_count, false, ld.next_followup, ld.followup_suppressed_reason
                   from public.leads ld where ld.id = p_lead_id;
    return;
  end if;

  update public.leads ld
     set no_answer_count = ld.no_answer_count + 1,
         call_count = coalesce(ld.call_count, 0) + 1,
         no_answer_lock_until = null,
         next_followup = followup_internal.fu_format(greatest(now() + interval '1 day', coalesce(ld.followup_not_before, now()))),
         updated_at = now()
   where ld.id = p_lead_id
     and ld.no_answer_count < 5
     and ld.followup_suppressed_at is null
     and ld.status not in ('DEAL_CLOSED_WON', 'DEAL_CLOSED_LOST')
  returning ld.* into l;

  if not found then
    return query select ld.no_answer_count, false, ld.next_followup, ld.followup_suppressed_reason
                   from public.leads ld where ld.id = p_lead_id;
    return;
  end if;

  insert into public.activities (id, lead_id, type, description, user_id, user_name, duration_seconds, timestamp, company_id)
  values (call_id, l.id, 'CALL', 'Call attempt · No Answer (' || l.no_answer_count || '/5)',
          p_user_id, p_user_name, 0, now(), l.company_id);
  insert into public.activities (id, lead_id, type, description, user_id, user_name, duration_seconds, timestamp, company_id)
  values ('nf-' || p_request_id, l.id, 'FOLLOW_UP',
          case when l.followup_suppressed_at is not null
               then '5 attempts reached — follow-ups stopped'
               else 'Auto follow-up next day — ' || l.next_followup end,
          p_user_id, p_user_name, 0, now(), l.company_id);

  return query select l.no_answer_count, true, l.next_followup, l.followup_suppressed_reason;
end $$;

revoke all on function public.lead_log_no_answer(text, text, text, text) from public;
grant execute on function public.lead_log_no_answer(text, text, text, text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
