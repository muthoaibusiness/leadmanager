# Eyad bot conversation handling: bursts, recap, media and call routing, repeated asks

Date: 2026-10-31. Status: draft for approval. Scope: `wa-bot-eyad` and the shared trainer code it bundles. Dubai is out of scope. Nothing in this document is built.

## Intent

Customers write to the Eyad WhatsApp number in short bursts, send photos and voice notes, and sometimes call. Today the bot answers each message on its own, says nothing useful when a photo arrives, never learns that a call happened, and keeps offering a meeting it already offered. Sales agents read a raw thread with no summary. This design makes the bot answer one coherent reply per burst, hand media and calls to the right human, keep a short recap for the agent, and stop repeating itself.

## Goals

1. A burst of messages from one customer gets one reply that answers them in order. No message is dropped, no reply is sent twice.
2. After each answered exchange, a short recap exists for the agent: what the customer wants, which project and location, budget if they stated one, their intent, open questions, actions taken, next step. Only facts from the thread; nothing invented. The recap is one note per lead, updated in place — never duplicated. It is distinct from the greeting/welcome message.
3. A photo, video, document, voice note or call reaches a human: the agent for the customer's project region, or the existing assigned agent. The media reference is kept. Audio is not transcribed (no provider in the stack). Media/calls from a brand-new contact create a lead through the region pool even when global auto-forward is off; duplicate leads are prevented.
4. The bot asks one clarifying question when the project or location is unknown, once.
5. The bot offers a meeting or a call at most once until the customer responds to it, and never after an appointment is set.

## Non-goals

- Decrypting inbound media (deferred by decision on 2026-10-31; a separate change to `wa-webhook`).
- Call forwarding or auto-answer. Wasender exposes a `call` webhook with `data.call.{id, from, date, isGroup, isVideo, status}` and no forward endpoint.
- Changing the legacy `runFaqAgent` path or Dubai.
- A new UI surface. The recap lands where agents already look (below).

## Anti-goals

- A reply that answers only the last message of a burst.
- A recap that states a budget, size or date the customer did not type.
- A second meeting offer in the same conversation while the first is unanswered.
- Any bot action triggered by a customer message that looks like a command.

## Constraints (verified)

- `wa-bot-eyad` is a stateless Edge Function. Two messages 1 s apart are two parallel invocations with no shared memory. Any buffer must live in Postgres.
- Wasender allows one send per 5 s per session; the code already waits 5.5 s between sends.
- The trainer core (`trainer-core.ts`, `trainer-live.ts`) is Deno-free and tested under Node (`npm run test:trainer`, `npm run test:live`). New logic goes there with tests.
- One responder per chat (CR-002). The test-number path is `runTrainerTestTurn` → `runTestTurn` → `runTurn`.
- Conversation memory is `ai_conversation_state` keyed `eyad:<phone>` (`memoryKey`), with `state.asked` (exact strings, last 20), `paused`, `active_project`.
- History for the live path is the last 21 `wa_messages` rows of the thread (`runTestTurn`).
- The webhook secret is empty, so the function cannot tell Wasender from anyone else. This design does not depend on the secret but notes that any new write path is reachable by a forged payload until the secret is set.
- Inbound events arrive under up to three names for the same message (`messages.upsert`, `messages-personal.received`, `messages.received`); `claimEvent(eyadbot:<key.id>)` collapses them.
- No production migration or deploy without explicit approval. Section "Changes" lists each.

## Decisions

### D1. Burst coalescing with a database queue and a per-conversation lease

Flow for an inbound text or media message on a trainer chat:

1. Insert a row into a new table `ai_inbound_queue` (`conversation_key`, `message_id` primary key, `text`, `media` jsonb or null, `received_at`, `seq` from `messageTimestamp` then arrival). The insert is idempotent on `message_id`.
2. Wait the burst window (default 5 s, read from `wa_bot_settings.burst_window_ms`, new column, null means 5000).
3. Call a new RPC `ai_claim_burst(p_key, p_lease_seconds)` that, in one transaction: refuses if a lease on `p_key` is held by another invocation and not expired (returns `busy`); otherwise takes the lease and returns and deletes all queued rows for the key, ordered by `seq`.
4. On `busy`: exit with outcome `coalesced`. The lease holder will drain the rows.
5. On rows: build one customer text by joining the texts in order with newlines; media rows contribute a bracketed label such as `[customer sent a photo]`. Run one `runTurn`. Send. Then call `ai_claim_burst` again; if more rows arrived during the model call, repeat. Release the lease at the end (`ai_release_lease`).
6. Log one `ai_turns` row per model call with `trace.burst = { message_ids: [...] }`.

Why a lease and not only the queue: without it, a message that arrives while the model is already running starts a second model call, and the two replies can cross. The lease serialises replies per conversation and keeps their order.

Timeout handling: the lease has an expiry (default 60 s) and the holder renews it before each model call and before each send (`ai_renew_lease`). The drain loop stops after 3 model calls per invocation and leaves the rest queued for the next arrival. If the holder dies, the next arrival takes over after expiry and drains whatever is queued. Nothing is lost; at worst a reply is late. (My call: a renewed lease plus an iteration cap, because a 60 s fixed lease is shorter than wait + model + retry + 5.5 s send gaps.)

Retries from Wasender (same `key.id`) are still stopped by `claimEvent` before the queue.

Command detection runs per message before queueing, on the raw text with `fromMe`, exactly as today. The joined burst text is never parsed for commands. (My call.)

Paused or taken-over chats: messages are still queued and mirrored, the model does not run, and the queue is drained without a reply when the lease is next claimed, so the thread history stays complete. Media and calls on a paused chat still notify the assigned agent (D2) but never create a lead. (My call; open question 6 asks the owner to confirm.)

Queue hygiene: rows older than 24 h are purged by the claim RPC, and a key holds at most 50 rows (the oldest are dropped first). Both limits are arbitrary ceilings against a forged flood while the webhook secret is empty. (My call.)

Scope: the queue and lease sit inside the trainer branch of `handleInbound`, after the welcome, Jolshiri, price and takeover logic. Today that branch runs only for test numbers (`settings.trainerTest`). When CR-002 phase 3 routes every Eyad chat to the trainer, the same code applies. The legacy `runFaqAgent` branch is unchanged. (Open question 7 asks whether to widen it now.)

### D2. Media and call events

For an inbound message with media, or a `call` event:

1. Mirror as today (media reference kept in `wa_messages.media_url`, encrypted until the decrypt change ships).
2. Media with no text, or a call: do not run the model. Media with a caption, or media inside a text burst: the text goes through D1 and gets a reply; the media still routes to a human below. (My call.)
3. Route to a human:
   - If the phone already has a lead, notify `leads.assigned_to` (a `notifications` row, type `WA_MEDIA` or `WA_CALL`, message naming the customer and the kind, `lead_id` set).
   - Else resolve the region: active project in `ai_conversation_state` → that trainer item's `body.region` (the same field `wa_projects.region` carries for the legacy catalog); else `preleads.region`; else a non-880 number → Dubai. Call `wa_create_lead` with the region pool command from `REGION_CMD` in `wa-bot-eyad/index.ts` (`/fdh`, `/fctg`, `/fcml`) or `/fdu`. The RPC already notifies the picked agent and sends the assigned text when `notify_client` is true. This lead creation for media/calls happens regardless of the global auto-forward setting (which is off), and `wa_create_lead`'s `exists` return plus `findLeadForNote` prevent a duplicate lead for a phone that already has one.
   - Else (region unknown): send one clarifying question in the customer's language (from `detectLanguage` over the thread, English when there is no text), record it in `state.asked` under the key `clarify_project`, and do not ask again. When the customer answers with a project name, the normal text path resolves it and the next media or call is routed.
4. Marketing enquiries: there is no signal in the data for "marketing enquiry". Routing to `/fmkt` happens only when an agent uses the command. (Open question 2.)

The `call` event must be enabled in the Wasender dashboard for the Eyad session; production has never received one. `parseEvent` gains a `kind: "call"` branch reading `data.call.from` as the JID.

Cumilla routing gap: `/fsn`, `/fdp`, `/fkl` have no `user_id`, so the pool lead has no CRM notification. Out of scope here; listed in the test plan.

### D3. Recap

The reply model already returns strict JSON. Add one field, `recap`, an object with fixed keys: `requirement`, `project`, `location`, `budget`, `intent`, `open_questions` (array), `actions` (array), `next_step`. Every value is a short string or null. One model call per turn, no second call.

Grounding guard (in `guardReply`): any number or money amount in `recap.budget` or `recap.requirement` must appear in the customer's own messages of this thread (not in the knowledge). A recap that fails the guard is dropped and the turn keeps its reply; `trace.recap_dropped` records why. The reply itself is not rejected for a recap failure.

Storage: `ai_conversation_state.state.recap` holds the latest recap. `ai_turns.trace.recap` holds the per-turn one. The agent sees it:

- in the Test numbers tab trace (exists today);
- in the lead's **existing note** — `logNoteActivity()` writes an `activities` row of type `NOTE`, source `Eyad Bot (recap)` (the same machinery `logConversationHistory()` uses for the `WhatsApp conversation before forward:` note). There is no `leads.notes` column; the lead's visible "notes" in the UI is a client composition of `activities` NOTE rows (LeadPanel `lead-notes`), so a NOTE row is the only place a recap is visible in the CRM.
- **Never duplicate the note.** The first time a lead needs a recap, insert one NOTE row. Every later recap for the same lead **updates that row in place** (find the latest recap NOTE for the lead by source `Eyad Bot (recap)`; replace its `description`), so the lead timeline never floods. This is the reconciliation of the owner's rule "reuse/update the existing customer note" with the actual data model.
- **Linked to a verified customer user id and lead.** The note is written only against the lead resolved by `findLeadForNote(phone)` (the verified phone, tail-9 match). The bot is identified by the row's `user_name`; the owning agent is `leads.assigned_to`. If the phone has no lead, no note is written yet — the recap stays in `ai_conversation_state.state.recap` and becomes the first note only when D2 or a command creates the lead (via `wa_create_lead`'s `exists` path to prevent a duplicate lead).
- **Greeting and recap are separate.** The first-contact welcome/greeting is a message, not a recap, and never replaces or duplicates the recap row. A recap is written only after a meaningful exchange (or on handoff/forward/routing), not on a bare greeting.

Verification before an agent replies: an agent picking a lead must verify the customer user id and review the prior recap/history before responding, and use context-aware follow-ups (e.g. "You previously discussed Citizen Avenue, visited the shop, and asked about pricing. What would you like to know today?"). The recap must contain the facts to support that; the agent does the verifying.

### D4. Repeated asks and meeting offers

1. `asked` becomes a list of category tokens, not sentences. The model returns `asked` from a fixed vocabulary: `project`, `area`, `size`, `budget`, `timeline`, `purpose`, `meeting`, `call`, `brochure`, `clarify_project`. The prompt lists the vocabulary and the already-asked tokens. Unknown tokens are dropped by `parseModelOutput`. Existing free-text entries in `state.asked` are kept in the list and shown to the model unchanged until they age out of the last-20 window; they are not mapped. (My call: no migration of live state.)
2. New state fields: `meeting_offered_turn` (integer turn count when `meeting` or `call` was last asked), `meeting_outcome` (`null`, `accepted`, `declined`, `set`). `accepted` comes from `isAffirmative` on the next customer message after an offer; `declined` from a negative; `set` when `leads.meeting_date` is not null for the phone. The lead lookup is a new optional port on `Ports` (`leadFacts(phone)` returning `{ meeting_date, assigned_to }` or null), wired in `trainer-deno.ts`; the Playground passes none and treats the outcome as `null`. (My call.)
3. Guard: a reply that contains a meeting or call offer (pattern over the three languages, reusing the price-agent patterns in `ai.ts` where they fit) is rejected with error `repeat_offer` when `meeting_outcome` is `set`, or when an offer is pending and fewer than 3 turns have passed since it. The existing retry-once-with-errors loop asks the model for a corrected reply.
4. The System Prompt (published v2) already says "offer the meeting directly". The prompt text is admin-owned; the state line sent with each turn (`Conversation state: ...`) gains `meeting_outcome` and `turns_since_offer`, which is enough for the model and is enforced by the guard either way.

### D5. Language

`detectLanguage` and the script guard already exist and pass tests. No change. The burst text is detected as one string; if a customer mixes scripts in one burst, the dominant script wins by the existing 30 percent rule. Test cases F1 to F9 in the test plan cover the three languages.

### D6. History

`runTestTurn` already reads the last 21 thread rows. The combined burst text is the current message; its individual rows are excluded from history by `message_id` (today only the last matching text is popped). No other change.

## Changes

| # | Change | Kind | Approval needed |
|---|---|---|---|
| M1 | migration: `ai_inbound_queue`, `ai_turn_leases`, RPCs `ai_claim_burst`, `ai_renew_lease`, `ai_release_lease`; `wa_bot_settings.burst_window_ms` | schema | yes, before apply |
| C1 | `trainer-live.ts`: queue insert, wait, claim loop, lease, burst trace; `trainer-deno.ts` ports for the RPCs | code | — |
| C2 | `wa-bot-eyad/index.ts` `parseEvent`: `call` kind; media-only inbound → D2 routing instead of the model | code | — |
| C3 | `trainer-core.ts`: `recap` in `ModelOut`, prompt line, grounding guard, `asked` vocabulary, meeting state and `repeat_offer` guard | code | — |
| C4 | `wa.ts`: `notifyAgent(leadId, type, message)` helper over `notifications` | code | — |
| C5 | tests: `trainer-live.test.ts` (burst order, duplicate, busy lease, lease expiry, media routing by region, clarification asked once), `trainer-core.test.ts` (recap guard, asked vocabulary, repeat_offer) | tests | — |
| D1 | deploy `wa-bot-eyad` from the commit, after live v67 is re-verified against `4e5d678` | deploy | yes |
| W1 | Wasender dashboard: enable the `call` webhook event for the Eyad session | config, user | user action |

Rollback: `wa_bot_settings.burst_window_ms = 0` disables coalescing (claim runs immediately, still serialised by the lease). Redeploying v67 from `4e5d678` removes everything else; the new tables are inert.

## Left to the builder

- Exact table and column names, the lease default, and the RPC signatures.
- Notification wording in the three languages for the clarifying question.
- Whether the burst label for media is per item or one line for several items.
- Test fixture shapes for the `call` event (copy the Wasender example payload).

## Open questions for the owner

1. Recap destination: resolved — one NOTE row per lead, updated in place on handoff/forward/routing, never on every turn (owner rule "reuse/update the existing customer note").
2. Marketing enquiries: what in a message identifies one? Without a rule, only the `/fmkt` and `/frahat` commands route to Marketing.
3. Burst window: 5 s default. Shorter answers faster but splits slow typists; longer delays every reply by that much.
4. New-contact media/call lead creation: resolved — yes, create via the region pool even while auto-forward is off, with duplicate prevention (owner rule).
5. Calls: enable the `call` event in Wasender now, or after the code ships? (Still open; Wasender has never delivered a `call` event in production.)
6. Paused or taken-over chats: resolved — store the incoming messages, keep the bot silent (no reply), and still notify the assigned agent about media and calls. No lead is created from a paused chat (owner rule).
7. Scope: build inside the test-number branch only (as designed), or widen to every Eyad chat in the same change? Widening is the CR-002 phase 3 cut-over and changes what real customers get.
