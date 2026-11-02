-- 0059 · Public (shareable) project page — publish control.
--
-- Adds `properties.public_published`: the management toggle that decides whether
-- a project's public page (#/p/<id>) is reachable without login. Default off,
-- so nothing is exposed until an admin publishes it. The public page itself
-- reads the live row through the anon key; this single boolean is the gate.
--
-- Safe to run more than once. Apply in the Supabase SQL editor.
alter table public.properties
  add column if not exists public_published boolean not null default false;

notify pgrst, 'reload schema';
