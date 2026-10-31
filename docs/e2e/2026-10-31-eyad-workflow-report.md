# WECON / Eyad Bot workflow report (2026-10-31, 13:00 to 13:40 UTC)

Branch `asad-dev` at `626abf6`, working tree staged but **not committed**. Nothing deployed, pushed, or migrated in this run. Every number below was read from production tables, the function logs, the Supabase function metadata, or the downloaded live bundles at the time stated.

| Step | Status | Evidence |
|---|---|---|
| 1 Stop legacy relay | **NOT RUN** (nothing to stop found) | `wa_settings.default.relay_url` = `functions/v1/wa-send`, `webhook_url` = `functions/v1/wa-webhook`, `token_set` false. In the last 24 h every inbound `wa_messages` row (114) has a matching `eyadbot:` or `dubai-bot:` claim in `wa_webhook_events`, and 0 inbound rows lack one, so the only sender reaching `wa-webhook` is the two bots' `forwardToMirror`. No n8n or other relay is configured in this project; the n8n "Conversion APIs backfill" named in `wa-bot-dubai/index.ts` is outside this project and was not touched. No service was stopped. |
| 2 Inspect Git | **PASS** | Branch `asad-dev`, 6 commits ahead of the last fetched `origin/asad-dev` (`6ed7efd`); `git ls-remote` could not reach the remote from this machine ("Please make sure you have the correct access rights"), so the ahead count is against the stale ref. Newest commit `626abf6` (peer session, 18:05 +06): `trainer-handler.ts`, `trainer-handler.test.ts`, `.gate-harness/capi/main.jsx`. No merge, rebase or cherry-pick in progress. One stash from the `feat/ai-trainer-mvp` era, untouched. `main` untouched. |
| 3 Check conflicts | **PASS** | File overlap between `626abf6` and this session's diff: none. Untracked `_shared/auth-bridge-core.ts` (59 lines, imported by nothing) belongs to the peer session and is left unstaged. A duplicate recap helper this session had added to `wa.ts` (`upsertRecapNote`, no caller) was removed; `writeRecapNote` in `trainer-live.ts` is the single implementation. |
| 4 Run Test 3 | **BLOCKED** (no definition) | No artifact in the repo or docs is named "Test 3". Nearest candidates: CR-002 item 3 (Playwright E2E, 21/22, run 2026-10-30), phase-1a report section 3 (local test results), and test-plan rows F3/B3/C3. Documented suites were run instead: `npm run test:trainer` 335/335, `npm run test:commands` 91/91, `eslint` on the one touched `.jsx` clean, `node --check` on the six edited Edge files clean. Deno is not installed here, so no `deno check`. |
| 5 Test Eyad / Playground | **PASS** with findings | Model `anthropic/claude-haiku-5.5`, embeddings `text-embedding-3-large` 3072d, 73 chunks all one model and dimension. Live turns 12:50 to 13:13 UTC on the three test numbers: 8 `ok`, 1 `brochure_sent`, 1 `skipped_greeting`, 2 `skipped_paused`, 1 `fallback_invalid_output` (`guard_errors: ["script"]`: Bangla question "লোকেশন", model answered in Latin script; the fallback paused `eyad:8801866064500`, which is why its next two messages were `skipped_paused`). Languages: en, banglish, bn all exercised. Duplicate echo rows: 2 more pairs since 12:00 (`AI Agent` rows at 12:46 and 12:50, echoes 3.7 s and 4.3 s later). Citizen Avenue document: version 2, `needs_reindex`, 0 version-2 chunks at 13:34 UTC, so every Citizen Avenue turn since 12:49 retrieved only "WECON sales offices" (scores 0.21 to 0.30). **Re-index has not happened.** No synthetic webhook was sent; the secret is still empty (logs: "no webhook secret for eyad, accepting unauthenticated", 25 lines 12:56 to 13:07). |
| 6 Verify Meta / CAPI | **PASS** (dry-run state confirmed) | `META_CAPI_ACCESS_TOKEN` present in function secrets; `CAPI_SCHED_KEY` and `CAPI_SCHED_SEND` absent. Live `meta-capi-sched` v2 (29 Oct) accepts a call with no `x-api-key` when the key is unset; HEAD fails closed with 503. The three cron runs (30 Oct 15:00, 31 Oct 07:00, 12:00 UTC) returned 200 and, with `CAPI_SCHED_SEND` unset, dry-ran. `capi_event_attempts` 0 rows, `capi_job_log` 0 rows, `capi_send_locks` 0 active, `capi_send_permits` 0 in 24 h, 31 leads `pending` and qualified, all inside the 7-day window (25 to 29 Oct). Dedupe: `event_id = lead id`, Meta does not dedupe business-messaging events, so the code skips `unsure` leads unless resent on purpose. UI sends and settings need a verified sign-in (CR-001 D1) and are refused with 403. No change made. |
| 7 Inspect schedules | **PASS** | DB time zone UTC. 5 `cron.job` rows, all active, no duplicates: `wa-followup` `*/2 * * * *` (720 runs in 24 h, 0 failed, last 13:16 UTC); `capi-retention` 21:00 UTC; `capi-qualify-1300` 07:00 UTC and `capi-qualify-1800` 12:00 UTC (13:00 and 18:00 Dhaka); `capi-send-2100` 15:00 UTC (21:00 Dhaka, dry-run while `CAPI_SCHED_SEND` is unset). Nothing restarts a relay. Live `wa-followup` v15 (19 Oct) has no cron-key gate; HEAD requires `FOLLOWUP_CRON_KEY` (503 without it) and the cron command sends no `x-followup-key` header, so **HEAD `wa-followup` must not be deployed before that secret and header exist**. Not in this deploy. |
| 8 Prepare commit | **PASS** (staged, not committed) | 45 files staged by explicit path: 10 code files (+103/-16 lines), 4 new test files, docs, and the two rollback bundles. Left out: `_shared/auth-bridge-core.ts` (peer's). Commit message drafted at `/tmp/commit-msg-20261031.txt`. The staged code diff is in the audit report appendix below. |
| 9 Prepare deployment | **PASS** (prepared, awaiting approval) | See "Deployment plan". |

## Deployment plan (awaiting explicit approval; nothing deployed)

Rollback bundles saved and hashed: `supabase/deployed/2026-10-31/wa-webhook-v15/` (2 files) and `supabase/deployed/2026-10-31/wa-bot-eyad-v67/` (17 files), each with `SHA256SUMS` and `DEPLOYMENT.json`, downloaded 13:28 UTC with `supabase functions download --use-api` into a scratch directory; function metadata (version, `ezbr_sha256`) was identical before and after.

Live versus git, byte for byte (CRLF stripped):

- `wa-bot-eyad` v67: all 17 files equal commit `4e5d678`. HEAD `626abf6` differs only in `_shared/trainer-handler.ts` (the peer's 1024-token model probe, 16 lines, inside `modelConfigTest`, which the bot never calls). The working tree then changes `trainer-core.ts` (+6/-3), `trainer-live.ts` (+22), `trainer-media.ts` (1 line), `wa.ts` (+26), `wa-bot-eyad/index.ts` (+11/-7). Import closure from the working tree: 17 files, the same 17 the live bundle carries; no new file.
- `wa-webhook` v15: `index.ts` equals commit `6750658` and HEAD; `_shared/wa.ts` equals commit `e760194` (2026-10-14) and is 315 lines behind HEAD. The live webhook has never run the current `wa.ts`. The webhook's closure is 3 files (`index.ts`, `_shared/wa.ts`, `_shared/phone.ts`), all present. `index.ts` keeps its own `getCredentials` + `safeEqual` signature check, so auth behaviour is unchanged by the new `wa.ts`.

Secrets both bundles read exist in the project: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WASENDER_API_TOKEN`, `OPENROUTER_API_KEY`, `META_CAPI_ACCESS_TOKEN`; optional ones (`WASENDER_WEBHOOK_SECRET`, `WASENDER_BASE`, `ALLOWED_ORIGIN`, `AI_TRAINER_*`, `OPENROUTER_MODEL`) are read with defaults. This session adds no new `Deno.env.get`.

Commands, from a scratch checkout of the committed tree once the commit exists:

```
npx supabase@2 functions deploy wa-webhook  --no-verify-jwt --project-ref sbqmougcvnplgjgihpwe
npx supabase@2 functions deploy wa-bot-eyad --no-verify-jwt --project-ref sbqmougcvnplgjgihpwe
```

Health checks after deploy: `list_edge_functions` shows v16 and v68; a real customer message on a test number produces one `ai_turns` row and **one** OUT row in Conversations (no blank-sender echo within 120 s); function logs show no `isBotEcho` or `canonicalConvJid` reference errors.

Rollback: copy the bundle files over `supabase/functions/` in a scratch checkout and run the same two deploy commands.

Risks the owner should weigh before approving:

1. **Thread re-keying.** 143 of 528 Eyad `@lid` threads carry a real BD number; after deploy their new messages land in `eyad:<phone>@s.whatsapp.net`. 103 of those already have such a thread (the duplicate pair), 40 do not (a new thread appears). 59 were active in the last 7 days. Old LID threads keep their history and stop growing; merging them is the gated migration.
2. **Reply cap.** A model reply over 5 non-blank lines is rejected, retried once, and if still long the turn falls back and **pauses the chat** (`fallback_invalid_output` + handoff), the same path a script mismatch takes today. The prompt asks for 5 lines, so this should be rare, but it is new.
3. **Echo window.** 120 s is a guess from today's 3.7 to 6 s gaps; a slower echo still shows twice.
4. **History labelling.** In phone-JID threads, past echo rows (blank sender) read as human-agent turns in the trainer's history. Pre-existing; the echo skip stops new ones.

## Also found, not in scope

- `wa-send` answered 400 to 126 of 167 requests in 24 h (`Unknown action` or `Invalid JSON`). All from CRM browsers in Bangladesh (Chrome 156/157, Edge), request bodies 46 to 49 bytes, each within seconds of a successful 200 send from the same browser. The only relay call in `src/lib/wa.js` is `action: "send"` (about 266 bytes), so the small body comes from another client path; sends themselves succeed. Source not identified in this run.
- Test `2fb0edea` ideal reply edited (revision 2, audit 112, 13:11 UTC): the "only one unit left at G-2" clause removed, with the owner's approval.
