# Eyad bot implementation cards (from the 7-line review)

Date: 2026-10-31. Branch: `asad-dev`. Rule: local code + tests first; migrations, production secret changes, knowledge-doc content, and deployments each need separate approval. Nothing in this doc is deployed.

| # | Item | Verdict from review | Kind | Status |
|---|---|---|---|---|
| 1 | Security — webhook secret empty, no synthetic tests | skip | — | deferred (needs `wa_secrets` + Wasender-side secret, approved) |
| 2 | Banglish cross-script retrieval | required | code + content | **2a done**; **2b draft done**; content apply gated |
| 3 | Duplicate conversation threads | required | code + migration | **canonicalization + tests done**; migration/merge gated |
| 4 | Cumilla agents lack CRM user IDs | skip | — | deferred (needs adding `user_id` to `/fsn` `/fdp` `/fkl` rows) |
| 5 | Recap: one NOTE row per lead, updated in place | require | code + tests | **multiple + wiring done**; deploy gated |
| 6 | Physical-phone test cases | user tests | — | pending user send |
| 7 | Duplicate error / duplicate-messages clarity | required | code + tests | findings; gated |

## Local code delivered (2026-10-31, `asad-dev`, not deployed, no migration)

- **Card 2a** — `trainer-core.ts` `BANGLISH`: `koi`, `tola`, `koyta`. Test `detectLanguage("Citizen Avenue koi?") === "banglish"` (in `trainer-core.test.ts`).
- **Card 2b** — `docs/Projects/citizen-avenue-knowledge.md`: the full replacement body (one section per FAQ question, Bangla + Banglish + English, no phone-number boilerplate), which superseded the earlier Banglish-facts draft. Written to document `1c62a3f8` as version 2 on 2026-10-31 12:49 UTC with owner approval; it answers nothing until the owner clicks Re-index in the Knowledge tab.
- **Card 3 (canonicalization)** — `wa.ts` `canonicalConvJid(remote, phone)` (LID + real BD number → phone JID, normalized to 880 form). Wired into `wa-bot-eyad/index.ts` (`parseEvent.convJid`, all 5 convId sites) and `wa-webhook/index.ts` (mirror convId). Test `wa-conv.test.ts`. One-time merge of existing duplicate `wa_conversations`/`wa_messages` rows + migration still gated.
- **Card 5 (recap)** — `trainer-live.ts` `writeRecapNote` (ports-based, update-in-place) wired into `runTestTurn` on handoff (no-op until the core emits `recap`). Test: `trainer-live-recap.test.ts`. A second copy in `wa.ts` (`upsertRecapNote`) had no caller and was removed in the step-3 conflict check. Deploy gated.

Test result: 337/337 (`npm run test:trainer`, which now lists the new files) and 91/91 (`npm run test:commands`). Audit-session additions (reply cap, bot-echo dedupe, Citizen Avenue floor labels, Playground freeze date, Citizen Avenue knowledge draft): `docs/e2e/2026-10-31-ai-trainer-audit.md`, section 5.

## Card 2a — Banglish detection (D11) — DONE

`trainer-core.ts` `BANGLISH` list: added `koi`, `tola`, `koyta`. `detectLanguage("Citizen Avenue koi?")` now returns `"banglish"` (was `"en"`). Tests added to `trainer-core.test.ts`. 50/50 pass.

**Residual (2b, gated, content not code):** `koto tola?` was *already* tagged banglish — the failure was **retrieval** (vector search returned 0 chunks), because the Citizen Avenue document chunks are Bangla-only. Fix needs a Banglish/English rendering of the key Citizen Avenue facts (floors, parking, shops) appended to the knowledge document or as fact items in `ai_trainer_documents` / the item revision — that is a production data mutation, needs approval.

## Card 5 — Recap one-note, updated in place — DONE (code+tests)

`writeRecapNote(ports, phone, description)` in `_shared/trainer-live.ts` (with `RECAP_NOTE_SOURCE = "Eyad Bot (recap)"`): resolves the lead by phone, finds its latest recap NOTE and replaces description + timestamp; otherwise inserts the first; no-op when the phone has no lead. Test `trainer-live-recap.test.ts` covers all three.

**Wiring:** `trainer-live.ts` now calls `writeRecapNote` on handoff (guard: no-op until the core emits `recap`). Deploying the bundle is separate approval.

## Card 3 — duplicate threads (D5) — findings, gated

Root cause: webhook builds `convId = ${account}:${jid}` where a customer's messages arrive under two jids — a LID (`…@lid`) and the phone (`…@s.whatsapp.net`) — so the same customer gets two conversations and every bot reply appears twice (echo row in the `@s` thread). `wa-webhook/index.ts:202` already extracts `phoneJid` from candidates.

Proposed fix: canonicalize the conversation PK to the phone-jid when a phone-format jid is present; when only a LID is available, keep `account:<lid>` and use `pn-from-lid` to link later phone events to the same thread. Requires a one-time merge of existing duplicate `wa_conversations`/`wa_messages` rows + a migration → approval-gated.

## Card 4 — duplicate error / duplicate-messages (7) — findings

`claimEvent` dedupe (`eyadbot:<key.id>`) already collapses retried payloads — verified B3 (`{ok:true, duplicate:true}`, one `ai_turns` row). The remaining duplicate *visible to the customer/agent* is the double-thread echo, which is Card 3's fix. Burst queue (design D1) will add its own idempotent insert on `message_id`, giving a second dedupe layer.

## Gated approvals needed (separately)

1. `wa_secrets` secret + Wasender Eyad webhook setting (item 1).
2. Citizen Avenue knowledge content — approved and written 2026-10-31 12:49 UTC: version 2, status `needs_reindex`, md5 `4b81b0bf…` matches `docs/Projects/citizen-avenue-knowledge.md`. Owner clicks Re-index in the Knowledge tab to embed it. Until then the document is not served (see `docs/e2e/2026-10-31-ai-trainer-audit.md`).
3. Thread canonicalization migration + merge of existing duplicate rows — item 3.
4. Deploy `wa-webhook` (echo skip, canonical thread) and `wa-bot-eyad` (canonical thread, recap, reply cap) — items 3, 5.
5. Cumilla `user_id` rows (if item 4 is later unskipped).
