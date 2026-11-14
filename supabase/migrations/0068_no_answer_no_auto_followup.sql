-- 0068 — Attempt / No Answer no longer books a follow-up for tomorrow.
-- The agent sets follow-ups themselves with the Follow-up button (0066 form).
--
-- lead_log_no_answer (0049) keeps everything else: one atomic attempt count,
-- the 5-attempt cap that stops follow-ups, the CALL row, and one FOLLOW_UP row per
-- attempt. That FOLLOW_UP row stays because Prospects contacted counts it
-- (src/lib/contactPerf.js); only its wording changes. The lead's existing
-- next_followup is left exactly as it is (a follow-up already booked stays).
-- Same signature as 0049, so the app needs no change to call it. Safe to re-run.

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
               else 'No answer (' || l.no_answer_count || '/5) — no follow-up booked' end,
          p_user_id, p_user_name, 0, now(), l.company_id);

  return query select l.no_answer_count, true, l.next_followup, l.followup_suppressed_reason;
end $$;

revoke all on function public.lead_log_no_answer(text, text, text, text) from public;
grant execute on function public.lead_log_no_answer(text, text, text, text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
