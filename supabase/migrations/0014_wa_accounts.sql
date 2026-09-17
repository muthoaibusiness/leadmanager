-- ============================================================================
-- LeadManager / WEPRO CRM -- two WhatsApp accounts (Dubai + Eyad)
--
-- Every thread now belongs to one Wasender session ("account"). A lead in the
-- Dubai team talks through the Dubai number; everyone else through Eyad's.
--
-- Thread ids become  <account>:<jid>  so the same customer can hold one thread
-- per account without colliding on the WhatsApp JID. Rows that pre-date this
-- migration are assumed to be the Eyad session (the original single token).
--
-- The app may already have created a prefixed thread (eyad:<jid>) for a
-- customer whose legacy row (<jid>) still exists. Step 2 folds the legacy row
-- into the prefixed one instead of failing on the primary key.
--
-- wa_secrets gains one row per account ('dubai', 'eyad'); the legacy 'default'
-- row stays as the Eyad fallback. Tokens can also come from Edge Function
-- secrets  WASENDER_API_TOKEN_DUBAI / _EYAD  (see .env).
--
-- Safe to run multiple times.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> Run.
-- ============================================================================

-- 1) account column ---------------------------------------------------------
alter table public.wa_conversations add column if not exists account text not null default 'eyad';
alter table public.wa_messages      add column if not exists account text not null default 'eyad';

create index if not exists idx_wa_conv_account_phone on public.wa_conversations (account, phone);

-- 2) prefix legacy ids ------------------------------------------------------
-- 2a) messages: repoint every legacy thread reference.
update public.wa_messages
   set conversation_id = 'eyad:' || conversation_id
 where conversation_id not like 'eyad:%' and conversation_id not like 'dubai:%';

-- 2b) legacy threads whose prefixed twin already exists: merge into the twin.
update public.wa_conversations n
   set name                 = coalesce(nullif(n.name, ''), l.name),
       avatar_url           = coalesce(nullif(n.avatar_url, ''), l.avatar_url),
       lead_id              = coalesce(n.lead_id, l.lead_id),
       last_message_at      = greatest(n.last_message_at, l.last_message_at),
       last_message_preview = case when coalesce(l.last_message_at, '-infinity'::timestamptz) > coalesce(n.last_message_at, '-infinity'::timestamptz)
                                   then l.last_message_preview else n.last_message_preview end,
       last_message_dir     = case when coalesce(l.last_message_at, '-infinity'::timestamptz) > coalesce(n.last_message_at, '-infinity'::timestamptz)
                                   then l.last_message_dir else n.last_message_dir end,
       unread_count         = coalesce(n.unread_count, 0) + coalesce(l.unread_count, 0),
       source               = case when l.source = 'AD' then 'AD' else n.source end,
       ad_meta              = coalesce(n.ad_meta, l.ad_meta),
       assigned_to          = coalesce(n.assigned_to, l.assigned_to),
       company_id           = coalesce(n.company_id, l.company_id),
       archived             = n.archived and coalesce(l.archived, false),
       created_at           = least(n.created_at, l.created_at)
  from public.wa_conversations l
 where l.id not like 'eyad:%' and l.id not like 'dubai:%'
   and n.id = 'eyad:' || l.id;

delete from public.wa_conversations l
 where l.id not like 'eyad:%' and l.id not like 'dubai:%'
   and exists (select 1 from public.wa_conversations n where n.id = 'eyad:' || l.id);

-- 2c) the rest simply get the prefix.
update public.wa_conversations
   set id = 'eyad:' || id
 where id not like 'eyad:%' and id not like 'dubai:%';

-- 3) one credential row per account ----------------------------------------
insert into public.wa_secrets (id) values ('dubai'), ('eyad')
on conflict (id) do nothing;
