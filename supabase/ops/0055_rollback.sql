-- Rollback of 0055: the 20 tables go back to how 0053/0054 left them (RLS off,
-- anon and authenticated with full privileges), and the five bot RPCs get
-- their anon/authenticated EXECUTE back. Run only together with redeploying
-- the previous client.

do $$
declare t text;
begin
  foreach t in array array['activities','agent_lead_quota','app_state','bookings','companies','hold_requests','leads',
                           'notifications','preleads','properties','targets','teams','wa_bot_settings','wa_conversations',
                           'wa_knowledge','wa_message_corrections','wa_messages','wa_projects','wa_settings','wa_webhook_events'] loop
    execute format('drop policy if exists crm_rw on public.%I', t);
    execute format('drop policy if exists crm_read on public.%I', t);
    execute format('drop policy if exists crm_admin_write on public.%I', t);
    execute format('drop trigger if exists crm_stamp_company on public.%I', t);
    execute format('alter table public.%I disable row level security', t);
    execute format('grant all on public.%I to anon, authenticated', t);
  end loop;
end $$;

grant execute on function public.wa_bump_unread(text, text, timestamptz, text), public.wa_create_lead(text, text, text),
  public.wa_upsert_prelead(text, text, text, text, text, text), public.wa_book_visit(jsonb), public.wa_visit_notified(bigint)
  to anon, authenticated;

do $$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists wa_media_auth_upload on storage.objects;
    drop policy if exists project_media_auth_upload on storage.objects;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'wa_media_anon_upload') then
      create policy wa_media_anon_upload on storage.objects for insert with check (bucket_id = 'wa-media');
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'project_media_anon_upload') then
      create policy project_media_anon_upload on storage.objects for insert with check (bucket_id = 'project-media');
    end if;
  end if;
end $$;

drop index if exists public.idx_notifications_user_created;
drop function if exists public.crm_chat_convs();
drop function if exists public.crm_stamp_company();
-- The notification company_id backfill is kept: it is correct data, and the
-- old client reads the same rows either way.
drop function if exists public.crm_chat_company();
drop function if exists public.crm_my_company();
drop function if exists public.crm_is_master();
drop function if exists public.crm_co_ok(text);
drop function if exists public.crm_active();
drop function if exists public.crm_admin();
notify pgrst, 'reload schema';
