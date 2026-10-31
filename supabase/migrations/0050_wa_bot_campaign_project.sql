-- The project a bot's current ad campaign is about. A prelead's property_interest
-- is only wa_settings.default_project for contacts the ad did not name (every
-- Dubai contact read "Wecon Osman Bellevue"), so a flow that offers "the
-- campaign's brochure" needs the real one. Empty/NULL = the bot's built-in
-- default (Dubai: Wecon Citizen Avenue). Editable per campaign, no redeploy.
alter table wa_bot_settings add column if not exists campaign_project text;
update wa_bot_settings set campaign_project = 'Wecon Citizen Avenue' where bot = 'dubai' and campaign_project is null;
