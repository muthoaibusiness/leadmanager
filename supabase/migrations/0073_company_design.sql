-- 0073: the company's app design (Users › Appearance).
--
-- companies.ui_design holds which design every account of the company wears: 'classic' (default),
-- 'blueprint', 'pebble' or 'ink' (see DESIGNS in src/lib/theme.js). Writing companies is
-- Master-only (0055, crm_admin_write), so Management sets its own company's value through
-- crm_set_company_design. Until this migration is applied the app keeps the choice per device
-- (src/lib/companyDesign.js).

alter table public.companies add column if not exists ui_design text not null default 'classic';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'companies_ui_design_check') then
    alter table public.companies add constraint companies_ui_design_check
      check (ui_design in ('classic', 'blueprint', 'pebble', 'ink'));
  end if;
end $$;

create or replace function public.crm_set_company_design(p_design text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company text;
begin
  if p_design is null or p_design not in ('classic', 'blueprint', 'pebble', 'ink') then
    raise exception 'unknown design: %', p_design using errcode = '22023';
  end if;
  if not (select public.crm_admin()) then
    raise exception 'only Management or Master may change the design' using errcode = '42501';
  end if;
  v_company := (select public.crm_my_company());
  if v_company is null then
    raise exception 'this account has no company' using errcode = '42501';
  end if;
  update public.companies set ui_design = p_design where id = v_company;
  return p_design;
end $$;

revoke all on function public.crm_set_company_design(text) from public, anon;
grant execute on function public.crm_set_company_design(text) to authenticated;
