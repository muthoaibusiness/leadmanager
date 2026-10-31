-- AI Trainer test-number flow (docs/superpowers/plans/2026-10-18-relay-parity-and-test-number-flow.md).
--
-- trainer_test_mode, per bot, default false. While it is false nothing changes
-- for anyone. While it is true, a chat whose number is in that bot's
-- test_numbers (migration 0035) is answered by the AI Trainer core over the
-- current drafts instead of the legacy FAQ agent; every other chat stays on
-- the legacy path. The bot pointers (ai_bot_pointers) are not touched.
--
-- The index lets the Test numbers tab read one conversation's turns.
--
-- Additive and safe to run multiple times. Run in: Supabase Dashboard → SQL Editor.

alter table public.wa_bot_settings
  add column if not exists trainer_test_mode boolean not null default false;

create index if not exists ai_turns_conversation_idx on public.ai_turns (conversation_id, started_at desc);

notify pgrst, 'reload schema';
