-- Per-bot automation checklist (WA Relay tab → Eyad Bot / Dubai Bot).
--
-- Until now the automation toggles lived on the single wa_settings row, so
-- Eyad and Dubai could only be switched together. Each bot now has its own row
-- here; the Edge Functions read their own row (getBotSettings(bot) in
-- _shared/wa.ts) and fall back to the old wa_settings values if it is missing,
-- so deploying the functions before running this migration changes nothing.
--
--   welcome_enabled / welcome_message   first-contact intro / greeting
--   faq_agent_enabled                   AI reply to customer questions
--   ai_media_enabled                    AI may follow up with photo / floor plan / brochure
--   auto_forward_enabled                Eyad: create the lead after N messages
--                                       Dubai: create a lead for every inbound contact
--   auto_forward_after_messages         Eyad only
--   manual_forward_enabled              agent /f* commands (create lead)
--   docs_command_enabled                Eyad /send* commands; Dubai drip documents
--   takeover_enabled                    agent /t handover message
--   notes_enabled                       agent /n notes
--   customer_notify_enabled             "expert assigned" messages to the customer
--   meta_capi_enabled                   Meta Conversions API lead event
--
-- Safe to run multiple times. Run in: Supabase Dashboard → SQL Editor.

create table if not exists public.wa_bot_settings (
  bot                         text primary key,
  display_name                text not null,
  welcome_enabled             boolean not null default true,
  welcome_message             text,
  faq_agent_enabled           boolean not null default true,
  ai_media_enabled            boolean not null default true,
  auto_forward_enabled        boolean not null default false,
  auto_forward_after_messages integer not null default 3,
  manual_forward_enabled      boolean not null default true,
  docs_command_enabled        boolean not null default true,
  takeover_enabled            boolean not null default true,
  notes_enabled               boolean not null default true,
  customer_notify_enabled     boolean not null default true,
  meta_capi_enabled           boolean not null default true
);

-- Same as wa_settings / wa_projects: the browser (anon key) edits these.
alter table public.wa_bot_settings disable row level security;

-- Seed from the current global row so nothing changes when this lands.
-- Dubai's bot has always created a lead for every inbound contact, so its
-- auto-forward starts on; Eyad's was off by default.
insert into public.wa_bot_settings
  (bot, display_name, welcome_enabled, welcome_message, faq_agent_enabled, auto_forward_enabled, auto_forward_after_messages)
select b.bot, b.display_name,
       coalesce(s.welcome_enabled, true), s.welcome_message, coalesce(s.faq_agent_enabled, true),
       case when b.bot = 'dubai' then true else coalesce(s.auto_forward_enabled, false) end,
       coalesce(s.auto_forward_after_messages, 3)
from (values ('eyad', 'Eyad Bot'), ('dubai', 'Dubai Bot')) as b(bot, display_name)
left join public.wa_settings s on s.id = 'default'
on conflict (bot) do nothing;

notify pgrst, 'reload schema';
