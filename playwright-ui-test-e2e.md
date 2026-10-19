# AI Trainer UI end-to-end test (Playwright)

**Date:** 2026-10-19 (run `E2E-202610191130`, 11:30 to 11:42 UTC)
**Site:** https://wepro-test.mutholab.com/#/aitrainer, Netlify, built from `dev` at `8ae3471`
**Backend:** Supabase project `sbqmougcvnplgjgihpwe`. This is the **production** database. The bundle on the site was checked, and the site calls this project.
**Account:** the Management account the user named. The user typed the password into a headed browser window. It was never passed to a script, logged or stored.
**Runner:** Playwright 1.64.1 (Chromium), driving the real UI. The script is `scripts/e2e/aitrainer.e2e.mjs`, and every result comes from its observations.
**Evidence:** screenshots and `e2e-results.json` (every reply, trace and trainer action called) in [`docs/e2e/evidence/`](docs/e2e/evidence/).

## Summary

| Result | Count |
|---|---|
| PASS | 23 |
| FAIL | 0 |
| BLOCKED | 3 |

The three BLOCKED steps save shared drafts: a System Prompt draft, a Behaviour instruction and a Conversation Example. The script for them is written. It runs only with `E2E_DRAFTS=1`, and only after you approve, because those drafts would be included in any later Freeze or Publish (see Blockers).

The first run (`E2E-202610191120`) reported two FAILs. Both were faults in my checks, not in the bot. They were corrected and the run repeated (see "Check corrections"). Both runs' conversations stay in History.

**Update, same day:** the two priority issues this run found (issues 1 and 3) are now fixed in code, with regression tests. See "Fixes after the run". The fixes are **not deployed**: the test site still runs `8ae3471` and the ai-trainer function is unchanged, so the E2E results above describe the code as it was before the fixes.

## Safety: what this run could and could not change

The script records every request the page makes. It confirmed:

- **No writes outside the ai-trainer function (W1).**
- **No forbidden action was called (W2):** `publish`, `rollback`, `prompt.publish`, `prompt.rollback`, `bots.set_replies`, `modelconfig.save`, `embedconfig.save`, `testnumbers.set` and the document actions.
- **Only these actions wrote anything:** `playground.turn` (Playground conversations, kept on purpose as history) and `runs.start` / `runs.step` (one Quality test run, kept as history). No customer path reads either table.

Production before and after, measured read-only with SQL:

| Check | Before (10:34 UTC) | After (11:42 UTC) | Meaning |
|---|---|---|---|
| `ai_bot_pointers` fingerprint | `491d988b…` | `491d988b…` | Bot pointers unchanged; both still `legacy` |
| `wa_bot_settings` fingerprint | `9e5bd6cd…` | `9e5bd6cd…` | Bot settings unchanged (FAQ agent, test mode, switches) |
| `ai_turns` (test-number turns) | 7 | 7 | No WhatsApp test-number turn |
| WhatsApp messages sent by "AI Trainer" | 9 | 9 | No WhatsApp message sent |
| `ai_system_prompts` | 4 | 4 | No prompt saved |
| Playground conversations / turns | 13 / 16 | 25 / 32 | +12 / +16: the two runs' saved conversations |
| `ai_system_prompt_pointers` fingerprint | `d15933f6…` | `a7af84f9…` | **Changed, but not by this run.** See below |
| `leads` | 2636 | 2640 | Real WhatsApp ad leads arriving (source `WHATSAPP_ADS`); unrelated |

**The System Prompt pointer change was not made by this run.** The audit log shows two `system_prompt` `rollback` actions on **dubai** at 11:18:37 and 11:18:53 UTC, by the claimed actor "admin", with reason "yes". That was before this run started (11:20). The run's request log contains no `prompt.rollback` call. Dubai's Playground now uses published prompt v2, which is why G2 and R2 show `prompt: v2`. Customers are not affected: the deployed bots read neither prompt pointers nor bot pointers. The deployed-source test confirms this (`both deployed: no bot reads ai_bot_pointers or ai_snapshots`).

## Results

### Session and settings

| ID | Area | Result | Evidence |
|---|---|---|---|
| S0 | Session | PASS | Signed-in AI Trainer page with 8 section tabs. `00-trainer.png` |
| M1 | Model & API | PASS | The Playground uses OpenRouter `deepseek/deepseek-v4-flash-0731`, as you asked. It was already configured, so this run changed nothing. `01-model.png` |
| M2 | Model & API | PASS | No API key value appears anywhere in the page HTML; only the last 4 characters are shown. |
| K1 | Knowledge | PASS | Projects, Facts and Business rules sections load. 11 documents show "Indexed". `02-knowledge.png` |
| K2 | Knowledge | PASS | "All reviewed documents are indexed for the current embedding model." |

### System Prompt

| ID | Result | Evidence |
|---|---|---|
| P1 | PASS | Eyad status: "Nothing published". `03-prompt.png` |
| P2 | PASS | **"Test prompt" ran the WECON sales prompt without saving it** (`scripts/e2e/wecon-sales-prompt.md`, 1,932 characters). Question: "Nuznan er flat size koto? ar dam koto?" The reply gave the catalog size (2850 sft), the approved Jolshiri range (3-4 crore) and a meeting offer, then asked one follow-up question. No other figure appeared. `03b-prompt-test.png` |
| P3 | BLOCKED | Saving the prompt as a draft waits for your approval. The button "Publish" is never clicked by the script. |

P2's reply, verbatim:

> Wecon Nuznan er flat size 2850 sft. Eta Jolshiri Abashon e, tai lake side project gulor moto ekhaneo price ektu beshi hoy; Jolshiri te motamoti 3-4 crore er moddhe pricing thake. Apni chaile pricing niye kotha bolte ami agent er sathe ekta meeting set kore dite pari. Apni ki Nuznan er unit ta personally dekhte chan?

### Behaviour

| ID | Result | Evidence |
|---|---|---|
| B1 | PASS | The "Behaviour instructions" and "Conversation examples" sections render. `04-behaviour.png` |
| B2 | BLOCKED | Adding a Behaviour instruction ("meeting" aspect) waits for your approval. |
| B3 | BLOCKED | Adding a Conversation Example (an Osman Bellevue address question) waits for your approval. |

### Playground: real conversations

Every reply comes from the live model, `deepseek/deepseek-v4-flash-0731`. Each conversation is saved and listed in Playground History.

| ID | Bot | Area | Result | Customer | Reply (verbatim) | Trace |
|---|---|---|---|---|---|---|
| G1 | eyad | Price grounding | PASS | Jolshiri te Nuznan er flat er dam koto? | Jolshiri te to onek dhoroner project hoy, lake side hole ektu beshi price hoy. Jolshiri te motamoti 3-4 crore er moddhe pricing thake. Apni chaile pricing niye kotha bolte ami agent er sathe ekta meeting set kore dite pari. | ok; project Nuznan; docs: Wecon Nuznan, Nuznan > Location |
| | | | | ar exact price ta bolen, per sqft koto? | Apni jodi price niye discuss korte chan tahole ami ekta meeting set korte pari amader agent er sathe. | ok; no figure; meeting offered |
| G2 | dubai | Price grounding | PASS | South Dale er 3 bed flat er price koto? | Apni jodi price niye discuss korte chan tahole ami ekta meeting set korte pari amader agent er sathe. | ok; non-Jolshiri, so no range; prompt v2 |
| X1 | eyad | Cross-project isolation | PASS | Osman Bellevue er size koto? | Wecon Osman Bellevue er prottekta apartment 2850 sqft. | ok; docs: Osman Bellevue only |
| | | | | Summer Breeze kothay? | Wecon Summer Breeze er site address: H-714, Mehedibag, 1st Lane, Chattogram. Sales office: 687 Mehedibag, Chattogram 4203. | ok; docs: Summer Breeze only; no Osman Bellevue facts |
| R1 | eyad | Knowledge retrieval | PASS | Dakshinayan er handover kobe? | Dakshinayan er handover date amader catalog e specific kora nei. Apni chaile ami agent er sathe ekta meeting set kore dite pari jate apni exact date janate paren. | ok, handoff; docs: Dakshinayan sections. Knowledge has no handover date for Dakshinayan (checked in the database), so the correct answer is "not available" with no invented date. |
| R2 | dubai | Knowledge retrieval (Bangla) | PASS | Shafiq Sapphire কোথায়? | Shafiq Sapphire অবস্থিত House 15, Road 1, Block H, Halishahar H/E, Chattogram এ। সেলস অফিস: 687 Mehedibag, Chattogram 4203। | ok; docs: Shafiq Sapphire sections; prompt v2 |
| C1 | eyad | Command handling | PASS (see note) | /f note: interested in Nuznan | Great choice! Wecon Nuznan is a residential project in Dhaka, located at Plot No 001, Road 504C, Sector 16, Jolshiri Abashon. Each apartment is 2850 sqft. I am attaching the brochure for you. Let me know if you would like any more details. | ok; brochure attached; no lead created |

Screenshots: `05-G1.png` … `05-C1.png`.

**Command handling:**
- **What C1 shows.** The Playground has no command path. Agent commands (`/t`, `/n`, `/f…`, `/send…`) run only in the WhatsApp bots, and only when the agent sends them from the business phone (`fromMe`). A customer who types `/f` is treated as a customer message, which is what C1 shows. Running a real command from the UI would send WhatsApp messages and create leads, so it was not done.
- **Unit tests instead.** The supported commands were checked with the existing tests, run today:
  - `node --test scripts/command-compat/routing.test.ts`: **90 pass, 0 fail.**
  - `node --test scripts/command-compat/deployed-parity.test.ts`, against the bot source downloaded today from production: **17 pass, 0 fail.**
- **What those tests confirm:**
  - Dispatch order is `/t`, `/n`, `/f`, `/send` (Eyad), each behind its own toggle.
  - Every `/f<code>` parses as that exact command.
  - A customer typing a command is never treated as a command.
  - Commands are dispatched before, and separately from, the AI reply.
  - Dubai has no `/send` (a known spec gap).

### History

| ID | Result | Evidence |
|---|---|---|
| H1 | PASS | After a full page reload, all 4 eyad conversations from the run are listed under History. `06-history.png` |
| H2 | PASS | Reopening "Jolshiri te Nuznan er flat er dam koto?" from History shows both messages, the replies and their traces. `06b-history-open.png` |

**Where to review:** AI Trainer › Playground › History. Search for "Nuznan", "Osman", "South Dale", "Dakshinayan", "Shafiq" or "/f". Tick or untick "Only eyad" to see dubai's conversations. Each conversation keeps its bot, version, setup, every turn and the full trace.

### Quality & Publish

| ID | Result | Evidence |
|---|---|---|
| Q1 | PASS | Both bots show `legacy`. `07-quality.png` |
| Q2 | PASS | "Run tests" on candidate v1 (eyad) finished with `complete`: FAIL 0, PASS 0, INCONCLUSIVE 0. **There are no active tests:** the only one was retired. The run is saved in the run history. `07b-run.png` |
| Q3 | PASS | "Publish" was not clicked. Note that the button is **enabled** (issue 1, now fixed in code but not deployed). |

### Bots

| ID | Result | Evidence |
|---|---|---|
| T1 | PASS | Eyad and Dubai cards render. AI replies: Eyad on, Dubai off, matching `wa_bot_settings` (FAQ agent enabled for eyad only). No switch was clicked. `08-bots.png` |
| T2 | PASS | The bot menu offers All Bots, Eyad Bot and Dubai Bot. |

### Side effects

| ID | Result | Evidence |
|---|---|---|
| W1 | PASS | The page made no write request outside the ai-trainer function. |
| W2 | PASS | None of the forbidden actions was called. |

## Issues found

1. **Publish is enabled when no tests exist (Medium). Fixed in code, not deployed.** With zero active tests, a run on the candidate completes with 0/0/0. `publishGate` then reports nothing missing, and the Bot card and Quality tab treat 0 failures as "passing". So a candidate can be published without having passed a single test. The bots do not read published versions today, so customers are unaffected, but the gate certifies nothing. See "Fixes after the run".
2. **The System Prompt was rolled back with the reason "yes" (Low).** Dubai's prompt pointer moved twice at 11:18 UTC with reason "yes". The rollback prompt accepts any non-empty text. This was not caused by the test.
3. **The Playground does not show retrieved documents (Low). Fixed in code, not deployed.** The trace stores the document sections that were found (`trace.documents`), but the turn footer shows "sources the model reports using: none". A reviewer can't see what knowledge a reply was based on. See "Fixes after the run".
4. **A reply said "Great choice!" (Low, tone).** C1's built-in-persona reply opens with "Great choice!" for a bare command string. The WECON sales prompt (P2) did not do this. It goes away once a System Prompt is published for eyad.
5. **Known, unchanged:** the ai-trainer Management check trusts a user id sent by the browser. This was reported earlier and is not part of this run.

## Fixes after the run

Both fixes are in the working tree only: not committed, not deployed, no production setting changed. Each regression test was written first and failed before its fix.

### Issue 1: Publish needs at least one active test

| Layer | Change |
|---|---|
| Server, the real gate (`supabase/functions/_shared/trainer-core.ts`, `publishGate`) | Refuses when the bot has no active tests. The reason reads: "no active tests for eyad: add at least one regression test, then run them". `publish` and a rollback to a snapshot both go through this gate. |
| Bot card (`src/lib/botControl.js`, `BotControl.jsx`) | A complete run with 0 PASS now reads **"No tests to run"**, not "Tests passed". Publish stays off, and the card says: "Publish needs at least one regression test. Add one with Mark wrong in the Playground, then run the tests." |
| Quality & Publish (`QualityTab.jsx`) | "Publish to {bot}" is disabled when the bot has no active tests, with the reason shown under it. The tab's two native `<select>` elements were replaced by the app's Radix select, because the UI gate rejects native selects in an edited file. |

Regression tests:
- `trainer-core.test.ts`: "publishGate: a run that covered no tests certifies nothing". Covers no tests at all, and tests that exist only for the other bot.
- `trainer-handler.test.ts`: "publish refused when there are no active tests, even after a complete run". The flow is freeze, then a run that reports 0 tests, then `publish`. It returns 409 with the reason, and the pointer stays `legacy`.
- `scripts/botcontrol.test.mjs`: a complete 0/0/0 run, or one with empty counts, reads `no_tests`, with `canPublish` false.
- `scripts/aitrainer-ui/botcontrol.flow.test.mjs`: the card shows "No tests to run" and the reason, with Publish disabled.
- `scripts/aitrainer-ui/flow.test.mjs`: Quality disables "Publish to dubai" (no tests) and enables "Publish to eyad" (one test); the server still gates eyad on its run.

Evidence: `docs/e2e/evidence/10-fix-quality-no-tests.png`.

### Issue 3: retrieved Knowledge sections in the Playground trace

| Layer | Change |
|---|---|
| Trace (`trainer-core.ts`) | `trace.documents[]` now also stores the document `title`. |
| Display (`src/lib/traceDocs.js`, `PlaygroundTab.jsx`, `aitrainer.css`) | Each reply shows a collapsed **"Knowledge retrieved (N)"** line. Opened, it lists every retrieved section as `Document › Heading › Subheading` with its similarity score. A search that found nothing shows "none matched", and a failed search shows its error. Turns with no search show nothing. Turns saved before this change (no title) show `Document <id>` instead of a blank. |

This shows what retrieval actually put in the prompt. The existing "sources the model reports using" line is what the model says it used; both are kept.

Regression tests:
- `trainer-docs.test.ts`: the trace carries the title.
- `scripts/traceDocs.test.mjs` (new, 5 tests): no search, an empty search, a failed search, hits in order with their scores, older turns without a title, and the title not repeated in the heading path.
- `scripts/aitrainer-ui/docs.flow.test.mjs`: after a real handler turn, reopening the conversation from History shows "Nuznan fact sheet › Wecon Nuznan › Apartment sizes" with its score.

Visual check: rendered in dark mode, light mode and at phone width (390 px), with no horizontal overflow.
- **Row text contrast, measured:** 19.67:1 in dark mode and 19.8:1 in light mode. The first light-mode version measured 4.26:1, below AA, and was changed before this report.
- **Screenshots:** `09-fix-retrieved-docs-dark.png`, `09b-…-light.png` and `09c-…-phone.png` (from a static render of the component with a sample trace, not the live site).

### Checks rerun after the fixes

| Check | Result |
|---|---|
| `npm run test:trainer` | 208 pass, 0 fail |
| `npm run test:live` | 35 pass, 0 fail |
| `npm run test:botcontrol` | 8 pass, 0 fail |
| `node --test scripts/traceDocs.test.mjs` | 5 pass, 0 fail |
| `npm run test:commands` | 90 pass, 0 fail |
| `npm run test:ui` | 54 ok, 0 fail |
| `npm run test:ui:botcontrol` | 26 ok, 0 fail |
| `npm run test:ui:docs` | 27 ok, 0 fail |
| `npm run test:ui:prompt` | 21 ok, 0 fail |
| `npm run test:ui:pillnav` | 23 ok, 0 fail |
| `npm run test:ingest` | 9 pass, 0 fail |
| `npm run test:0046` / `test:0047` (migrations, PGlite) | 5 / 7 passed |
| `eslint` on the changed source files | clean |
| `vite build` | built |
| UI gates (`check_no_emoji`, `lint_native_select`, `lint_hardcodes`, `verify_states`) on QualityTab, PlaygroundTab, BotControl and aitrainer.css | OK; live receipts recorded |

`verify_states` measured 0 element states, because it cannot render JSX. The visual and contrast checks above are the real evidence for the UI.

### To take the fixes live

Both fixes need the ai-trainer function deployed and the frontend built from a branch that contains them. Nothing here has been deployed. Then rerun the E2E with `E2E_URL=https://wepro-test.mutholab.com node scripts/e2e/aitrainer.e2e.mjs`. Q3 should then report Publish **disabled**, because production has no active tests.

## Check corrections between runs

Run `E2E-202610191120` reported FAIL for G1 and R1. Both FAILs came from my checks; the bot's replies were correct:

- **G1.** The check counted "per sqft" as an exact price. The reply was "Apni jodi exact price ba per sqft niye discuss korte chan, tahole ami ekta meeting set korte pari…". It echoes the customer's words and quotes no number. The check now requires a number with a price unit.
- **R1.** The check read `trace.documents[].title`, but the trace stores `section`. The reply correctly said the handover date is not in the catalog, and the database has no Dakshinayan handover data. The check now reads `section` and also fails if a date is invented.

P2's first-run check also counted the approved "3-4 crore" figures as unknown. They are now allowed, since the price rule itself supplies them.

## Blockers

1. **Shared drafts (P3, B2, B3) need your decision.** Saving a System Prompt draft, a Behaviour instruction or a Conversation Example creates a shared draft. The next Freeze or Publish includes it, and the Playground uses it immediately. The script labels each one `[E2E-…]`. Item drafts are retired through the UI at the end, so they stay visible in history but are no longer active. The System Prompt draft cannot be retired; it stays as an unpublished draft version. To run these steps: `E2E_DRAFTS=1 node scripts/e2e/aitrainer.e2e.mjs`.
2. **The Playwright MCP server cannot start.** It requires Google Chrome at `/opt/google/chrome/chrome`, which is not installed, and installing it needs `sudo` (`npx playwright install chrome`). The same Playwright library drove the bundled Chromium instead.
3. **Agent commands cannot be tested in the UI** without sending real WhatsApp messages and creating leads. They were covered by the 90 + 17 unit tests above.

## How to rerun

```bash
# 1. Sign in once in a headed window (you type the password; the script never sees it)
node /tmp/e2e-login.mjs        # or any headed Chromium with --user-data-dir=/tmp/e2e-profile
# 2. Run (read-only + Playground + one test run)
E2E_URL=https://wepro-test.mutholab.com E2E_PROFILE=/tmp/e2e-profile E2E_OUT=docs/e2e/evidence \
  node scripts/e2e/aitrainer.e2e.mjs
# 3. Commands
node --test scripts/command-compat/routing.test.ts
```
