-- Admin-editable welcome/greeting text (WA Relay tab → Automation). Null =
-- fall back to each bot's own hardcoded default. {name} is replaced with
-- the customer's name (or "there" when unknown), same fallback the hardcoded
-- templates already use.
alter table wa_settings
  add column if not exists welcome_message text;
