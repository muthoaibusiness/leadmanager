-- Drops everything 0037 created. Only valid while both pointers are 'legacy'
-- (the bots do not read these tables in legacy mode). Destroys trainer data.
do $$ begin
  if exists (select 1 from ai_bot_pointers where mode <> 'legacy') then
    raise exception 'a bot is not in legacy mode; move it back first';
  end if;
end $$;
drop table if exists ai_test_results, ai_test_runs, ai_bot_pointers, ai_snapshots, ai_test_revisions, ai_tests,
  ai_trainer_audit, ai_trainer_item_revisions, ai_trainer_imports, ai_conversation_state, ai_turns, ai_handoffs,
  ai_budget_reservations, ai_budget_days, ai_trainer_items cascade;
drop function if exists ai_budget_reserve(text, numeric, numeric), ai_budget_settle(uuid, numeric), ai_budget_release(uuid),
  ai_item_save(jsonb, int, text, text), ai_reject_change(), ai_snapshot_guard(), ai_run_guard(), ai_pointer_guard();
