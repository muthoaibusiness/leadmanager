-- 0060 — Facebook forms: hand the lead to the sales pool the moment the form is answered.
--
-- A form set to "forward" runs the same route as an agent typing a /f… tag in WhatsApp
-- (/fctg: the Chattogram pool): the wa_create_lead function makes the lead and picks
-- the agent from wa_agents, and the customer is messaged from the Eyad number with who
-- their expert is. forward_tag is the tag; notify_customer is the message to the customer.
--
-- Additive and safe to re-run. Existing forms keep their assign_mode.

alter table public.fb_lead_forms drop constraint if exists fb_lead_forms_assign_mode_check;
alter table public.fb_lead_forms add constraint fb_lead_forms_assign_mode_check
  check (assign_mode in ('none', 'agent', 'team', 'round_robin', 'forward'));

alter table public.fb_lead_forms add column if not exists forward_tag text not null default '/fctg';
alter table public.fb_lead_forms add column if not exists notify_customer boolean not null default true;
