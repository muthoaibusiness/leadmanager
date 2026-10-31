-- 0053 — undo the dashboard RLS lockdown of 2026-10-30.
--
-- Applied in production 2026-10-30, approved by the repo owner.
--
-- Why
-- ---
-- On 2026-10-30 between 05:21 and 05:23 UTC, someone enabled row level security
-- on these 10 tables from the Supabase dashboard and added no policies. The app
-- uses only the anon key (no Supabase Auth), so with RLS on and no policy, every
-- read returns [] and every write fails. Login broke first, because loginRemote
-- reads `users`.
--
-- This puts the tables back to how they were before. The anon key regains full
-- access to them, the same access it had on 2026-10-29. Locking these tables
-- down needs real auth plus tenant-scoped policies first. That is separate work.
--
-- Not touched: the tables migrations 0037-0052 lock to the service role on
-- purpose (ai_*, capi_*, wa_secrets). Those keep RLS on.

alter table public.activities       disable row level security;
alter table public.agent_lead_quota disable row level security;
alter table public.app_state        disable row level security;
alter table public.bookings         disable row level security;
alter table public.companies        disable row level security;
alter table public.hold_requests    disable row level security;
alter table public.leads            disable row level security;
alter table public.targets          disable row level security;
alter table public.teams            disable row level security;
alter table public.users            disable row level security;
