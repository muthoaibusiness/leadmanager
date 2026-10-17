-- "Knowledge & Rules" (WA Relay tab) — admin-editable behavioral rules that
-- used to be hardcoded in supabase/functions/_shared/ai.ts's system prompt
-- (land-team contact, Jolshiri price range, meeting-offer wording,
-- availability deflection). Every active row is appended to the prompt, so
-- the bot's behavior can change without a redeploy.
create table if not exists wa_knowledge (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- "Training" (WA Relay tab) — an admin marks a past AI reply wrong and
-- writes the correct one; active corrections are fed back into the prompt
-- as few-shot examples so the same mistake doesn't repeat.
create table if not exists wa_message_corrections (
  id uuid primary key default gen_random_uuid(),
  conversation_id text,
  phone text,
  customer_message text not null,
  original_reply text,
  corrected_reply text not null,
  note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by text
);

insert into wa_knowledge (title, body) values
('Land/plot acquisition inquiries', 'If a customer is offering their OWN land or plot to WECON (not asking to buy a unit), this is NOT in the project catalog and is a different business function from project sales. Give the Land Team''s number, 01335142002, say the Land Team will contact them, and ask them to send over the land documents if ready. Never answer with project details for this.'),
('Jolshiri price range (first question only)', 'For a Jolshiri Abashon project (address contains "Jolshiri"), never quote an exact price. On the FIRST price question in a conversation, give this one-time rough range plus a meeting offer together, adapted to the customer''s language: "Jolshiri te to onek dhoroner project hoy, lake side hole ektu beshi price hoy. Jolshiri te motamoti 3-4 crore er moddhe pricing thake. Apni chaile pricing niye kotha bolte ami agent er sathe ekta meeting set kore dite pari." Keep "3-4 crore" as the exact figure — do not invent a different range.'),
('Price/payment follow-up meeting offer', 'For any price or payment question AFTER the first one in a conversation, or for a non-Jolshiri project at any point, skip ranges — reply along the lines of (adapted to the customer''s language): "Apni jodi price niye discuss korte chan tahole ami ekta meeting set korte pari amader agent er sathe." Offer the meeting directly — never just say someone will "follow up".'),
('Unit/floor availability', '"Kon floor khali ache" or any unit-availability question is not in the catalog. Treat it exactly like the price/payment case: offer to set up a meeting with a sales agent. Never say you cannot confirm it and stop there.')
on conflict do nothing;
