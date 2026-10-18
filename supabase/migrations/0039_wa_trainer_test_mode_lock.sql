-- Locks wa_bot_settings.trainer_test_mode (migration 0038) to the service role.
--
-- wa_bot_settings has RLS off: the browser edits the checklist with the anon
-- key (WA Relay, AI Trainer Bots tab). A table-wide UPDATE grant would also let
-- anyone holding the anon key switch trainer test mode on and skip the audited
-- testnumbers.set action. Postgres cannot revoke one column out of a table-wide
-- grant, so anon/authenticated get column-level INSERT and UPDATE on every
-- other column instead. trainer_test_mode is then written only by the
-- ai-trainer function (service role), which checks the Management role and
-- writes an audit row. A new insert still gets the column default (false).
--
-- test_numbers stays browser-editable: it is the existing WA Relay list
-- (migration 0035) and the bots already treat it as trusted. A number on it
-- gets trainer replies only after a Management user turns test mode on.
--
-- Safe to run multiple times. Run in: Supabase Dashboard → SQL Editor.

do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'wa_bot_settings' and column_name <> 'trainer_test_mode';
  execute 'revoke insert, update on public.wa_bot_settings from anon, authenticated';
  execute format('grant insert (%s), update (%s) on public.wa_bot_settings to anon, authenticated', cols, cols);
end $$;

notify pgrst, 'reload schema';
