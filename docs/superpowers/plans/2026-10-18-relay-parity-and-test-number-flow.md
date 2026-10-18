# WA Relay parity and test-number flow

Branch `feat/ai-trainer-mvp`. Local work only: no deploy, no WhatsApp send, no
production secret or migration, both bot pointers stay `legacy`.

## 1. Feature-gap checklist

Source of truth: `src/components/views/RelayView.jsx` (WA Relay page),
`supabase/functions/wa-bot-eyad`, `wa-bot-dubai`, `wa-webhook`, `wa-send`,
`_shared/wa.ts`, `_shared/ai.ts`, migrations 0007, 0034, 0035, 0036.

| # | WA Relay feature (where) | AI Trainer today | Action |
|---|---|---|---|
| 1 | Per-bot checklist, 10 toggles each (`BotPanel`, `wa_bot_settings`, 0034) | none | Bring over: Bots tab reuses the same component |
| 2 | Greeting text and auto-forward threshold (`BotPanel`) | none | Same component |
| 3 | Assignment message templates, read-only (`ASSIGN_TEMPLATES`) | none | Same component |
| 4 | Testing numbers per bot (`wa_bot_settings.test_numbers`, 0035, `normTestNumber`) | none | Same component; also the test-number flow's allow-list |
| 5 | Projects CRUD (`ProjectsManager`, `wa_projects`) | draft `project` items, imported from `wa_projects` | Keep: drafts are the trainer's equivalent. `wa_projects` stays the live (legacy) source, edited on WA Relay |
| 6 | Knowledge & Rules CRUD (`KnowledgeManager`, `wa_knowledge`) | draft facts / rules / behaviour, imported | Keep (same reason as 5) |
| 7 | Training: recent live AI replies, correct one (`TrainingManager`, `wa_message_corrections`) | Playground "Mark wrong" covers playground replies only | Bring over: Live replies section in Behaviour tab, saving the correction as a draft example (and the legacy correction row, unchanged behaviour) |
| 8 | Training stats (`TrainingStats`) | none | Same component |
| 9 | Legacy FAQ agent on real traffic (`askAgent` in bots) | trainer core only in Playground and test runs | Not merged: bots stay legacy. Test numbers get the trainer core instead (section 2) |
| 10 | Agent commands `/t /n /f* /send*` (bots) | none | Unchanged in the bots. The trainer path never sees a command, and filters command and agent rows from history (`buildHistory`) |
| 11 | Chat mirror, delivery status (`wa-webhook`, `wa_messages.status`, `wa_id`) | none | Reuse: test-number replies are written to `wa_messages` with `wa_id`, so `wa-webhook` receipts update them as for any send |

Nothing on WA Relay is removed. Items 1-4, 7 and 8 render the same code on both
pages (extracted, not copied), so behaviour is identical.

## 2. Test-number flow (design)

Where: inside each bot's existing `handleInbound`, at the FAQ-agent call, behind
one new opt-in column `wa_bot_settings.trainer_test_mode` (migration 0038,
default false). When it is false nothing changes for anyone. When it is true:

- A chat whose number is NOT in `test_numbers`: unchanged (legacy).
- A chat whose number IS in `test_numbers`: the legacy FAQ agent is skipped,
  and `runTestTurn` (new, `_shared/trainer-live.ts`) answers with
  `trainer-core.runTurn` over the current drafts, the same content and code
  the Playground uses. History comes from `wa_messages` (with agent `/` rows
  removed); state from `ai_conversation_state`; the turn is logged to
  `ai_turns` with its trace and outcome.
- The reply is sent only when the recipient is the inbound sender and is in
  `test_numbers` (checked again at send time), through `sendWaMessageMirrored`,
  which writes `wa_messages` (sender `AI Trainer`, `wa_id` from Wasender) so
  Conversations and delivery receipts work unchanged.

Not touched on the test-number path: prelead upsert, welcome, auto-forward,
commands. A test number already gets every checklist feature (0035), which is
existing behaviour; the trainer must not add lead assignment on top, and does
not.

The Trainer UI gets a "Test numbers" tab: the switch, the allow-list, and per
test number the conversation (inbound, reply, status, error) and the turn trace
from `ai_turns`.

## 3. Verification

- Node: `test:trainer`, `test:commands`, `test:0037`, a new `test:live`
  (runTestTurn with fake ports: isolation, history filter, logging, failure
  paths), `test:ui` extended to the new tabs.
- Local stack (`/tmp/claude-1000/sbdev`): apply 0007/0034/0035/0038 to the dev
  database, serve `wa-bot-eyad`, `wa-webhook` and `ai-trainer` with
  `WASENDER_BASE` pointed at a local fake Wasender and the model at the stub.
  Drive real webhook payloads: test number inbound, non-test number inbound,
  `/n` and `/t` commands, a delivery receipt. Check DB rows and the fake
  Wasender's received sends.
- Browser: the Trainer page against the local stack.

Live delivery stays unverified until the functions are deployed and a real
WhatsApp message is sent from a test number.
