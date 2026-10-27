-- Read-only report for the decisions 0049 deliberately leaves open. Changes
-- nothing; 0049 does not backfill or suppress any existing row.
-- Returns counts and internal lead ids only (no names, phones or messages).
-- Live, 2026-10-27: 45 leads at 5+ attempts (20 at 5, 25 at 6-7) and 47 leads
-- with 2+ logged Not Interested transitions (44 Not Interested now, 3 not,
-- 30 with a follow-up set).

-- ── A. Leads already at 5+ No Answer attempts ───────────────────────────────
-- After 0049 these are held at their count and are NOT suppressed. Their next
-- No Answer is refused. Decision needed: leave them (A), or suppress them with
-- ATTEMPTS_EXHAUSTED in a separate, approved script (B).
select no_answer_count,
       count(*) as leads,
       count(*) filter (where next_followup is not null) as with_followup,
       count(*) filter (where status in ('DEAL_CLOSED_WON', 'DEAL_CLOSED_LOST')) as closed,
       count(*) filter (where status = 'NOT_INTERESTED') as not_interested,
       count(*) filter (where no_answer_lock_until is not null) as had_24h_lock
  from public.leads where no_answer_count >= 5
 group by 1 order by 1;

select id, no_answer_count, status, (next_followup is not null) as has_followup
  from public.leads where no_answer_count >= 5
 order by no_answer_count desc, id;

-- ── B. Leads with 2+ logged NOT_INTERESTED transitions ──────────────────────
-- 0049 starts every existing lead at ni_count = 0. Decision needed: backfill
-- ni_count from history (counts only), and separately whether to suppress.
-- Limits: only exact 'Status → Not Interested' rows count; imports and bot
-- inserts left no row; free-text notes are ignored; history starts 2026-06-08.
with ni as (
  select lead_id, count(*) as ni_logged, max(timestamp) as last_ni
    from public.activities
   where type = 'STATUS_CHANGE' and description = 'Status → Not Interested'
   group by lead_id having count(*) >= 2)
select l.id, ni.ni_logged, ni.last_ni::date as last_ni, l.status,
       (l.next_followup is not null) as has_followup,
       exists (select 1 from public.activities a
                where a.lead_id = l.id and a.type = 'STATUS_CHANGE' and a.timestamp > ni.last_ni) as status_moved_after
  from ni join public.leads l on l.id = ni.lead_id
 order by (l.status <> 'NOT_INTERESTED') desc, ni.last_ni desc;

select count(*) filter (where n >= 2) as leads_2plus,
       count(*) filter (where n = 1) as leads_exactly_1
  from (select lead_id, count(*) as n from public.activities
         where type = 'STATUS_CHANGE' and description = 'Status → Not Interested'
         group by lead_id) s;

-- ── C. After 0049: state of the new columns (expect all zero before any use) ─
select count(*) filter (where followup_suppressed_at is not null) as suppressed,
       count(*) filter (where ni_count > 0) as with_ni_count,
       count(*) filter (where followup_not_before is not null) as with_requested_time
  from public.leads;
