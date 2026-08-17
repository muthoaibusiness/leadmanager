-- ============================================================================
-- LeadManager / WEPRO CRM — WhatsApp Conversations (Wasender)
--
-- Adds the chat system used by the Conversations view:
--   wa_conversations   one row per WhatsApp thread (JID), linked to a CRM lead
--   wa_messages        one row per message, PK = Wasender message id (dedupe)
--   wa_webhook_events  raw delivery ids, so a replayed webhook is a no-op
--   wa_settings        admin-editable, NON-secret config (relay url, allow-list)
--   wa_secrets         API token + webhook secret. RLS on, zero policies →
--                      the anon key cannot read or write it. Only the service
--                      role (inside the Edge Function / n8n) can touch it.
--
-- Safe to run multiple times (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
-- Run in: Supabase Dashboard → SQL Editor → New query → Run.
--
-- Server-side env vars (set with `npx supabase secrets set KEY=value`):
--   WASENDER_API_TOKEN     Wasender private API token
--   WASENDER_WEBHOOK_SECRET  shared secret Wasender signs deliveries with
--   SUPABASE_SERVICE_ROLE_KEY  (provided automatically to Edge Functions)
-- None of these are VITE_-prefixed, so none can reach the browser bundle.
-- ============================================================================

-- 1) Conversations -----------------------------------------------------------
create table if not exists public.wa_conversations (
  id                    text primary key,          -- WhatsApp JID (8801…@s.whatsapp.net)
  phone                 text not null,             -- normalised digits, for lead matching
  name                  text,                      -- WhatsApp push name
  avatar_url            text,
  lead_id               text,                      -- soft link to public.leads.id
  last_message_at       timestamptz,
  last_message_preview  text,
  last_message_dir      text,                      -- 'IN' | 'OUT'
  unread_count          integer     default 0,
  source                text        default 'WHATSAPP',  -- 'WHATSAPP' | 'AD'
  ad_meta               jsonb,                     -- click-to-WhatsApp ad payload (see below)
  assigned_to           text,                      -- CRM user id owning the thread
  company_id            text,
  archived              boolean     default false,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

-- ad_meta shape (all optional, straight from the Wasender ad-referral payload):
--   { "title": "…", "description": "…", "body": "…",
--     "conversionSource": "…", "sourceUrl": "…",
--     "greetingMessageBody": "…", "thumbnailUrl": "…" }

alter table public.wa_conversations add column if not exists ad_meta       jsonb;
alter table public.wa_conversations add column if not exists lead_id       text;
alter table public.wa_conversations add column if not exists assigned_to   text;
alter table public.wa_conversations add column if not exists company_id    text;
alter table public.wa_conversations add column if not exists avatar_url    text;
alter table public.wa_conversations add column if not exists archived      boolean default false;

create index if not exists wa_conv_last_msg_idx  on public.wa_conversations (last_message_at desc nulls last);
create index if not exists wa_conv_phone_idx     on public.wa_conversations (phone);
create index if not exists wa_conv_lead_idx      on public.wa_conversations (lead_id);
create index if not exists wa_conv_assigned_idx  on public.wa_conversations (assigned_to);

-- 2) Messages ----------------------------------------------------------------
-- PK is the Wasender message id, so a duplicate webhook delivery collapses into
-- the same row instead of creating a second bubble.
create table if not exists public.wa_messages (
  id             text primary key,
  wa_id          text,                             -- Wasender's own id; set on outbound once accepted
  conversation_id text not null,
  phone          text,
  direction      text not null,                    -- 'IN' | 'OUT'
  type           text not null default 'text',     -- text|image|document|video|audio|sticker
  body           text,
  caption        text,
  media_url      text,                             -- Supabase Storage public URL
  media_mime     text,
  media_name     text,
  media_size     bigint,
  status         text        default 'PENDING',    -- PENDING|SENT|DELIVERED|READ|FAILED
  error          text,
  sender_name    text,
  sent_by        text,                             -- CRM user id (outbound only)
  client_ref     text,                             -- optimistic-UI correlation id
  wa_timestamp   timestamptz,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

alter table public.wa_messages add column if not exists caption    text;
alter table public.wa_messages add column if not exists client_ref text;
alter table public.wa_messages add column if not exists sent_by    text;
alter table public.wa_messages add column if not exists error      text;
alter table public.wa_messages add column if not exists wa_id      text;

create index if not exists wa_msg_conv_idx   on public.wa_messages (conversation_id, wa_timestamp desc);
create index if not exists wa_msg_status_idx on public.wa_messages (status);
create index if not exists wa_msg_ref_idx    on public.wa_messages (client_ref);
-- Outbound rows keep the client-generated PK so the optimistic bubble never
-- moves; delivery receipts arrive keyed by Wasender's id and resolve through here.
create unique index if not exists wa_msg_waid_idx on public.wa_messages (wa_id) where wa_id is not null;

-- 3) Webhook replay guard ----------------------------------------------------
-- The Edge Function inserts the delivery id first; a conflict means "already
-- processed" and the handler returns 200 without touching messages again.
create table if not exists public.wa_webhook_events (
  id          text primary key,
  event_type  text,
  received_at timestamptz default now()
);

-- Housekeeping: keep the guard table small.
create index if not exists wa_evt_received_idx on public.wa_webhook_events (received_at);

-- 4) Admin settings (NON-secret) ---------------------------------------------
-- Readable by the app so the Conversations view knows who is allowed in and
-- where to POST outbound messages. Contains no credentials.
create table if not exists public.wa_settings (
  id               text primary key default 'default',
  relay_url        text,                        -- Edge Function or n8n webhook the app POSTs to
  session_name     text,                        -- Wasender session/device label
  enabled          boolean     default true,
  allowed_user_ids jsonb       default '[]'::jsonb,  -- CRM user ids granted chat access
  token_set        boolean     default false,   -- UI hint only; true once a token is stored
  webhook_url      text,                        -- shown to admin to paste into Wasender
  company_id       text,
  updated_at       timestamptz default now(),
  updated_by       text
);

insert into public.wa_settings (id) values ('default') on conflict (id) do nothing;

-- 5) Secrets — locked away from the anon key ---------------------------------
create table if not exists public.wa_secrets (
  id              text primary key default 'default',
  api_token       text,
  webhook_secret  text,
  updated_at      timestamptz default now(),
  updated_by      text
);

alter table public.wa_secrets enable row level security;
-- Deliberately NO policies. With RLS enabled and no policy, both `anon` and
-- `authenticated` are denied every operation. `service_role` bypasses RLS, so
-- only server-side code (Edge Function / n8n credential) can read the token.
revoke all on public.wa_secrets from anon, authenticated;

-- 6) Realtime ----------------------------------------------------------------
-- The app subscribes to these two tables for instant delivery.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'wa_messages'
  ) then
    alter publication supabase_realtime add table public.wa_messages;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'wa_conversations'
  ) then
    alter publication supabase_realtime add table public.wa_conversations;
  end if;
end $$;

-- REPLICA IDENTITY FULL so UPDATE events carry the previous row (needed to tell
-- a status change apart from a new message).
alter table public.wa_messages      replica identity full;
alter table public.wa_conversations replica identity full;

-- 7) Media bucket ------------------------------------------------------------
-- Incoming WhatsApp media URLs expire and require auth headers, so the webhook
-- copies each file here and stores the public URL on the message row.
insert into storage.buckets (id, name, public)
values ('wa-media', 'wa-media', true)
on conflict (id) do nothing;

-- Public read (bucket is already public). Outbound attachments are uploaded
-- straight from the agent's browser, then the relay hands Wasender the public
-- URL — so `anon` needs INSERT on this bucket only. Update/delete stay closed.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'wa_media_public_read') then
    create policy wa_media_public_read on storage.objects
      for select using (bucket_id = 'wa-media');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'wa_media_anon_upload') then
    create policy wa_media_anon_upload on storage.objects
      for insert with check (bucket_id = 'wa-media');
  end if;
end $$;

-- 8) Atomic unread bump ------------------------------------------------------
-- Called by the webhook. Doing this read-modify-write in SQL keeps two messages
-- arriving in the same instant from clobbering each other's count.
create or replace function public.wa_bump_unread(
  p_conv text, p_preview text, p_at timestamptz, p_dir text default 'IN'
) returns void as $$
begin
  update public.wa_conversations
     set unread_count = case when p_dir = 'IN' then coalesce(unread_count, 0) + 1 else coalesce(unread_count, 0) end,
         last_message_at = p_at,
         last_message_preview = p_preview,
         last_message_dir = p_dir
   where id = p_conv;
end $$ language plpgsql security definer;

revoke all on function public.wa_bump_unread(text, text, timestamptz, text) from anon, authenticated;

-- 9) updated_at triggers -----------------------------------------------------
create or replace function public.wa_touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end $$ language plpgsql;

drop trigger if exists wa_conv_touch on public.wa_conversations;
create trigger wa_conv_touch before update on public.wa_conversations
  for each row execute function public.wa_touch_updated_at();

drop trigger if exists wa_msg_touch on public.wa_messages;
create trigger wa_msg_touch before update on public.wa_messages
  for each row execute function public.wa_touch_updated_at();
