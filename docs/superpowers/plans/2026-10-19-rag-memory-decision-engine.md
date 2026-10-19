# AI Trainer: RAG, memory and decision engine

Branch `feat/ai-trainer-mvp`. Local work only: no deploy, no production
migration, no WhatsApp send, both bot pointers stay `legacy`. Extends the
existing design (`docs/superpowers/specs/2026-10-18-wecon-ai-trainer-design.md`,
"the spec"); where the spec already decides something, this plan points to it
rather than restating it.

Status words: **implemented** (code and a test show it), **partial**,
**missing**, **unverified** (code exists but nothing in the repo proves it runs,
or it lives outside the repo).

## 1. Audit

### 1.1 WhatsApp inbound, commands, routing, delivery

| Capability | Status | Where |
|---|---|---|
| Webhook entry, mirror forward, dedupe by message id | implemented | `wa-bot-eyad/index.ts:625-659`, `wa-bot-dubai/index.ts:671-708`, `claimEvent` `_shared/wa.ts:72-82` |
| Webhook authentication | **missing** | no signature check, by comment (`wa-bot-eyad/index.ts:630-638`); `x-replay: 1` skips dedupe (eyad:655, dubai:704) |
| Command vs customer split | implemented | `fromMe && text.startsWith("/")` (eyad:197, dubai:258) |
| Commands run before any AI generation | implemented | command and inbound branches are exclusive (eyad:662-676, dubai:711-716); AI only in `handleInbound` (eyad:376/383, dubai:482/488) |
| Command authorisation (which agent may run which command) | **missing** | any `fromMe` event is trusted; with no webhook auth, a forged `fromMe` payload runs `/t`, `/f…`, `/send…`, `/n` |
| `/t` takeover | implemented | `handleTakeover` eyad:437, dubai:590 |
| `/n` note | implemented | `handleNote` eyad:467, dubai:575; `logNoteActivity` `_shared/wa.ts:411` (company hard-coded `c1`) |
| `/f…` forward and lead create | implemented, mapping unverified | `handleCreateLead` eyad:478, dubai:606; agent map is DB-side (`wa_create_lead`, `wa_agents`, not in repo); snapshot in `scripts/command-compat/fixtures.ts:3-13` |
| `/send…` documents | partial | Eyad only, `handleSendDocs` eyad:586; codes `wa_projects.send_code` (0029); Dubai has none |
| Reply delivery and CRM mirror | implemented | `sendWaMessageMirroredId` `_shared/wa.ts:155-237` (429 retry); fixed 5.5 s gaps, no cross-invocation queue |
| Relay `wa-send` authorisation | **missing** | `send` has no auth (`wa-send/index.ts:80-99`); `set-credentials` trusts a client `userId` (:68) |
| Command routing tests | implemented | `scripts/command-compat/routing.test.ts` (copy of deployed parsers, CC-01..45) |

### 1.2 AI Trainer content, Playground, publishing

| Capability | Status | Where |
|---|---|---|
| Knowledge: projects, facts, rules | implemented (drafts) | `KnowledgeTab.jsx`, `ai_item_save` 0037:257, `validateItem` `trainer-core.ts:88` |
| Behaviour and tone | implemented as `behaviour` items | `aspect` includes `tone` (`trainer-core.ts` `ASPECTS`); no separate Tone object, which is fine: versioned with the snapshot |
| Examples, legacy import | implemented | `BehaviourTab.jsx`, `importPreview`/`importCommit` `trainer-handler.ts:152-201` |
| Playground over drafts or a snapshot | implemented | `playgroundTurn` `trainer-handler.ts:251`, history in 0040 |
| Freeze, stepped test runs, gated publish, rollback | implemented as intent only | `trainer-handler.ts:468-586`; **no bot reads `ai_bot_pointers`**, so publish changes nothing for customers (see the 2026-10-19 investigation) |
| Retrieval | partial | only `full` mode (`SnapshotContent.retrieval`, `trainer-core.ts:131`): everything in scope goes into the prompt; examples are the first 6 by id, not ranked (`buildPrompt` `:274`) |
| Grounding guards | implemented, hardened in phase 1 | `guardReply` `trainer-core.ts:331`; see section 4 |

### 1.3 Model and API configuration

| Path | Status | Where |
|---|---|---|
| Playground | implemented | `ai_model_configs` scope `playground` only (0043:24), key in Vault, host-bound (`playgroundModel` `trainer-handler.ts:340`) |
| Trainer test runs and test-number turns | implemented | server default `env.replyModel` (`trainer-deno.ts:74-80`) |
| Live legacy bot | implemented, separate | `OPENROUTER_MODEL` secret, `_shared/ai.ts:18`; no timeout on its fetch (`ai.ts:30`) |

The Playground model setting does not reach the live bot or test runs. That is
by design (0043:3-6) but means a Playground pass does not prove a test run pass.

### 1.4 Chat history and provider history

| Capability | Status | Where |
|---|---|---|
| Message store | implemented | `wa_conversations`, `wa_messages` (0007:24, :63), unique `wa_id` (:97); RLS off |
| Conversation id | implemented | `${account}:${remoteJid}`; the JID may be `@s.whatsapp.net` or `@lid`, so one customer can have two threads (`wa-webhook/index.ts:208`) |
| `account`, `lid` columns | unverified | used by code, created by no migration in the repo |
| Recent context | implemented | legacy: last 30 rows (`getRecentHistory` `_shared/wa.ts:119`); trainer: last 21, commands dropped (`trainer-live.ts:79`, `buildHistory` `trainer-core.ts:243`) |
| Agent command text in legacy AI history | **bug** | wa-webhook mirrors `/f…` as OUT rows; `getRecentHistory` does not filter them |
| Provider history import | **not available** | the only Wasender call in the repo is `POST /send-message`. Wasender's `GET /api/whatsapp-sessions/{session}/message-logs` returns only messages *sent via the API*, never inbound ones, and only when per-session logging is on |
| Rolling summary, customer preferences | missing | `ai_conversation_state.state` holds project, language, price disclosure, asked questions (`ConvState` `trainer-core.ts:197`) and is written only by test-mode turns |

### 1.5 Schema, RLS, functions, jobs

| Item | Status | Where |
|---|---|---|
| `ai_*` tables | implemented | 0037, 0040, 0043; RLS on, anon revoked |
| `ai_conversation_state`, `ai_turns`, `ai_handoffs` | partial | created (0037:146-184); leases never written, `ai_handoffs` unused |
| pgvector, chunks, `ai_match_chunks` | missing | no `create extension`; spec 4.3 / 5 designs them; migration number 0038 in the spec is now taken |
| Storage | implemented | buckets `wa-media` (0007), `project-media` (0021, anon insert), `finance-media` (0023, private) |
| Core tables `users`, `leads`, `preleads`, `wa_projects`, `wa_agents` and RPCs `wa_upsert_prelead`, `wa_create_lead` | unverified | not created by any repo migration |
| `wa_bump_unread` | unverified risk | SECURITY DEFINER without `search_path`, not revoked from `PUBLIC` (0007:190-205) |
| Background jobs | unverified | `wa-followup` cron exists only as a comment (`wa-followup/index.ts:9-15`); no `cron.schedule` in the repo |
| `supabase/ops/0037_verify.sql` | stale | expects exactly 15 `ai_` tables; 0040 and 0043 make it 18 |
| `supabase/.temp/*` | tracked in git | includes `pooler-url` and `project-ref`; not a secret, but should not be committed |

## 2. Architecture

The spec's shape holds and is kept: one Deno-free core (`trainer-core.ts`) with
ports; content frozen into immutable, checksummed snapshots; every behaviour
change versioned by `CORE_VERSION`. The additions below are modules behind that
core, not a second platform.

- **Retrieval is a port, not a mode switch inside `buildPrompt`.** `runTurn`
  gains `ports.retrieve(query, scope) -> ItemRow[]`. `full` keeps today's
  selection; `vector` calls `ai_match_chunks`. The snapshot fixes which one
  runs and which chunk ids are eligible (spec 4.3 rules 2-5), so rollback still
  reproduces retrieval exactly.
- **Live facts are a tool, never retrieval.** Price and availability come from
  a read-only `lookupInventory(project_ref)` port over `properties`
  (`asking_price`, `units_available`, `unit_statuses`), returned with its read
  time. Documents never state current price or availability; the prompt says
  so and the guard treats a live figure as evidence only when the tool returned
  it in this turn.
- **Memory is three layers, all keyed by a stable customer key.** The key is
  `bot` plus the 10-or-more-digit phone (with country code), not the JID, so
  `@lid` and `@s.whatsapp.net` threads merge. Layers: recent turns (existing),
  a rolling summary (written by a separate model call after N turns, stored
  with the turn range it covers), and typed preferences (budget band, area,
  size, purpose) that only change through a validated tool call.
- **Decisions are tools with server-side validation.** The model may request
  `qualify_lead`, `add_note`, `forward_to_agent`, `handover`. Each request is
  validated (schema, the conversation is not paused, the agent code exists in
  the same mapping the `/f…` commands use), made idempotent by
  `(turn_id, tool)` and audited. Agent commands stay first and unchanged.

## 3. Ordered tasks

Each task is one reviewable change with its own tests. A task that needs a
production migration or a deploy stops for owner approval.

| # | Task | Depends on | Acceptance |
|---|---|---|---|
| 1 | **Grounding guard hardening** (done, section 4) | none | conversation text is not evidence; Bangla digits checked; whole-number match; citations filtered; `CORE_VERSION` 1.1.0 |
| 2 | Retrieval port with `full` adapter; examples ranked by the spec's lexical score instead of id order | 1 | `runTurn` behaviour unchanged except example selection; R0-style fixture (synthetic, 3 languages) reports Recall@5 for `full` |
| 3 | R0 evaluation harness: 60 synthetic queries, Recall@5 and MRR per language, run under Node with a stub embedder | 2 | harness prints metrics; gate thresholds from spec 5.4 asserted for a fixture model |
| 4 | Migration `0044_ai_trainer_chunks.sql` (pgvector, `ai_trainer_chunks`, `ai_match_chunks`), tested in PGlite with its `vector` extension | 3, owner approves pgvector | idempotent; chunks immutable; scope filter applied before ranking; anon has no grants |
| 5 | Chunking and embedding on item save (server side, `ai_item_save` caller), `vector` adapter | 4 | freeze refuses a `vector` snapshot with missing chunks (spec 4.3 rule 6); embed failure falls back to `full` with `ok_retrieval_fallback` |
| 6 | Document ingestion: PDF/text upload to a private bucket, text extraction, one fact draft per section for review | 5 | nothing becomes knowledge without a reviewed draft; extraction stored with source file and page |
| 7 | `lookupInventory` tool over `properties`, read-only, figures returned as evidence for that turn | 1 | a price outside the tool result is refused; stale reads labelled with their time |
| 8 | Customer key and memory layers (summary, preferences) on `ai_conversation_state`, plus the spec's `ai_turn_lease` | 2 | `@lid` and phone threads share memory; a paused conversation gets no reply (turns the existing todo test green) |
| 9 | Decision tools with validation, idempotency and audit | 8 | each tool refuses a paused conversation, an unknown agent code and a duplicate `(turn_id, tool)` |
| 10 | History backfill from `wa_messages` only (the provider has no inbound history) | 8 | paged, deduped by `wa_id`, no import from any other source |
| 11 | Security prerequisites before any live cutover: webhook signature, `wa-send` auth, lock `faq_agent_enabled`/`test_numbers`, atomic publish | none | the todo tests from the 2026-10-19 investigation turn green |

Cutover (bots reading the pointer, spec 10.4) stays out of this plan. Task 11
must land before it.

Status on 2026-10-19 (detail in section 6): 1, 2, 3, 7, 9 (validation and
idempotency; no live executor), 10 done locally. 4 done as migration **0045**
(0044 went to the atomic pointer function). 5 partly: chunking, the vector
adapter and its ports exist, but nothing creates chunks or freezes a
`vector` snapshot yet. 8 partly: customer key and pause enforcement done;
rolling summary and preferences not. 11 partly: webhook check, fail-closed
settings, mid-turn OFF and atomic publish done; `wa-send` auth and the
`faq_agent_enabled` / `test_numbers` column locks not. 6 not started.

## 4. Phase 1: grounding guard hardening (implemented)

Changes in `supabase/functions/_shared/trainer-core.ts`:

- `runTurn` evidence is the snapshot's in-scope items and resolved projects
  only. Before, history and the customer's own message were evidence, so a
  customer who typed "50 lakh" made the bot confirm 50 lakh.
- `guardReply` folds Bangla digits (০-৯) to ASCII. Before, a figure written in
  Bangla digits skipped the number check entirely.
- `guardReply` compares whole numbers. Before, "1" passed because "16" was in
  the address.
- `trace.used_item_ids` keeps only ids the model was shown, so the `uses_item`
  check cannot pass on an invented citation.
- `CORE_VERSION` 1.0.0 to 1.1.0 (spec 6.5): runs certified on 1.0.0 no longer
  certify a publish; re-run the tests on 1.1.0.

Tests: `supabase/functions/_shared/trainer-grounding.test.ts` (5, synthetic
data), added to `npm run test:trainer`. Each was seen failing before its fix.

Known limits:

- A figure that appears anywhere in the in-scope content passes, even if the
  reply attaches it to the wrong thing ("16 crore" passes because of
  "Sector 16"). Closing that needs task 7's typed figures.
- The bot can no longer repeat a number the customer said ("3 bedroom"):
  that reply now falls back to the handoff template. This is stricter on
  purpose; if Playground runs show it too often, allow customer figures only
  when the reply does not pair them with a price or size unit.

Rollback: revert the commit, or restore `trainer-core.ts` and `package.json`
and delete `trainer-grounding.test.ts`. No data or migration is involved; the
bots in legacy mode do not run this code.

## 5. Bots control card with bot selector (implemented, local)

The AI Trainer "Bots" tab now opens on one control card per bot, following the
owner's mockup: customer-reply switch, what customers get, candidate version
and its tests, and Run tests / Publish / Rollback. A bot menu above the cards
defaults to **All Bots** and narrows to Eyad Bot or Dubai Bot. The full WA
Relay checklist stays below, collapsed.

What it shows is derived from real rows only (`src/lib/botControl.js`):

- **Customer replies** is `wa_bot_settings.faq_agent_enabled`, the same column
  WA Relay's "AI reply (FAQ agent)" toggles. A missing row reads "Unknown" and
  the switch is disabled, never "Off". Each change asks for confirmation and
  calls the new `bots.set_replies` action, which checks the Management role,
  changes only that bot's column and writes an `ai_trainer_audit` row
  (entity `bot_replies`). The card never writes `wa_bot_settings` directly.
- **What customers get** says "Legacy FAQ agent" while the bots do not read
  `ai_bot_pointers` (verified in the deployed source, §1.1). A published
  pointer is shown separately as **Not live**. `pointersAreLive` flips this
  once the bots consume published versions.
- **Publish** is enabled only when the newest candidate's latest complete run
  for that bot has no FAIL or INCONCLUSIVE; the server gate still decides.
  **Rollback** is enabled only while the pointer is on a snapshot, and moves
  it back to legacy with a required reason. Both send `expected_snapshot_id`
  (migration 0044) so a concurrent change is refused.
- New actions: `runs.list` (read-only run summaries, no per-test results) and
  `bots.set_replies` (the switch above).

Files: `src/lib/botControl.js`, `src/components/aitrainer/BotControl.jsx`,
`src/components/aitrainer/BotsTab.jsx`, `src/components/aitrainer/aitrainer.css`
(the `.bc-*` block), `supabase/functions/_shared/trainer-handler.ts`
(`runs.list`, `bots.set_replies`), tests below, `package.json` scripts.

Tests:

- `npm run test:botcontrol` (5): filter, today's production state, published
  pointer never labelled live, test-state ladder, unknown settings row.
- `npm run test:ui:botcontrol` (19 checks): All Bots default, both cards, the
  switch writes one bot's column, a cancelled confirm writes nothing, choosing
  Dubai Bot shows one card, Publish and Rollback enable only from data, no
  production action runs without a click.
- Handler tests: `runs.list` (summary fields only, newest first, Management
  only) and `bots.set_replies` (refused for a non-Management account, rejects
  a bad bot or value, changes one column, audited, pointers untouched, 404
  without a settings row).
- The UI flow test also proves the card sends `bots.set_replies` and never
  writes `wa_bot_settings` itself.

Not verified: the design kit's render gates (`verify_states`,
`slop_tells`, `taste_audit`) need a headless browser and could not start on
this machine (`libnspr4.so` missing). No screenshot was taken.

Known limits:

- The card's switch is server-side now, but WA Relay's own checklist still
  writes `wa_bot_settings` with the anon key, and the anon UPDATE grant on
  `faq_agent_enabled` is still in place (§1.5). Closing it needs a migration
  that revokes that column grant (as 0039 did for `trainer_test_mode`) and WA
  Relay moved onto `bots.set_replies`. Not done here: it changes WA Relay.
- `bots.set_replies` reaches production only when `ai-trainer` is redeployed.
  Until then the card's switch returns "Unknown action".

### 5.1 Design review and fixes

Rendered against the real app and production data (every write blocked) at
1366px and 390px, then reviewed by the design critic (verdict REVISE). Fixed:

- **Critical:** a hardcoded green "Live" badge sat beside "Legacy FAQ agent"
  even when AI replies were off. The headline now follows the switch:
  "Legacy FAQ agent" when on, "No automatic answers" when off, "Global WA
  settings" with no per-bot row (the bot then follows `wa_settings`, where a
  missing column counts as on, `_shared/wa.ts` getBotSettings).
- One status badge per card ("AI replies on/off"); the switch reads
  On / Off / Unknown, never "Off" for an unknown state.
- "What customers get" leads (20px); drafts sit in a dashed outline.
- Run tests moved next to the candidate it tests. Why Publish and Rollback are
  disabled is visible text tied by `aria-describedby`, not a tooltip.
- The phone layout stacks the candidate badge, and copy is shorter.
- The shared `.cot-badge.off` (3.8:1) uses `--t2` on these cards; buttons in
  the bar are 44px.
- Cards still load against an `ai-trainer` without `runs.list`; tests then
  read "Test status unavailable" and Publish stays off.

Measured on the render: lowest text contrast 7.72:1, no target under 44px,
no horizontal overflow at 390px, no write attempted. Kit gates (with
receipts): `verify_states` OK (0 element-states measured, it cannot render
JSX), `taste_audit` OK, `slop_tells` 1 MED "pure #000" heuristic, not traced
to any element of the card (the cards set no black text).

Tests now: `test:botcontrol` 7, `test:ui:botcontrol` 25 checks.

Rollback: revert the files above. `BotsTab.jsx` returns to the WA Relay
checklist only; `runs.list` and `bots.set_replies` are unused by anything else.
No data or migration.

## 6. Tasks 2-11: what was built (local, uncommitted, not deployed)

Nothing below reaches a customer today. The live bots still answer with the
legacy `runFaqAgent`; the trainer core runs only in the Playground, test runs
and test-number chats. Each item names its tests; every new test was seen
failing before its fix unless noted.

### Retrieval and evaluation (tasks 2, 3)

- `retrieveContext` / `retrieve` in `trainer-core.ts`: rules and behaviour in
  full, examples ranked by a lexical score (shared tokens plus a project-alias
  bonus, ties by id), top 6. Evidence is what was retrieved, not every item.
  Tests: `trainer-retrieval.test.ts` (8).
- `trainer-eval.ts`: Recall@k, MRR, per-language report and the spec 5.4 gate.
  `npm run eval:retrieval` prints two sets:

  | Set | Overall recall@5 | MRR | Gate |
  |---|---|---|---|
  | shared wording (30, `fixtures/r0-synthetic.ts`) | 1.000 | 0.911 | pass |
  | paraphrase (15, `fixtures/r0-paraphrase.ts`) | 0.800 | 0.373 | **fail** |

  The first set reuses the fact's own words, so it measures little. The
  paraphrase set is the real bar: lexical ranking misses it, which is the case
  for embeddings. Both are synthetic; spec 5.4 asks for 60 real or redacted
  queries before any model is chosen.

### Vector retrieval (tasks 4, 5)

- Migration `0045_ai_trainer_chunks.sql`: `vector` extension, immutable
  `ai_trainer_chunks` tied to `(item_id, revision)`, `ai_match_chunks` that
  filters snapshot chunk ids, model, dimension, bot and project **before**
  ranking. Service role only. `npm run test:0045` (8, PGlite with pgvector).
- `chunksFor`, the `vector` branch of `retrieve`, and the `embed` /
  `matchChunks` ports (`trainer-handler.ts` `vectorPorts`, budgeted). Any
  failure falls back to `full` for the turn and is traced. Tests:
  `trainer-vector.test.ts` (5), `trainer-ports.test.ts`.
- Not built: writing chunks on item save, freezing a `vector` snapshot with
  chunk ids, and a Deno embedder. `freezeContent` still only produces `full`,
  so the vector path is unreachable until those land and R0 passes.

### Live inventory (task 7)

- `trainer-inventory.ts`: counts and price range from
  `properties.variants[].units[]`, the same rules as `src/lib/projects.js`; a
  project with no units reads "no unit data", never "sold out"; a failed read
  is `null`, never zero stock.
- A project item may carry `crm_property_id`. When exactly one linked project
  is resolved, `runTurn` reads it through `ports.inventory` and puts the figures
  and their read time in the prompt and the evidence. Without a read, a stock
  or price figure falls back to a consultant.
- The read is scoped by `AI_TRAINER_COMPANY_ID`; unset means no live figures.
- Tests: `trainer-inventory.test.ts` (5), `trainer-inventory-turn.test.ts` (5).

### Memory and pause (task 8)

- `ai_conversation_state` is now keyed `bot:phone` (`memoryKey`), so a phone
  thread and a `@lid` thread share one memory. Old per-thread rows are still
  read.
- A turn is skipped (`skipped_paused`) when the state is paused or the
  customer's `preleads.takeover` is set (agent `/t`), checked again before each
  send.
- Tests in `trainer-live.test.ts`: the former todo now passes, plus 5 more.
- Not built: rolling summary, typed preferences, the spec's `ai_turn_lease`.

### Decision tools (task 9)

- `trainer-tools.ts`: `qualify_lead`, `add_note`, `forward_to_agent` (only the
  17 existing `/f…` codes, checked against the command fixture), `handover`.
- Strict argument validation. A paused conversation refuses everything except
  `handover`. One run per `(turn, tool)` through `claim`.
- Without an executor, calls are recorded as `proposed` only.
- Tests: `trainer-tools.test.ts` (8), plus a mutation check: removing any of 4
  rules fails a test.
- Not built: the model does not emit tool calls yet, and no executor writes
  CRM rows.

### History backfill (task 10)

- `trainer-backfill.ts` reads only `wa_conversations` and `wa_messages`.
- Every thread whose phone is the same full number is merged in time order.
- Paged by `(wa_timestamp, id)`. Paging by timestamp alone looped forever on
  equal timestamps.
- Deduped by `wa_id`, with agent commands dropped and a size cap.
- Tests: `trainer-backfill.test.ts` (6).

### Security (task 11)

- **Phone matching.** `phone.ts` matches the full number. Before, UAE
  971501234567 matched BD 8801501234567.
- **Settings.** A failed `wa_bot_settings` read turns customer automations OFF;
  agent commands stay ON. A missing row still falls back as before.
- **Mid-turn OFF.** `runFaqAgent` re-reads the AI switch before every send. Both
  OpenRouter calls time out at 30 s.
- **Webhook.** Both bots check `X-Webhook-Signature` against the stored secret,
  the same plain shared-secret contract `wa-webhook` uses (Wasender docs,
  webhook-setup). A mismatch is a 401; with no secret configured the request
  is accepted with a warning, as before. `x-replay` skips dedupe only for a
  verified request.
- **Publish and rollback.** Each is one `ai_pointer_set` transaction (0044)
  with an optional `expected_snapshot_id`. `npm run test:0044` (7).
- Not done:
  - `wa-send` still has no auth.
  - `faq_agent_enabled` and `test_numbers` are still anon-writable.
  - `isManager` still trusts a client-sent user id.

### Before any deploy

1. Apply 0044, then 0045 (0045 needs pgvector approved).
2. Set `wa_secrets.webhook_secret` for eyad and dubai, and confirm Wasender
   sends `X-Webhook-Signature` to each bot URL. With the secret set and the
   header missing, the bots reject all real traffic.
3. Set `AI_TRAINER_COMPANY_ID`, and add `crm_property_id` to project items, or
   no live figures are used.
4. Re-run every regression test on core 1.4.0. Runs certified on an older core
   no longer allow a publish.

### Test results (2026-10-19)

| Suite | Result |
|---|---|
| `test:trainer` | 145 pass |
| `test:live` | 33 pass |
| `test:0037` | 24 pass |
| `test:0044` | 7 pass |
| `test:0045` | 8 pass |
| `test:ui` | pass |
| `test:commands` | 90 pass |
| `test:botcontrol` | 5 pass |
| `vite build` | ok |

A strict `tsc` pass over the Deno-free modules (scratch install, not in the
repo) found no new type errors in the files added here. Its findings in
`trainer-handler.ts` (union narrowing on `llm.chat` results) predate this work.

## 7. System Prompt editor and runtime (implemented, local)

The operator writes each bot's System Prompt in the AI Trainer, tests it on
one message, publishes it, and rolls back to an earlier version. Nothing here
reaches a customer: the live bots still use the legacy FAQ agent.

**Storage** (migration `0046_ai_system_prompts.sql`, not applied):
`ai_system_prompts` keeps every saved version (immutable, one row per save,
`draft` or `published`, max 12,000 characters, sha256). `ai_system_prompt_pointers`
names each bot's published version; a trigger refuses a draft or another
bot's row. RLS on, no anon/authenticated grant. `npm run test:0046` (5).

**Where it sits in the model's instructions** (`buildPrompt`, highest first):

1. Platform safety: never invent a project, price, size, availability or action.
2. Operator instructions: the bot's System Prompt inside
   `<operator_instructions>`, told it cannot override (1), the facts or (7).
3. Catalog and resolved projects.
4. Business rules, then behaviour items.
5. Retrieved facts, then live inventory with its read time.
6. Examples and conversation state.
7. Reply language, no-claim rules and the strict JSON output contract, last.

Customer text never enters the system message; it arrives as the user turn
inside `<customer_message>`. History arrives as prior turns.

**Which prompt a turn uses:**

| Path | Prompt |
|---|---|
| Playground on drafts | the bot's published prompt; the latest draft only when "Latest draft" is chosen |
| Playground on a snapshot | the prompt pinned in that snapshot |
| Test prompt button | the editor's text, unsaved; nothing is stored |
| Trainer test numbers | the bot's published prompt only, never a draft |
| Freeze snapshot | pins each bot's published prompt, so publish and rollback reproduce it |
| Live customer bots | not used (legacy FAQ agent) |

Every turn's trace records `system_prompt: {id, version_no, sha256}` or
`null` (built-in persona), never the prompt text. Playground turns show
"prompt: vN".

**Actions** (`trainer-handler.ts`, Management only, audited):
`prompt.get`, `prompt.history`, `prompt.save_draft`, `prompt.publish` (only
the newest draft, else 409), `prompt.rollback` (published versions of the
same bot, reason required), `prompt.test`.

**UI:** System Prompt tab (`PromptTab.jsx`): bot menu, monospace editor with a
character and token count, unsaved/draft/published status, Save draft,
Publish, Test prompt, and a history list with "Use this" for rollback. The
Playground got a "System Prompt: Published / Latest draft" selector, and its
three dropdowns now use the app's accessible `ui/select.jsx`. The trainer tab
bar scrolls on its own on phones (it used to push the whole page sideways).

**Tests:**

- `trainer-prompt.test.ts` (6): the prompt reaches the model; bot A's never
  reaches bot B; the precedence order above; an operator prompt saying
  "ignore every rule" still sits under safety and before the JSON contract;
  a prompt change changes the model input; the trace has the version, not
  the text.
- Handler (6): drafts versus published, rollback, Playground default versus
  "draft", Test prompt saves nothing, Management only, snapshots pin the
  published prompt.
- Live (2): test numbers get only the published prompt; none means built-in.
- `npm run test:ui:prompt` (21 checks), end to end through the real handler:
  edit, save, an unpublished draft not reaching the Playground, publish, a
  newer draft not changing published behaviour, Test prompt, a second
  publish, rollback restoring the earlier behaviour, Dubai untouched.

Rendered against the real app at 1366px and 390px (prompt reads stubbed
because the deployed `ai-trainer` predates them; every write blocked): no
text under 4.5:1, no horizontal overflow, no write attempted.

**Not tested with a real model:** every test uses a scripted model, so
whether a given prompt makes replies sound more human is untested. The
precedence wording is advice to the model, not enforcement; the grounding
guard and output parser are what enforce facts and format.

**To use it:** apply 0046, deploy `ai-trainer`, deploy the frontend.

Rollback: revert the files above. 0046 is additive; drop the two tables and
two functions to remove it.

## 8. Embedding model, Markdown documents and real vector retrieval (implemented, local)

Nothing here reaches a customer. Migration **0047** is not applied; 0045
(pgvector) is not applied either, and pgvector is available but not enabled
in production.

**Embedding model (Model & API):** a separate section, below the unchanged
chat model. Provider, base URL, model id, vector size and key. Stored as
`ai_model_configs` scope `embedding` with its own Vault key bound to its own
host. The chat key is reused only for the same provider and host
(`reuse_chat_key`). Test connection makes one real embedding request and is
"connected" only when a vector of the saved size comes back. Custom hosts get
the same private-address check as the chat model (`embedWithConfig`).

**Documents (Knowledge):** Markdown is the main format; plain text works;
PDF text is imported as `pdf_text`, one `## Page N` section per page with
text, pages without text listed as warnings, and it must be reviewed before
indexing. The DOCX path and the per-section fact importer from earlier in
this session were removed in favour of whole documents.

Status: draft, reviewed, indexing, indexed, failed, needs_reindex. Only a
reviewed document is indexed. Any edit is a new version back in draft. An
embedding model or size change marks indexed documents needs_reindex, and
`ai_match_doc_chunks` only returns chunks of the indexed version, the saved
model and the query's dimension, for one company. Publish is refused
(`documents_not_indexed`) while any reviewed document is not indexed for the
current model.

**Chunking:** `markdownChunks` splits on headings; each chunk starts with its
heading path ("Wecon Nuznan > Apartment sizes"), lists and table rows stay
whole, long sections split on paragraph or line boundaries under 1,500
characters.

**Runtime:** Playground turns embed the question with the saved model, take up
to 5 chunks scoring at least 0.2, and add them to the prompt as
"Document excerpts" with `[doc:<id>#<n>] title, section`. The excerpts count as
grounding evidence; the trace records chunk id, document, version, section
and score. A failed search is traced and the turn continues on the snapshot.
Test-number turns and the live bots do not search documents yet.

**Measured with real models** (`npm run eval:docs`, OpenRouter, 10 real WECON
project documents from `wa_projects`, 33 chunks, 21 paraphrased questions):

| Retrieval | Scoped to the project: recall@1 | Unscoped (all chunks): recall@5 |
|---|---|---|
| lexical baseline | 0.714 (bn 0.857, banglish 0.571, en 0.714) | 0.952 |
| text-embedding-3-small | 0.571 (bn 0.286) | 0.762 |
| text-embedding-3-large | 0.714 (bn 0.714) | **1.000** |
| hybrid RRF, large + lexical | 0.667 | not measured |

Findings:

- **3-small is worse than the lexical baseline on Bangla** (recall@1 0.286).
  Do not use it.
- **3-large** matches lexical when scoped and beats it unscoped, which is how
  the runtime searches documents today (no project on a document).
- The hybrid did not beat 3-large here; not wired in.
- Unanswerable questions still score 0.30 to 0.52, so a similarity score
  never proves an answer. The grounding guard (a figure must appear in a
  retrieved excerpt) is what stops invented facts; the 0.2 cut only drops
  noise.
- Cost: 1,295 embedding tokens per full run of each model.

21 questions on 10 short documents is a small set; it is enough to reject
3-small, not to certify 3-large.

**Not done:**

- Test-number turns and the live bots do not search documents.
- A failed index has no automatic retry; the operator re-indexes.
- No HNSW index (exact scan; fine below about 10,000 chunks).
- A document cannot be tied to one project from the editor yet.
- No real-provider Playground turn was run end to end: the end-to-end UI test
  uses a deterministic stub embedder against the real handler.

**Tests:** `npm run test:0047` (7, PGlite + pgvector), `trainer-docs.test.ts`
(6), 9 handler tests (config save/load, key reuse rules, real-request test,
dimension mismatch, provider error, review/index/edit cycle, failed index,
model change, publish gate, Playground search, Management only),
`embedWithConfig` (private targets refused), `npm run test:ingest` (9, real
pdf.js), `npm run test:ui:docs` (25 checks end to end).

**To use it:** approve pgvector, apply 0045 then 0047, deploy `ai-trainer`
and the frontend, then save `openai/text-embedding-3-large` (3072) in Model &
API, re-review and index each document.

Rollback: revert the files; 0047 is additive (drop `ai_trainer_documents`,
`ai_match_doc_chunks`, the four new chunk columns and the embedding scope).

### Rollback

Nothing is deployed or applied, so rollback is a revert of the working tree:

- **Restore:** `trainer-core.ts`, `trainer-handler.ts`, `trainer-live.ts`,
  `trainer-deno.ts`, `wa.ts`, `ai.ts`, both bots' `index.ts`, `QualityTab.jsx`
  and the test scripts in `package.json`.
- **Delete:** the new modules (`trainer-inventory`, `trainer-tools`,
  `trainer-backfill`, `trainer-eval`, `phone`), their tests, the fixtures,
  `scripts/eval-retrieval.ts`, `scripts/test-0044.mjs`,
  `scripts/test-0045.mjs`, and migrations 0044 and 0045.
- **If 0045 were ever applied:** `drop function ai_match_chunks; drop table
  ai_trainer_chunks;`. Keep the `vector` extension if anything else uses it.
- **If 0044 were ever applied:** `drop function ai_pointer_set(...)`. The
  handler then needs its pre-0044 version.
