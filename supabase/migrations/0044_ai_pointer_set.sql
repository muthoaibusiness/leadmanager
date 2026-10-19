-- AI Trainer: publish and rollback as one transaction. The Edge Function used
-- to do three separate writes (snapshot status, pointer, audit row), so a
-- failure part-way left the pointer moved with no audit, and two trainers
-- could overwrite each other. Additive: one new function, nothing altered.
-- No bot reads ai_bot_pointers yet, so this changes no customer behaviour.

-- Raises 'pointer_moved' when p_check_expected and the bot's current
-- snapshot_id differs from p_expected_snapshot_id (null means legacy).
-- p_publish also publishes a candidate snapshot; the snapshot and pointer
-- guard triggers still reject anything else.
create or replace function ai_pointer_set(
  p_bot text, p_mode text, p_snapshot_id uuid, p_check_expected boolean, p_expected_snapshot_id uuid,
  p_publish boolean, p_action text, p_reason text, p_actor text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_before ai_bot_pointers; v_after ai_bot_pointers; v_version int;
begin
  select * into v_before from ai_bot_pointers where bot = p_bot for update;
  if not found then raise exception 'not_found'; end if;
  if p_check_expected and v_before.snapshot_id is distinct from p_expected_snapshot_id then
    raise exception 'pointer_moved';
  end if;
  if p_publish and p_snapshot_id is not null then
    update ai_snapshots set status = 'published', published_at = now(), published_by_claimed = p_actor
    where id = p_snapshot_id and status = 'candidate';
  end if;
  update ai_bot_pointers set mode = p_mode, snapshot_id = p_snapshot_id, changed_at = now(),
    changed_by_claimed = p_actor, reason = p_reason
  where bot = p_bot returning * into v_after;
  select version_no into v_version from ai_snapshots where id = v_after.snapshot_id;
  insert into ai_trainer_audit (entity, entity_id, action, before, after, reason, actor_claimed)
  values ('pointer', p_bot, p_action, to_jsonb(v_before), to_jsonb(v_after) || jsonb_build_object('version_no', v_version), p_reason, p_actor);
  return to_jsonb(v_after);
end $$;

revoke all on function ai_pointer_set(text, text, uuid, boolean, uuid, boolean, text, text, text) from public, anon, authenticated;
grant execute on function ai_pointer_set(text, text, uuid, boolean, uuid, boolean, text, text, text) to service_role;

notify pgrst, 'reload schema';
