-- 0075: the company's app layout (Users › Appearance), beside its design (0073).
--
-- companies.ui_layout holds how every account of the company has its pages laid out: 'sidebar'
-- (default, the original shell), 'rail', 'topbar' or 'dock' (see LAYOUTS in src/lib/theme.js).
-- As with the design, writing companies is Master-only (0055), so Management sets its own
-- company's value through crm_set_company_layout. Until this migration is applied the app keeps
-- the choice per device (src/lib/companyDesign.js).
-- Needs crm_admin() and crm_my_company() from 0055. Run 0073 as well: it creates
-- crm_set_company_design, which the design choice uses.

alter table public.companies add column if not exists ui_layout text not null default 'sidebar';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'companies_ui_layout_check') then
    alter table public.companies add constraint companies_ui_layout_check
      check (ui_layout in ('sidebar', 'rail', 'topbar', 'dock'));
  end if;
end $$;

create or replace function public.crm_set_company_layout(p_layout text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company text;
begin
  if p_layout is null or p_layout not in ('sidebar', 'rail', 'topbar', 'dock') then
    raise exception 'unknown layout: %', p_layout using errcode = '22023';
  end if;
  if not (select public.crm_admin()) then
    raise exception 'only Management or Master may change the layout' using errcode = '42501';
  end if;
  v_company := (select public.crm_my_company());
  if v_company is null then
    raise exception 'this account has no company' using errcode = '42501';
  end if;
  update public.companies set ui_layout = p_layout where id = v_company;
  return p_layout;
end $$;

revoke all on function public.crm_set_company_layout(text) from public, anon;
grant execute on function public.crm_set_company_layout(text) to authenticated;
