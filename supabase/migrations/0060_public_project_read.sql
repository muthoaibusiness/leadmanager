-- 0060 · Public project pages: a safe read path.
--
-- The public pages (#/p portfolio, #/p/<id> detail) used to read
-- public.properties straight through the anon key with select *. That sent
-- every unit's hold metadata (client name and id, holder, hold expiry, note),
-- rates, prices and the company id to any visitor's browser, and it stops
-- working once 0055 revokes anon from properties.
--
-- These two functions are now the only public read path. They return
-- published projects only (public_published, migration 0059) and a fixed
-- whitelist of fields:
--   project   id, name, purpose, address, handover, storeys, land_area,
--             size_text, facing, details, photos, brochures
--   variants  id, name, size, beds, baths
--   units     id, size, status   (status resolved to available | booked | sold)
--   plans     id, name, order, image {url, width, height}, boxes {id, x, y, w, h, unitId}
-- Never: client/holder fields, notes, rates, prices, company ids, updatedBy.
--
-- security definer, so they keep working after 0055 locks the table. The
-- caller only ever gets what the function builds, never the row itself.
-- Depends on 0059 (public_published). Safe to run more than once.

-- The public status of one unit: a custom status (unit.tag) resolves to its
-- base first, then hold -> booked. Anything unknown counts as sold, so an
-- unexpected value never shows a unit as buyable.
create or replace function public.public_unit_status(u jsonb, statuses jsonb)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case coalesce(
           (select s->>'base' from jsonb_array_elements(coalesce(statuses, '[]'::jsonb)) s
             where s->>'id' = u->>'tag' limit 1),
           u->>'status', 'available')
    when 'available' then 'available'
    when 'hold' then 'booked'
    else 'sold' end
$$;

-- Photos and brochures from the Catalog media: https URLs only.
create or replace function public.public_media(m jsonb, kind text)
returns jsonb language sql immutable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(
           case when kind = 'docs'
             then jsonb_build_object('label', coalesce(nullif(x->>'label', ''), 'Brochure'), 'url', coalesce(x->>'url', x #>> '{}'))
             else to_jsonb(coalesce(x->>'url', x #>> '{}')) end), '[]'::jsonb)
    from jsonb_array_elements(case when jsonb_typeof(m->kind) = 'array' then m->kind else '[]'::jsonb end) x
   where coalesce(x->>'url', x #>> '{}') ~* '^https://'
$$;

create or replace function public.public_project_card(p public.properties)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', p.id, 'name', p.name, 'type', coalesce(p.purpose, ''), 'address', coalesce(p.address, ''),
    'handover', coalesce(p.handover, ''), 'sizeText', coalesce(p.size_text, ''),
    'cover', public.public_media(p.media, 'images') -> 0,
    'counts', (
      select jsonb_build_object(
        'available', count(*) filter (where st = 'available'),
        'booked', count(*) filter (where st = 'booked'),
        'sold', count(*) filter (where st = 'sold'),
        'minSize', min(sz) filter (where sz > 0), 'maxSize', max(sz) filter (where sz > 0))
        from (select public.public_unit_status(u, p.unit_statuses) st,
                     coalesce(nullif(u->>'size', '')::numeric, nullif(v->>'size', '')::numeric) sz
                from jsonb_array_elements(coalesce(p.variants, '[]'::jsonb)) v,
                     jsonb_array_elements(coalesce(v->'units', '[]'::jsonb)) u) t))
$$;

-- The portfolio: every published project as a card, by name.
create or replace function public.public_projects()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(public.public_project_card(p) order by p.name), '[]'::jsonb)
    from public.properties p
   where p.public_published
$$;

-- One published project in full; null when it does not exist or is not published.
create or replace function public.public_project(p_id text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select public.public_project_card(p) || jsonb_build_object(
    'storeys', coalesce(p.storeys, ''), 'landArea', coalesce(p.land_area, ''),
    'facing', coalesce(p.facing, ''), 'details', coalesce(p.details, ''),
    'photos', public.public_media(p.media, 'images'),
    'brochures', public.public_media(p.media, 'docs'),
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

-- Supabase's default privileges grant execute to anon and authenticated
-- directly, so revoking from public alone leaves them callable.
revoke all on function public.public_unit_status(jsonb, jsonb), public.public_media(jsonb, text),
  public.public_project_card(public.properties), public.public_projects(), public.public_project(text)
  from public, anon, authenticated;
grant execute on function public.public_projects(), public.public_project(text) to anon, authenticated;

notify pgrst, 'reload schema';
