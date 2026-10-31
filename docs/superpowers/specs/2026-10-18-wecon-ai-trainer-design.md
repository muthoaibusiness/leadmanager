# WECON AI Trainer — Design Spec

| | |
|---|---|
| Status | Draft for review. Not approved. No code, migration, extension or deploy may happen before approval. |
| Date | 2026-10-18 |
| Scope | WEPRO CRM (`leadmanager/`), the WhatsApp bots `wa-bot-eyad` and `wa-bot-dubai`, a new Edge Function `ai-trainer`, a new shared module `_shared/trainer-core.ts`, and a new CRM page "AI Trainer". |
| Supersedes | Nothing. `docs/plans/wecon-visual-ai-workflow-plan.md` stays the long-term platform plan; this spec is the near-term product the owner asked for. Security hardening, staging and the workflow engine are out of scope here by the owner's decision of 2026-10-18. |

Evidence labels: **Verified** (checked in this repository or by a read-only probe on 2026-10-18), **Decision** (taken by the owner in this design session), **Proposal** (this spec's design), **Unknown** (must be measured or confirmed).

---

## 1. Goal and success criteria

**Goal (Decision).** Management trains the WhatsApp bot inside the CRM: gives it knowledge, teaches sales behaviour by example, corrects wrong replies, and proves the result before any of it reaches a customer. The bot should discern intent, keep context across a conversation, avoid repeated questions, give the right project information at the right moment, and hand over to the sales team when it should.

**Success criteria.**

1. Management edits project facts, business rules, behaviour instructions and conversation examples as drafts. A draft never changes what a live bot does.
2. In the Playground, Management holds a multi-turn conversation against a draft or any published version and sees, for every reply, which project was resolved, which rules, facts and examples were used, which media actions were emitted, and which guards ran. Nothing is sent on WhatsApp.
3. A wrong reply, from the Playground, from a real WhatsApp conversation, or from a hand-written scenario, can be corrected and saved as a versioned example and, optionally, as a regression test.
4. Publishing is blocked unless every active regression test in scope passes against the exact candidate version.
5. WhatsApp and the Playground run the same core code, the same published snapshot and the same context-building logic. Parity is shown by tests and runtime version stamps (section 6), not asserted.
6. Each bot shows which version it is actually running, and Management can roll either bot back to any earlier published version.
7. No customer receives a reply built from Trainer content until the owner explicitly approves customer activation for that bot (section 13).

**MVP acceptance (required).** The MVP is accepted only when this flow works end to end against the real database: the current Supabase project with migration 0037 applied. No mocked storage, no in-browser state standing in for tables.

1. Add a draft fact and a draft rule in the Knowledge tab. They are stored as `ai_trainer_items` rows with audit rows.
2. Hold a multi-turn Playground conversation on the drafts. The second turn uses context from the first, for example the active project, and the trace shows the draft items used.
3. Mark a reply wrong, save the ideal reply and reason as an `example`, and save it as a regression test.
4. Freeze a candidate snapshot and run the regression set. Results are stored per test with verdicts.
5. With any FAIL or INCONCLUSIVE result, Publish is refused with the failing tests listed. After the content is fixed and a new run passes completely, Publish to one bot succeeds, and that bot's pointer and the Quality page show the new snapshot.

The manual checklist is in section 12.1.

**Out of scope (Decision).** Security audit work, staging/production separation, infrastructure clean-up, a workflow engine, a visual builder, model fine-tuning, automated follow-ups, live-inventory answers. Fine-tuning is reconsidered only after the evaluation data shows prompting and retrieval are not enough.

**Practical note (owner's).** Examples do not retrain the model's weights. The bot improves through retrieved knowledge, behaviour instructions, corrected examples and evaluation.

---

## 2. Decisions taken in this session

| ID | Decision |
|---|---|
| TD-1 | Management only trains, tests, publishes and rolls back. |
| TD-2 | All edits are drafts. Publish is gated: every active regression test in scope must pass. A retired or changed test needs a reason and keeps its audit history. Published snapshots are immutable; rollback to any earlier one is supported. |
| TD-3 | Tests are judged by deterministic checks plus an AI judge. Deterministic checks are authoritative; the judge can fail or leave inconclusive, never rescue (section 7). |
| TD-4 | One shared content set. Each bot (`eyad`, `dubai`) has its own pointer to a published snapshot, so bots move and roll back independently. |
| TD-5 | Corrections come from three sources: Playground replies, real WhatsApp replies (redacted), hand-written scenarios. |
| TD-6 | Handoff pauses the bot for that customer and alerts Management. No lead is created automatically. |
| TD-7 | Temporary Trainer access key, held only server-side, checked by `ai-trainer` before any privileged action. Browser-supplied user ids and roles are never trusted. To be replaced by individual Supabase Auth identities and Management-controlled permissions. |
| TD-8 | Approach A: one shared, Deno-free core module used by both bots and the Trainer, with snapshots stored in the database. Approach B (a separate simulator) and C (bots calling the Trainer over HTTP for every reply) were rejected: B lets two implementations drift; C adds a network hop and a failure point to every customer reply. |
| TD-9 | MVP stays on the current Supabase project. A dedicated AI database is a documented future path only (section 11). |

---

## 3. Current state this design builds on (Verified)

| Fact | Where |
|---|---|
| The FAQ agent is one OpenRouter call. Its tone, style and media rules are hardcoded prompt text. | `supabase/functions/_shared/ai.ts:121-158` |
| `wa_knowledge` (4 rows) and the latest 25 active `wa_message_corrections` (0 rows) are appended to every prompt, live, unversioned. Corrections store the customer's phone. | `_shared/wa.ts:274-285`, migration `0036` |
| Project catalog is `wa_projects` (11 rows, integer identity id), edited live in WA Relay. | `_shared/wa.ts:107-111`, migration `0029` |
| History is the thread's last 10 `wa_messages` rows. Agent `/f` commands and notes are passed to the model as the bot's own words. | `getRecentHistory`, `_shared/wa.ts:115-129` |
| Any model or parse failure becomes silence. Only one media item per turn. | `askAgent`, `ai.ts:177-227` |
| Bot-authored replies are mirrored with `sender_name = 'AI Agent'`. | `_shared/wa.ts:191` |
| Takeover is `preleads.takeover`; the bots skip the agent when it is true. | `wa-bot-eyad/index.ts:313,370`, `wa-bot-dubai/index.ts:408` |
| A Deno-free shared module tested under Node already exists: `finance-core.ts`. | `supabase/functions/finance/index.ts:14-18` |
| `safeEqual` (constant-time compare) exists. | `_shared/wa.ts:394` |
| Admin gate in the UI is `isChatAdmin` (MANAGEMENT or MASTER); WA Relay is `NAV_SCOPES.relay = ['MANAGEMENT']`. | `src/lib/wa.js:172`, `src/lib/constants.js:40` |
| OpenRouter has an embeddings endpoint (`POST /api/v1/embeddings`, answers 401 without a key) and lists `baai/bge-m3` (8,194-token context), `intfloat/multilingual-e5-large` (512), `qwen/qwen3-embedding-8b`, `openai/text-embedding-3-small`, `google/gemini-embedding-001`. | Probe of `https://openrouter.ai/api/v1/embeddings/models`, 2026-10-18 |
| `pgvector` is not installed. | Plan §4.4 (Noted) |

---

## 4. Data model

Two migrations, both additive. Nothing existing is dropped, renamed or retyped. Existing bot behaviour is unchanged until a bot pointer is deliberately moved out of legacy mode (section 4.6).

- `0037_ai_trainer.sql`: every table below except chunks. Applies without pgvector.
- `0038_ai_trainer_chunks.sql`: the `vector` extension and `ai_trainer_chunks`. Applied only after the owner approves pgvector and the retrieval evaluation (section 5.4) selects a model.

All new tables have RLS on with no anon or authenticated policy, following the finance pattern. Only the service role, used by `ai-trainer` and the bots, reads or writes them.

### 4.1 Tables

| Table | Purpose | Key constraints |
|---|---|---|
| `ai_trainer_items` | Every draft content item, by `kind`: `project`, `fact`, `rule`, `behaviour`, `example`. Columns: `id uuid`, `kind`, `revision int`, `status` (`active`, `retired`), `bots text[]`, `project_ref uuid null`, `body jsonb`, `content_hash`, `retired_reason`, timestamps. | `kind` check; `body` must be an object; scope checks (4.4); unique `(kind, content_hash)` where `status = 'active'`. Each write bumps `revision` and writes one audit row in the same transaction. |
| `ai_trainer_item_revisions` | Immutable copy of every item revision: `item_id`, `revision`, full row content. This is what snapshots and chunks reference. | PK `(item_id, revision)`. Update and delete rejected by trigger. |
| `ai_trainer_audit` | Append-only log for items, tests, imports, snapshots, pointers. Columns: `entity`, `entity_id`, `action`, `before jsonb`, `after jsonb`, `reason`, `actor_claimed text`, `auth_method text` (`trainer_key` today), `verified_user_id text null`, `at`. | Update and delete rejected by trigger. `reason` required for retire, test change, rollback, return to legacy. |
| `ai_tests` | Regression cases (section 7.1), with `revision`, `status`, `retired_reason`, `origin` (`playground`, `real`, `handwritten`). | Revisions copied to `ai_test_revisions`, immutable. |
| `ai_rubrics` | Judge rubrics: `key`, `version`, `text`, `criteria jsonb`. | Immutable once inserted. |
| `ai_snapshots` | Frozen content (4.2), `version_no`, `status` (`candidate`, `published`), `checksum`, `core_version_frozen`, `created_by_claimed`, `published_at`, `published_by_claimed`. | `content` and `checksum` immutable from insert. The only permitted update is setting `status = 'published'`, `published_at`, `published_by_*` once, from null. Delete rejected. Trigger recomputes nothing; checksum is verified on every load (4.3). |
| `ai_bot_pointers` | One row per bot: `bot` (`eyad`, `dubai`), `mode` (`legacy`, `snapshot`), `snapshot_id null`, `changed_at`, `changed_by_claimed`, `reason`. | `mode = 'snapshot'` requires a `published` snapshot. Seeded as `legacy` for both bots. |
| `ai_test_runs` | One run: `snapshot_id`, `snapshot_checksum`, `core_version`, `reply_model`, `judge_model`, `prompt_version`, `rubric_key`, `rubric_version`, `status` (`running`, `complete`, `incomplete`, `aborted`), counts, cost. | Finalised once; then immutable. |
| `ai_test_results` | Per test revision per run: input conversation, reply, emitted media actions, handoff flag, trace, deterministic results, judge attempts and verdict, final verdict. | Update and delete rejected. |
| `ai_conversation_state` | Per WhatsApp conversation: active project and its source, language, first-price disclosed time per project, questions already asked, `paused`, last snapshot used, `lease_turn_id`, `lease_until`, revision. | PK `conversation_id`. Optimistic revision check on write. Lease taken only through `ai_turn_lease` (6.3.1). |
| `ai_handoffs` | One row per handoff: `conversation_id`, `bot`, `reason`, `turn_id`, `status` (`open`, `closed`), `notify_status` (`pending`, `sent`, `failed`), `notify_attempts`, `notify_last_error`, `customer_msg_status` (`pending`, `sent`, `failed`, `skipped`), timestamps. | Unique `(conversation_id)` where `status = 'open'`, so a second handoff for the same conversation returns the open one (6.3.3). |
| `ai_budget_days`, `ai_budget_reservations` | Daily budget per pool (`trainer`, `live`): `limit_usd`, `reserved_usd`, `spent_usd`. Reservations: `pool`, `day`, `estimate_usd`, `actual_usd`, `status` (`reserved`, `settled`, `released`), `created_at`. | Changed only through `ai_budget_reserve`, `ai_budget_settle`, `ai_budget_release` (section 9). |
| `ai_turns` | One row per bot turn in snapshot mode (the "what the bot actually used" record): bot, conversation id, snapshot id and checksum, `core_version`, model, used item ids, guard results, outcome (6.6), message ids, cost, timestamps. | Insert at turn start, one final update, then immutable. |
| `ai_trainer_imports` | One report per legacy import: per source row, `imported` (with kind and new item id), `rejected` (with reason) or `duplicate` (of which item). | Immutable. |
| `ai_trainer_chunks` (0038) | `id`, `item_id`, `item_revision`, `chunk_no`, `chunk_text`, `bots text[]`, `project_ref`, `embedding_model text`, `embedding_dim int`, `embedding vector(<dim>)`, `text_sha256`. | Unique `(item_id, item_revision, chunk_no, embedding_model)`. Update and delete rejected. FK `(item_id, item_revision)` to `ai_trainer_item_revisions`. |

### 4.2 Snapshot content and isolation

A snapshot copies content by value. It never points at a mutable row.

```json
{
  "schema": 1,
  "projects": [{ "item_id": "…", "revision": 3, "body": { "name": "Wecon Nuznan", "…": "…" } }],
  "items":    [{ "item_id": "…", "kind": "rule", "revision": 2, "bots": ["eyad","dubai"], "project_ref": null, "body": { "…": "…" } }],
  "retrieval": { "mode": "full", "embedding_model": null, "embedding_dim": null, "chunk_ids": [] },
  "model_config": { "reply_model": "anthropic/claude-haiku-5.5", "max_tokens": 600 },
  "prompt_version": "p1",
  "rubric": { "key": "sales-default", "version": 1 }
}
```

Isolation rules:

1. **Bodies are inlined.** Projects and items are copied in full at their frozen revision. Editing a draft afterwards creates a new revision and cannot change any snapshot.
2. **Retrieval is pinned to frozen chunks.** In `vector` mode, `chunk_ids` lists exactly the chunks of the frozen revisions, embedded with the snapshot's `embedding_model`. Retrieval (`ai_match_chunks`) filters `id = any(snapshot.chunk_ids)` before ranking, so a published snapshot can never return a chunk from a newer draft revision or from a different embedding model.
3. **Chunks are immutable and never deleted,** so every chunk a snapshot lists still exists.
4. **Query embeddings use the snapshot's model.** If that model is unavailable at the provider, retrieval falls back to `full` mode for that turn (6.6) with an alert. Content stays identical; only selection widens.
5. **Rollback reproduces content and retrieval scope exactly,** because the snapshot carries both by value or by immutable id. Behaviour also depends on the core version; rollback rules for that are in 6.5.
6. **Freeze validation.** A candidate is refused if: any item references a project not included in the snapshot; any `vector`-mode item revision lacks chunks for the chosen model; any item fails its schema; two active project items share an alias.
7. **Project scope of a snapshot.** Every active `project` item enabled for at least one bot is included. A project not in the snapshot does not exist for that bot.

### 4.3 Checksum

`checksum = sha256(canonicalJson(content))`, where `canonicalJson` sorts object keys recursively, keeps array order, and emits no whitespace. Both functions live in `trainer-core.ts`, so the Trainer and the bots compute it identically.

- Computed at freeze; stored with the snapshot.
- Recomputed on every snapshot load, by the bots and the Trainer. A mismatch is a hard failure (6.6).
- Test runs record the checksum they ran against. Publish requires a complete, all-pass run with `snapshot_checksum = snapshot.checksum` (section 7.5).
- `chunk_set_sha256` (sha256 over the sorted list of `chunk_id:text_sha256`) is verified at freeze time and stored in `retrieval`; chunk immutability is enforced by trigger.

**Limit.** A database owner can disable triggers. Closing that waits for the Supabase Auth and RLS work outside this spec.

### 4.4 Scope: validation and resolution

- `bots` is a non-empty subset of `{eyad, dubai}`. "Both" means both values; there is no magic string. Server-side validation rejects anything else, and a check constraint repeats it.
- `project_ref` is null (company-wide) or the id of an active `project` item. `project` and `behaviour` items must have null `project_ref`. Facts, rules and examples may be either.
- An item applies to a turn only when `bot = any(item.bots)` and (`project_ref is null` or `project_ref = any(resolved_projects)`).
- Retrieval applies the same filter in SQL before similarity ranking (`ai_match_chunks(snapshot_id, query_vec, bot, project_refs[], k)`), so similarity can never pull another project's content.
- When no project is resolved, the context holds company-wide items plus a catalog summary (names and regions only). Project facts and media are not available until a project is resolved.
- The output validator rejects any media action or fact citation for a project that was not resolved in that turn.

### 4.5 Item schemas (summary)

Validated in `trainer-core.ts` on every write, with one JSON Schema per kind.

| Kind | Body |
|---|---|
| `project` | `name`, `aliases` (`bn`, `banglish`, `en` arrays), `region`, `type`, `address`, `size_text`, `tags` (for example `jolshiri`), `media` (`photos[]`, `floor_plans[]` as `{url, label}`, `brochure`, `map_image`, `video`), `send_code`, `legacy_wa_project_id`. A floor plan without a label is allowed but flagged incomplete. |
| `fact` | `topic`, `text`, `source` (free text: brochure, management, website), `languages` covered. |
| `rule` | `name`, `when` (plain-language trigger), `must` and `must_not` (plain-language), `parameters` (typed, for example `land_team_contact`, `price_range_text`), `priority`. Rules are always included in full, never retrieved by similarity. |
| `behaviour` | `aspect` (`tone`, `language`, `greeting`, `discovery`, `pricing`, `objection`, `meeting`, `handoff`), `instruction`, optional `do` and `dont` example lines. Always included in full. |
| `example` | `conversation` (turns, redacted or synthetic), `original_reply` (optional), `ideal_reply`, `reason`, `source` (`playground`, `real`, `handwritten`), `source_ref` (redacted conversation hash or run id), `language`. Retrieved by similarity in `vector` mode; the most relevant few in `full` mode (5.2). |

### 4.6 Legacy mode (temporary compatibility)

- Both pointers start as `mode = 'legacy'`. In legacy mode a bot runs today's exact code path (`askAgent` with live `wa_projects`, `wa_knowledge`, `wa_message_corrections`). The Trainer does not change that path.
- The UI labels legacy mode "Legacy: unversioned live reads, not a published version" and never shows a version number for it.
- Legacy turns do not write `ai_turns` rows, so they cannot be mistaken for snapshot turns. The Quality page shows, per bot, the pointer (intent) and the latest `ai_turns` row (fact).
- Leaving legacy mode is a gated publish. Returning to legacy is an audited emergency action that needs a reason.
- Legacy mode, and the legacy prompt path, are removed by a later change once the owner declares the cutover complete.

### 4.7 Legacy import

A wizard in the Knowledge Studio (`import.preview`, then `import.commit`):

- `wa_projects` rows become `project` items (drafts). Floor plans pair with `floor_plan_labels` by position; extra plans get no label and are flagged.
- Each `wa_knowledge` row gets a proposed kind (`rule`, `behaviour` or `fact`) and proposed parameters. Management confirms, changes or rejects each row. Nothing is imported without a decision.
- `wa_message_corrections` rows become `example` items after redaction (section 8). A row that fails the redaction check is rejected.
- Duplicates are detected by `content_hash` and reported, not inserted.
- The report (`ai_trainer_imports`) lists imported, rejected and duplicate rows with reasons. The legacy tables are not changed.

---

## 5. Retrieval and embeddings

### 5.1 Modes

| Mode | What reaches the prompt | When |
|---|---|---|
| `full` (default) | All in-scope rules and behaviour; all in-scope facts of the resolved projects plus company-wide facts; examples ranked by a deterministic lexical score (shared tokens and aliases), top 6. | Default for every snapshot until an embedding model passes 5.4. With 11 projects the facts fit in the prompt. |
| `vector` | Rules and behaviour in full (never retrieved by similarity); facts and examples by `ai_match_chunks`, top-k per kind, scope-filtered first. | Only after 0038 is applied and a model passes 5.4. |

The mode is part of snapshot content, so it is tested and published like everything else.

### 5.2 Chunking

- One chunk per fact. Examples: one chunk per example (the last customer turn plus ideal reply). Project items: one chunk per section (overview, location, media list).
- Maximum chunk length 400 tokens, below the smallest candidate context (512 for `multilingual-e5-large`).
- Chunks are created when an item revision is saved (in `vector` mode deployments) and are immutable.

### 5.3 Embedding model requirements

- Multilingual, with Bangla script, Banglish (Bengali in Latin script) and English in one vector space.
- Fixed output dimension, stored as `embedding_dim`. The `vector(<dim>)` column type fixes the dimension, so a model with another dimension needs its own column or table and a re-embed. Vectors are L2-normalised and compared by cosine distance.
- The exact provider model id is stored on every chunk and in the snapshot. Query and document embeddings must come from the same model id.
- Candidate dimensions and contexts are to be confirmed against the provider at selection (Unknown until then): `baai/bge-m3` (1,024, context 8,194), `intfloat/multilingual-e5-large` (1,024, context 512, needs `query:` and `passage:` prefixes), `qwen/qwen3-embedding-8b` (dimension Unknown), `openai/text-embedding-3-small` (1,536).
- Exact scan at first. Deliberate simplification: add an HNSW index above about 10,000 chunks; HNSW in pgvector supports at most 2,000 dimensions, which rules out large-dimension models for indexed search.

### 5.4 Retrieval evaluation set R0 (gate for `vector` mode)

- **Content.** 60 queries: 20 Bangla script, 20 Banglish, 20 English. Spread across intents (price, location, media, size, amenities, land offer, availability, greeting) and at least 6 projects. Written by Management or drawn from redacted real messages. Each query lists its relevant item ids.
- **Metrics.** Recall@5 and MRR, overall and per language, with scope filtering applied.
- **Gate.** Recall@5 ≥ 0.90 overall and ≥ 0.85 for each language. Below that, snapshots stay in `full` mode.
- **Selection.** `baai/bge-m3` is a candidate, not a choice. The model with the best per-language minimum that passes the gate is proposed to the owner with its cost, and only then is 0038 applied.
- **Cost.** About 60 queries plus a few hundred chunks per model, under $0.01 per model at listed prices (Unknown until measured).

---

## 6. One reply path for WhatsApp and the Playground

### 6.1 Shared core

`supabase/functions/_shared/trainer-core.ts` has no Deno dependency and is tested under Node, as `finance-core.ts` is. It exports `CORE_VERSION`, `canonicalJson`, `checksum`, `freezeContent`, the item schemas, `buildContext`, `resolveProject`, `buildPrompt`, `validateOutput`, `resolveMedia` and `runTurn`.

```
runTurn({ snapshot, bot, inbound, history, state, adContext, ports }) →
  { reply, media[], handoff, stateNext, trace, outcome }
```

`ports` supplies the only environment-specific functions: `callModel`, `embed`, `matchChunks`, `now`. Both callers pass real implementations of these. The difference between WhatsApp and the Playground is only the **sink** that receives the result.

### 6.2 Turn steps

| Step | Behaviour |
|---|---|
| 1 Verify | Recompute the snapshot checksum. Mismatch: hard failure (6.6). |
| 2 Context | `buildContext` takes history rows and state. It drops agent commands (`/…`) and agent notes, labels human-sent rows as "sales agent", keeps the last 20 turns, and merges the inbound burst. State supplies the active project and its source, language, first-price disclosure per project, and questions already asked. |
| 3 Pre-checks | Deterministic lexicons (Bangla, Banglish, English) for greeting-only and "wants a person". Greeting-only from a returning contact: no reply, no model call. "Wants a person": handoff. |
| 4 Project | Precedence: an alias named in this message; the active project from state (30-day limit); the ad project only when the event is a real ad and the ad text maps to exactly one project; otherwise none. Generic words never resolve a project alone. |
| 5 Retrieve | Per snapshot `retrieval.mode` (5.1), scope-filtered (4.4). |
| 6 Prompt | `buildPrompt(snapshot, context, retrieved)`, versioned by `prompt_version`. Customer text is delimited as data. |
| 7 Model | One call with the snapshot's `model_config`. Expected output: `{intent, project_ref, language, reply, media[], handoff, asked[], used_item_ids[]}`. |
| 8 Guards | `validateOutput`: schema; `project_ref` and media must exist in the snapshot and match the resolved project; no refusal phrase; no claim that an action happened; every number must appear in the evidence or a rule parameter; script matches language. On failure: one re-ask with the errors, then the fallback template (6.6). |
| 9 Media | `resolveMedia` from the snapshot before the text is final. A requested floor without a label match leads to a clarifying question, never plan 1. A missing asset means the text must not promise it. |
| 10 State | `stateNext`: active project, language, first-price disclosure, questions asked. |

### 6.3 Sinks

| Sink | Used by | Does |
|---|---|---|
| `whatsapp` | `wa-bot-eyad`, `wa-bot-dubai` in snapshot mode | Inserts the `ai_turns` row at start; sends text, then media, 5.5 s apart, through `sendWaMessageMirrored`; applies handoff (`preleads.takeover = true` plus one Management notification per handoff); writes `ai_conversation_state` with its revision check; finalises `ai_turns`. |
| `capture` | `ai-trainer` (Playground, test runs) | Returns the result and trace. Sends nothing, writes no conversation state, never touches `preleads` or notifications. Playground state lives in the session object, which has the same structure as `ai_conversation_state`. |

#### 6.3.1 One turn at a time per conversation

Before any model call, the WhatsApp sink calls `ai_turn_lease(conversation_id, turn_id, 90 s)`. It is a single SQL statement and is atomic. It succeeds only if the conversation is not paused and no other turn holds an unexpired lease. If it fails, the turn ends as `skipped_busy` or `skipped_paused`: no model call and no message. This stops two simultaneous webhooks for one conversation from producing two replies, or a reply after a pause.

The pause check runs twice: once in the lease, and again immediately before each send, from `ai_conversation_state.paused` and `preleads.takeover`. A pause applied mid-turn (by `/t`, by another turn's handoff, or by a human) stops the remaining sends of the current turn.

#### 6.3.2 Pause is idempotent

`ai_pause(conversation_id, phone, reason, turn_id)` is one database function and one transaction. It:

- sets `ai_conversation_state.paused = true`;
- sets `preleads.takeover = true` for the phone;
- inserts the `ai_handoffs` row, or returns the existing open one (unique open handoff per conversation);
- releases the lease.

Calling it again returns the same open handoff and changes nothing. The bots already skip the agent when `preleads.takeover` is true, so the legacy path honours the pause as well.

#### 6.3.3 Handoff order

1. **Pause first** (`ai_pause`). If the pause fails, it is retried once. If it still fails, the turn sends nothing further, outcome `handoff_pause_failed`, High alert. The bot never keeps talking because a pause failed.
2. **Notify Management second.** Insert one `notifications` row per Management user for the open handoff, idempotent per handoff id. The result is recorded on `ai_handoffs.notify_status`.
3. **Message the customer last,** choosing the template by the notification result:
   - notification `sent`: the handoff template may say a consultant will contact them soon;
   - notification `failed`: a neutral template that names no person and claims no notification ("thank you, we will get back to you"). The Quality page lists the failure.
   No template ever says the team or a consultant "has been informed".
4. **Retry.** A failed notification is retried by the next `status` call from the Trainer and by every later inbound turn of that conversation, up to 5 attempts in total. It is never retried by the customer-facing path in a loop. While a handoff is open, the conversation stays paused, so retries cannot cause bot replies.
5. **Unpause** only by a person: the existing `/t` flow, a Resume action on the Quality page (audited, with a reason), or closing the handoff.

### 6.4 Parity tests

Each fixture runs through the real bot handler and the real `ai-trainer` handler with the same snapshot and the same scripted `callModel` and `embed` stubs. Assertions per fixture:

- the assembled model request (messages and parameters) is byte-identical;
- the result (`reply`, `media`, `handoff`, `stateNext`, `outcome`) is identical;
- the sinks receive identical results and differ only in sink type.

| Fixture | Covers |
|---|---|
| PT-01 | Project named by Bangla-script alias |
| PT-02 | Project named by Banglish alias with a misspelling |
| PT-03 | Active project carried from state, customer says "this project" |
| PT-04 | Ad context mapping to exactly one project |
| PT-05 | Ad context matching two projects: no project resolved, clarifying question |
| PT-06 | Organic contact, price question, no project: asks which project, no range |
| PT-07 | Returning contact whose state already has a first-price disclosure: meeting offer only |
| PT-08 | Greeting-only from a returning contact: no model call, no reply |
| PT-09 | Media: labelled floor plan; unlabelled floor (clarify); missing brochure (no promise); "all floor plans" |
| PT-10 | Validation failure: invalid JSON, then re-ask, then fallback template |
| PT-11 | Guard failure: refusal phrase and action claim replaced |
| PT-12 | Handoff: customer asks for a person |
| PT-13 | Retrieval fallback: embedding port fails, `full` selection used and logged |
| PT-14 | Model failure: fallback plus handoff, outcome recorded |

The core tests run under Node. The handler tests need Deno, which is not installed on this machine (Verified); the plan's earlier phases used a checksum-verified Deno download.

### 6.5 `CORE_VERSION`

- **Pinning.** `CORE_VERSION` is a string constant in `trainer-core.ts` (for example `"1.0.0+sha256:<first 12 hex of the file>"`). A Node test computes the file's hash and fails if the suffix does not match, so the constant cannot go stale. Any behaviour change bumps the number.
- **Where it is checked.**
  - Each bot answers `GET ?health` with `{ core_version, mode_eyad, mode_dubai }`, with no customer data. `ai-trainer` fetches both bots' health before publish and rollback.
  - Every `ai_turns` row and every test run stamps `core_version`.
  - A snapshot is **certified** for a core version when it has a complete, all-pass test run on that core version.
- **Rules.**
  1. Publish to a bot is allowed only if the snapshot is certified for the bot's live `core_version` and the Trainer's `core_version` equals it.
  2. A bot in snapshot mode serves AI replies only if its snapshot is certified for the bot's own `core_version`. Otherwise the turn is held (6.6): no AI reply, handoff notification, High alert.
  3. Rollback to a snapshot is immediate if that snapshot is certified for the bot's current `core_version`. Otherwise the Trainer first runs its tests on the current core.
- **Safe rollout of a core change. One bot at a time.**
  1. Deploy `ai-trainer` with the new core. The bots keep their bundled old core.
  2. Re-run the tests of every snapshot a bot points at, on the new core. Fix and republish if anything fails.
  3. Deploy the **first** bot only. Check `GET ?health` shows the new core version and the expected mode. Send scripted messages from a test number and confirm the `ai_turns` rows show the expected snapshot, checksum and core version.
  4. Watch the first bot for at least 24 hours with the agent on for test numbers only. No held, failed or interrupted outcomes may appear.
  5. Repeat steps 3 and 4 for the second bot.
  6. Rollback at any step: redeploy that bot's previous function tag (minutes), or set its pointer back to its previous snapshot or to `legacy` (seconds, audited). Snapshots certified on the old core stay valid.
  7. Each bot deploy and each customer activation needs the owner's explicit approval at that time (section 13).
- **A bot in legacy mode** does not run `trainer-core` at all, so a core change cannot alter its behaviour. It still ships the new core in its bundle, ready for its own cutover.

### 6.6 Failure handling

No failure is silent. Every snapshot-mode turn ends with an `ai_turns.outcome`, and no text claims an action that has not succeeded.

| Failure | Behaviour | Outcome |
|---|---|---|
| Snapshot load fails, or checksum mismatch | No AI reply. Handoff notification so a person answers. High alert. The bot stays in snapshot mode; it never switches to legacy by itself. | `held_snapshot_error` |
| Bot core not certified for its snapshot | Same as above | `held_uncertified` |
| Embedding call fails or model unavailable | `full` selection for this turn, logged in the trace, Medium alert if repeated | `ok_retrieval_fallback` |
| OpenRouter timeout, 5xx or 429 | One retry after 2 s. Then the fallback template ("a consultant will reply to you shortly", in the customer's language, no claim of a specific action) and handoff. | `fallback_model_error` |
| Model output invalid after one re-ask | Fallback template and handoff | `fallback_invalid_output` |
| Media asset missing in the snapshot | Text is generated without promising media | `ok` with `media_missing` in the trace |
| Media send rejected by Wasender | One retry on 429 after 5.5 s. Then a short follow-up: the file could not be delivered and a consultant will send it. Handoff notification. | `media_send_failed` |
| Text send fails | One retry on 429. Then no further sends for this turn, High alert | `send_failed` |
| Notification insert fails | Recorded on `ai_handoffs` (`notify_status = failed`, error, attempt count). The customer gets the neutral template (6.3.3). Retried later, never in a loop, up to 5 attempts. The Quality page lists it. | `handoff_notify_failed` |
| Pause (`ai_pause`) fails | One retry. Then no further sends in this turn, no customer handoff message, High alert. The next inbound turn runs `ai_pause` again before anything else and sends nothing if it fails again. | `handoff_pause_failed` |
| Lease not acquired | No model call, no message | `skipped_busy` or `skipped_paused` |
| Budget reservation refused | No model call. Fallback template and handoff, as for a model error. | `fallback_budget` |
| Function dies mid-turn | The `ai_turns` row stays `started`. Rows older than 2 minutes show as "interrupted" in the Quality page. | `interrupted` |

Deliberate simplification: turns are processed inside the webhook request, as today, with no job queue. Add a queue if `interrupted` turns appear regularly.

Alerts in this MVP are rows in `notifications` for Management users, at most one per conversation per handoff, plus a Quality page list. No external alerting.

---

## 7. Test and judge contract

### 7.1 Test case

| Field | Meaning |
|---|---|
| `title`, `tags` | For finding and grouping tests |
| `bots` | Which bots the test applies to (subset of `{eyad, dubai}`) |
| `setup` | Ad or organic context (with ad text), new or returning contact, initial conversation state |
| `conversation` | Turns before the target turn, synthetic or redacted |
| `target` | The customer message under test |
| `checks[]` | Deterministic checks (7.2) |
| `ideal_reply` | Reference answer for the judge |
| `judge` | `rubric` (key and version) or `none` |
| `exact_required` | Only with a stated reason; enables exact-text checks |
| `origin`, `source_ref` | `playground`, `real` or `handwritten`, with a redacted reference |
| `revision`, `status`, `retired_reason` | Changing or retiring a test needs a reason; results attach to a test revision |

### 7.2 Deterministic checks

Mandatory checks run on every test automatically:

- output schema valid;
- no refusal phrase (Bangla, Banglish, English lexicon);
- no claim of a completed action;
- every number in the reply is present in the evidence or a rule parameter;
- reply script matches the reply language.

Per-test check types:

| Check | Passes when |
|---|---|
| `language_is` | Detected reply language equals the value (`bn`, `banglish`, `en`) |
| `no_reply` | The turn produced no reply (greeting-only) |
| `project_resolved_is` | The resolved project id equals the value, or none |
| `asks_clarification` | The model output marks a clarifying question |
| `media_action` | The emitted media actions (from the capture sink, not the text) include the given type, project and floor label or count |
| `no_media` | No media action emitted |
| `handoff` | Handoff flag equals the value |
| `must_contain_semantic` | Left to the judge; listed for the rubric |
| `must_contain_exact`, `must_not_contain` | Exact substring checks. `must_contain_exact` only with `exact_required`. |
| `uses_item` | `used_item_ids` includes the given item |
| `max_length` | Reply length within the limit |

A failed mandatory or per-test check fails the test. The judge is then not called, and the result records "judge skipped: deterministic failure".

### 7.3 AI judge

- **Inputs.** The conversation, the target message, the reply, the emitted media actions, the ideal reply, and the versioned rubric. No phone numbers or names.
- **Criteria** (rubric `sales-default` v1): answered the customer's actual question; used conversation context and did not re-ask known facts; correct and supported information; natural tone in the customer's language; moved the sale forward (discovery question, meeting offer) when appropriate.
- **Output.** `{ verdict: "pass" | "fail" | "inconclusive", criteria: { <name>: 1-5 }, rationale }`, validated by schema.
- **Model.** `judge_model`, configured separately from the reply model and recorded on the run.

### 7.4 Final verdict and variability

| Deterministic | Judge | Final |
|---|---|---|
| Any fail | not called | **FAIL** |
| All pass | `judge: none` | **PASS** |
| All pass | pass | **PASS** |
| All pass | fail | **FAIL** |
| All pass | inconclusive, invalid output, or provider error | **INCONCLUSIVE** |

Variability handling, without promising determinism:

- A judge **attempt** is one judge call. Inside an attempt, output that fails its schema is re-requested once, and a provider error is retried once after 2 s. If either is still failing, that attempt's verdict is inconclusive. A judge error is never treated as a pass and never skipped.
- When the first attempt's verdict is `fail` or `inconclusive`, two more attempts run (3 total). Two or more `pass` gives pass; two or more `fail` gives fail; anything else gives inconclusive. All attempts are stored.
- The reply itself is generated once per test per run. A test can set `samples: 3`, meaning three replies are generated and all three must pass. Management uses this for behaviour that has proved unstable.
- The judge can never override a deterministic failure.

### 7.5 Publish gate

Publish of snapshot S to bot B is allowed only when all of the following hold:

1. A run exists with `status = complete`, `snapshot_checksum = S.checksum`, `core_version` equal to B's live core version and to the Trainer's, and the current rubric version.
2. The run covers every active test whose `bots` include B, at each test's current revision.
3. Every result in that run is PASS. Any FAIL or INCONCLUSIVE blocks publish.
4. Freeze validation (4.2) passed.

Management cannot override the gate. The remedies are: fix content and re-run; re-run to resolve an inconclusive result; or change or retire a test with a recorded reason, which creates a new revision and requires a new run.

### 7.6 What each run records

Input conversation (redacted or synthetic), snapshot id and checksum, `core_version`, reply and judge model ids, `prompt_version`, rubric key and version, deterministic results, every judge attempt with verdict and rationale, final verdict, emitted media actions, trace, token counts, cost and timestamps. No phone numbers or customer names.

### 7.7 Long runs

A run is processed in steps of at most 5 tests per `runs.step` call, so no request approaches the Edge Function wall-clock limit. The browser drives the steps and shows progress. A run left unfinished stays `incomplete` and can be resumed; it never counts for the publish gate.

---

## 8. Corrections and privacy

**Three sources.**

1. **Playground.** Mark a reply wrong, write the ideal reply and the reason. Saves an `example` item; optionally also a test built from the conversation so far.
2. **Real WhatsApp replies.** From the Training review list (recent `sender_name = 'AI Agent'` replies) or a "Train this reply" action on AI bubbles in Conversations (Management only). The context is copied and redacted.
3. **Hand-written scenarios.** Synthetic conversation and ideal reply, no customer data.

**Every correction records** the original reply, ideal reply, reason, source, bots and project scope, and the item revision it creates.

**Saving a correction changes no live bot.** It is a draft until it is part of a snapshot that passes the gate and is published.

**Duplicates.** The same conversation and ideal reply (by `content_hash`) cannot be saved twice; the editor shows the existing item instead.

**Editing and retiring** an example creates a new revision or sets `retired` with a reason; both are audited.

**Redaction** (for real conversations, applied server-side before storage):

- phone numbers (any run of 7 or more digits, with `+`, spaces or dashes), emails and URLs that are not catalog assets are replaced by tokens;
- the customer's push name and lead name are replaced by `{customer}`;
- agent notes and commands are dropped;
- only the turns needed for the correction are kept (default: the last 6);
- a record that still matches a phone or email pattern after redaction is rejected.

Customer messages and replies sent to OpenRouter for Playground and tests are the redacted or synthetic copies. Live WhatsApp turns send the conversation text as today, without phone numbers (the core never puts phone numbers in the prompt).

---

## 9. Access control (temporary)

- **Secret.** Edge Function secret `AI_TRAINER_KEY`, at least 32 random bytes from a cryptographic generator. It is never in `.env` files with a `VITE_` prefix, never in the bundle, and separate from `OPENROUTER_API_KEY` and the service-role key.
- **Check.** `ai-trainer` compares the `X-Trainer-Key` header with `safeEqual` before every action except `auth.check`. Failures are counted per source IP; after 10 failures in 10 minutes that IP gets 429 for 10 minutes.
- **Browser.** Management enters the key once per browser session. It is kept in `sessionStorage` (wrapped in try/catch) and cleared when the tab session ends or on sign-out. The page also requires `isChatAdmin(user)` for display, but that is a convenience, not a security check.
- **Actor.** The request carries `actor_claimed` (the signed-in CRM user's name). Audit rows record it as claimed, with `auth_method = 'trainer_key'` and `verified_user_id = null`. The UI shows "claimed by".
- **Bots.** The bots read `ai_bot_pointers`, `ai_snapshots` and chunks with the service role they already hold, and write `ai_turns` and `ai_conversation_state`. They expose only `GET ?health` (core version and modes) in addition to today's webhook.
- **Budget.** Enforced atomically in the database, so simultaneous requests cannot overrun it.
  - Two pools per day: `trainer` (Playground, test runs, judge) and `live` (bot turns in snapshot mode). The limits come from the Edge secrets `AI_TRAINER_DAILY_BUDGET_USD` and `AI_LIVE_DAILY_BUDGET_USD`, and are copied into `ai_budget_days` when a day's row is created.
  - **No model call without a reservation.** Before every OpenRouter call, `ai_budget_reserve(pool, estimate_usd)` runs one statement: `update ai_budget_days set reserved_usd = reserved_usd + $est where pool = $p and day = $d and spent_usd + reserved_usd + $est <= limit_usd returning …`. Row locking makes it safe under concurrency. If no row is updated, the call is refused: 429 for Trainer actions, `fallback_budget` for live turns (6.6).
  - The estimate is the maximum cost of the call: prompt tokens counted before the call, plus `max_tokens`, at the model's listed prices.
  - After the call, `ai_budget_settle(reservation_id, actual_usd)` moves the reservation from reserved to spent, using the provider's reported usage. If the call failed before reaching the provider, `ai_budget_release` frees it.
  - A reservation older than 10 minutes that was never settled is counted as spent at its estimate by the next reserve call. A crash can only make the budget stricter, never looser.
  - The Trainer shows the remaining budget and an estimate before each test run.
- **Replacement.** Documented as temporary. Replaced by individual Supabase Auth identities and Management-controlled permissions, at which point `verified_user_id` is filled and the key is retired.

---

## 10. UI and `ai-trainer` actions

### 10.1 Navigation

- New page **AI Trainer**, view key `aitrainer`, registered in `PAGES` with `lazyChunk`, `NAV_META`, `VIEW_TITLES`, `NAV_SCOPES` (`['MANAGEMENT']`), `FEATURE_KEYS` and `FEATURE_LABELS`.
- Tabs (replace the history entry, as Projects tabs do): Knowledge, Behaviour, Training, Playground, Quality & Publish.
- Per-tab state that should survive Back uses `useNavState` with keys prefixed `aitrainer.`.
- WA Relay stays as it is during legacy mode. Its Knowledge & Rules and Training sections get a notice pointing to the AI Trainer.

### 10.2 Screens

| Tab | Contents | Main actions |
|---|---|---|
| Knowledge | Projects with completeness (address, type, region, photos, labelled floor plans, brochure, map); facts per project and company-wide; rules with parameters; legacy import wizard with its report | Create, edit, retire (reason), import |
| Behaviour | Behaviour instructions by aspect; examples with filters (source, project, bot, status, language) and duplicate warnings | Create, edit, retire, convert example to test |
| Training | Review list of recent real AI replies with their redacted context; corrections inbox from Conversations; hand-written scenario editor | Mark wrong, write ideal reply and reason, save as example, optionally as test |
| Playground | Pick bot, setup (ad or organic with ad text, new or returning, initial state) and version (current drafts, a candidate, or any published snapshot). Multi-turn chat. Each bot turn shows reply, media cards from the resolved assets, handoff flag and the trace: resolved project and source, language, rules, facts and examples used (with ids and revisions), guard results, model, tokens, cost. Compare mode replays the same customer turns on two versions side by side. | Send, reset, mark wrong, save as test, compare |
| Quality & Publish | Per bot: mode badge (legacy or snapshot vN with checksum), live core version from health, last served turn from `ai_turns`, outcome counts (fallbacks, holds, failed sends, failed notifications, interrupted). Draft-versus-published diff. Freeze candidate. Test run with progress and results (pass, fail, inconclusive, with details). Missing-information report: incomplete projects, catalog-gap turns by topic. Publish per bot, rollback per bot, history. | Freeze, run, re-run, publish, roll back, return to legacy (reason) |

### 10.3 `ai-trainer` actions

`POST` with `{ action, payload, actor_claimed }` and header `X-Trainer-Key`. Success `{ ok: true, data }`; errors `{ ok: false, error: { code, message, details } }` with 400, 401, 404, 409 (revision or checksum conflict), 422 (schema), 429 (rate limit or budget) or 500.

| Action | Does |
|---|---|
| `auth.check` | Validates the key |
| `items.list`, `items.get`, `items.create`, `items.update`, `items.retire` | Item CRUD with schema validation, revision check, audit |
| `import.preview`, `import.commit` | Legacy import (4.7) |
| `tests.list`, `tests.get`, `tests.create`, `tests.update`, `tests.retire` | Test CRUD with reasons and revisions |
| `review.list` | Recent real AI replies, redacted |
| `correction.fromReal` | Redacts a real conversation and opens it as a draft example |
| `playground.turn` | Runs `runTurn` with the capture sink on drafts (an in-memory snapshot from `freezeContent`), a candidate or a published snapshot |
| `snapshot.freeze`, `snapshot.list`, `snapshot.get`, `snapshot.diff` | Candidate creation with freeze validation; listing and diffs |
| `runs.start`, `runs.step`, `runs.get` | Test runs (7.7) |
| `publish` | `{ snapshot_id, bots[] }`, gate per 7.5 and core check per 6.5, audit |
| `rollback` | `{ bot, snapshot_id }` per 6.5, or `{ bot, legacy: true, reason }`, audit |
| `status` | Pointers, bot health (core versions), last served turns, outcome counts |

### 10.4 Bot changes (the cutover code)

Both bots gain, behind the pointer:

- read `ai_bot_pointers` for the bot; `legacy` runs today's path unchanged;
- `snapshot`: load and verify the snapshot, check certification, load history and state, call `runTurn` with the WhatsApp sink;
- `GET ?health`.

`wa-webhook` and `wa-send` are not changed. The command branch of both bots (§10.5) is not changed; the pointer check sits only on the inbound path.

---

## 10.5 Existing WhatsApp command compatibility

These commands are existing behaviour. The Trainer must preserve them as they are and must not redesign them. No change in this spec or its plan alters a command, a mapping, or the bots' live command handling.

### 10.5.1 Command guard

- A message is a command only when it is a self-chat message (`key.fromMe === true`), its text starts with `/`, and the chat is not a group (`remoteJid` does not end in `@g.us`).
  - Eyad: `parseEvent`, `wa-bot-eyad/index.ts:208-215`.
  - Dubai: `parseWasenderEvent`, `wa-bot-dubai/index.ts:237-244`.
- The command token is the first word of the text, lower-cased (`command` field). Matching is therefore case-insensitive on the token.
- Commands are routed before any AI step and never reach the model as customer messages.
- A message that fails the guard is not a command:
  - a customer's text starting with `/` is an ordinary inbound message;
  - a `fromMe` message without a leading `/` is ignored;
  - any group-chat message is ignored.
- The Trainer's context builder (`buildHistory`, plan Task 3) drops every agent row whose text starts with `/`, and labels other human rows as the sales agent. This keeps commands and their trailing notes (for example `/fdh this client is …`) out of model history; audit finding F13.

### 10.5.2 Lead forwarding `/f<taq>`

`wa_create_lead(p_phone, p_cmd, p_company_id)` resolves the token through `wa_agents.taq`. The supplied mapping was checked against production `wa_agents` (read-only, 2026-10-18): all 17 rows exist and are active, with matching regions and pool flags. The agent display names stored in the table are shorter ("Azizul", "Masud", "Sabbir", "Rahat", "Dubai") than the full names supplied. This is a display difference only, and the mapping rows are unchanged.

| Command | Agent or pool (as supplied) | Region | Pool | `notify_client` |
|---|---|---|---|---|
| `/fdh` | Dhaka pool | Dhaka | yes | true |
| `/faz` | Md.Azizul Haque | Dhaka | no | true |
| `/fmj` | Mehjabeen Mumtaha Rahman | Dhaka | no | true |
| `/fk` | Kamrul Shikder | Dhaka | no | true |
| `/fl` | Mainul | Dhaka | no | **false** |
| `/fctg` | Chittagong pool | Chattogram | yes | true |
| `/fm` | Masud Chowdhury | Chattogram | no | true |
| `/fs` | Shabbir Newaz | Chattogram | no | true |
| `/fmr` | Maruf Alam | Chattogram | no | true |
| `/fh` | Hillol Chowdhury | Chattogram | no | true |
| `/fsn` | Shahin | Cumilla | no | true |
| `/fcml` | Cumilla pool | Cumilla | yes | true |
| `/fdp` | Deep | Cumilla | no | true |
| `/fkl` | Kamal | Cumilla | no | true |
| `/fdu` | Dubai (Jaber Hossain) | Dubai | no | true |
| `/fmkt` | Marketing pool | Marketing | yes | true |
| `/frahat` | Mr Rahat | Marketing | no | true |

Behaviour to preserve (both bots), gated by `manual_forward_enabled`:

1. `wa_create_lead` creates or finds the lead and returns `status` (`created`, `exists`, `unknown_command`, `no_agent_available`, `error`).
2. **Trailing note.** Everything after the token (`extractTrailingNote`) is logged as a note on the lead. A phone number inside it moves to the lead's phone field (`splitPhoneFromNote`, `fixLeadPhoneFromNote`), and the conversation history note is added (`logConversationHistory`).
3. **Meta CAPI.** `LeadSubmitted` is sent only for a `created` lead with a click id, gated by `meta_capi_enabled`.
4. **Customer message,** gated by `customer_notify_enabled`. "Expert assigned" is sent for `created` with `notify = true`, and "already assigned" for `exists`. No message is sent for any other status; `/fl` (notify false) sends none on `created`.
5. **Region.** Eyad copies `preleads.region` to the lead.

### 10.5.3 `/t` and `/n`

- **`/t`** (gated by `takeover_enabled`) sets `preleads.takeover = true` and sends the handover message. The FAQ agent is skipped while `takeover` is true. The Trainer's pause (§6.3.2) sets the same flag, so both paths stop the bot.
- **`/n <note>`** (gated by `notes_enabled`) logs the text after the token as a note on the lead found by phone. It is a no-op when the note is empty or no lead matches.

### 10.5.4 Project document delivery `/send<code>`

Mapping from `wa_projects.send_code`, checked against production (read-only, 2026-10-18). All 11 rows exist and are active:

| Code | Project | Brochure on file | Photos on file |
|---|---|---|---|
| `/sendca` | Wecon Chowdhury Arcade | yes | 4 |
| `/senddk` | Wecon Dakshinayan | yes | 4 |
| `/sendio` | Wecon Iqbal Orchid | yes | 4 |
| `/sendjm` | Wecon JM Heritage Mall | yes | 2 |
| `/sendmm` | Momtaz Manor | **no** | 4 |
| `/sendnz` | Wecon Nuznan | yes | 2 |
| `/sendos` | Wecon Osman Bellevue | yes | 2 |
| `/sendphc` | P2P Helthcare | yes | 3 |
| `/sendsb` | Wecon Summer Breeze | yes | 4 |
| `/sendsd` | Wecon South Dale | yes | 4 |
| `/sendss` | Shafiq Sapphire | yes | **0** |

**Behaviour to preserve.** Gated by `docs_command_enabled`, with these steps:

1. Push the brochure as a document, named `<project> Brochure.pdf` and captioned `<project> — Brochure`.
2. Push the first 3 photos as images, captioned with the project name.
3. Wait 5.5 s between sends.
4. Send to the customer's dialable target: the phone, or the `@lid` JID when the phone is hidden.
5. Mirror each send into `eyad:<remoteJid>`.

An unknown code is a silent no-op. A project with no brochure sends only photos, and one with no photos sends only the brochure.

**Where this behaviour lives today (Verified 2026-10-18, read-only).**

| Bot | Deployed | Direct `/send` push | In git |
|---|---|---|---|
| `wa-bot-eyad` | v38, deployed 2026-10-17 | **Yes**: `handleSendDocs` pushes brochure plus `photos.slice(0, 3)` | **No.** No branch on GitHub contains it (`dev`, `asad-dev`, `main`, `hridoy-dev`, `conversation` checked). The repository copy still calls the `WA_DRIP_WEBHOOK_URL_EYAD` drip, which is not configured. v38 also adds `hasRealPhone`/`target` LID handling. |
| `wa-bot-dubai` | v34 | **No `/send` handler at all.** A `/send…` command falls through as an unknown command (silent). Dubai only calls `startDrip` on inbound, which is also unconfigured. | Deployed equals git |

Consequences:

- **Do not deploy either bot from the current repository.** Doing so would replace Eyad's working direct push with the no-op drip and drop the LID target handling. The deployed v38 source must first be recovered into git and tagged, as Phase 0 did for v35 (`docs/phases/phase-0-report.md` §2). The plan's Task C0 records it.
- **Dubai `/send` is a gap, not existing behaviour.** Preserving behaviour means Dubai keeps ignoring `/send` codes until the owner decides otherwise. Adding the direct push to Dubai would be a behaviour change, which needs its own approval and is not in this spec.
- The Trainer's own media resolution (§6.2 step 9) is separate from `/send`. It never handles commands, and `/send` never goes through the model.

### 10.5.5 Compatibility tests

Contract tests run against the bots' parsing and routing logic, which is extracted unchanged into a testable module only at cutover (§10.4). Until then they run against copies of the deployed functions. Each test asserts which handler runs and with which arguments; network and database calls are stubbed. Cases:

| ID | Case | Expected |
|---|---|---|
| CC-01..17 | `fromMe` text `/<taq>` for each of the 17 tokens | Routed to lead creation with `p_cmd = <taq>`; no model call |
| CC-18 | `/FDH` (upper case) | Same as `/fdh` |
| CC-19 | `/fdh this client wants a morning call` | Lead creation with `/fdh`; trailing note `this client wants a morning call` |
| CC-20 | `/fdh call 01712345678 after 5` | Note without the number; number passed to `fixLeadPhoneFromNote` |
| CC-21 | `/fl` returns `created` with `notify = false` | No customer message |
| CC-22 | `exists` result | "Already assigned" message |
| CC-23 | `unknown_command` or `no_agent_available` | No customer message |
| CC-24 | `/t` | `takeover = true`, handover message, no model call |
| CC-25 | Customer message after `/t` | No AI reply |
| CC-26 | `/n wants 3 bed` with a matching lead | Note logged |
| CC-27 | `/n` alone, or no matching lead | No-op |
| CC-28..38 | Eyad `/send<code>` for each of the 11 codes | Brochure (if any) then up to 3 photos, 5.5 s apart, to the dialable target, mirrored |
| CC-39 | `/sendmm` (no brochure), `/sendss` (no photos) | Photos only; brochure only |
| CC-40 | `/sendxx` unknown | No send |
| CC-41 | Dubai `/sendnz` | No send (current behaviour) |
| CC-42 | Customer (not `fromMe`) sends `/fdh` | Inbound message, no lead created, no command run |
| CC-43 | `fromMe` text `fdh` without slash | Ignored |
| CC-44 | `/fdh` in a group chat (`@g.us`) | Ignored |
| CC-45 | Each toggle off (`manual_forward`, `takeover`, `notes`, `docs_command`, `customer_notify`, `meta_capi`) | That step does not run |
| CC-46 | Trainer `buildHistory` over a thread containing `/fdh …`, `/n …`, `/t` | None of them in the model messages |

---

## 11. Future dedicated AI database (not provisioned)

Everything this spec adds is prefixed `ai_` and reached only through `trainer-core` ports and `ai-trainer`. There are no foreign keys from `ai_` tables into CRM tables (`legacy_wa_project_id` and `conversation_id` are plain values). A later move to a dedicated AI database is therefore:

1. Provision the new database with pgvector, apply 0037 and 0038 there.
2. Copy the `ai_` tables; verify every snapshot checksum and the chunk set hashes.
3. Point the ports at the new database through new secrets (`AI_DB_URL`, `AI_DB_KEY`), deploy `ai-trainer` first, then both bots, as in 6.5.
4. Keep the old tables read-only for a soak period, then drop them with approval.

---

## 12. Testing and verification of this build

| Area | How |
|---|---|
| Core logic | Node tests for `canonicalJson`, checksum, schemas, scope filter, project resolution, context builder, guards, media resolution, judge verdict table, publish gate |
| Parity | PT-01 to PT-14 (6.4), with Deno for the handler half |
| Database | Apply 0037 to a local Postgres (PGlite) with the production schema shape; tests for immutability triggers, scope constraints, pointer rules, snapshot update rule |
| Retrieval | R0 (5.4), before 0038 is applied |
| UI | `npm run lint` and `npm run build`; manual walk through every tab with the key set and unset |
| Concurrency | Database tests: two simultaneous `ai_turn_lease` calls for one conversation, only one wins. `ai_pause` called twice gives one open handoff. 20 parallel `ai_budget_reserve` calls never exceed the limit. |
| Live check | Snapshot mode is first enabled on one bot with `faq_agent_enabled` still off for customers, so only test numbers get replies. `ai_turns` rows must show the expected snapshot, checksum and core version. |

### 12.1 Manual acceptance checklist (MVP)

Run against the current Supabase project after 0037 is applied, with both bots still in `legacy` mode.

- [ ] Without the access key, every Trainer action returns 401 and the page asks for the key.
- [ ] With the key: create a draft fact and a draft rule. Both appear after a reload, and the audit list shows them as "claimed by" the signed-in user.
- [ ] Both bots show "Legacy" on the Quality page, with no version number.
- [ ] Playground, turn 1: "Nuznan er dam koto?" names a project. Turn 2: "location?" answers about Nuznan without asking which project again. The trace lists the draft items used.
- [ ] Mark the turn-2 reply wrong. Save the ideal reply and reason as an example and as a test. Saving the same correction again shows the existing example instead of a duplicate.
- [ ] Freeze a candidate. Run the tests. Every result shows its checks, the judge verdict and the rationale.
- [ ] Make one test fail on purpose, for example by retiring the fact it needs. Publish is refused and lists that test.
- [ ] Force an inconclusive result, for example by temporarily giving the judge an invalid model id. Publish is refused.
- [ ] Fix the content, re-run, and get all PASS. Publish to one bot. Its pointer and the Quality page show the new version and checksum.
- [ ] Roll that bot back to `legacy` with a reason. The Quality page shows "Legacy" again, and the audit records the reason.
- [ ] No WhatsApp message was sent during this checklist: the `wa_messages` count with `sender_name = 'AI Agent'` is unchanged.
- [ ] The day's budget is shown and decreases after Playground and test calls.

---

## 13. Sequence and gates

1. Owner approves this spec.
2. Implementation plan written and approved.
3. Build `trainer-core`, migration 0037, `ai-trainer`, the AI Trainer page. Bots unchanged.
4. Owner approves applying 0037 to the production project. Both pointers stay `legacy`.
5. Import legacy content, write tests, use the Playground. No customer effect.
6. Run R0. Owner decides on pgvector and 0038, or stays in `full` mode.
7. Deploy the bot changes **one bot at a time**, still in legacy mode, so behaviour does not change. For each bot: deploy; check `GET ?health`; send a test-number message and confirm the legacy reply path still works; keep the previous function tag ready for rollback.
8. Publish the first snapshot to **one** bot while `faq_agent_enabled` stays off for customers, so only test numbers get replies. Run the test-number script (the MVP checklist conversations, plus a handoff and a media request). Check `ai_turns` and `ai_handoffs`. Roll back to `legacy` on any held, failed or interrupted outcome.
9. Repeat step 8 for the second bot.
10. **Customer activation**, meaning `faq_agent_enabled` on for customers in snapshot mode, happens per bot and only on the owner's explicit approval, given at that time. Nothing in this spec or its plan turns it on.

Each of steps 4, 6, 7, 8, 9 and 10 is a production change and needs the owner's explicit approval at that time.

---

## 14. Open items

| ID | Item |
|---|---|
| O-1 | Rubric `sales-default` v1 wording, to be written with Management |
| O-2 | Fallback and handoff templates in Bangla, Banglish and English, to be written by Management |
| O-3 | Reply model and judge model choice; benchmark on the regression set |
| O-4 | Embedding model selection through R0 |
| O-5 | Whether greetings from returning contacts get a short acknowledgement instead of silence |
| O-6 | Whether first-price disclosure is tracked per project or per Jolshiri area |
| O-7 | OpenRouter key placement: the existing `OPENROUTER_API_KEY` Edge secret is reused; the owner's offer to share a key through `.env` is not needed and should not be used, because `.env` copies spread secrets |
