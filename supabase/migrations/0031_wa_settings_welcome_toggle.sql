-- Admin toggle (WA Relay tab → Automation) for the bots' first-contact
-- welcome/greeting message. On by default, matching current behaviour.
alter table wa_settings
  add column if not exists welcome_enabled boolean not null default true;
