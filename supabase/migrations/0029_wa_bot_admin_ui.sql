-- Backs the new "WhatsApp Relay" admin UI (project catalog editor, /send code
-- mapping, automation toggles) so these move out of hardcoded Edge Function
-- source into data an admin can change without a redeploy.

-- wa_projects.id is already an identity column, so a UI-created project gets
-- its id assigned by the DB with no extra wiring.

-- /sendXX → project mapping (was CODE_TO_PROJECT, hardcoded in wa-bot-eyad).
alter table wa_projects
  add column if not exists send_code text;

update wa_projects set send_code = '/sendjm' where name = 'Wecon JM Heritage Mall';
update wa_projects set send_code = '/senddk' where name = 'Wecon Dakshinayan';
update wa_projects set send_code = '/sendio' where name = 'Wecon Iqbal Orchid';
update wa_projects set send_code = '/sendmm' where name = 'Momtaz Manor';
update wa_projects set send_code = '/sendsb' where name = 'Wecon Summer Breeze';
update wa_projects set send_code = '/sendca' where name = 'Wecon Chowdhury Arcade';
update wa_projects set send_code = '/sendsd' where name = 'Wecon South Dale';
update wa_projects set send_code = '/sendss' where name = 'Shafiq Sapphire';
update wa_projects set send_code = '/sendos' where name = 'Wecon Osman Bellevue';
update wa_projects set send_code = '/sendphc' where name = 'P2P Helthcare';
update wa_projects set send_code = '/sendnz' where name = 'Wecon Nuznan';

-- Automation toggles, global (one row, id='default', same as the rest of
-- wa_settings). auto_forward_enabled gates wa-bot-eyad's "Auto Forward Create
-- Lead" step, which has been a dead end (logged, never actually called) since
-- the n8n port — the toggle is what finally makes it live. faq_agent_enabled
-- gates the OpenRouter FAQ/knowledge agent on both bots.
alter table wa_settings
  add column if not exists auto_forward_enabled boolean not null default false,
  add column if not exists faq_agent_enabled boolean not null default true;
