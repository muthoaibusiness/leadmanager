-- ============================================================================
-- LeadManager / WEPRO CRM -- one WhatsApp thread per customer, LID-aware
--
-- WhatsApp addresses inbound messages by LID (…@lid) but our outbound rows by
-- phone JID, so a customer ended up with two threads and the lead chat showed
-- only one side. From now on every thread is keyed on the phone JID whenever
-- the number is known, and the LID is remembered on the thread (new column
-- `lid`) so a later message addressed only by LID still lands in it.
--
-- This migration adds the column and folds the LID threads that already carry
-- a real phone into their phone thread. LID threads whose "phone" is just the
-- LID digits (number never learned) keep their LID id.
--
-- Safe to run multiple times.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> Run.
-- ============================================================================

-- 1) remember the LID on the thread -------------------------------------------
alter table public.wa_conversations add column if not exists lid text;
create index if not exists idx_wa_conv_account_lid on public.wa_conversations (account, lid) where lid is not null;

-- LID threads whose phone is a real number (not the LID digits themselves)
create temp table wa_lid_merge on commit drop as
select l.id                                                  as lid_id,
       l.account,
       split_part(split_part(l.id, ':', 2), '@', 1)          as lid,
       l.phone,
       l.account || ':' || l.phone || '@s.whatsapp.net'      as phone_id
  from public.wa_conversations l
 where l.id like '%@lid'
   and coalesce(l.phone, '') <> ''
   and l.phone <> split_part(split_part(l.id, ':', 2), '@', 1);

-- 2) make sure the phone thread exists, carrying what the LID thread knew ----
insert into public.wa_conversations (id, account, lid, phone, name, avatar_url, lead_id, source, ad_meta,
                                     last_message_at, last_message_preview, last_message_dir, unread_count, assigned_to, company_id)
select m.phone_id, l.account, m.lid, l.phone, l.name, l.avatar_url, l.lead_id, l.source, l.ad_meta,
       l.last_message_at, l.last_message_preview, l.last_message_dir, coalesce(l.unread_count, 0), l.assigned_to, l.company_id
  from wa_lid_merge m join public.wa_conversations l on l.id = m.lid_id
on conflict (id) do update set
  lid             = coalesce(public.wa_conversations.lid, excluded.lid),
  name            = coalesce(nullif(public.wa_conversations.name, ''), excluded.name),
  avatar_url      = coalesce(nullif(public.wa_conversations.avatar_url, ''), excluded.avatar_url),
  lead_id         = coalesce(public.wa_conversations.lead_id, excluded.lead_id),
  source          = case when excluded.source = 'AD' then 'AD' else public.wa_conversations.source end,
  ad_meta         = coalesce(public.wa_conversations.ad_meta, excluded.ad_meta),
  unread_count    = coalesce(public.wa_conversations.unread_count, 0) + coalesce(excluded.unread_count, 0),
  assigned_to     = coalesce(public.wa_conversations.assigned_to, excluded.assigned_to),
  company_id      = coalesce(public.wa_conversations.company_id, excluded.company_id);

-- 3) move the messages, fixing rows that carried the LID digits as phone ------
update public.wa_messages msg
   set conversation_id = m.phone_id,
       phone = case when msg.phone = m.lid or coalesce(msg.phone, '') = '' then m.phone else msg.phone end
  from wa_lid_merge m
 where msg.conversation_id = m.lid_id;

-- 4) drop the emptied LID threads --------------------------------------------
delete from public.wa_conversations c
 using wa_lid_merge m
 where c.id = m.lid_id
   and not exists (select 1 from public.wa_messages x where x.conversation_id = c.id);

-- 5) remaining LID threads: note their LID; phone threads: preview from newest
update public.wa_conversations
   set lid = split_part(split_part(id, ':', 2), '@', 1)
 where id like '%@lid' and lid is null;

update public.wa_conversations c
   set last_message_preview = x.preview, last_message_dir = x.direction, last_message_at = x.wa_timestamp
  from (
    select distinct on (conversation_id) conversation_id, direction, wa_timestamp,
           left(coalesce(nullif(body, ''), nullif(media_name, ''), type), 180) as preview
      from public.wa_messages order by conversation_id, wa_timestamp desc
  ) x
 where x.conversation_id = c.id and c.id in (select phone_id from wa_lid_merge);

notify pgrst, 'reload schema';
