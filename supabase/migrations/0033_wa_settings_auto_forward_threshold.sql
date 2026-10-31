-- Admin-editable message-count threshold for Eyad's auto-forward (WA Relay
-- tab → Automation). Was hardcoded as msgCount >= 3 in wa-bot-eyad.
alter table wa_settings
  add column if not exists auto_forward_after_messages integer not null default 3;
