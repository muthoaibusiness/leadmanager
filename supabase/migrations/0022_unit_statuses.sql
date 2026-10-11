-- 0022 · Custom unit statuses per project (Projects → Available Units)
--
-- Adds `properties.unit_statuses`: the project's own unit statuses, made by
-- Management in the floor plan editor, each with a name, a colour and the base
-- status it counts as:
--   [{ id, name, color: '#RRGGBB', base: 'available' | 'hold' | 'sold' }]
--
-- A unit keeps its base in `status` (so counts, holds, deals, dashboards and
-- reports are unchanged) and points at a custom one with an optional `tag` (the
-- status id) inside the existing `variants` JSON. No change is needed there.
--
-- Until this runs the app keeps working; creating a status says to apply it.
-- Safe to run more than once. Apply in the Supabase SQL editor.

alter table public.properties
  add column if not exists unit_statuses jsonb not null default '[]'::jsonb;

notify pgrst, 'reload schema';
