-- 0063 — Facebook leads the backlog drip should feed into the CRM, by id.
-- Used when Meta will not list a form's leads (the Page token lacks the permission): the ids come
-- from the Ads Manager CSV export (scripts/fb-backlog-sql.mjs prints the insert). The drip reads this
-- table as well as Meta's own list; a lead already handled is skipped either way.
create table if not exists public.fb_lead_backlog (
  leadgen_id   text primary key,
  form_id      text not null,
  created_time text,
  added_at     timestamptz not null default now()
);
alter table public.fb_lead_backlog enable row level security;   -- the function reads it with the service role
