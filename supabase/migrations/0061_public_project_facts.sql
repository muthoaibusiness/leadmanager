-- 0061 · Public project pages: "At a Glance" tabs.
--
-- Adds `properties.public_facts`: the facts the public project page shows in
-- its At a Glance card, grouped into tabs, exactly as the sales team writes
-- them:
--   [{ "tab": "Property Information", "rows": [["Type", "Shopping Cum Commercial"], ...] }, ...]
-- Empty by default; the page then falls back to the project's own fields.
--
-- public_project() (migration 0060) is redefined to return it as `facts`.
-- Only arrays pass through, and only {tab, rows} with string pairs, so a
-- malformed value never breaks the page. Depends on 0059 and 0060.
-- Safe to run more than once.
alter table public.properties
  add column if not exists public_facts jsonb not null default '[]'::jsonb;

-- The tabs, cleaned: each tab a non-empty name and rows of two strings.
create or replace function public.public_facts_clean(f jsonb)
returns jsonb language sql immutable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('tab', t->>'tab', 'rows', rows) order by tord), '[]'::jsonb)
    from jsonb_array_elements(case when jsonb_typeof(f) = 'array' then f else '[]'::jsonb end) with ordinality tt(t, tord)
    cross join lateral (
      select coalesce(jsonb_agg(jsonb_build_array(r->>0, r->>1) order by rord), '[]'::jsonb) rows
        from jsonb_array_elements(case when jsonb_typeof(t->'rows') = 'array' then t->'rows' else '[]'::jsonb end) with ordinality rr(r, rord)
       where jsonb_typeof(r) = 'array' and coalesce(r->>0, '') <> '' and coalesce(r->>1, '') <> '') x
   where coalesce(t->>'tab', '') <> '' and jsonb_array_length(rows) > 0
$$;

create or replace function public.public_project(p_id text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select public.public_project_card(p) || jsonb_build_object(
    'storeys', coalesce(p.storeys, ''), 'landArea', coalesce(p.land_area, ''),
    'facing', coalesce(p.facing, ''), 'details', coalesce(p.details, ''),
    'facts', public.public_facts_clean(p.public_facts),
    'photos', public.public_media(p.media, 'images'),
    'brochures', public.public_media(p.media, 'docs'),
    'links', public.public_media(p.media, 'links'),
    'variants', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', v->>'id', 'name', coalesce(v->>'name', ''),
        'size', nullif(v->>'size', '')::numeric,
        'beds', nullif(v->>'beds', '')::numeric, 'baths', nullif(v->>'baths', '')::numeric,
        'units', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', u->>'id',
            'size', coalesce(nullif(u->>'size', '')::numeric, nullif(v->>'size', '')::numeric),
            'status', public.public_unit_status(u, p.unit_statuses)) order by ord), '[]'::jsonb)
            from jsonb_array_elements(coalesce(v->'units', '[]'::jsonb)) with ordinality uu(u, ord))
      ) order by vord), '[]'::jsonb)
        from jsonb_array_elements(coalesce(p.variants, '[]'::jsonb)) with ordinality vv(v, vord)),
    'plans', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', f->>'id', 'name', coalesce(nullif(f->>'name', ''), 'Floor plan'),
        'order', coalesce(nullif(f->>'order', '')::numeric, 0),
        'image', jsonb_build_object('url', f->'image'->>'url',
                   'width', (f->'image'->>'width')::numeric, 'height', (f->'image'->>'height')::numeric),
        'boxes', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', b->>'id', 'x', (b->>'x')::numeric, 'y', (b->>'y')::numeric,
            'w', (b->>'w')::numeric, 'h', (b->>'h')::numeric, 'unitId', b->>'unitId')), '[]'::jsonb)
            from jsonb_array_elements(coalesce(f->'boxes', '[]'::jsonb)) b)
      ) order by coalesce(nullif(f->>'order', '')::numeric, 0)), '[]'::jsonb)
        from jsonb_array_elements(coalesce(p.floor_plans, '[]'::jsonb)) f
       where f->'image'->>'url' ~* '^https://')
  )
    from public.properties p
   where p.id = p_id and p.public_published
$$;

revoke all on function public.public_facts_clean(jsonb), public.public_project(text) from public, anon, authenticated;
grant execute on function public.public_project(text) to anon, authenticated;

notify pgrst, 'reload schema';
