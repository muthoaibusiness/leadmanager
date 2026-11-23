-- 0071 — Document kit for the Booking page (shop panel → Documents / History).
--
--   shop_docs     the company's document library: one file per kit item (brochure,
--                 floor plans, bank letter…), uploaded once and sent for any shop.
--                 Files live in the existing `project-media` bucket (migration 0021),
--                 under <company id>/docs/, so no new bucket or storage policy.
--   shop_doc_log  who sent which documents to which client for which shop, plus
--                 notes: the shop's History tab.
--
-- The kit items themselves (names, stages) are defined in src/lib/shopDocs.js.
-- Before this migration the Documents tab shows a notice and uploads are off.
-- Safe to re-run.

create table if not exists public.shop_docs (
  company_id text not null,
  doc_key text not null,
  name text,
  url text,
  size_bytes int,
  mime text,
  approved boolean not null default false,
  uploaded_by text,
  uploaded_by_name text,
  updated_at timestamptz not null default now(),
  primary key (company_id, doc_key)
);

create table if not exists public.shop_doc_log (
  id text primary key,
  company_id text not null,
  property_id text not null,
  unit_id text not null,
  kind text not null check (kind in ('docs_sent', 'note')),
  client text,
  contact text,
  channel text,
  docs jsonb not null default '[]'::jsonb,
  note text,
  by_id text,
  by_name text,
  created_at timestamptz not null default now()
);
create index if not exists shop_doc_log_unit on public.shop_doc_log (company_id, property_id, unit_id, created_at desc);

-- the same open app policy as the other company tables (see 0066)
alter table public.shop_docs enable row level security;
alter table public.shop_doc_log enable row level security;
grant select, insert, update, delete on public.shop_docs to anon, authenticated, service_role;
grant select, insert, update, delete on public.shop_doc_log to anon, authenticated, service_role;
drop policy if exists shop_docs_app on public.shop_docs;
create policy shop_docs_app on public.shop_docs for all to anon, authenticated using (true) with check (true);
drop policy if exists shop_doc_log_app on public.shop_doc_log;
create policy shop_doc_log_app on public.shop_doc_log for all to anon, authenticated using (true) with check (true);

notify pgrst, 'reload schema';
