-- wa_projects had RLS enabled with zero policies — the anon key (what the
-- browser uses) got nothing back, silently, while the service role (Edge
-- Functions) bypassed RLS and saw every row fine. That's how the WA Relay
-- admin UI's project list came up empty while the bots worked. Every sibling
-- catalog table (leads, properties, wa_settings) has RLS disabled — this is
-- non-sensitive public project data, so match them rather than carving out
-- a one-off policy.
alter table wa_projects disable row level security;
