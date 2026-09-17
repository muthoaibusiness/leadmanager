-- ============================================================================
-- LeadManager / WEPRO CRM -- Meta Conversions API (CAPI) for Click-to-WhatsApp
--
-- Every campaign runs as a Click-to-WhatsApp ad. Meta attributes a WhatsApp
-- conversation to the ad only through the click id (ctwa_clid) that arrives
-- on the FIRST inbound message of that conversation
-- (messages[].referral.ctwa_clid in the WhatsApp Cloud API webhook). It never
-- arrives again, so whatever writes public.preleads must capture it right
-- there. The CRM then reports conversion events to Meta with
--
--   action_source     = business_messaging
--   messaging_channel = whatsapp
--   user_data         = { ctwa_clid, page_id = <WABA id> }
--
-- Attribution lives ONLY on preleads. preleads is unique by phone (0007) and
-- leads.phone is immutable and stored in the same digits-only form, so the
-- sync job joins the two on phone at send time. leads gets no new columns.
--
--   preleads.ctwa_clid          text         click id, raw (never hashed)
--   preleads.wa_ad_id           text         referral.source_id
--   preleads.wa_ad_source_url   text         referral.source_url
--   preleads.waba_id            text         WhatsApp Business Account the
--                                            message landed on (CAPI page_id)
--   preleads.first_message_at   timestamptz  event_time for the Lead event
--
-- Sent events are logged in public.capi_events. Its primary key is the
-- event_id Meta dedups on; (phone, event_name) is unique so each conversion
-- is reported once per person. Rows with sent_at IS NULL are the retry queue.
--
-- Safe to run multiple times.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> Run.
-- ============================================================================

-- 1) preleads: attribution captured by the WhatsApp webhook writer ------------
alter table public.preleads add column if not exists ctwa_clid        text;
alter table public.preleads add column if not exists wa_ad_id         text;
alter table public.preleads add column if not exists wa_ad_source_url text;
alter table public.preleads add column if not exists waba_id          text;
alter table public.preleads add column if not exists first_message_at timestamptz;

-- The sync job looks preleads up by phone (already unique-indexed). This one
-- serves "which preleads carry attribution" scans and dedup checks.
create index if not exists preleads_ctwa_clid_idx
  on public.preleads (ctwa_clid)
  where ctwa_clid is not null;

-- 2) merge trigger: keep the FIRST click id, never overwrite -----------------
-- Same body as 0007 plus the five new columns. A repeat message for a known
-- phone carries no referral (Meta sends it once), and a later message from a
-- different ad must not replace the click that actually started the
-- conversation -- so every new column is coalesce(existing, incoming).
create or replace function public.preleads_merge_on_duplicate()
returns trigger
language plpgsql
as $$
declare
  existing_id uuid;
begin
  -- Digits only. Deliberately NOT the client's normalizePhone (src/lib/db.js),
  -- which prefixes 88 to anything starting with 0 — preleads holds Saudi (966…)
  -- and UAE (971…) numbers that rule would corrupt.
  new.phone := regexp_replace(coalesce(new.phone, ''), '\D', '', 'g');

  if new.phone = '' then
    return new;  -- let the not-null / caller deal with it
  end if;

  select id into existing_id
  from public.preleads
  where phone = new.phone
  for update;

  if not found then
    return new;  -- genuinely new phone, insert normally
  end if;

  update public.preleads set
    call_logs         = public.merge_delimited(call_logs, new.call_logs, ' | '),
    property_interest = public.merge_delimited(property_interest, new.property_interest, ', '),
    name              = coalesce(nullif(btrim(name),  ''), nullif(btrim(new.name),  '')),
    email             = coalesce(nullif(btrim(email), ''), nullif(btrim(new.email), '')),
    ctwa_clid         = coalesce(nullif(btrim(ctwa_clid),        ''), nullif(btrim(new.ctwa_clid),        '')),
    wa_ad_id          = coalesce(nullif(btrim(wa_ad_id),         ''), nullif(btrim(new.wa_ad_id),         '')),
    wa_ad_source_url  = coalesce(nullif(btrim(wa_ad_source_url), ''), nullif(btrim(new.wa_ad_source_url), '')),
    waba_id           = coalesce(nullif(btrim(waba_id),          ''), nullif(btrim(new.waba_id),          '')),
    first_message_at  = coalesce(first_message_at, new.first_message_at),
    updated_at        = now()
  where id = existing_id;

  return null;  -- cancel the insert; the merge above is the whole effect
end;
$$;

drop trigger if exists preleads_merge_before_insert on public.preleads;
create trigger preleads_merge_before_insert
before insert on public.preleads
for each row execute function public.preleads_merge_on_duplicate();

-- 3) capi_events: one row per conversion reported to Meta --------------------
create table if not exists public.capi_events (
  id          uuid        primary key default gen_random_uuid(),  -- sent as event_id (Meta dedup key)
  company_id  text,                                                -- tenant, mirrors leads.company_id
  phone       text        not null,                                -- digits only, joins preleads/leads
  lead_id     text,                                                -- leads.id when the event came from a lead row
  event_name  text        not null,                                -- Lead | Contact | Schedule | Purchase
  event_time  timestamptz not null,                                -- when the conversion happened, not when sent
  payload     jsonb,                                               -- exact body posted, for audit/replay
  sent_at     timestamptz,                                         -- null = queued / failed, retry
  attempts    integer     not null default 0,
  fb_trace_id text,                                                -- fbtrace_id from Meta's response
  last_error  text,
  created_at  timestamptz not null default now(),
  constraint capi_events_event_name_check
    check (event_name in ('Lead', 'Contact', 'Schedule', 'Purchase')),
  constraint capi_events_phone_event_key unique (phone, event_name)
);

-- retry queue scan
create index if not exists capi_events_pending_idx
  on public.capi_events (created_at)
  where sent_at is null;

create index if not exists capi_events_lead_id_idx
  on public.capi_events (lead_id);

-- 4) RLS: service role only ---------------------------------------------------
-- The sync job runs with the service key. Nothing in the browser reads or
-- writes this table, so no policies for authenticated/anon.
alter table public.capi_events enable row level security;

-- 5) Reload PostgREST schema cache -------------------------------------------
notify pgrst, 'reload schema';
