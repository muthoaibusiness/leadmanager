-- wa_projects.floor_plans is a plain URL array with no per-image label, so
-- the WhatsApp FAQ agent (wa-bot-eyad/wa-bot-dubai) can't tell a customer
-- apart which image is "ground floor" vs "roof floor". This adds a parallel
-- labels array (same index as floor_plans) the agent can match against.
alter table wa_projects
  add column if not exists floor_plan_labels text[];

update wa_projects
set floor_plan_labels = array['Ground Floor', 'Mezzanine Floor', 'Typical Floor', 'Roof Floor']
where name in ('Wecon Osman Bellevue', 'Wecon Nuznan');
