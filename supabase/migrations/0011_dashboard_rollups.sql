-- ============================================================================
-- 0011 — dashboard rollups
--
-- Why these functions exist
-- -------------------------
-- The Initial Agent and Meeting Agent dashboards were moved onto server-side
-- counts (one HEAD per KPI card, no rows). The Team Lead, Management and Master
-- dashboards cannot follow, because most of what they show is not a count:
--
--   Revenue / Pipeline Value      sum(deal_value)
--   Team Talk Time                sum(activities.duration_seconds)
--   Proposals Sent                count of OFFER activities
--   Source mix / status funnel    group by
--   14-day new-lead trend         group by day
--   Agent leaderboard             per-agent counts AND sums
--
-- PostgREST can express none of that here: aggregate functions are DISABLED on
-- this project (`select=deal_value.sum()` returns PGRST123 "Use of aggregate
-- functions is not allowed"), and it has no GROUP BY at all. So those pages had
-- to download every lead in the company and reduce in the browser — which is
-- exactly the load this whole change set is removing.
--
-- These three functions do the reduction in Postgres and return one small JSON
-- payload each. A Management dashboard that was downloading ~1200 lead rows
-- becomes three requests measured in kilobytes.
--
-- The client PROBES for them (dashboardRollup / agentLeadStats / activityRollup
-- in src/lib/db.js) and falls back to the old whole-book path if they are
-- absent, so the app keeps working whether or not this migration has been run.
--
-- Prerequisites: 0010 only, and even that is repeated defensively below.
-- Migration 0009 is NOT required: activity_rollup scopes through the parent
-- lead rather than through activities.company_id, which 0009 is what adds.
--
-- Scope arguments mirror sbLoad's tiers and getLeads():
--   p_company   the tenant. null = every company (MASTER only).
--   p_team      a team id. Matched on leads.team_id.
--   p_user_ids  team member ids. A lead counts if it is assigned to one of them
--               OR one of them appears in previous_assignees — the same union
--               getLeads() applies for a Team Lead, which guards against the
--               teamId drift fwdLead causes.
--   p_team + p_user_ids are OR-ed. Passing neither means "the whole company".
--
-- security definer because the anon key is what the browser holds; the RLS
-- policies in this project are `using (true)` anyway, so this grants nothing
-- the REST endpoint did not already expose. Scoping here is a payload
-- optimisation, not access control — see the note above sbLoad.
--
-- Safe to run multiple times.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> Run.
-- ============================================================================

-- 0) requires 0010 -----------------------------------------------------------
-- The funnel arm below reads leads.talked (see 0010_leads_talked_flag.sql).
-- Repeated here so this file can be applied on its own without erroring on a
-- missing column; 0010 is still what backfills it and keeps it current.
alter table public.leads add column if not exists talked boolean not null default false;

-- 1) whole-book rollup: totals, status/source breakdown, daily trend ---------
create or replace function public.dashboard_rollup(
  p_company    text        default null,
  p_team       text        default null,
  p_user_ids   text[]      default null,
  p_start      timestamptz default null,
  p_end        timestamptz default null,
  p_trend_days integer     default 14
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with scoped as (
  select l.*
    from public.leads l
   where (p_company is null or l.company_id = p_company or l.company_id is null)
     and (
          (p_team is null and p_user_ids is null)
       or (p_team is not null and l.team_id = p_team)
       or (p_user_ids is not null and (
             l.assigned_to = any(p_user_ids)
             or coalesce(l.previous_assignees, '[]'::jsonb) ?| p_user_ids))
     )
),
-- The date filter is a COHORT filter (leads created in the window), matching
-- what the dashboards do client-side. `scoped` stays unfiltered because the
-- trend and the event-dated tiles below need rows created before the window.
ranged as (
  select * from scoped
   where (p_start is null or created_at >= p_start)
     and (p_end   is null or created_at <= p_end)
),
days as (
  select generate_series(
           date_trunc('day', now()) - make_interval(days => greatest(p_trend_days, 1) - 1),
           date_trunc('day', now()),
           interval '1 day') as d
)
select jsonb_build_object(
  'total',   (select count(*) from ranged),
  'won',     (select count(*) from ranged where status = 'DEAL_CLOSED_WON'),
  'lost',    (select count(*) from ranged where status = 'DEAL_CLOSED_LOST'),
  -- coalesce, because `status not in (...)` is NULL (and so excludes the row)
  -- when status is null, whereas the browser's !CLOSED.includes(status) counts it.
  'active',  (select count(*) from ranged
               where coalesce(status, '') not in ('DEAL_CLOSED_WON','DEAL_CLOSED_LOST','NOT_INTERESTED')),
  'revenue', (select coalesce(sum(deal_value), 0) from ranged where status = 'DEAL_CLOSED_WON'),
  -- Deals a Team Lead is working now: negotiating or visit done, awaiting close.
  'closing_count', (select count(*) from scoped where status in ('NEGOTIATING','SITE_VISIT_DONE')),
  'closing_value', (select coalesce(sum(deal_value), 0) from scoped
                     where status in ('NEGOTIATING','SITE_VISIT_DONE')),
  -- Event-dated, so measured over `scoped`: a lead created in May whose visit
  -- happened yesterday belongs in yesterday's number.
  'site_visits', (select count(*) from scoped
                   where site_visit_done_date is not null
                     and (p_start is null or site_visit_done_date >= p_start)
                     and (p_end   is null or site_visit_done_date <= p_end)),
  'meetings_set', (select count(*) from scoped
                    where meeting_set_date is not null
                      and (p_start is null or meeting_set_date >= p_start)
                      and (p_end   is null or meeting_set_date <= p_end)),
  'status_counts', coalesce((select jsonb_object_agg(status, n)
                               from (select status, count(*) n from ranged
                                      where status is not null group by status) x), '{}'::jsonb),
  'source_counts', coalesce((select jsonb_object_agg(source, n)
                               from (select source, count(*) n from ranged
                                      where source is not null group by source) x), '{}'::jsonb),
  'trend', coalesce((select jsonb_agg(jsonb_build_object('d', to_char(d.d, 'YYYY-MM-DD'), 'n', c.n) order by d.d)
                       from days d
                       cross join lateral (
                         select count(*) n from scoped s
                          where s.created_at >= d.d and s.created_at < d.d + interval '1 day') c), '[]'::jsonb),
  -- The conversion funnel, cumulative by DEEPEST stage reached. This is
  -- leadStage() from src/lib/funnel.js expressed in SQL, arm for arm, so the
  -- bars are identical to the ones the browser used to compute -- including the
  -- talk-time arm, which is why it needs `talked` from migration 0010.
  -- Counting `rank >= stage` is what makes the funnel monotonic by
  -- construction, so each key below is a superset of the next.
  'funnel', (
    with staged as (
      select case
               when status = 'DEAL_CLOSED_WON' then 4
               when status = 'SITE_VISIT_DONE' or site_visit_done_date is not null then 3
               -- REACHED_MEETING = reachedFrom('MEETING_SET') in constants.js.
               when status in ('MEETING_SET','SITE_VISIT_SCHEDULED','SITE_VISIT_DONE',
                               'NEGOTIATING','DEAL_CLOSED_WON','DEAL_CLOSED_LOST')
                    or meeting_set_date is not null then 2
               -- PAST_CONTACT = reachedFrom('CONTACTED'). NOT_INTERESTED is
               -- deliberately absent from both: it is reachable straight from
               -- NEW, so it proves nothing about how far the lead got.
               when status in ('CONTACTED','INTERESTED','MEETING_SET','SITE_VISIT_SCHEDULED',
                               'SITE_VISIT_DONE','NEGOTIATING','DEAL_CLOSED_WON','DEAL_CLOSED_LOST')
                    or coalesce(talked, false) then 1
               else 0
             end as rank
        from ranged
    )
    select jsonb_build_object(
      'lead',       count(*),
      'connected',  count(*) filter (where rank >= 1),
      'meetingSet', count(*) filter (where rank >= 2),
      'siteVisit',  count(*) filter (where rank >= 3),
      'won',        count(*) filter (where rank >= 4)
    ) from staged
  )
)
$$;

-- 1b) stage trend -----------------------------------------------------------
-- Per-day counts of stage EVENTS over a rolling window, dated by when the event
-- happened rather than by when the lead arrived -- buildStageTrend() in
-- src/lib/funnel.js. Days are bucketed in the session time zone, matching that
-- function's deliberate use of local (not UTC) day boundaries: this is a UTC+6
-- app and UTC bucketing files every evening under the wrong day. Set the
-- database time zone accordingly, or pass p_tz.
--
-- `connected` has no column of its own, so it is reconstructed exactly as
-- connectedAt() does: the earliest of the first real call, the CONTACTED status
-- change, and meeting_set_date.
create or replace function public.stage_trend(
  p_company  text        default null,
  p_team     text        default null,
  p_user_ids text[]      default null,
  p_days     integer     default 30,
  p_tz       text        default 'Asia/Dhaka'
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with scoped as (
  select l.*
    from public.leads l
   where (p_company is null or l.company_id = p_company or l.company_id is null)
     and (
          (p_team is null and p_user_ids is null)
       or (p_team is not null and l.team_id = p_team)
       or (p_user_ids is not null and (
             l.assigned_to = any(p_user_ids)
             or coalesce(l.previous_assignees, '[]'::jsonb) ?| p_user_ids))
     )
),
conn as (
  select s.id,
         least(
           (select min(a.timestamp) from public.activities a
             where a.lead_id = s.id
               and ((a.type = 'CALL' and coalesce(a.duration_seconds, 0) > 0)
                    or (a.type = 'STATUS_CHANGE' and a.description = 'Status → Contacted'))),
           s.meeting_set_date
         ) as at
    from scoped s
),
days as (
  select generate_series(
           date_trunc('day', now() at time zone p_tz) - make_interval(days => greatest(p_days, 1) - 1),
           date_trunc('day', now() at time zone p_tz),
           interval '1 day') as d
)
select jsonb_build_object(
  'days', coalesce((select jsonb_agg(to_char(d.d, 'YYYY-MM-DD') order by d.d) from days d), '[]'::jsonb),
  'connected', coalesce((select jsonb_agg(c.n order by d.d) from days d cross join lateral (
      select count(*) n from conn
       where at is not null
         and (at at time zone p_tz) >= d.d and (at at time zone p_tz) < d.d + interval '1 day') c), '[]'::jsonb),
  'meetingSet', coalesce((select jsonb_agg(c.n order by d.d) from days d cross join lateral (
      select count(*) n from scoped
       where meeting_set_date is not null
         and (meeting_set_date at time zone p_tz) >= d.d and (meeting_set_date at time zone p_tz) < d.d + interval '1 day') c), '[]'::jsonb),
  'siteVisit', coalesce((select jsonb_agg(c.n order by d.d) from days d cross join lateral (
      select count(*) n from scoped
       where site_visit_done_date is not null
         and (site_visit_done_date at time zone p_tz) >= d.d and (site_visit_done_date at time zone p_tz) < d.d + interval '1 day') c), '[]'::jsonb)
)
$$;

-- 2) per-agent leaderboard --------------------------------------------------
-- One row per id in p_user_ids, ALWAYS — the left join keeps agents with no
-- leads in the result so the roster does not silently shrink.
create or replace function public.agent_lead_stats(
  p_user_ids     text[],
  p_company      text        default null,
  p_start        timestamptz default null,
  p_end          timestamptz default null,
  p_month_start  timestamptz default null
)
returns table (
  user_id      text,
  leads        bigint,
  calls        bigint,
  won          bigint,
  closed       bigint,
  revenue      numeric,
  converted    bigint,
  meetings_set bigint,
  visits_done  bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select u.uid,
         count(l.id),
         coalesce(sum(l.call_count), 0),
         count(*) filter (where l.status = 'DEAL_CLOSED_WON'),
         count(*) filter (where l.status in ('DEAL_CLOSED_WON','DEAL_CLOSED_LOST')),
         coalesce(sum(l.deal_value) filter (where l.status = 'DEAL_CLOSED_WON'), 0),
         count(*) filter (where l.status in ('SITE_VISIT_DONE','DEAL_CLOSED_WON')),
         -- achievement() in db.js: this month's meetings set / visits done,
         -- credited by meeting_set_by / site_visit_done_by rather than by who
         -- currently holds the lead.
         (select count(*) from public.leads m
           where m.meeting_set_by = u.uid
             and m.meeting_set_date is not null
             and (p_month_start is null or m.meeting_set_date >= p_month_start)),
         (select count(*) from public.leads v
           where v.site_visit_done_by = u.uid
             and v.site_visit_done_date is not null
             and (p_month_start is null or v.site_visit_done_date >= p_month_start))
    from unnest(p_user_ids) as u(uid)
    left join public.leads l
      on (l.assigned_to = u.uid
          or coalesce(l.previous_assignees, '[]'::jsonb) ? u.uid)
     and (p_company is null or l.company_id = p_company or l.company_id is null)
     and (p_start is null or l.created_at >= p_start)
     and (p_end   is null or l.created_at <= p_end)
   group by u.uid
$$;

-- 3) activity rollup --------------------------------------------------------
-- Talk time, call count and proposals, in total and per user. Replaces
-- Object.values(db.activities).flat() over the whole company.
create or replace function public.activity_rollup(
  p_company  text        default null,
  p_user_ids text[]      default null,
  p_start    timestamptz default null,
  p_end      timestamptz default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
-- Scoped through the PARENT LEAD, not through a company_id of its own.
-- public.activities has no company_id column: migration 0009 adds one, and it
-- has not been applied on every deployment (the app probes for it at runtime
-- and falls back to an unfiltered read -- see hasCompanyCol in supabase.js).
-- The join is also the more accurate test, since 0009's backfill leaves the
-- column null on any row written before it ran.
--
-- The join drops orphaned activities -- rows whose lead has been deleted --
-- which is what every dashboard wants anyway.
with scoped as (
  select a.*
    from public.activities a
    join public.leads l on l.id = a.lead_id
   where (p_company is null or l.company_id = p_company or l.company_id is null)
     and (p_start is null or a.timestamp >= p_start)
     and (p_end   is null or a.timestamp <= p_end)
     and (p_user_ids is null or a.user_id = any(p_user_ids))
)
select jsonb_build_object(
  'calls',     (select count(*) from scoped where type = 'CALL' and coalesce(duration_seconds,0) > 0),
  'talk_secs', (select coalesce(sum(duration_seconds), 0) from scoped where type = 'CALL'),
  'offers',    (select count(*) from scoped where type = 'OFFER'),
  'followups', (select count(*) from scoped where type = 'FOLLOW_UP'),
  'by_user', coalesce((select jsonb_object_agg(user_id, jsonb_build_object(
                                'calls', calls, 'talk_secs', talk_secs,
                                'offers', offers, 'followups', followups))
                         from (select user_id,
                                      count(*) filter (where type = 'CALL' and coalesce(duration_seconds,0) > 0) as calls,
                                      coalesce(sum(duration_seconds) filter (where type = 'CALL'), 0) as talk_secs,
                                      count(*) filter (where type = 'OFFER') as offers,
                                      count(*) filter (where type = 'FOLLOW_UP') as followups
                                 from scoped
                                -- 'system' writes the automated entries (hold
                                -- expiry and the like); crediting them to a
                                -- person would inflate that person's activity.
                                where user_id is not null and user_id <> 'system'
                                group by user_id) x), '{}'::jsonb)
)
$$;

-- Indexes the rollups lean on ------------------------------------------------
create index if not exists idx_leads_team           on public.leads (team_id);
create index if not exists idx_leads_meeting_set_by on public.leads (meeting_set_by) where meeting_set_by is not null;
create index if not exists idx_leads_visit_done_by  on public.leads (site_visit_done_by) where site_visit_done_by is not null;
create index if not exists idx_activities_user      on public.activities (user_id);
create index if not exists idx_activities_lead      on public.activities (lead_id);
create index if not exists idx_activities_ts        on public.activities (timestamp desc);

grant execute on function public.dashboard_rollup(text, text, text[], timestamptz, timestamptz, integer) to anon, authenticated;
grant execute on function public.agent_lead_stats(text[], text, timestamptz, timestamptz, timestamptz)   to anon, authenticated;
grant execute on function public.activity_rollup(text, text[], timestamptz, timestamptz)                 to anon, authenticated;
grant execute on function public.stage_trend(text, text, text[], integer, text)                          to anon, authenticated;
create index if not exists idx_activities_lead_type on public.activities (lead_id, type);

notify pgrst, 'reload schema';
