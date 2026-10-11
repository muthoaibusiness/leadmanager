-- 0020 · Floor plans for Projects → Available Units
--
-- Adds `properties.floor_plans` (the clickable plans: an image URL plus boxes
-- that point at inventory units) and the `project-media` Storage bucket that
-- holds the plan images.
--
-- Also creates, where missing, the storefront columns the app has written
-- since the catalog editor shipped (src/lib/supabase.js pToR) but that no
-- earlier migration declared. On a database that already has them these
-- statements do nothing.
--
-- Safe to run more than once. Apply in the Supabase SQL editor.

-- 1) Floor plans ----------------------------------------------------------------
-- [{ id, name, order, image: { url, width, height, mime, fileName, source,
--    pdfPage }, boxes: [{ id, unitId, x, y, w, h }], updatedAt, updatedBy }]
-- Box coordinates are fractions (0–1) of the image's width and height.
alter table public.properties
  add column if not exists floor_plans jsonb not null default '[]'::jsonb;

-- 2) Storefront columns the app already writes ----------------------------------
alter table public.properties add column if not exists variants        jsonb   default '[]'::jsonb;
alter table public.properties add column if not exists addons          jsonb   default '[]'::jsonb;
alter table public.properties add column if not exists media           jsonb   default '{}'::jsonb;
alter table public.properties add column if not exists fast_close_pct  numeric default 0;
alter table public.properties add column if not exists fast_close_days integer default 0;
alter table public.properties add column if not exists listing         text;
alter table public.properties add column if not exists approval        text;

-- 3) Storage for plan images ------------------------------------------------------
-- Public read, 25 MB cap, raster images and PDF only. SVG is deliberately not
-- allowed: an SVG served from a public URL can carry script.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('project-media', 'project-media', true, 26214400,
        array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

-- The browser uploads with the anon key (the same posture as `wa-media`), so
-- anon needs INSERT on this bucket only. No UPDATE or DELETE policies: every
-- upload gets a new file name, and nothing in the app overwrites or removes
-- a stored file.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'project_media_public_read') then
    create policy project_media_public_read on storage.objects
      for select using (bucket_id = 'project-media');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'project_media_anon_upload') then
    create policy project_media_anon_upload on storage.objects
      for insert with check (bucket_id = 'project-media');
  end if;
end $$;

-- 4) Make PostgREST see the new column right away --------------------------------
notify pgrst, 'reload schema';
