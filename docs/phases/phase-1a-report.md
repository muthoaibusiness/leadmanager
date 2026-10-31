# Phase 1A report: security fixes prepared and tested locally

| | |
|---|---|
| Date | 2026-10-17 |
| Status | **Prepared and tested locally. Staging tests pending, because the staging project does not exist yet. Deployed nowhere.** |
| Code | Local branch `phase1a/security-fixes-prep`, tag `phase1a/candidate-1` = `3208f07`, on top of the reconciled Phase 0 line `dfbd20b`. Not pushed. |
| Change record | `docs/changes/CR-001-phase-1a-security-fixes.md`: decision, affected components, implementation sequence, rollback, verification checklist, runbooks |
| Authorisation | "Prepare the narrowly scoped security fixes in staging and submit the test results for review." Production needs AG-1. |

## 1. Scope

**In candidate 1:**

| ID | Fix |
|---|---|
| CR-1 | Wasender webhook shared-secret verification in both bots and `wa-webhook`, staged by `WA_WEBHOOK_AUTH_MODE` (`auto`, `log`, `enforce`, `off`). The `x-replay` bypass is ignored under enforce. |
| CR-2 | The send endpoint is fixed at build time. `wa_settings.relay_url` is ignored and no longer written. |
| CR-3 | Browser credential rotation is disabled: `wa-send` answers `set-credentials` with 410, and the client sends credentials nowhere. |
| CR-4 | Migration 0037 revokes `EXECUTE` on `wa_bump_unread` from `PUBLIC`, anon and authenticated, with preflight, verify and rollback scripts. |

**Phase 1A items in the plan that candidate 1 leaves out.** Each one needs a decision. None was dropped silently.

| Plan item | Status | Reason |
|---|---|---|
| Stop injecting `wa_message_corrections` into prompts; remove the phone numbers stored in corrections | Not included | The table is empty (0 rows, Verified), so no phone numbers are stored and nothing is injected today. The path is still open: the anon key can insert rows (RLS off), and active rows would reach the AI prompt for test-number conversations. The change is small: skip corrections when building the prompt, and add a notice in the Training tab. **Recommendation: add it as candidate 2, or accept the risk until 1B.** |
| `wa-media` MIME allow-list and size limit (optional in 1A) | Not included | The plan makes it conditional on an inventory of the file types agents and customers exchange, so that human messaging does not break. That inventory does not exist yet, so the item moves to 1B. |
| Compensating controls for `wa-send` "send" (optional: rate limit, anomaly alert, send log) | Not included | Optional in the plan, and none of them is authentication. Decide whether to add any before 1B. |
| Staging (D2) | Blocked | The owner has to create the project |

**Still open after candidate 1, closed in 1B:** `wa-send` "send" is unauthenticated (Critical); configuration tables are writable with the anon key; `users.password` is plaintext and readable with the anon key.

## 2. Commits

| Commit | Content |
|---|---|
| `4b4d074` | CR-1: `_shared/webhook-auth.ts`, both bots, `wa-webhook`, unit tests |
| `72f5afd` | CR-2 and CR-3: `src/lib/wa.js`, `ChatSettingsModal.jsx`, `.env.example`, `wa-send` |
| `4dff86a` | CR-4: migration 0037, `supabase/ops/0037_preflight.sql`, `_verify.sql`, `_rollback.sql`, database tests |
| `b97a0e9`, `1815208` | Handler tests, including N-02 and N-03 |
| `3208f07` | A comment in `_shared/wa.ts` that still described browser rotation. Comment only. |

## 3. Local test results

All run on `3208f07`.

| Test | Tool | Result |
|---|---|---|
| Decision logic: modes, constant-time comparison, replay rule, header names | `scripts/test-webhook-auth.mjs`, Node 22.23.3 | **8 of 8 pass** |
| Real handlers of all four functions, with `Deno.serve` and `fetch` stubbed and no network permission | `scripts/phase1a-handler-test.ts`, Deno 2.1.4 | **36 of 36 pass.** Against the code before this branch, the same script fails 16 checks, exactly the changed behaviour, and passes the other 20. |
| Migration 0037, applied to the production schema baseline plus the synthetic seed | `scripts/phase1a-db-test.mjs`, PGlite 0.3.15 | **24 of 24 pass** |
| Type check of the four functions | `deno check` | The same single error before and after, in unchanged code (`_shared/wa.ts`, a role type in `getRecentHistory`). The new module checks clean. |
| ESLint | Project config | Changed files: 0 errors, 0 warnings. Whole repository: 1 error and 2 warnings, both before and after, all in files this change does not touch. |
| Production build | `vite build`, placeholder environment | Passes. The bundle builds the endpoint from `VITE_SUPABASE_URL`; the strings `relay_url` and `set-credentials` no longer appear. |

**What the handler tests prove:**

- With no secret configured, `auto` accepts exactly as today, so deploying changes nothing.
- With a secret, a missing or wrong header gets 401, and nothing is forwarded to the mirror.
- `log` accepts and logs. `enforce` fails closed when no secret is configured.
- N-01: 401, and no ledger row.
- N-02: one session's secret is refused by the other session's bot and mirror.
- N-03: one message id under two event names, then replayed with `x-replay: 1`, runs once.
- `set-credentials` gets 410 without a single read or write.
- No log line contains a secret or a token.

**What the database tests prove:**

- Before 0037 the baseline reproduces production's grants, and anon can bump an unread count, which reproduces the finding.
- After 0037, `0037_verify.sql` passes, anon and authenticated get "permission denied", and the service role still works.
- The schema inventory changes in exactly one row.
- The lead RPC contracts CT-01, CT-02 and CT-03 give identical results before and after.
- The rollback script restores the inventory exactly, and applying 0037 again is safe.

**Production facts checked read-only for this change:**

- No webhook secret exists in `wa_secrets` or in the function environment, so `auto` changes nothing at deploy.
- The stored relay URL equals the derived one, so live sends keep their endpoint.
- The ACL of `wa_bump_unread` was recorded.
- `wa_secrets` is not readable with the anon key.
- No function was deployed after 10:24 UTC.

## 4. Behaviour by mode

| `WA_WEBHOOK_AUTH_MODE` | No secret configured | Secret configured, right header | Secret configured, wrong or missing header |
|---|---|---|---|
| unset or `auto` (default) | Accept, no check (today's behaviour) | Accept | Reject with 401 |
| `log` | Accept, logged | Accept | Accept, logged |
| `enforce` | Reject with 401 | Accept | Reject with 401 |
| `off` | Accept, no check | Accept, no check | Accept, no check |

`x-replay: 1` skips deduplication only when the effective mode is not `enforce`. The mode is one project-wide secret, so the bots and `wa-webhook` always switch together.

## 5. Staging test plan (pending)

To run once the owner has created the staging project. About half a day for the engineer. Staging has no Wasender token, so any send attempt fails with "No Wasender token configured", and no real WhatsApp message can go out. Payloads are synthetic, with all-zero numbers.

| ID | Test | Expected |
|---|---|---|
| S-01 | Apply the baseline and the seed (staging README). Run `schema_inventory.sql` and compare it with production's. | 0 differences, apart from what the README lists as staging-only |
| S-02 | Deploy guard: try a dirty tree and an untagged commit, then `scripts/deploy-functions.sh <staging-ref> whatsapp` from `phase1a/candidate-1`. Then the drift check. | The first two refused; the deploy succeeds; drift check exit 0 |
| S-03 | Mode unset, no secret: a synthetic ignorable event and a synthetic inbound message POSTed to both bots | 200; the inbound message appears in Conversations through the mirror |
| S-04 | `WA_WEBHOOK_AUTH_MODE=log`, synthetic secret in staging `wa_secrets`, wrong header | 200, and a "webhook auth" `mismatch` line in the function logs |
| S-05 | Switch to `enforce` with `supabase secrets set`, with no redeploy | The next request without the header gets 401. Confirms that the mode changes without a deploy. |
| S-06 | `enforce`: no header, wrong header, the other session's secret, the right header | 401, 401, 401 (N-02), 200 with the mirror row written |
| S-07 | N-03: one message id as `messages-personal.received`, then as `messages.received`, then again with `x-replay: 1` | One message row, one ledger claim |
| S-08 | `enforce` with the secret row removed | 401 (fails closed). Then restore the secret. |
| S-09 | POST `set-credentials` to `wa-send` | 410; `wa_secrets.updated_at` unchanged |
| S-10 | Test-site build pointed at staging. Open Chat Settings, then send from the composer. | Staging's `wa-send` URL shown read-only; no credential inputs; the POST goes to that URL and fails cleanly with "No Wasender token configured" |
| S-11 | N-09: set staging `wa_settings.relay_url` to `https://example.invalid/x` and send again | The client still posts to the derived URL |
| S-12 | 0037 in staging: preflight, apply, verify; call `/rest/v1/rpc/wa_bump_unread` with the staging anon key; send a synthetic inbound message through `wa-webhook`; roll back; apply again | Preflight shows anon true; verify 5 of 5 PASS; the anon call gets permission denied; the unread count still rises; the rollback restores anon; the second apply passes |
| S-13 | CT-01 to CT-03 in the staging SQL editor, inside a transaction that is rolled back (the same calls as `phase1a-db-test.mjs`) | The same statuses and keys as in the local run |

The results go into section 6 of this report and are attached to CR-001.

## 6. Staging results

Not run yet. The staging project does not exist.

## 7. Risks and unknowns

- Wasender might omit the header on some event types. CR-001 step 5 observes every event type in `log` mode before enforcing.
- Whether Wasender retries a delivery after a 401 is Unknown. A misconfigured enforce could lose messages, so `log` comes first and the rollback takes seconds.
- Whether Wasender invalidates the old API token when a new one is generated is Unknown. Check it in the dashboard before rotating (runbook A).
- No check has yet shown that nothing else calls `wa_bump_unread` with the anon key: the Management API logs endpoint returned errors. CR-001 step 0 does the check in the dashboard.

## 8. Decisions needed

1. Candidate 1 as it stands, or add the corrections change as candidate 2 (section 1).
2. A named reviewer for the diff `dfbd20b..3208f07`.
3. Creation of the staging project, so that S-01 to S-13 can run.
4. After staging: AG-1 approval of CR-001 for production.

## 9. What this phase touched

- Local git only: the branch and tag above. Nothing pushed.
- Production, read-only: the SELECT checks listed in section 3. They used the Supabase CLI login role, the same disclosed effect as Phase 0.
- Local tools in the session scratchpad: Deno 2.1.4, downloaded from the official release and SHA-256-checked against the published checksum; the portable Node 22.23.3; PGlite 0.3.15.
- Not done: no deploy, no migration applied anywhere, no secret set, no Wasender change, no WhatsApp message.
