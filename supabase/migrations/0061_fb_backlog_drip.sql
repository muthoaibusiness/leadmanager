-- 0061 — Facebook leads: feed the backlog into the CRM one lead every 5 minutes.
--
-- When backlog_drip is on, wa-followup (every 2 min, at most once per 5 min) lists the leads Meta
-- holds for each active form, takes the oldest one that is not a CRM lead yet, and handles it like
-- a live lead: the form's settings decide the agent (/fctg) and the customer message.
-- Off by default; switch it off again once the backlog is through.
--   update fb_lead_settings set backlog_drip = true;
alter table public.fb_lead_settings add column if not exists backlog_drip boolean not null default false;
