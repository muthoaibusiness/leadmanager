-- 0058 — Meta CAPI: a manual-send switch, separate from recovery pause.
--
-- The `retry` action in capi-core.ts sends leads the operator picked from the
-- CRM. This adds an explicit gate for that manual path: when OFF, a manual
-- send is refused (409). It does not touch the scheduled sender (0052) or the
-- bots' per-bot switch — the schedule and the bots keep their own control.
-- Defaults ON, so existing behavior is unchanged until an admin turns it off.
--
-- Additive and re-runnable. Requires 0050 (capi_settings row exists).

alter table public.capi_settings
  add column if not exists manual_send_enabled boolean not null default true;
