# AI Trainer: all-project audit (2026-10-31)

Branch `asad-dev`. Everything below was read from production tables, the function logs, the asset URLs themselves, or the source tree on 2026-10-31. Nothing is inferred. "Local" means code on this branch, tested under Node, not deployed. Every production change (content, model, migration, deploy, secret) is listed under "Needs approval" and was not made.

## 1. Models and retrieval (verified)

| Item | Value | Verdict |
|---|---|---|
| Playground model | `anthropic/claude-haiku-5.5` via OpenRouter, key set 06:52 UTC, test ok 09:06 UTC | ok |
| Embedding model | `openai/text-embedding-3-large`, 3072 dims, test ok 2026-10-19 | ok |
| Index | 73 chunks, all `embedding_dim` 3072, one model; every document `indexed`, `index_model` matches; `ai_match_doc_chunks` filters by model and `vector_dims(p_query)` | compatible |
| Item vectors | 0 item chunks; snapshot `retrieval.mode` is `full` (rules, behaviour, facts always in prompt, examples ranked lexically) | by design |
| Snapshot `05e0024d` | v1, candidate, frozen 2026-10-18, no Citizen Avenue | stale; 3 Playground conversations today ran on it and the bot said "Citizen Avenue is not in our catalog" |
| Deepseek fallbacks | 6 `fallback_model_error` in the Playground 08:09 to 08:41 UTC, model `deepseek/deepseek-v4-flash-0731`; none since Haiku | resolved by the model switch |
| Reply budget | `max_tokens` 2000, `effort: low`, reasoning-off retry on `length` | ok |

Live replies today (test numbers, `ai_turns`): 25 `ok`, 5 `fallback_invalid_output` (all `guard_errors: ["schema"]`, model returned non-JSON; 3 on 2026-10-18, 2 since), 4 `skipped_greeting`, 3 `skipped_paused`. Languages answered: 17 en, 6 banglish, 2 bn.

## 2. Projects and assets (every URL fetched, first bytes checked)

12 projects in `wa_projects`, 12 trainer project items, 11 fact-sheet documents plus one sales-office document and the Citizen Avenue FAQ document. 128 asset URLs fetched with a range GET; magic bytes classified.

| # | Project | Brochure | Photos | Floor plans | Map image | Info card | Video | Findings |
|---|---|---|---|---|---|---|---|---|
| 1 | Dakshinayan | PDF | 4 JPEG | 4 PNG, unlabelled (names readable) | JPEG | JPEG | **HTML page** | `video_url` is the property web page, not a video |
| 2 | JM Heritage Mall | PDF (Drive, `octet-stream`) | 2 PNG (Drive, tokenised URLs) | 13 JPEG | JPEG (Drive) | JPEG | MP4 | Drive URLs carry `uuid`/`at` tokens that expire |
| 3 | Iqbal Orchid | PDF | 4 JPEG | none | JPEG | JPEG | none | |
| 4 | Momtaz Manor | **none** | 4 listed, **3 distinct** (`2.jpg` twice) | none | JPEG | none | none | no brochure, duplicate photo |
| 5 | Summer Breeze | PDF | 4 listed, **3 distinct** (`sm-summer-bridge-1.jpg` twice) | none | JPEG | JPEG | none | duplicate photo |
| 6 | Chowdhury Arcade | PDF | 2 WEBP, 2 JPEG | 13 JPEG | JPEG | JPEG | none | `1sr-Floor.jpg` typo, handled by `floorLabel` |
| 7 | South Dale | PDF | 3 WEBP, 1 JPEG | 12 listed, **11 distinct** (7th floor twice) | none | none | none | duplicate plan (already deduped by `resolveMedia`); no map |
| 8 | Shafiq Sapphire | PDF (Drive) | **0** | none | **HTML** (Drive viewer link) | **HTML** (Drive viewer link) | none | no photos; map and info card are web pages, so `verifyImages` refuses them |
| 9 | Osman Bellevue | PDF (Drive) | 2 JPEG | 4 JPEG, labelled | JPEG | JPEG | **HTML page** | `video_url` is a web page |
| 10 | P2P Helthcare | PDF (Drive) | 3 JPEG | none | **empty** | PNG | YouTube | name misspelt ("Helthcare"), `nature` and `address` null, no map |
| 11 | Nuznan | PDF | 2 JPEG | 4 JPEG, labelled | PNG | PNG | none | |
| 12 | Citizen Avenue | PDF (Drive) | 4 JPEG | 8 PNG, unlabelled | **none** | none | MP4 (Drive) | no `send_code`; `map_image` empty in the item; `Semi_Basement_Citizen_Mall-scaled.png` and `Basement_Floor_-Citizen_Mall-scaled.png` got no floor label (fixed locally, below) |

All 11 brochures are real PDFs (`%PDF` header); 6 are served as `application/octet-stream` from Drive, which the probe accepts because it checks the bytes, not the header. Every photo and floor plan is a real image. The only non-image "images" are Shafiq Sapphire's two Drive viewer links.

Trainer item vs `wa_projects` drift: the item for Citizen Avenue has `map_image: ""` while `wa_projects.map_image_url` is null (consistent). Osman Bellevue and Citizen Avenue items carry tokenised Drive brochure URLs that differ from the `wa_projects` plain URLs; both resolve to the same PDF today.

## 3. Knowledge, facts, rules, behaviour, prompt (cross-check)

| Surface | State | Findings |
|---|---|---|
| Fact items | **0** | Every project fact lives in documents; the `Facts:` prompt section is always empty |
| Fact-sheet documents (11) | address, region, sales office; Dhaka ones add apartment size | Thin: no handover, amenities, floors, parking, price policy for any project except Citizen Avenue. Chowdhury Arcade's sheet has no sales office (Cumilla office exists in the Citizen Avenue FAQ only) |
| Citizen Avenue document | 20 Q&A, Bangla only, tab-separated, no headings, 7 chunks of 293 to 1466 chars | Chunks split mid-answer (chunk 1 starts with the tail of Q1). Every answer ends by asking for the customer's mobile number, which the bot already has. Banglish and English questions miss it: `koto tola?` retrieved 0 chunks (D10). Q15 says "স্যার" once |
| Rules (4 active) | Jolshiri price range, price follow-up, land/plot, unit availability | Jolshiri rule says `3-4 crore`; Dakshinayan is tagged `jolshiri`. Consistent with `wa_knowledge` copies, two of which are `is_active: false` there and active here (two systems, not a conflict in the trainer) |
| Behaviour (1 active) | `tone`: "If anyone seek borchur mentioning specific project or ads click should send brochur as pdf" | Misspelt; brochures are sent by code, never by the model (prompt line "Brochures and profiles are sent by the system"), so this instruction is dead and contradicts the prompt |
| Examples (3 active) | "Hi" → "Hello"; Dhaka project list naming "only one unit left at G-2"; Jolshiri 3 projects | **"only one unit left at G-2"** is an availability claim with no source; the example teaches the model to state stock. The greeting example is unreachable (greetings are skipped before the model) |
| System Prompt (eyad v2) | warm, 1 to 3 sentences, "Apni", one greeting, no price guessing, hand off when upset | No "Sir/Ma'am" guidance; no line-count cap; no "answer every question in the message" (bursts) |
| Reply tests (`ai_tests`) | 1 active: `2fb0edea` "do you have project at dhaka ?" with `handoff: false`, judge `rubric` | One regression test for the whole catalog; the publish gate would certify a snapshot on it. Its `ideal_reply` is the retired example's text, including "only one unit left at G-2", so the rubric judge scores replies against an unsourced availability claim. Retire or edit it (owner approval; not done). |
| Legacy `wa_knowledge` | 6 rows, 3 active | "Jolshiri campaign: stay silent on Chattogram" is active for the legacy agent only; the trainer path ignores it. Not a trainer defect, noted for the cut-over |

Contradictions found: none between documents. Unsupported: the G-2 example. Stale: snapshot 05e0024d, the behaviour item. Duplicate: Momtaz and Summer Breeze photos, South Dale plan.

## 4. Reply quality (live traces)

- Repetition: C1 to C4 (customer typing `/fdh`, `/sendnz`, `/t`, `/n …`) got the same "Sorry, I didn't understand…" four times. The 20-entry `asked` list holds sentences, so the model sees nothing stopping it.
- Length: all 25 ok replies are one paragraph of 33 to 422 characters; the longest lists all 12 projects in one sentence.
- Meeting offers: 9 of the last 12 ok replies end with a meeting or "kon din" question, including right after one was asked (B2A then B2B).
- Language: `Citizen Avenue koi?` answered in English (D11, fixed earlier today); `Nuznan er size কত?` correctly bn. One bn reply mixed "Apni" in Latin script inside Bangla.
- Honorifics: no "Sir/Ma'am" in any prompt, rule or reply.
- Duplicate replies in Conversations: every bot reply appears twice in `wa_messages` (sender `AI Trainer`, then an echo with blank sender 4 s later). Cause: Wasender's `fromMe` echo carries a different `key.id` than the `msgId` the send API returned, so the `wa_id` unique index never collides. Verified on 10 pairs today.

## 5. Local changes made (tested, not deployed)

| Change | Files | Test |
|---|---|---|
| Reply cap: `guardReply` rejects more than 5 non-blank lines (`length`); prompt asks for at most 5 short lines and to answer every question in order | `trainer-core.ts` (CORE_VERSION 1.10.0) | `trainer-reply-quality.test.ts` |
| Bot echo dedupe: `isBotEcho()`; `wa-webhook` skips a `fromMe` text that matches a bot-sent OUT row in the same thread within 120 s | `wa.ts`, `wa-webhook/index.ts` | `wa-conv.test.ts` (3 cases from today's rows) |
| Floor labels for Citizen Avenue basement plans | `trainer-media.ts` | `trainer-media.test.ts` |
| Playground version picker shows the freeze date next to each snapshot | `PlaygroundTab.jsx` | eslint clean |
| Citizen Avenue knowledge document, sectioned, trilingual, no phone-number boilerplate (draft only) | `docs/Projects/citizen-avenue-knowledge.md` | `trainer-citizen-doc.test.ts` (chunks per section, facts present in 3 scripts, no price figure) |
| New test files added to `npm run test:trainer` (`trainer-reply-quality`, `trainer-citizen-doc`, `trainer-live-recap`, `wa-conv`) | `package.json` | 335/335 pass; `test:commands` 91/91. An earlier duplicate recap helper in `wa.ts` and its test were removed during the conflict check: `writeRecapNote` in `trainer-live.ts` is the single implementation. |
| Gate receipt for `PlaygroundTab.jsx` (plugin `gate.mjs`) | — | `check_no_emoji.py` pass; `verify_states.mjs` exit 0 with 0 element-states (the harness does not mount this component, so nothing was measured); `lint_hardcodes.py` exit 1 on line 82 `margin: '4px 0'`, from commit `e38acba4` (2026-10-19), not this edit |

Earlier today on this branch (same rules): Banglish words `koi`, `tola`, `koyta`; `canonicalConvJid` for LID threads; recap note upsert; reasoning-retry budget accounting.

### Applied to production, owner approved 2026-10-31 (12:43 UTC)

| Change | Evidence |
|---|---|
| Example `66d271a5` ("only one unit left at G-2") retired through `ai_item_save` | revision 3, `ai_trainer_audit` action `retire`, actor `Claude Code (owner approved 2026-10-31)` |
| Behaviour `1ae936e5` (send brochure as PDF) retired through `ai_item_save` | revision 2, same audit row shape |
| `wa_projects` 1, 4, 5, 7, 8, 9: duplicate photo removed (Momtaz, Summer Breeze), duplicate 7th-floor plan removed (South Dale), `video_url` nulled (Dakshinayan, Osman Bellevue), Shafiq Sapphire `map_image_url` and `property_info_url` nulled | `updated_at` 12:43:51 UTC; photos 3/3, 3/3 distinct; South Dale plans 11/11 distinct |
| System Prompt v3 drafted, not saved | `docs/Projects/eyad-system-prompt-v3.md` (v2 plus Sir/Ma'am, 5-line cap, answer every question, offer the meeting once) |
| Document `1c62a3f8` body replaced with `docs/Projects/citizen-avenue-knowledge.md`: version 2, status `needs_reindex`, `indexed_version` still 1 | `md5(body)` `4b81b0bf3980a94eec1e375b9ae0a204` equals the local file (7115 chars, 17 sections); `ai_trainer_audit` id 111, 12:49:32 UTC. **Owner action:** Knowledge tab, Citizen Avenue, click Re-index. `ai_match_doc_chunks` serves only `status = 'indexed'`, so the document answers nothing until that click; the old version-1 chunks are not used either. |

Active items now: 12 projects, 4 rules, 2 examples, 0 behaviour, 0 facts.

Not built, by choice: burst coalescing (needs a queue and lease in Postgres, design in `docs/superpowers/specs/2026-10-31-eyad-conversation-handling-design.md`, migration approval); meeting-offer throttle (same design, D4); "Sir/Ma'am" (prompt content, owner-authored).

## 6. Needs approval (production)

1. Done 12:49 UTC: body of document `1c62a3f8` replaced (version 2, `needs_reindex`). **Re-index is yours:** Knowledge tab, Citizen Avenue, Re-index. One embedding run on the trainer budget; until then Citizen Avenue questions get no document excerpt (fixes D10 once indexed).
2. Done 12:43 UTC: example `66d271a5` retired (revision 3).
3. Done 12:43 UTC: behaviour `1ae936e5` retired (revision 2).
4. System Prompt v3: drafted in `docs/Projects/eyad-system-prompt-v3.md`. Owner pastes it into the Prompt tab as a draft, tests it in the Playground with "Latest draft", publishes.
5. Done 12:43 UTC: duplicate photos and plan removed, web-page `video_url` and Shafiq Sapphire viewer links nulled. Still open, needs data the owner has: P2P Helthcare name, `nature`, `address`, `map_image_url`; Citizen Avenue `send_code`; direct image URLs for Shafiq Sapphire's map and info card; JM Heritage Mall's Drive URLs carry expiring tokens.
6. Test `2fb0edea`: its `ideal_reply` still says "only one unit left at G-2". Retire it (`tests.retire` with a reason) or edit the ideal reply to drop the claim, then freeze a new snapshot and add regression tests per project before publishing (the gate needs them).
7. Deploy `wa-webhook` and `wa-bot-eyad` from this branch after review.
8. Webhook secret in `wa_secrets` and Wasender (unchanged: synthetic tests stay blocked).

## 7. Not verified

- Replies on the three physical numbers for the F/O/M cases (await the owner's phone tests).
- Whether Wasender always delivers the echo within 120 s under load; the window is a guess from today's 4 to 6 s gaps, so a slow echo would still show twice.
- The Dubai bot: out of scope, test mode off.
- Rendered contrast of the Playground version picker: `verify_states.mjs` found 0 element-states because `.gate-harness/main.html.jsx` mounts only LeadPanel and FollowUpModal.
