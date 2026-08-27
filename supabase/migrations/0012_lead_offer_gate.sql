-- ============================================================================
-- LeadManager / WEPRO CRM -- Offer gate on the Team Lead hand-off
--
-- Rule: an Initial/Meeting Agent may not forward a lead to a Team Lead without
--       sending an offer, and the Team Lead's pipeline shows ONLY leads that
--       carry one.
--
-- The offer itself is still an OFFER activity (fwdLead writes it, LeadPanel
-- renders it), but "does this lead have an offer" has to be answerable from the
-- lead row: the panel's list is a paged PostgREST query and its totals come
-- from dashboard_rollup(), and neither can filter on a related table.
--
--   offer_sent_at  timestamptz  when the offer was sent with the TL hand-off
--   offer_value    numeric      that offer's pipeline value (totalSft x clientOffer)
--
-- Both are backfilled from existing OFFER activities, so leads forwarded before
-- this migration keep their place in the pipeline.
--
-- Safe to run multiple times.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> Run.
-- ============================================================================

-- 1) columns (mirror src/lib/supabase.js lToR/rToL) --------------------------
alter table public.leads add column if not exists offer_sent_at timestamptz;
alter table public.leads add column if not exists offer_value   numeric;

-- 2) backfill from the OFFER activities already on record --------------------
-- An OFFER activity's description is a JSON blob written by fwdLead. It is a
-- text column, so a row that predates that format (or was hand-edited) would
-- abort the whole UPDATE on cast -- hence the exception-swallowing reader.
create or replace function public.json_num(p_text text, p_key text)
returns numeric
language plpgsql
immutable
as $$
begin
  return (p_text::jsonb ->> p_key)::numeric;
exception when others then
  return null;
end;
$$;

with first_offer as (
  select distinct on (a.lead_id)
         a.lead_id, a.timestamp, a.description
    from public.activities a
   where a.type = 'OFFER'
   order by a.lead_id, a.timestamp
)
update public.leads l
   set offer_sent_at = f.timestamp,
       offer_value   = coalesce(public.json_num(f.description, 'pipelineValue'), l.offer_value)
  from first_offer f
 where f.lead_id = l.id
   and l.offer_sent_at is null;

-- 3) index — the Team Lead pipeline filters on it on every load --------------
create index if not exists idx_leads_offer_sent on public.leads (offer_sent_at);

-- 4) dashboard_rollup: the closing arms now match the gated list -------------
-- Supersedes the copy in 0011. Identical apart from closing_count /
-- closing_value; if 0011 is ever edited, re-apply this file after it.
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
  -- Gated on offer_sent_at (0012): a lead only reaches a Team Lead WITH an
  -- offer, so the panel's list, its count and its value all cover the same
  -- rows. offer_value is the offer's pipeline value -- calcPipelineValue() in
  -- db.js -- which is what the panel summed before the rollup existed.
  'closing_count', (select count(*) from scoped
                     where status in ('NEGOTIATING','SITE_VISIT_DONE')
                       and offer_sent_at is not null),
  'closing_value', (select coalesce(sum(coalesce(offer_value, deal_value)), 0) from scoped
                     where status in ('NEGOTIATING','SITE_VISIT_DONE')
                       and offer_sent_at is not null),
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
  -- When each tile's number last moved. The panel prints it as "updated 3
  -- hours ago" under the value: a stale figure and a quiet week look identical
  -- otherwise, and a Team Lead reading the board needs to tell them apart.
  'last_new_at',     (select max(created_at) from ranged),
  'last_won_at',     (select max(updated_at) from ranged where status = 'DEAL_CLOSED_WON'),
  'last_closing_at', (select max(updated_at) from scoped
                       where status in ('NEGOTIATING','SITE_VISIT_DONE')
                         and offer_sent_at is not null),
  'last_visit_at',   (select max(site_visit_done_date) from scoped
                       where site_visit_done_date is not null
                         and (p_start is null or site_visit_done_date >= p_start)
                         and (p_end   is null or site_visit_done_date <= p_end)),
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

-- 5) activity_rollup: the same stamps for the two activity tiles -------------
-- Supersedes the copy in 0011; identical apart from last_call_at / last_offer_at.
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
  -- Freshness stamps for the Proposals Sent / Team Talk Time tiles.
  'last_call_at',  (select max(timestamp) from scoped where type = 'CALL'),
  'last_offer_at', (select max(timestamp) from scoped where type = 'OFFER'),
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
-- 6) Reload PostgREST schema cache so the new columns are accepted -----------
notify pgrst, 'reload schema';
