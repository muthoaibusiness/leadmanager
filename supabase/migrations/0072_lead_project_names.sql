-- 0072 · One spelling per project on leads.
--
-- leads.property_interest held the same project under several names, because
-- different writers use different catalogs: the app (properties.name, e.g.
-- "CITIZEN AVENUE MALL"), the WhatsApp bots (wa_projects, e.g. "Wecon Citizen
-- Avenue"), Facebook forms and imports ("WECON CITIZEN AVENUE"). The project
-- filter and per-project counts then split one project into several.
--
-- The canonical name is the company's own project (properties.name). A value
-- may list several projects ("A, B"); each part is matched on its own:
--   1. case and a leading "WECON " are ignored ("Wecon Nuznan" = "WECON NUZNAN")
--   2. else a known alias (typos, short names) below
--   3. else the one project whose name contains the part as whole words
--      ("CITIZEN AVENUE" -> "CITIZEN AVENUE MALL", "NORTHDALE" -> "WECON AHMED NORTHDALE")
--   4. else the part is kept as typed (a project not in the catalog)
-- Repeated parts are dropped. deal_project_name is set from deal_project_id.
--
-- A trigger applies the same rule to every insert and update, whoever writes
-- (app, bots, Facebook forms, imports), so the variants don't come back.
-- preleads (the bots' own table) are not touched: the bots match those names
-- against wa_projects.
--
-- Backup of every changed row: public.leads_project_backup_0072.
-- Undo:
--   drop trigger if exists leads_project_canon on public.leads;
--   update public.leads l set property_interest = b.property_interest, deal_project_name = b.deal_project_name
--     from public.leads_project_backup_0072 b where b.id = l.id;
--
-- Safe to run more than once. Apply in the Supabase SQL editor.

begin;

create or replace function public.lead_project_key(t text)
returns text language sql immutable set search_path = '' as $$
  select btrim(regexp_replace(regexp_replace(upper(coalesce(t, '')), '^\s*WECON\s+', ''), '\s+', ' ', 'g'))
$$;

-- Typos and short names the containment rule can't settle. key -> canonical key.
create or replace function public.lead_project_alias(k text)
returns text language sql immutable set search_path = '' as $$
  select case k
    when 'NORTHADALE' then 'AHMED NORTHDALE'
    when 'NORTHDALE' then 'AHMED NORTHDALE'
    when 'DAKHINAYAN' then 'DAKSHINAYAN'
    when 'OSMAN' then 'OSMAN BELLEVUE'
    when 'HERITAGE MALL' then 'JM HERITAGE MALL'
    else k end
$$;

create or replace function public.lead_project_canon(val text, company text)
returns text language plpgsql stable set search_path = '' as $$
declare
  part text; k text; hit text; n int; out text[] := '{}';
begin
  if val is null or btrim(val) = '' then return val; end if;
  foreach part in array string_to_array(val, ',') loop
    part := btrim(part);
    continue when part = '';
    k := public.lead_project_alias(public.lead_project_key(part));
    select p.name into hit from public.properties p
      where (company is null or p.company_id = company) and public.lead_project_key(p.name) = k limit 1;
    if hit is null then
      select count(*), min(p.name) into n, hit from public.properties p
        where (company is null or p.company_id = company)
          and (' ' || public.lead_project_key(p.name) || ' ') like ('% ' || k || ' %');
      if n <> 1 then hit := null; end if;
    end if;
    hit := coalesce(hit, part);
    if not hit = any(out) then out := out || hit; end if;
  end loop;
  return array_to_string(out, ', ');
end;
$$;

create or replace function public.leads_project_canon()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.property_interest is distinct from old.property_interest then
    new.property_interest := public.lead_project_canon(new.property_interest, new.company_id);
  end if;
  if new.deal_project_id is not null and (tg_op = 'INSERT' or new.deal_project_id is distinct from old.deal_project_id
      or new.deal_project_name is distinct from old.deal_project_name) then
    new.deal_project_name := coalesce((select p.name from public.properties p where p.id = new.deal_project_id), new.deal_project_name);
  end if;
  return new;
end;
$$;

revoke all on function public.lead_project_canon(text, text) from public, anon, authenticated;
revoke all on function public.leads_project_canon() from public, anon, authenticated;

create table if not exists public.leads_project_backup_0072 as
  select id, property_interest, deal_project_name, now() as saved_at from public.leads where false;
alter table public.leads_project_backup_0072 enable row level security;

insert into public.leads_project_backup_0072 (id, property_interest, deal_project_name, saved_at)
select l.id, l.property_interest, l.deal_project_name, now()
from public.leads l
where (l.property_interest is distinct from public.lead_project_canon(l.property_interest, l.company_id)
    or l.deal_project_name is distinct from coalesce((select p.name from public.properties p where p.id = l.deal_project_id), l.deal_project_name))
  and not exists (select 1 from public.leads_project_backup_0072 b where b.id = l.id);

update public.leads l
set property_interest = public.lead_project_canon(l.property_interest, l.company_id),
    deal_project_name = coalesce((select p.name from public.properties p where p.id = l.deal_project_id), l.deal_project_name)
where l.property_interest is distinct from public.lead_project_canon(l.property_interest, l.company_id)
   or l.deal_project_name is distinct from coalesce((select p.name from public.properties p where p.id = l.deal_project_id), l.deal_project_name);

drop trigger if exists leads_project_canon on public.leads;
create trigger leads_project_canon before insert or update of property_interest, deal_project_id, deal_project_name on public.leads
  for each row execute function public.leads_project_canon();

commit;
