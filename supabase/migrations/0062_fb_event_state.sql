-- 0062 — Facebook Leads > Received: what happened to each lead, at a glance.
-- Written by fb-leads after the lead is made; the Received tab shows them as chips.
--   agent_name    who it was given to
--   forward_tag   the /f… tag it went through ('' = not forwarded)
--   customer_msg  sent | failed | off (notice switched off) | skipped (form says no) | '' (not forwarded)
--   capi          sent | unclear | failed | off | '' (Meta Lead event)
alter table public.fb_lead_events add column if not exists agent_name text;
alter table public.fb_lead_events add column if not exists forward_tag text;
alter table public.fb_lead_events add column if not exists customer_msg text;
alter table public.fb_lead_events add column if not exists capi text;
