-- Testing numbers per bot (WA Relay tab → Eyad Bot / Dubai Bot).
--
-- A chat with one of these numbers gets every checklist feature, even the ones
-- switched Off, so the team can try a feature on its own phone before turning
-- it on for customers. getBotSettings(bot, phone) in _shared/wa.ts does the
-- override. Numbers are stored as digits with the country code (8801XXXXXXXXX);
-- matching compares the last 10 digits, so 01XXXXXXXXX and +880… also match.
--
-- Safe to run multiple times. Run in: Supabase Dashboard → SQL Editor.

alter table public.wa_bot_settings
  add column if not exists test_numbers text[] not null default '{}';

update public.wa_bot_settings
   set test_numbers = array_append(test_numbers, '8801709665095')
 where not ('8801709665095' = any(test_numbers));

notify pgrst, 'reload schema';
