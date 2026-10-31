# CR-002: One AI responder on `wa-bot-eyad`, powered by the AI Trainer

| | |
|---|---|
| Status | **Plan for approval. No production setting, row, secret or function has been changed for this record.** |
| Date | 2026-10-29 (revision 2) |
| Scope | `wa-bot-eyad` and the test number `8801604271958`. Dubai is out of scope and must not change. |
| Goal | Exactly one AI responder per conversation (the AI Trainer core), proven first on one test number, then moved into the production Eyad flow. CRM human messaging and the Conversations mirror stay as they are. Every step has a rollback. |
| Code | Working tree on `asad-dev`, uncommitted (section 7) |

Evidence labels: **Confirmed** = read in source, deployed bundle, configuration, logs or read-only SQL today. **Proposed** = a change in this record, not yet made.

## 1. Proven routes (Confirmed)

"WA Relay" is the name of a CRM settings page. It is not the inbound bot. Every route below is proven from code and configuration, not inferred from names.

| # | Route | Proof |
|---|---|---|
| R1 | **Customer to Eyad number, inbound:** Wasender session `Eyad` has one webhook URL, `functions/v1/wa-bot-eyad`. | 124 `eyadbot:<id>` claims in `wa_webhook_events` in 3 days. `wa-bot-eyad/index.ts` `Deno.serve` claims `eyadbot:${key.id}`. |
| R2 | **Mirror into Conversations:** `wa-bot-eyad` forwards the raw body to `wa-webhook?account=eyad` (`forwardToMirror`, fire-and-forget). `wa-webhook` only writes `wa_conversations` / `wa_messages`. It never calls a model or sends. | `wa-webhook/index.ts` has no `askAgent`, no send. Its `<event>:<id>` claims run in step with the `eyadbot:` ones. |
| R3 | **Human agent typing in the CRM, outbound:** browser to `wa_settings.relay_url` = `functions/v1/wa-send`, which calls Wasender `send-message` and writes the `wa_messages` row (sender = the agent's name). No AI is involved. | `src/lib/wa.js` `sendText` / line 383; `wa-send/index.ts` action `send`. 696 OUT rows on Eyad in 7 days have an empty or human `sender_name`. |
| R4 | **Legacy AI reply** (`runFaqAgent` then `askAgent`, OpenRouter) inside `wa-bot-eyad`. It runs when `wa_bot_settings.faq_agent_enabled` is true, there is text, there is no `/t` takeover, and the chat is **not** a trainer test chat. | `wa-bot-eyad/index.ts` the `else if (settings.faqAgentEnabled …)` branch. 110 "AI Agent" replies on Eyad in 7 days, the last at 08:52 UTC today. |
| R5 | **AI Trainer reply** (`runTrainerTestTurn` then `trainer-core.runTurn`) inside `wa-bot-eyad`. It runs when `faq_agent_enabled` and `trainer_test_mode` are both true for `eyad` **and** the number is in `wa_bot_settings.test_numbers`. R4 and R5 are `if / else if`, so one chat never gets both. | `getBotSettings` (`_shared/wa.ts`) sets `trainerTest`; `wa-bot-eyad/index.ts` the `if (… && settings.trainerTest)` branch. 1 "AI Trainer" reply in 7 days (the 07:13 test). |
| R6 | **Scripted flow messages** in `wa-bot-eyad`, sent **before** R4/R5 and regardless of them: welcome (new contact), the Jolshiri bundle on consent, "dedicated agent" on a price question, the agent-yes acknowledgement, `/t` handover, and the lead-assigned notice. | `sendWaText` / `sendWaMessageMirrored` calls at `wa-bot-eyad/index.ts` lines 351-401, 480, 551-553. |
| R7 | **Follow-up nudges:** `pg_cron` job `wa-followup`, `*/2 * * * *`, active, POSTs to `functions/v1/wa-followup`. It sends the profile and agent follow-ups for `preleads.flow_stage` `greeted`, `asked_profile` and `profile_sent`. | `cron.job` row; `wa-followup/index.ts`. |
| R8 | **Auto-forward lead:** after `message_logs ≥ auto_forward_after_messages` (3), if not yet `forwarded` and there is a region command, it calls `wa_create_lead`, which inserts into `leads` and `notifications`. | `wa-bot-eyad/index.ts` `eligible`; `wa_create_lead` writes `preleads`, `leads`, `notifications`. |
| R9 | **Meta CAPI `LeadSubmitted`:** after `wa_create_lead` returns `created` with a `ctwa_clid`, when `meta_capi_enabled` is on. | `wa-bot-eyad/index.ts` `sendMetaCapiEvent`. Broken since 2026-10-21 (section 6). |

**Current configuration (Confirmed):**
- `wa_bot_settings.eyad`: `faq_agent_enabled` true, `trainer_test_mode` **true** (set 07:12 UTC today, audited), and `test_numbers` `8801709665095`, `8801866064500`, `8801604271958`.
- `wa_bot_settings.dubai`: `faq_agent_enabled` false, `trainer_test_mode` false.
- `wa_settings.default`: `relay_url` = `wa-send`, global `faq_agent_enabled` false (overridden per bot).
- `ai_bot_pointers`: both `legacy`. The live bots never read them (verified in the 2026-10-19 reconciliation).

**Answers to "what to disable":**
- **Do not stop `wa-send` (R3).** It is the human-agent channel and has no AI in it. Stopping it would stop every agent's replies and change nothing about the bot.
- **The component to switch off during a test is R4, the legacy AI reply, for the test chat only.** R5 already does that today: in test mode a listed number gets the Trainer and never R4.
- **The component that should host the final unified flow is `wa-bot-eyad`'s AI branch (R4/R5).** It is the only place an AI reply is produced. Inbound (R1), mirror (R2), human sends (R3) and the scripted flows (R6/R7) stay where they are.

## 2. Where double replies can still happen (Confirmed)

R4 and R5 never both run. Two other paths can still put two automated messages in front of a customer:

| Case | What happens today | Fix |
|---|---|---|
| A price question from a returning contact | R6 sends the fixed "dedicated agent" text and **returns**, so the AI branch never runs. One reply. | None needed for the test. For production: decide whether the Trainer or the fixed text owns price questions (phase 3). |
| A new contact's first message | R6 sends the welcome, then R4/R5 also answers. Two messages, by design. The Trainer skips pure greetings (`skipped_greeting_new`). | Keep for now (it is the current product behaviour). |
| A Jolshiri lead after the welcome | R7 sends follow-up nudges every 5 min / 1 h, independent of any AI reply. | Out of scope for the test (the test number is not a Jolshiri ad lead: `flow_stage` null). |
| The same delivery under two events (`messages.upsert` and `messages-personal.received`) | Claimed once by message id (`eyadbot:<id>`), so it is processed once. | None |

## 3. Target architecture (Proposed)

```
Wasender "Eyad" ──webhook──▶ wa-bot-eyad ──forward──▶ wa-webhook ─▶ wa_conversations / wa_messages
                               │
                               ├─ scripted flows (welcome, price-agent, /t, /n, /f, /send, lead notices)   unchanged
                               ├─ auto-forward + Meta CAPI                                                  unchanged
                               └─ AI reply: ONE responder
                                    trainer-core.runTurn (published System Prompt, trainer items,
                                    Knowledge retrieval, brochure checks, guards, ai_turns log,
                                    ai_conversation_state memory, pause on handoff)
CRM composer ──▶ wa-send ──▶ Wasender                                                                       unchanged
pg_cron ──▶ wa-followup                                                                                      unchanged
```

The legacy `runFaqAgent` / `askAgent` stays in the code as the rollback path. It is not deleted until phase 4.

**Selector:** one per-bot setting decides which responder answers a chat. The design reuses what exists:

| Mode | Who gets the Trainer | Everyone else | How it is set |
|---|---|---|---|
| `legacy` (today, test mode off) | nobody | `runFaqAgent` | `trainer_test_mode` false |
| `test` (today, test mode on) | numbers in `test_numbers` | `runFaqAgent` | `trainer_test_mode` true (audited `testnumbers.set`) |
| `trainer` (phase 3) | every Eyad chat | nobody | **new**: `ai_bot_pointers.eyad` set to a published snapshot, which the bot reads (code change C3) |

A chat is answered by exactly one of the two in every mode, because of the `if / else if`.

## 4. Phased migration

### Phase 0. Preserve and prove (no production change)
1. **Done (A2).** Live `wa-bot-eyad` v61 is saved as `supabase/deployed/2026-10-29/wa-bot-eyad-v61/`, the rollback bundle. Details:
   - Downloaded at 09:33:30 UTC. The metadata read before and after was the same (`ezbr_sha256` `7cd431da…`), and the files are byte-identical to the 07:28 UTC download.
   - `sha256sum -c SHA256SUMS` passes for all 7 files.
   - It builds as found. It contains no secrets.
   - See its `README.md` and `DEPLOYMENT.json`.
2. Commit the working-tree changes (section 7): the deployed-only rules ported into git, their tests, the E2E script, and this record.
3. Already done, read-only: Playwright E2E of the Playground and Knowledge (21/22 PASS; the single R2 failure was a provider error and passed 3 of 3 on rerun), and a local replay proving the 600-token cause of the 07:13 failure and the HEAD fix. The cap causes some failures, not all (section 5 correction).

### Phase 1. One-number WhatsApp test (deploy `wa-bot-eyad` only)

Isolation:
- Only `8801604271958` is tested. The other two Eyad test numbers also route to the Trainer while `trainer_test_mode` is on.
- `8801866064500` is in active team use (section 5 correction). Coordinate with its holder before the deploy and keep them informed during the test window, because the deploy changes their replies too.
- Lead auto-creation for each test number, read-only on 2026-10-29 09:45 UTC. The Eyad bot runs with `auto_forward_enabled` false, but test numbers have it forced on, with a threshold of 3:

  | Number | Prelead | Messages | `forwarded` | `ctwa_clid` | CRM lead | Next message auto-creates a lead? |
  |---|---|---|---|---|---|---|
  | 8801604271958 | `898910dc-1ccb-492d-bdc5-e3190d1699d3` | 2 | false | no | none | **Yes** (3rd message, Dhaka, `/fdh`), until P1 |
  | 8801866064500 | `9c36262e-cb6e-4642-a00a-ff3b56e09739` | 90 | **true** | yes | none | No: `forwarded` blocks it |
  | 8801709665095 | `e6060265-643d-4757-bab1-9ecf4585adff` | 25 | **true** | no | 1 (existing) | No |

  `forwarded` blocks only automatic lead creation. A `/f…` command typed on the business phone in any of these chats still calls `wa_create_lead`. For 8801866064500 that would create a new lead with its `ctwa_clid`, and a Meta CAPI attempt that fails today (section 6). Ask the team not to send `/f` commands on test chats during the window.
- Dubai: `trainer_test_mode` false and session logged out (last inbound 2026-10-28 06:15). Not touched.
- Unrelated Eyad customers: still R4 (`runFaqAgent`), the same as today. The deploy changes their path only by the reviewed git fixes (section 5).

Lead auto-creation prevention (needed: the prelead has 2 messages, and the 3rd triggers R8):
- **P1** `update public.preleads set forwarded = true where id = '898910dc-1ccb-492d-bdc5-e3190d1699d3';`
  Only `wa-bot-eyad` reads the flag (the `eligible` check). Nothing in `src/` reads `preleads.forwarded`. This number has no `ctwa_clid`, so R9 cannot fire either.

Stale state:
- **P2** `delete from public.ai_conversation_state where conversation_id = 'eyad:8801604271958@s.whatsapp.net' and bot = 'eyad' and paused = true;`
  This is the simulated thread, paused by the 07:13 fallback. The real phone arrives on the LID thread `eyad:89254134857802@lid` (not paused), and HEAD reads memory key `eyad:8801604271958` (no row). P2 is hygiene, not a blocker.
- **P2b (decision needed, not for 8801604271958):** `eyad:226431162396785@lid` (8801866064500) has been paused since the 2026-10-18 fallbacks. After D1, HEAD skips every Trainer turn on that chat (`skipped_paused`). Either clear it with the holder's agreement (`update public.ai_conversation_state set paused = false, state = jsonb_set(state, '{paused}', 'false') where conversation_id = 'eyad:226431162396785@lid' and bot = 'eyad';`, rollback: set both back to `true`), or accept that this number stays silent on the Trainer after the deploy.

Deploy:
- **D1** `npx supabase functions deploy wa-bot-eyad --no-verify-jwt --project-ref sbqmougcvnplgjgihpwe` from the committed tree.
- Check after deploy: a new version is listed; `eyadbot:` claims keep arriving; the next real customer turn logs no error; there are no `rejected webhook` lines.

Test: section 8.

### Phase 2. Close the gaps before any customer gets the Trainer (code, then deploy `wa-bot-eyad`)

| ID | Change | Why |
|---|---|---|
| C1 | `runTrainerTestTurn` passes `searchDocs` (the same `docSearchPort` the Playground uses) | WhatsApp test turns do not read the indexed Knowledge documents today (`trainer-deno.ts` builds ports without `searchDocs`). The Playground does. They must match. |
| C2 | The Trainer's handoff (`paused`) also writes `ai_handoffs` and a CRM notification | A paused chat is invisible to agents today; the fallback text promises a consultant. |
| C4 | Unit tests for C1-C2 in `trainer-live.test.ts`; the Playwright E2E rerun | Evidence before customers |

### Phase 3. Cut over Eyad to the Trainer (one setting, reversible)

| ID | Change |
|---|---|
| C3 | `wa-bot-eyad` reads `ai_bot_pointers` for `eyad`. Mode `snapshot` routes **every** Eyad chat to `runTurn` with that published snapshot's content (not live drafts). Mode `legacy` keeps today's behaviour. The Quality & Publish gate (at least one passing regression test) already guards `publish`. |
| C5 | Price questions: decide whether the R6 fixed text stays first or the Trainer's price rule answers. The default keeps R6 (no change). |
| — | Cutover = **Publish** in AI Trainer › Quality & Publish. Rollback = **Rollback to legacy** on the same page. Both are audited, and neither needs a deploy. |

### Phase 4. Retire the legacy responder
After two weeks on `trainer` with no rollback: delete `runFaqAgent` / `askAgent` from `wa-bot-eyad`, keep the scripted helpers in `_shared/ai.ts` that `wa-followup` and Dubai still use, and redeploy. Dubai follows the same phases separately, once its session is back.

## 5. What the phase 1 deploy changes for everyone on Eyad (Confirmed by diff)

Live v61 vs the working tree, line-ending normalised:

| Change | Effect |
|---|---|
| Test-number replies use `max_tokens` 2000 at low reasoning effort (`REPLY_LIMITS`) | Fixes the 07:13 failure. Reproduced: v61 at 600 gives `finish_reason length` and `fallback_invalid_output`; HEAD gives the right answer. Test numbers only. The 600 cap makes **some** replies fail, not all (see the correction below). |
| Trainer turns: published System Prompt, brochure checks, memory keyed by phone, pause honoured before every send | Test numbers only |
| `aiStillOn` re-checks the AI switch before each legacy send | Switching AI replies off takes effect mid-turn |
| Settings read failure: automations off (fail closed) | Safer on a database error |
| Test-number match on the full number (`samePhone`), not the last 10 digits | A foreign number sharing the last 10 digits no longer matches |
| `verifyWebhook` | Accepts every request while no webhook secret exists (`wa_secrets.webhook_secret` empty for all 3 rows; no env secret). Do **not** add a secret in this change (CR-001 Appendix B). |
| `x-replay` honoured only for a verified sender | Replay header ignored, since nothing is verified |
| Price, land and consent edge-case fixes, 30 s OpenRouter timeouts | Reviewed in `docs/reports/legacy-bot-reconciliation.md` §13.4; 8 of 8 real price messages gave the same result |
| Deployed-only rules (ad-lead welcome, "which project" prompt) | **Kept**: ported into git, with identical prompt text (section 7) |

**Correction (2026-10-29, after commit `dfa9f55`).** Earlier text said the live bot "would fail the same way" on every test-number reply. That overstated it. The 600-token cap truncates a reply only when the model's hidden reasoning, plus the JSON, runs past 600 tokens. Shorter turns get through. Turns on live v61 (from 2026-10-19 20:03 UTC) that reached the model:

| Turn | Thread | Number | Outcome |
|---|---|---|---|
| `e7f33a2a-834a-4c39-b859-87368686586f`, 07:13:35 | `eyad:8801604271958@s.whatsapp.net` (simulated) | 8801604271958 | `fallback_invalid_output`, `guard_errors ["schema"]`: the case reproduced above |
| `c20c56f9-071e-44b0-aa7f-fe06be93722b`, 09:32:08 | `eyad:226431162396785@lid` | 8801866064500 | `ok` (greeting reply, 1 send) |
| `be69d44d-b811-497b-9df8-adb6b3f68433`, 09:32:47 | same | 8801866064500 | `ok` (1 send) |
| `c6db758f-2d36-490a-9123-79a7bd3a57b0`, 09:35:28 | same | 8801866064500 | `ok` (Nuznan brochure, 2 sends) |

`f05212d7…` (07:12:56) was a pure greeting and never reached the model (`skipped_greeting_new`).
- **On v61:** 1 of 4 model turns failed.
- **On 2026-10-18 (earlier deployed code):** 3 of 7 test-number turns ended `fallback_invalid_output` with `guard_errors ["schema"]`. git shows the 600 cap was added on 2026-10-18 (`ab66552`), but the bundle that was live that day was not saved, so the cause is not proven for those turns.
- The 07:13 evidence and its local replay are unchanged.

**Test number 8801866064500 is in active team use.** A team member chatted with the Trainer on Eyad at 09:32 to 09:35 UTC, while CR-002 was being prepared, and received 4 "AI Trainer" messages, including the Nuznan brochure PDF. Its chat state is **paused**: `ai_conversation_state` row `eyad:226431162396785@lid`, `paused true`, last written 09:35:33 UTC. The pause dates from 2026-10-18. That thread had three `fallback_invalid_output` turns that day (`a56e4257…`, `2142bba6…`, `0e89ad46…`), and a fallback sets `paused: true`. v61 `runTurn` copies the previous state into the next one (`paused: parsed.handoff ? true : a.state.paused`), so the flag survives every later `ok` turn. v61 never checks it before sending, which is why the 09:32 to 09:35 replies still went out. **After the deploy, HEAD does check it.** `isPaused` reads memory key `eyad:8801866064500` (no row), then falls back to the thread row, which is paused. So on HEAD every Trainer turn for 8801866064500 ends `skipped_paused` with no reply, until the row is cleared. The same applies to 8801604271958 only on its simulated JID thread, not on its real LID thread.

Environment (Confirmed, names only): `OPENROUTER_API_KEY` (matches the local key's digest), `WASENDER_API_TOKEN`, `META_CAPI_ACCESS_TOKEN` (invalid, section 6), and the platform `SUPABASE_*`. No new secret is needed for phases 1-3. Unset and not needed: `OPENROUTER_MODEL` (default `anthropic/claude-haiku-5.5`), `AI_TRAINER_COMPANY_ID` (no live stock figures), `AI_TRAINER_EMBEDDING_*` (the model is read from `ai_model_configs`).

Deploy dependencies: migrations 0034, 0035, 0038, 0039, 0043-0047 are applied (their tables and columns exist and are in use). There are none for phase 1. C3 (phase 3) needs no migration: `ai_bot_pointers` and the publish gate exist.

## 6. Meta CAPI is broken (Confirmed, separate from this change)

| Fact | Evidence |
|---|---|
| Every send since 2026-10-21 is rejected | `function_logs`, `wa-bot-eyad` (function `f5d3c910…`): 33 lines today from 02:45 to 07:47 UTC, i.e. 11 leads × 3 retries, each `400 OAuthException code 190, error_subcode 464 "Error validating access token: Sessions for the user are not allowed because the user is not a confirmed user."` |
| Last reported lead | `leads.CAPI_STATUS = 'LeadSubmitted'`, latest `created_at` 2026-10-20 14:46 UTC |
| Missed | 7 days: 80 ad leads, 0 reported. 30 days: 163 ad leads, 111 not reported. Today: 11, 0 reported. Per day, 2026-10-17 to 20 are all OK, and from 2026-10-21 every day is 0 |
| Token | `META_CAPI_ACCESS_TOKEN` last set 2026-10-14 06:11 UTC. The code and the Relay toggle (`meta_capi_enabled` on) are fine. The token's user is blocked by Facebook. |
| Failed sends are not marked | `CAPI_STATUS` is written only on success, so every missed lead is still `NULL` with its `ctwa_clid`, and can be re-sent |

Fix, which needs the owner (it is a credential):
1. In Meta Business Manager, create a **System User** with access to dataset `869790160551668`, and generate a long-lived token with `ads_management` / CAPI permission. Use this rather than a personal token.
2. `npx supabase secrets set META_CAPI_ACCESS_TOKEN=<token> --project-ref sbqmougcvnplgjgihpwe`. Secrets apply to every function without a redeploy.
3. Re-send the missed leads still inside Meta's 7-day window (`ctwa_clid` set, `CAPI_STATUS` null, `created_at > now() - 7 days`), reusing `event_id = lead id` so Meta deduplicates. Older leads cannot be recovered.
4. Check the external hourly "Conversion APIs backfill" (n8n, referenced in `wa-bot-dubai/index.ts`). If it holds the same personal token, it is failing too.

This fix is independent of phases 1-4 and can go first.

## 7. Exact code changes in the working tree (uncommitted)

| File | Change |
|---|---|
| `supabase/functions/_shared/ai.ts` | `leadContext()` (the deployed ad-lead rule); the "No project is known…" line and the "When NO project is in context…" rule in `SYSTEM_PROMPT`, now exported for its test. The text is identical to live v61. |
| `supabase/functions/wa-bot-eyad/index.ts` | Reads `ctwa_clid, wa_ad_id`; the welcome uses `lead.jolshiriLead`; `runFaqAgent` gets `lead.adProject` |
| `supabase/functions/wa-bot-dubai/index.ts` | The same (`ctx`), matching live Dubai v58. **Kept out of the A1 commit and left uncommitted in the working tree.** The Eyad change does not need it: `isJolshiriProject` is still exported, and HEAD's Dubai source bundles unchanged against the new `ai.ts` (checked). It belongs to a separate Dubai change. |
| `supabase/functions/_shared/ai-flow.test.ts` | 4 tests (red before the port, green after) |
| `scripts/e2e/aitrainer.e2e.mjs` | L1 (the live question) and N1 (Test numbers) checks, `E2E_SESSION_USER` sign-in, the Knowledge-retrieved line |

Checks: `ai-flow` 17/17; `test:live` 61/61; `test:trainer` 315/315; `test:commands` 91/91; esbuild bundles of `wa-bot-eyad`, `wa-bot-dubai` and `wa-followup` build.

## 8. Manual WhatsApp test (phase 1)

From `8801604271958` to the Eyad number, send exactly:

> Where is Wecon Nuznan located, and how big is each apartment?

There are no price words (R6 would answer instead) and no greeting (the Trainer skips greetings).

**Expected:** **one** reply from "AI Trainer" within about 15 s, containing **Plot No 001, Road 504C, Sector 16, Jolshiri Abashon, Dhaka** and **2850 sqft**, with no price and no other project.
**Failure signs:** "One of our consultants will get back to you shortly" (fallback), two replies, or any "AI Agent" reply on this thread.

Monitoring (read-only):

| Check | Pass |
|---|---|
| `ai_turns` on `eyad:89254134857802@lid`, newest | `outcome ok`, `guard_errors []`, one `wa_ids`, no `send_errors` |
| `wa_messages`, the same thread, from the send time | 1 IN; 1 OUT from "AI Trainer"; 0 from "AI Agent" |
| `ai_conversation_state` key `eyad:8801604271958` | `paused false`, `active_project` Nuznan |
| `leads` for `%1604271958%` | 0 |
| `preleads` `898910dc…` | `forwarded true`, 3 messages |
| `ai_budget_days` trainer, today | about +$0.01 |
| `wa_bot_settings`, `ai_bot_pointers`, `ai_system_prompt_pointers` fingerprints | unchanged |
| Other Eyad chats in the window | answered by "AI Agent" as before, no errors |
| `function_logs` `wa-bot-eyad` | `trainer test turn … outcome: 'ok'`; no `rejected webhook`, no new error types |

## 9. Rollback

| Step | Rollback | Time |
|---|---|---|
| D1 deploy | Deploy `supabase/deployed/2026-10-29/wa-bot-eyad-v61/` from a scratch copy, following its `README.md`, with `--no-verify-jwt` | about 1 min |
| P1 `forwarded = true` | `update public.preleads set forwarded = false where id = '898910dc-1ccb-492d-bdc5-e3190d1699d3';` | instant |
| P2 deleted row | Re-insert `('eyad:8801604271958@s.whatsapp.net', 'eyad', '{"asked":[],"paused":true,"language":"en","active_source":null,"active_project":null,"first_price_at":{}}', true)` | instant |
| Test mode | AI Trainer › Test numbers › Eyad switch off (audited `testnumbers.set`) | instant |
| Test number | Remove `8801604271958` in WA Relay or AI Trainer › Test numbers | instant |
| Phase 3 cutover | AI Trainer › Quality & Publish › Rollback to legacy | instant |
| Meta token | Set the previous value again (only if the new one is worse) | instant |

## 10. Approval checklist

| # | Action | Production write | Approve? |
|---|---|---|---|
| A1 | Commit the Eyad-scoped working tree on `asad-dev` (no push; the Dubai diff stays uncommitted) | no | ☑ approved 2026-10-29 |
| A2 | Save v61 to `supabase/deployed/2026-10-29/` and commit | no | ☑ approved 2026-10-29 |
| A3 | P1: `forwarded = true` on prelead `898910dc…` | yes, 1 row | ☐ |
| A4 | P2: delete the stale paused state row | yes, 1 row | ☐ |
| A5 | D1: deploy `wa-bot-eyad` only | yes, function | ☐ |
| A6 | Owner sends the test message; Claude monitors (section 8) | (owner) | ☐ |
| A7 | Meta CAPI: owner provides a System User token; set the secret; re-send ≤7-day misses | yes, secret + Meta | ☐ |
| A8 | Phase 2 code (C1, C2) | no, until its own deploy | ☐ |
| A9 | Phase 3 (C3, then Publish) | yes | ☐ |
