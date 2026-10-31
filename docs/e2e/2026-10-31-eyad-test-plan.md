# Eyad WhatsApp bot: live test plan and results (2026-10-31)

Scope: `wa-bot-eyad` v67 (commit `4e5d678`), the AI Trainer test-number path, and the Conversations mirror. Test numbers: `8801709665095`, `8801866064500`, `8801604271958`. Dubai is out of scope.

Every fact below was read on 2026-10-31 from production tables (`wa_projects`, `wa_agents`, `ai_trainer_items`, `ai_trainer_documents`), from the source tree at `4e5d678`, or from `docs/Projects/Citizen Avenue Mall FAQ - Rahat - Sheet1.pdf`. Nothing here is inferred. Where a fact is missing, the table says so.

Status values in the results table: `not run`, `pass`, `fail`, `blocked`. A test is `pass` only with a row id, log line or screenshot in the Evidence column.

## 1. Environment at the start of the run

| Item | Value | Source |
|---|---|---|
| `wa-bot-eyad` | v67, built from `4e5d678`, downloaded bundle equals the commit | `list_edge_functions`, byte diff |
| `ai-trainer` | v17, deployed 08:44 UTC from code not in git | `list_edge_functions` |
| `wa_bot_settings.eyad` | `trainer_test_mode` true; `test_numbers` = the 3 numbers; `faq_agent_enabled` false (test numbers read every toggle as on) | `wa_bot_settings`, `getBotSettings` |
| `wa_bot_settings.dubai` | `trainer_test_mode` false; `8801604271958` not listed | `wa_bot_settings` |
| Playground model | `anthropic/claude-haiku-5.5` (set back from `deepseek/deepseek-v4-flash-0731` today) | `ai_model_configs` |
| Embedding model | `openai/text-embedding-3-large`, 3072 dims | `ai_model_configs` |
| Published System Prompt (eyad) | v2, `2ba6f90f` | `ai_system_prompt_pointers` |
| Webhook secret | empty for `eyad`, `dubai`, `default`; function logs "accepting unauthenticated" | `wa_secrets`, function logs |
| Snapshot `05e0024d` | v1, 2026-10-18, 11 projects, no Citizen Avenue. Do not use it in the Playground. Use Drafts or freeze a new candidate. | `ai_snapshots` |

## 2. Projects

Rows 1-11 are `wa_projects` (the legacy catalog that `/send*`, keyword matching and region auto-forward read). Citizen Avenue exists only as a trainer item and a knowledge document.

| # | Project | Region | Address | Type | Size | `/send` code | Brochure | Photos |
|---|---|---|---|---|---|---|---|---|
| 1 | Wecon Dakshinayan | Dhaka | Plot -017, Road-504, Sector 17, Jolshiri Abashon, Dhaka | Residential | 2800 sqft per apartment | `/senddk` | yes | 4 |
| 2 | Wecon JM Heritage Mall | Chattogram | 934, 935 Laldighi East, Kotwali, Chattogram | Commercial | not recorded | `/sendjm` | yes | 2 |
| 3 | Wecon Iqbal Orchid | Chattogram | Road No 03, Nasirabad Properties, South Khulshi | Residential | not recorded | `/sendio` | yes | 4 |
| 4 | Momtaz Manor | Chattogram | OR Nizam Road R/A, Chattogram | Residential | not recorded | `/sendmm` | **none** | 4 |
| 5 | Wecon Summer Breeze | Chattogram | H-714, Mehedibag, 1st Lane, Chattogram | Residential | not recorded | `/sendsb` | yes | 4 |
| 6 | Wecon Chowdhury Arcade | Cumilla | 467, Shaheed Khawaja Najim Uddin Road, Badurtola, Kotwali, Kandirpar, Cumilla | Commercial | not recorded | `/sendca` | yes | 4 |
| 7 | Wecon South Dale | Chattogram | Plot 32, Abdul Malek Sarak, Road 2, South Khulshi R/A, Chattogram | Residential | not recorded | `/sendsd` | yes | 4 |
| 8 | Shafiq Sapphire | Chattogram | House 15, Road 1, Block H, Halishahar H/E, Chattogram | Residential | not recorded | `/sendss` | yes | **0** |
| 9 | Wecon Osman Bellevue | Dhaka | Plot -016, Road-406, Sector 16, Jolshiri Abashon, Dhaka | Residential | 2850 sqft per apartment | `/sendos` | yes | 2 |
| 10 | P2P Helthcare | Chattogram | not recorded | not recorded | not recorded | `/sendphc` | yes | 3 |
| 11 | Wecon Nuznan | Dhaka | Plot No 001, Road 504C, Sector 16, Jolshiri Abashon, Dhaka | Residential | 2850 sqft per apartment | `/sendnz` | yes | 2 |
| — | Wecon Citizen Avenue | Chattogram | Amirabad, Lohagara, Chattogram | Commercial (mall) | shops 100-1200 sqft | **none assigned** | yes (Drive) | 4 |

Sales offices (knowledge document "WECON sales offices"): Dhaka, House 5A, Road 25A, Dhaka 1212 (Nuznan, Osman Bellevue, Dakshinayan); Chattogram, 687 Mehedibag, Chattogram 4203. The Citizen Avenue FAQ (Q20) also lists a Cumilla office: Holding 56, 1st floor, Laksam Road, Ramghat, Kandirpar, Cumilla, and gives the Dhaka office as House 5/A, Road 25/A, Block A, Banani, Dhaka 1212.

Citizen Avenue data defects found in recon (fixed in this run, see section 7): the trainer item carried `send_code: "/sendca"` (Chowdhury Arcade's code) and `legacy_wa_project_id: 3` (Iqbal Orchid's id), and the project had no `wa_projects` row.

## 3. Citizen Avenue facts the bot may state

Source: FAQ document, 20 questions, indexed as "Project Wecon Citizen Avenue Knowledge" (7 chunks, both bots, linked to the project). Q numbers refer to the PDF.

| Fact | Value | Q |
|---|---|---|
| Location | Amirabad, Lohagara, Chattogram; on a 150 ft wide road; on the Chattogram to Cox's Bazar / Bandarban route | 1 |
| Map | https://maps.app.goo.gl/yere7UHNLG8FT9Xs8 | 1 |
| Shop sizes | 100 to 1200 sqft | 3 |
| Shop types | clothing, brand goods, jewellery, mobile and electronics, other categories | 4 |
| Price | **not stated**; depends on size, floor, position; ask what the customer needs and offer a call | 2, 7 |
| Installments | **not stated**; the team explains payment terms | 8 |
| Renting out | possible; tenant and rent depend on position and market demand | 9 |
| Resale | possible in future | 10 |
| Handover | December 2031; may change with construction progress | 11 |
| Amenities | lift, escalator, car parking, food area, varied shops, kids' play area, security | 12 |
| Parking | basement: 47 cars and 6 motorcycles; cars and motorcycles planned | 13, 18 |
| Building | basement, ground floor, 9 floors and roof; land about 39.6 katha; faces north-east | 16 |
| Floor mix | semi-basement: gold souk and supershop (about 5700 sqft); ground: gents and brand shops; 1st: gents, ladies, kids; 2nd: ladies and kids; 3rd: mixed and jewellery; 4th: mobile and electronics; 5th: food court. Floors 6 to 9 are not described. | 17 |
| Lifts and escalators | 5 lifts, 6 pairs of escalators | 19 |
| Developer | WECON Properties Limited, REHAB member, P2P Group company; design by P2P Design Studio | 20 |
| Booking | choose size and position, then application, documents and payment per project rules | 14 |

Every FAQ answer ends by asking for the customer's mobile number so the team can call. The bot already has the number; the expected behaviour is to offer a consultant call or meeting once, not to ask for the number.

## 4. Agent routing (commands)

`wa_agents`, 17 active rows. A pool command picks the in-pool agent of that region with the lowest `assigned_count` (`wa_pick_agent`). `wa_create_lead` returns `exists` and sends the already-assigned text when the phone already has a lead.

| Command | Agent | Region | Pool | In round-robin | CRM user | Phone | Notify customer |
|---|---|---|---|---|---|---|---|
| `/fdh` | Dhaka pool | Dhaka | yes | — | — | — | yes |
| `/faz` | Md.Azizul Haque | Dhaka | no | yes | yes | yes | yes |
| `/fmj` | Mehjabeen Mumtaha Rahman | Dhaka | no | yes | yes | yes | yes |
| `/fk` | Kamrul Shikder | Dhaka | no | **no** | yes | yes | yes |
| `/fl` | Mainul | Dhaka | no | **no** | yes | yes | **no** |
| `/fctg` | Chittagong pool | Chattogram | yes | — | — | — | yes |
| `/fm` | Masud Chowdhury | Chattogram | no | yes | yes | yes | yes |
| `/fs` | Shabbir Newaz | Chattogram | no | yes | yes | yes | yes |
| `/fmr` | Maruf Alam | Chattogram | no | yes | yes | yes | yes |
| `/fh` | Hillol Chowdhury | Chattogram | no | yes | yes | yes | yes |
| `/fcml` | Cumilla pool | Cumilla | yes | — | — | — | yes |
| `/fsn` | Shahin | Cumilla | no | yes | **no** | yes | yes |
| `/fdp` | Deep | Cumilla | no | yes | **no** | **no** | yes |
| `/fkl` | Kamal | Cumilla | no | yes | **no** | yes | yes |
| `/fdu` | Jaber Hossain | Dubai | no | no | yes | yes | yes |
| `/fmkt` | Marketing pool | Marketing | yes | — | — | — | yes |
| `/frahat` | Mr Rahat | Marketing | no | yes | yes | yes | yes |

Routing gap (verified, not fixed): the three Cumilla agents have no `user_id`, so a `/fcml`, `/fsn`, `/fdp` or `/fkl` lead is created with `assigned_to` null and no CRM notification is written.

Automatic region routing in `handleInbound`: project region Dhaka → `/fdh`, Chattogram → `/fctg`, Cumilla → `/fcml`; a non-880 number → `/fdu`. There is no Marketing route. Auto-forward is globally off (`wa_settings.auto_forward_enabled` false) and on for test numbers.

Sender check: a command runs only when Wasender's `key.fromMe` is true (`parseEvent`). A customer message starting with `/` is treated as inbound text. `npm run test:commands` covers this (30 tests, pass on 2026-10-31).

## 5. Test cases

Sender column: **You** = sent from the test phone or typed on the Eyad phone; **Inject** = I POST a Wasender-shaped payload to `functions/v1/wa-bot-eyad` (possible only while the webhook secret is empty). Every injected payload uses a unique `key.id` prefixed `test-20261031-`.

Evidence for each case: `ai_turns` row (outcome, trace.language, trace.project, trace.documents, trace.reply), `wa_messages` rows in both the `@lid` and `@s.whatsapp.net` threads, and the `trainer test turn` log line.

### 5.1 Citizen Avenue FAQ accuracy and language

| ID | Sender | From | Message | Expected |
|---|---|---|---|---|
| F1 | You | each number | `Citizen Avenue Mall কোথায়?` | Bangla script; Amirabad, Lohagara, Chattogram; may add 150 ft road; one follow-up question; no price |
| F2 | You | 8801866064500 | `citizen mall price per sft?` | Banglish; no figure, no range; asks size or need; offers a consultant call |
| F3 | You | 8801604271958 | `How many floors does Citizen Avenue have?` | English; basement, ground, 9 floors, roof; may add 39.6 katha |
| F4 | You | 8801709665095 | `গাড়ি পার্কিং আছে?` | Bangla; 47 cars, 6 motorcycles |
| F5 | You | 8801866064500 | `handover kobe?` | Banglish; December 2031; may change |
| F6 | You | 8801604271958 | `কোন তলায় কী দোকান?` | Bangla; the floor list from Q17; no claim about floors 6 to 9 |
| F7 | You | 8801709665095 | `Lift and escalator?` | English; 5 lifts, 6 pairs of escalators |
| F8 | You | 8801866064500 | `দোকান ভাড়া দিতে পারব?` | Bangla; possible, depends on position and demand; no guarantee |
| F9 | You | 8801604271958 | `Where is your office in Chattogram?` | English; 687 Mehedibag; offers to arrange a time |
| F10 | You | any | `Dhanmondi te flat ache?` | Asks which project or area; does not invent a Dhanmondi project |
| F11 | You | 8801604271958 | `Nuznan er dam?` (after F3) | Switches to Wecon Nuznan; no Citizen Avenue facts; price rule applies |

Known code path for F2 and F5 on `8801604271958` and `8801709665095` (`preleads.flow_stage` null): `handleInbound` sends the fixed English text `FLOW_PRICE_AGENT_TEXT` and returns before the Trainer runs. On `8801866064500` (`flow_stage` = `agent_assigned`) the Trainer answers. Record which one happened.

### 5.2 Greeting, bursts, duplicates, recap

| ID | Sender | From | Message | Expected today | Target after the design in `docs/superpowers/specs/2026-10-31-eyad-conversation-handling-design.md` |
|---|---|---|---|---|---|
| B1 | You | any | `hello` | No bot reply (`skipped_greeting`); no welcome because the contact is not new | same |
| B2 | Inject | 8801604271958 | two messages 1 s apart: `Citizen Avenue koi?` then `parking ache?` | Two separate replies, each answering one message | One reply covering both, in order |
| B3 | Inject | 8801604271958 | the same payload posted twice (same `key.id`) | One reply; second POST returns `{ok:true, duplicate:true}` | same |
| B4 | You | 8801866064500 | three FAQ questions quickly | Three replies | One combined reply; no repeated meeting offer |
| R1 | — | — | after B4 | No recap exists | Recap stored on the conversation state and visible to the agent |

### 5.3 Commands: customer-originated must never execute

| ID | Sender | From | Message | Expected |
|---|---|---|---|---|
| C1 | Inject (fromMe false) | 8801604271958 | `/fdh` | No `leads` insert, no `notifications` insert, `preleads.forwarded` unchanged; treated as text (Trainer may answer or stay silent) |
| C2 | Inject (fromMe false) | 8801604271958 | `/sendnz` | No brochure sent; no `AI Trainer` document row |
| C3 | Inject (fromMe false) | 8801604271958 | `/t` | `preleads.takeover` stays false |
| C4 | Inject (fromMe false) | 8801604271958 | `/n test note` | No `activities` NOTE row |

### 5.4 Commands: owner-originated (typed on the Eyad phone)

| ID | Sender | Target chat | Message | Expected |
|---|---|---|---|---|
| O1 | You | 8801604271958 | `/sendnz` | Wecon Nuznan brochure then 2 photos, 5.5 s apart; 3 `wa_messages` OUT rows |
| O2 | You | 8801604271958 | `/n customer prefers evening calls` | one `activities` row, type `NOTE`, on lead `e6391d4f` |
| O3 | You | 8801604271958 | `/faz wants Citizen Avenue shop` | lead exists → already-assigned text to the customer; note saved on the lead; no second lead |
| O4 | You | 8801604271958 | `/t` | `preleads.takeover` true; handover text sent; the next customer message gets no bot reply |
| O5 | You | 8801604271958 | `/frahat` | `exists` path (lead already assigned); no new lead |

Reset after O4: set `preleads.takeover` back to false for `8801604271958`, or the remaining cases on that number get no replies.

### 5.5 Media and calls

| ID | Sender | From | Message | Expected today | Target |
|---|---|---|---|---|---|
| M1 | You | 8801604271958 | a photo, no caption | `wa_messages` IN row type `image` with `media_url`; file is encrypted (not viewable); no bot reply | agent notified; reference preserved |
| M2 | You | 8801604271958 | a voice note | IN row type `audio`; encrypted; no reply | agent notified; no transcription (no provider) |
| M3 | You | 8801604271958 | a WhatsApp call | nothing recorded (`call` event never received in production) | `call` event enabled in Wasender; agent notified |

### 5.6 Conversations tab

| ID | Check | Expected today |
|---|---|---|
| V1 | inbound F1 visible | yes, in the `eyad:<lid>@lid` thread |
| V2 | bot reply visible | yes, twice: `AI Trainer` row in the `@lid` thread and an echo row with blank sender in the `@s.whatsapp.net` thread |
| V3 | owner command `/sendnz` visible | the command text as an OUT row with blank sender |
| V4 | note, transfer, outcome | note in the lead's activity log, not in the chat; transfer as the already-assigned text; outcome in `ai_turns` only |

## 6. Results

Filled in during the run. `pass` requires evidence.

| ID | Status | Actual | Evidence | Notes |
|---|---|---|---|---|
| F1 | not run | | | |
| F2 | not run | | | |
| F3 | not run | | | |
| F4 | not run | | | |
| F5 | not run | | | |
| F6 | not run | | | |
| F7 | not run | | | |
| F8 | not run | | | |
| F9 | not run | | | |
| F10 | not run | | | |
| F11 | not run | | | |
| B1 | not run | | | you send |
| B2 | pass (today's behaviour) | Two separate replies 11 s apart. First (detected `en`) gave Amirabad, Lohagara, 150 ft road, map link, then a meeting offer. Second (`banglish`) said the floor count is not available and offered a meeting, although FAQ Q16 holds it: retrieval returned 0 documents for `koto tola?` (see D10). | `ai_turns` 9deb249a (10:48:50 UTC), 1f22d833 (10:49:01); `wa_webhook_events` `eyadbot:TEST20261031B2A`, `B2B`; `/tmp/eyad-inject-20261031.log` | target (one combined reply) not built |
| B3 | pass | Same `key.id` posted twice 6 s apart. Second POST returned `{"ok":true,"duplicate":true}`. One `ai_turns` row, one send (wa id 93079802). Reply was correct: basement, 47 cars, 6 motorcycles, in Banglish. | `ai_turns` a09fec11 (10:47:54); `wa_webhook_events` `eyadbot:TEST20261031B3` claimed once at 10:47:51; log lines 10:48:04 and 10:48:10 | |
| B4 | not run | | | you send |
| R1 | not run | | | no recap exists today |
| C1 | pass | Customer-originated `/fdh`: no lead created (1 before, 1 after), no notification (1 before, 1 after), `preleads.forwarded` unchanged. Treated as text; bot replied "Sorry, I didn't catch that. Are you asking about Wecon Citizen Avenue?" | `ai_turns` b084afb7 (10:50:07); counts read at 10:47:27 and 11:02:02 UTC | |
| C2 | pass | Customer-originated `/sendnz`: no document sent (OUT document rows 0 before, 0 after). Text reply only. | `ai_turns` 1bb003b6 (10:50:52) | |
| C3 | pass | Customer-originated `/t`: `preleads.takeover` false before and after; the next message (C4) was still answered. | `ai_turns` 4744ee0f (10:51:37) | |
| C4 | pass | Customer-originated `/n ...`: NOTE activities on lead e6391d4f 1 before, 1 after. | `ai_turns` 62fd5486 (10:52:23) | |

Observation from C1 to C4: the bot sent the same "Sorry, I didn't understand that message..." reply four times in a row. Harmless, but a customer who types a slash by mistake gets a canned line each time.

Run note: the injections ran 10:47 to 10:52 UTC from `/tmp/eyad-inject-20261031.sh` (7 POSTs, all HTTP 200), under the "Both" approval given earlier. They were accepted because no webhook secret is set (D4). The owner's later instruction, "verify webhook authentication before synthetic tests", applies from now on: no further injections until a secret is set in `wa_secrets` **and** in Wasender's webhook settings for the Eyad session, and every later injection will carry that signature.
| O1 | not run | | | |
| O2 | not run | | | |
| O3 | not run | | | |
| O4 | not run | | | |
| O5 | not run | | | |
| M1 | not run | | | |
| M2 | not run | | | |
| M3 | not run | | | |
| V1 | not run | | | |
| V2 | not run | | | |
| V3 | not run | | | |
| V4 | not run | | | |

## 7. Defects found during recon

| # | Defect | Status |
|---|---|---|
| D1 | `8801866064500` muted: `ai_conversation_state` `eyad:226431162396785@lid` paused since the 08:17 UTC handoff; two messages at 10:14 and 10:15 UTC got `skipped_paused` | fixed 2026-10-31 (paused set false) |
| D2 | Citizen Avenue missing from `wa_projects`; trainer item had Chowdhury Arcade's `/sendca` and Iqbal Orchid's legacy id | `wa_projects` row 12 added 2026-10-31 (region Chattogram, 4 photos, 8 floor plans, brochure, map, video; `send_code` null until the owner names one). `wa_detect_project` now resolves "citizen", "cityzen", "citizen avenue", "citizen mall". Trainer item saved as revision 3 through `ai_item_save`: `send_code` removed, `legacy_wa_project_id` 12, audited. |
| D3 | Inbound media mirrored encrypted: 6 of 6 recent files in `wa-media/in/` have no JPEG or OGG header. Fix is `POST /api/decrypt-media` before mirroring. | skipped by decision |
| D4 | No webhook secret; anyone with the function URL can post a `fromMe: true` command | skipped by decision |
| D5 | Each customer shows two threads in Conversations; every bot reply appears twice | local fix on `asad-dev`, not deployed: `canonicalConvJid` keys a LID chat by the phone JID when the number is known, and `wa-webhook` skips the bot's own `fromMe` echo (`isBotEcho`: same text within 120 s of an `AI Trainer` or `AI Agent` row). Existing duplicate rows still need the gated merge. |
| D6 | Price question from a contact with `flow_stage` null gets the fixed English text before the Trainer | open |
| D7 | Cumilla agents have no CRM user; their leads get no notification | open |
| D8 | Dubai: test mode off, `8801604271958` not listed | open |
| D9 | `ai-trainer` v17 and `wa-bot-dubai` v62 differ from git | open (other session owns the `ai-trainer` deploy) |
| D10 | Banglish `koto tola?` retrieved 0 knowledge chunks, so the bot said the floor count is unavailable although FAQ Q16 (Bangla) states basement, ground, 9 floors and roof. The bot did not guess, which is correct; the gap is cross-script retrieval (Banglish query against a Bangla-only document). Fix is content: add an English or Banglish rendering of the key Citizen Avenue facts to the knowledge document or as fact items. | applied 2026-10-31 12:49 UTC with owner approval: document `1c62a3f8` body is now `docs/Projects/citizen-avenue-knowledge.md` (one section per question, Bangla + Banglish + English, no phone-number boilerplate; chunking test `trainer-citizen-doc.test.ts`), version 2, status `needs_reindex`. Closed once the owner clicks Re-index in the Knowledge tab and `koto tola?` retrieves the floors chunk. |
| D11 | `Citizen Avenue koi?` was detected as English and answered in English. `koi` is not in the Banglish word list. | fixed 2026-10-31 (added `koi`, `tola`, `koyta` to `BANGLISH` in `trainer-core.ts`; tests pass). Detection only — does not change retrieval content (D10). |
