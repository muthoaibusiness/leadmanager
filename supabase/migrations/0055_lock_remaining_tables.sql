-- 0055 — close the remaining anon-open tables (CR-001 D1, after 0054).
--
-- NOT APPLIED. Ships only together with 0054, the account migration and the
-- client that signs in with Supabase Auth: without them every page goes empty.
-- Rollback: supabase/ops/0055_rollback.sql. scripts/test-0055.mjs runs both.
--
-- Rule (company scope, the app's own SCOPE_STRICT=false rule):
-- * anon: nothing.
-- * a signed-in ACTIVE account: rows of its own company, plus rows with no
--   company (2814 leads hold 18 such rows; the app already loads them).
--   MASTER: every company. Writes follow the same rule: a row may stay
--   without a company or move into the caller's own, never into another.
--   is_active is checked on every request through
--   crm_me(), so a deactivated account's still-valid access token reads and
--   writes nothing, closing the PostgREST revocation gap left by 0054.
-- * WhatsApp chat tables (wa_conversations, wa_messages): company-scoped. A
--   thread with no company of its own (2074 of 2081) belongs to the company
--   that owns the WhatsApp numbers, wa_settings.company_id (crm_chat_company).
--   A message follows its thread. Who may send is checked again by wa-send.
-- * Bot configuration (wa_bot_settings, wa_knowledge, wa_message_corrections,
--   wa_projects) and wa_settings: read by any active account, written only by
--   Management or Master. wa_bot_settings carries the Meta CAPI switch.
-- * Server-only tables (preleads, app_state, wa_webhook_events): no browser
--   access; the Edge Functions use the service role, which bypasses RLS.
-- * Five SECURITY DEFINER RPCs the bots call with the service role lose their
--   anon/authenticated EXECUTE grant (CR-001 CR-4 for wa_bump_unread).
--
-- Not covered here: role-level scoping inside a company (an agent can still
-- read its whole company, as today). Recorded in the CR-001 D1 report.

-- The notification bell asks for one user's newest 200 (user_id, created_at
-- desc). Without this index Postgres reads all of that user's rows (9203 for
-- the busiest account) to sort them; under RLS on a cold cache that took
-- 3.8 s and hit the 8 s statement timeout. With it: 9-15 ms cold. Built
-- outside the transaction below, so it does not hold the lockdown open.
create index if not exists idx_notifications_user_created on public.notifications (user_id, created_at desc);

begin;

-- Waits for each table's lock for at most 10 s, then stops cleanly (nothing
-- is applied; re-run it). A deadlock against ANALYZE or VACUUM, which take
-- their table locks one by one in their own order, is detected by Postgres
-- and rolls the whole migration back: it is safe to re-run. Apply it when
-- nothing else is changing these tables, not right after a bulk load.
set local lock_timeout = '10s';

-- The caller, resolved once per statement. Each policy wraps these in
-- (select ...) so Postgres runs them as an InitPlan, not once per row: a
-- per-row call took over 8 s on 15011 activities and hit the role's
-- statement_timeout; the InitPlan form takes about 18 ms. crm_me() is from 0054.
create or replace function public.crm_my_company()
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select m.company_id from public.crm_me() m where m.is_active is not false
$$;
create or replace function public.crm_is_master()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.crm_me() m where m.is_active is not false and m.role = 'MASTER')
$$;
create or replace function public.crm_active()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.crm_me() m where m.is_active is not false)
$$;
create or replace function public.crm_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.crm_me() m where m.is_active is not false and m.role in ('MANAGEMENT', 'MASTER'))
$$;
-- The company that owns the WhatsApp numbers: an unscoped thread is its.
create or replace function public.crm_chat_company()
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select s.company_id from public.wa_settings s where s.id = 'default'
$$;
-- A row a signed-in account writes without a company gets the caller's own,
-- so it never lands in the "no company" pool every tenant reads. Service-role
-- writes (bots, Edge Functions) have no CRM caller and are left as they are.
create or replace function public.crm_stamp_company()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.company_id is null and auth.uid() is not null then
    new.company_id := public.crm_my_company();
  end if;
  return new;
end $$;
revoke all on function public.crm_stamp_company() from public, anon, authenticated;

-- Notifications from before 0009 carry no company although their recipient
-- has one (about 215000 rows): give them the recipient's, so they stop being
-- readable by every tenant. The rows are not otherwise changed.
update public.notifications n set company_id = u.company_id
  from public.users u where u.id = n.user_id and n.company_id is null and u.company_id is not null;

-- The threads the caller may see, resolved once per statement (InitPlan): a
-- per-row lookup on wa_messages hit the 8 s statement timeout. Master: null = all.
create or replace function public.crm_chat_convs()
returns text[] language sql stable security definer set search_path = public, pg_temp as $$
  select case when public.crm_is_master() then null else coalesce(array_agg(c.id), '{}') end
  from public.wa_conversations c
  where coalesce(c.company_id, public.crm_chat_company()) = public.crm_my_company()
$$;
revoke all on function public.crm_my_company(), public.crm_is_master(), public.crm_active(), public.crm_admin(),
  public.crm_chat_company(), public.crm_chat_convs() from public, anon;
grant execute on function public.crm_my_company(), public.crm_is_master(), public.crm_active(), public.crm_admin(),
  public.crm_chat_company(), public.crm_chat_convs() to authenticated;


do $$
declare
  t text;
  company_tables text[] := array['activities','bookings','hold_requests','leads','notifications','properties','targets','teams'];
  chat_tables    text[] := array['wa_conversations','wa_messages'];
  config_tables  text[] := array['wa_bot_settings','wa_knowledge','wa_message_corrections','wa_projects','wa_settings'];
  server_tables  text[] := array['preleads','app_state','wa_webhook_events'];
begin
  foreach t in array company_tables || chat_tables || config_tables || server_tables || array['companies','agent_lead_quota'] loop
    execute format('revoke all on public.%I from anon', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists crm_rw on public.%I', t);
    execute format('drop policy if exists crm_read on public.%I', t);
    execute format('drop policy if exists crm_admin_write on public.%I', t);
  end loop;

  foreach t in array company_tables loop
    -- Read: own company, rows with no company (SCOPE_STRICT=false), Master all.
    -- Write: only your own company's rows. A legacy row with no company (18
    -- leads, 9 activities) can still be updated, but only into the caller's
    -- company (crm_stamp_company fills it in), and a row can never be moved
    -- out to "no company", where every tenant would read it.
    execute format('create policy crm_rw on public.%I for all to authenticated '
      'using ((select public.crm_is_master()) or company_id = (select public.crm_my_company()) or (company_id is null and (select public.crm_active()))) '
      'with check ((select public.crm_is_master()) or company_id = (select public.crm_my_company()))', t);
    execute format('drop trigger if exists crm_stamp_company on public.%I', t);
    execute format('create trigger crm_stamp_company before insert or update on public.%I for each row execute function public.crm_stamp_company()', t);
  end loop;

  -- Config tables have no company of their own: they belong to the company
  -- that owns the WhatsApp numbers. Read by any active account; written only
  -- by that company's Management, or Master. Without this, any company's
  -- Management could rewrite wa_settings.company_id and take every thread.
  foreach t in array config_tables loop
    execute format('create policy crm_read on public.%I for select to authenticated using ((select public.crm_active()))', t);
    execute format('create policy crm_admin_write on public.%I for all to authenticated '
      'using ((select public.crm_is_master()) or ((select public.crm_admin()) and (select public.crm_chat_company()) = (select public.crm_my_company()))) '
      'with check ((select public.crm_is_master()) or ((select public.crm_admin()) and (select public.crm_chat_company()) = (select public.crm_my_company())))', t);
  end loop;

  foreach t in array server_tables loop
    execute format('revoke all on public.%I from authenticated', t);
  end loop;
end $$;

-- WhatsApp chat: the caller's company's threads. A thread with no company is
-- the numbers' company's. A message is checked through its thread, so it
-- cannot be written into, or read from, another company's. Writes also need
-- the numbers' company: otherwise another company could create, tagged with
-- itself, the thread id a new customer will use, and read what they send.
create policy crm_rw on public.wa_conversations for all to authenticated
  using ((select public.crm_is_master()) or coalesce(company_id, (select public.crm_chat_company())) = (select public.crm_my_company()))
  with check ((select public.crm_is_master()) or (coalesce(company_id, (select public.crm_chat_company())) = (select public.crm_my_company())
    and (select public.crm_chat_company()) = (select public.crm_my_company())));
create policy crm_rw on public.wa_messages for all to authenticated
  using ((select public.crm_is_master()) or conversation_id = any (array(select unnest(public.crm_chat_convs()))))
  with check ((select public.crm_is_master()) or conversation_id = any (array(select unnest(public.crm_chat_convs()))));

-- Storage: the public buckets lose their anonymous upload policy (0007, 0021).
-- Uploads need a signed-in active account; reads stay public (WhatsApp and
-- the property pages link the files directly).
do $$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists wa_media_anon_upload on storage.objects;
    drop policy if exists project_media_anon_upload on storage.objects;
    drop policy if exists wa_media_auth_upload on storage.objects;
    drop policy if exists project_media_auth_upload on storage.objects;
    -- Only the paths the app writes: wa.js waUploadMedia (out/...) and
    -- projects.js (<own company>/...). Size and type limits stay on the buckets.
    create policy wa_media_auth_upload on storage.objects for insert to authenticated
      with check (bucket_id = 'wa-media' and (select public.crm_active()) and name like 'out/%');
    create policy project_media_auth_upload on storage.objects for insert to authenticated
      with check (bucket_id = 'project-media' and (select public.crm_active())
        and split_part(name, '/', 1) = coalesce((select public.crm_my_company()), 'company'));
  end if;
end $$;

-- companies: read your own (Master: all); create and change only by Master.
create policy crm_read on public.companies for select to authenticated
  using ((select public.crm_is_master()) or id = (select public.crm_my_company()));
create policy crm_admin_write on public.companies for all to authenticated
  using ((select public.crm_is_master())) with check ((select public.crm_is_master()));

-- agent_lead_quota has no company column: scope through its user.
create policy crm_rw on public.agent_lead_quota for all to authenticated
  using ((select public.crm_is_master()) or exists (select 1 from public.users u where u.id = agent_lead_quota.user_id and u.company_id = (select public.crm_my_company())))
  with check ((select public.crm_is_master()) or exists (select 1 from public.users u where u.id = agent_lead_quota.user_id and u.company_id = (select public.crm_my_company())));

-- SECURITY DEFINER RPCs: callable by the service role (the bots) only.
revoke execute on function public.wa_bump_unread(text, text, timestamptz, text) from public, anon, authenticated;
revoke execute on function public.wa_create_lead(text, text, text) from public, anon, authenticated;
revoke execute on function public.wa_upsert_prelead(text, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.wa_book_visit(jsonb) from public, anon, authenticated;
revoke execute on function public.wa_visit_notified(bigint) from public, anon, authenticated;
grant execute on function public.wa_bump_unread(text, text, timestamptz, text), public.wa_create_lead(text, text, text),
  public.wa_upsert_prelead(text, text, text, text, text, text), public.wa_book_visit(jsonb), public.wa_visit_notified(bigint) to service_role;

notify pgrst, 'reload schema';

commit;
