-- ============================================================================
-- LeadManager / WEPRO CRM — preleads: unique by phone, merge on repeat
--
-- public.preleads had no unique index on phone, so an external writer (nothing
-- in this repo touches the table) created a fresh row on every submission. One
-- phone accumulated 8 rows, six of them byte-identical.
--
-- After this migration phone is the identity of a prelead. A repeat insert is
-- folded into the existing row: call_logs and property_interest are unioned
-- (first occurrence wins, case-insensitive), name/email fill only if empty, and
-- takeover/forwarded are left alone because staff own that workflow state.
--
-- Delimiters differ on purpose. A single call_logs entry contains commas of its
-- own ("দাম, সাইজ ও পেমেন্ট প্ল্যান জানতে চাই"), so joining entries with a comma
-- would make an entry boundary indistinguishable from a comma inside an entry.
--
--   call_logs         joined with ' | '
--   property_interest joined with ', '   (project names contain no commas, and
--                                         src/components/views/LeadsView.jsx
--                                         already splits that field on [,·])
--
-- Part 2 is DESTRUCTIVE — it deletes the duplicate rows it merged. Uncomment
-- the snapshot above it first if you want a way back.
--
-- Run in: Supabase Dashboard → SQL Editor → New query → Run.
-- ============================================================================

-- 1) Helper: union two delimiter-joined lists, keeping first occurrence -------
-- Case-insensitive de-dupe is what stops six identical rows from merging into
-- "Mall | Mall | Mall | Mall | Mall | Mall".
create or replace function public.merge_delimited(existing text, incoming text, sep text)
returns text
language sql
immutable
as $$
  with parts as (
    select btrim(v) as v, ord
    from unnest(
      string_to_array(coalesce(existing, ''), sep)
      || string_to_array(coalesce(incoming, ''), sep)
    ) with ordinality as t(v, ord)
    where btrim(v) <> ''
  ),
  firsts as (
    select min(ord) as ord from parts group by lower(v)
  )
  select nullif(string_agg(p.v, sep order by p.ord), '')
  from parts p
  join firsts f on f.ord = p.ord;
$$;

-- 2) Backfill: collapse existing duplicates onto the oldest row --------------
-- Snapshot first if you want one (uncomment, run once):
-- create table public.preleads_backup_20260818 as select * from public.preleads;

with ordered as (
  select *, row_number() over (partition by phone order by created_at, id) as rn
  from public.preleads
),
merged as (
  select
    phone,
    (array_agg(id order by rn))[1] as keep_id,
    public.merge_delimited(
      string_agg(nullif(btrim(call_logs), ''), ' | ' order by rn), '', ' | '
    ) as call_logs,
    public.merge_delimited(
      string_agg(nullif(btrim(property_interest), ''), ', ' order by rn), '', ', '
    ) as property_interest,
    (array_agg(name  order by rn) filter (where nullif(btrim(name),  '') is not null))[1] as name,
    (array_agg(email order by rn) filter (where nullif(btrim(email), '') is not null))[1] as email,
    bool_or(takeover)  as takeover,
    bool_or(forwarded) as forwarded,
    min(created_at) as created_at,
    max(updated_at) as updated_at
  from ordered
  group by phone
)
update public.preleads p set
  call_logs         = m.call_logs,
  property_interest = m.property_interest,
  name              = m.name,
  email             = m.email,
  takeover          = m.takeover,
  forwarded         = m.forwarded,
  created_at        = m.created_at,
  updated_at        = m.updated_at
from merged m
where p.id = m.keep_id;

with ordered as (
  select id, phone, row_number() over (partition by phone order by created_at, id) as rn
  from public.preleads
)
delete from public.preleads p
using ordered o
where p.id = o.id and o.rn > 1;

-- 3) Constraint (only possible once part 2 has removed the duplicates) -------
alter table public.preleads alter column phone set not null;
create unique index if not exists preleads_phone_key on public.preleads (phone);

-- 4) Trigger: merge instead of inserting a second row for the same phone -----
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
    updated_at        = now()
  where id = existing_id;

  return null;  -- cancel the insert; the merge above is the whole effect
end;
$$;

drop trigger if exists preleads_merge_before_insert on public.preleads;
create trigger preleads_merge_before_insert
before insert on public.preleads
for each row execute function public.preleads_merge_on_duplicate();

-- 5) Reload PostgREST schema cache -------------------------------------------
notify pgrst, 'reload schema';
