# CR-001: Phase 1A security fixes

| | |
|---|---|
| Status | **Draft for review. Staging tests pending. Not approved for production.** |
| Date | 2026-10-17 |
| Gate | AG-1, first production change (plan §11.8). It is not an emergency hotfix (AG-2). |
| Code | Local branch `phase1a/security-fixes-prep`, tag `phase1a/candidate-1` = `3208f07`. Review range: `dfbd20b..3208f07`. Not pushed. |
| Based on | `dfbd20b`, the reconciled Phase 0 line. Its bots match production exactly: `wa-bot-eyad` v35 and `wa-bot-dubai` v34 (drift check, 2026-10-17 11:20 UTC). |
| Decisions | D1 (no browser-supplied user id as authentication), D3 (Wasender stays). See `docs/decisions/2026-10-17-management-decisions.md`. |
| Approvals needed | Management for AG-1; a named reviewer for the diff; the owner for the Wasender dashboard steps |

## 1. Decision

Close four holes that need no change to login. Each fix is small, can be reversed on its own, and changes nothing customers see.

| ID | Problem today | Fix |
|---|---|---|
| CR-1 | `wa-bot-eyad` and `wa-bot-dubai` accept any POST. Anyone with a function URL can inject customer messages, trigger bot replies, and use `x-replay: 1` to re-run processed events. | Both bots and `wa-webhook` verify the Wasender webhook **shared secret** in `X-Webhook-Signature`. Wasender sends the secret itself, not a signature of the body. A mode switch stages the rollout: `auto` (default), `log`, `enforce`, `off`. `x-replay` is ignored under enforce. |
| CR-2 | The browser reads the send endpoint from `wa_settings.relay_url`, which anyone with the public anon key can change, and POSTs every outbound message there. | The endpoint is fixed at build time: `VITE_WA_RELAY_URL`, or else `<VITE_SUPABASE_URL>/functions/v1/wa-send`. The stored value is ignored. Production's stored value already equals the derived URL (Verified, read-only), so live sends go where they go today. |
| CR-3 | Chat Settings posts a new Wasender token, and the webhook secret, to that same database-controlled URL. `wa-send` authorises the change by looking up a user id the browser supplies, which is not authentication. | `wa-send` answers `set-credentials` with HTTP 410. The browser sends credentials nowhere. An operator rotates them with runbook A until Phase 1B. |
| CR-4 | The anon key can execute `wa_bump_unread`, a `SECURITY DEFINER` function, and rewrite any conversation's unread count, preview and time. Migration 0007 revoked anon and authenticated, but not `PUBLIC`. | Migration 0037: revoke `EXECUTE` from `PUBLIC`, anon and authenticated; keep `service_role`. Privileges only. |

**Not fixed by this change. These remain known risks until Phase 1B:**

- `wa-send` "send" is unauthenticated (Critical). Anyone with the function URL can send WhatsApp messages from either business number.
- The configuration tables `wa_settings`, `wa_bot_settings`, `wa_knowledge` and `wa_message_corrections` are writable with the anon key.
- `users.password` is plaintext and readable with the anon key.

## 2. Affected components

| Component | Change | Deploy unit | Visible effect |
|---|---|---|---|
| `wa-bot-eyad`, `wa-bot-dubai` | CR-1. New `_shared/webhook-auth.ts`. | WhatsApp function group | None while the mode is `auto` and no secret exists, which is production today (Verified) |
| `wa-webhook` | CR-1. `auto` is exactly its current rule. | Same group | None |
| `wa-send` | CR-3: `set-credentials` returns 410. "send" is unchanged. | Same group | None for sending |
| `_shared/wa.ts` | A comment only. `wa-webhook` and `wa-send` currently bundle an older copy. None of the 12 symbols `wa-webhook` imports, or the 8 that `wa-send` imports, differs (Verified). | Same group | None |
| Web app (`src/lib/wa.js`, `ChatSettingsModal.jsx`, `.env.example`) | CR-2 and CR-3 | Netlify: `dev` (test site), then `main` (live site) | Chat Settings shows the relay URL read-only, and the credential inputs are replaced by a notice |
| Database | Migration 0037 | SQL editor | None |
| Configuration (activation only) | Edge secret `WA_WEBHOOK_AUTH_MODE`; one webhook secret per Wasender session; `wa_secrets.webhook_secret` | Dashboard or CLI | None in `log`. Forged deliveries rejected in `enforce`. |

Unchanged, and tested before and after: the `wa_create_lead` and `wa_upsert_prelead` contracts (CT-01 to CT-03), the agent commands, Meta CAPI, human sending from the composer, and the request shapes of every function. Edge secrets are project-wide (one list per project, Verified), so all four functions always see the same mode.

## 3. Preconditions

All must hold before step 1.

- [ ] Management has approved this record (AG-1), and a named reviewer has approved the diff `dfbd20b..3208f07`.
- [ ] The staging results in `docs/phases/phase-1a-report.md` §5 are attached and pass. This needs the staging project (D2), which the owner has to create.
- [ ] A deploy freeze on the WhatsApp functions is agreed. Production received three uncoordinated deploys on 2026-10-17.
- [ ] The Phase 0 and Phase 1A branches and tags are pushed, so the deployed commit can be traced outside one machine.
- [ ] Production is still at `wa-bot-eyad` v35, `wa-bot-dubai` v34, `wa-webhook` v10 and `wa-send` v9 (`supabase functions list`). If anything changed, reconcile again first.

## 4. Implementation sequence (production)

Run the steps in order. Each one can be rolled back on its own (section 5). Stop at the first failed check.

**Step 0. Record the starting state.**
- `supabase functions list` (versions and times).
- `scripts/check-deployed-drift.sh sbqmougcvnplgjgihpwe deployed/wa-bot-eyad-v35 wa-bot-eyad wa-bot-dubai`. It must exit 0.
- Run `supabase/ops/0037_preflight.sql` and keep the output. Expected section C: `{=X/postgres,postgres=X/postgres,service_role=X/postgres}`.
- Dashboard, Logs, API (edge logs), last 7 days: requests whose path contains `/rpc/wa_bump_unread`. Any request made with the anon key means a client other than `wa-webhook` calls it, for example an n8n workflow. Stop and review. (The Management API logs endpoint returned errors on 2026-10-17, so this check was not done in Phase 0.)

**Step 1. CR-4: migration 0037.**
- Apply `supabase/migrations/0037_revoke_public_execute_wa_bump_unread.sql` in the SQL editor.
- Run `supabase/ops/0037_verify.sql`. All 5 rows must say PASS.
- For 30 minutes: new inbound messages raise the unread badge in Conversations, and the edge logs show no 401 or 403 on `/rpc/wa_bump_unread`.

**Step 2. Deploy the WhatsApp function group (CR-1 dormant, CR-3 server side).**
- Confirm `WA_WEBHOOK_AUTH_MODE` is **not** set: `supabase secrets list` shows names only.
- With the tag checked out: `CONFIRM_PRODUCTION=3208f07 scripts/deploy-functions.sh sbqmougcvnplgjgihpwe whatsapp`. The script refuses a dirty tree, an untagged commit or a partial group. On a machine without npm, set `SUPABASE_CLI` to the path of a Supabase CLI 2.120.0 binary; the path must not contain spaces.
- `scripts/check-deployed-drift.sh sbqmougcvnplgjgihpwe phase1a/candidate-1 wa-bot-eyad wa-bot-dubai wa-webhook wa-send` must exit 0.
- For 60 minutes: inbound messages keep appearing in Conversations; `wa_webhook_events` keeps receiving claims from both bots; no new errors in the function logs. No "webhook auth" lines are expected, because no secret exists.
- One POST of `{"action":"set-credentials"}` to `wa-send` returns 410. It is rejected before any read or write.

**Step 3. Deploy the web app (CR-2, CR-3 client side).**
- Through the normal git flow: `dev`, so the test site first, then `main` for the live site.
- Chat Settings shows `https://sbqmougcvnplgjgihpwe.supabase.co/functions/v1/wa-send` read-only and no credential inputs.
- An operator sends one message from the composer to an internal test number (CT-09). The browser's network panel shows the POST going to that URL, and the message reaches SENT. This is a real WhatsApp send, so it is approved as part of this record.

**Step 4. Rotate the Wasender API tokens (runbook A).**
- Do this only after steps 2 and 3, which close the path the old browser flow could leak a token through (plan §8.4).

**Step 5. Activate webhook verification (CR-1).**

> **Warning.** Set `log` mode before any webhook secret exists on the server. In `auto` mode a stored secret is enforced at once. If Wasender is not yet sending that secret, every inbound message is rejected until the secret is removed or the mode is changed.

- 5a. `supabase secrets set WA_WEBHOOK_AUTH_MODE=log`. Supabase documents that functions read a new secret immediately, without a redeploy. Staging test S-05 confirms it.
- 5b. Create and configure one secret per session (runbook B).
- 5c. Observe for at least 24 hours, until every event type in `wa_webhook_events` has occurred: the function logs must show no "webhook auth" line while that traffic flows. Only non-matching outcomes are logged.
- 5d. `supabase secrets set WA_WEBHOOK_AUTH_MODE=enforce`. A POST without the header to each bot URL returns 401, and nothing is processed or forwarded.
- 5e. For 72 hours, inbound counts per day stay in line with the baseline: the ledger claims compared with `wa_messages` IN rows.

## 5. Rollback

| Step | Rollback | Time | Data impact |
|---|---|---|---|
| 1 | Run `supabase/ops/0037_rollback.sql`. The preflight then shows the same grantees as before; entry order may differ. | Seconds | None: privileges only |
| 2 | Fastest for CR-1: `supabase secrets set WA_WEBHOOK_AUTH_MODE=off`, no deploy. Full: redeploy the group from tag `deployed/wa-bot-eyad-v35` (`5e370ff`) with `CONFIRM_PRODUCTION=5e370ff`. Its bots are byte-identical to today's. Its `wa-webhook` and `wa-send` index files are identical to today's, and their shared code differs only in symbols they do not import (Verified). | Seconds, or minutes | None |
| 3 | Netlify: publish the previous deploy, for each site. The old client would again offer credential rotation, which `wa-send` refuses with 410 while step 2 stands. | Minutes | None |
| 4 | Fix forward: generate another token. Whether Wasender invalidates the old token on regeneration is Unknown; check it in the dashboard. | Minutes | None |
| 5 | `WA_WEBHOOK_AUTH_MODE=log` or `off`. The secrets can stay. Wasender's retry behaviour after a 401 is Unknown, so a message rejected during a mistake may not come back. Count `wa_messages` against the ledger for the affected window. | Seconds | Possible lost inbound messages during a misconfiguration |

## 6. Verification checklist

Record each result, with time and operator, in the change log.

- [ ] Preconditions in section 3 all hold
- [ ] Step 0 outputs saved: function list, drift check exit 0, 0037 preflight, edge-log check showing no anon callers
- [ ] 0037 verify: 5 of 5 PASS
- [ ] Unread badge still rises for new inbound messages
- [ ] Drift check against `phase1a/candidate-1`: exit 0 for all four functions
- [ ] Inbound processing normal for 60 minutes after step 2: Conversations, ledger claims, no new errors
- [ ] `set-credentials` returns 410
- [ ] Live and test sites show the fixed relay URL, and the credential inputs are gone
- [ ] CT-09: composer send to an internal test number reaches SENT
- [ ] Tokens rotated (runbook A), with operator and time recorded, and no token value recorded
- [ ] `log` mode set before any webhook secret was stored
- [ ] No "webhook auth" line for 24 hours or more, with traffic seen for every event type
- [ ] `enforce` set; a header-less POST returns 401 from both bots
- [ ] 72 hours of inbound counts in line with the baseline

## 7. Risks

| Risk | Mitigation |
|---|---|
| Wasender omits the header on some event types | Step 5c observes every event type in `log` before enforcing |
| The secret is stored before `log` mode is set, and inbound stops | The warning in step 5. Rollback with `off` takes seconds. |
| 0037 breaks an unknown anon caller, for example n8n | The edge-log check in step 0. Rollback takes seconds. The n8n exports in `config/` do not call the function. |
| A webhook secret leaks | It is never logged (tested). Rotate with runbook B, which is the same steps. |
| `wa_secrets` cannot be read during a database incident | `auto` and `log` accept, as today. `enforce` rejects unless an environment fallback (`WASENDER_WEBHOOK_SECRET_EYAD` or `_DUBAI`) is set. During such an incident processing fails anyway. |
| One more database read per webhook delivery in the bots | Small: one indexed primary-key read. `wa-webhook` already does it. |

---

## Appendix A. Runbook: rotate a Wasender API token (until Phase 1B)

Who: an administrator signed in with their **own** Supabase account (verifiable) and with access to the Wasender dashboard.
When: after CR-001 step 3; on suspected exposure; when staff with access leave.

1. Check which rows hold a token, without showing it. In the SQL editor:
   ```sql
   select id, api_token is not null and api_token <> '' as has_token,
          left(md5(coalesce(api_token, '')), 8) as fingerprint, updated_at
     from public.wa_secrets order by id;
   ```
   `getCredentials` uses the account row (`eyad` or `dubai`), then the `default` row, then the `WASENDER_API_TOKEN_<ACCOUNT>` and `WASENDER_API_TOKEN` environment secrets. Equal fingerprints mean equal tokens.
2. In the Wasender dashboard, generate a new API key for the session.
3. Store it, typing the value directly into the SQL editor:
   ```sql
   update public.wa_secrets
      set api_token = '<new token>', updated_at = now(), updated_by = '<operator name>'
    where id = 'eyad';   -- or 'dubai'; also 'default' if step 1 showed the same fingerprint
   ```
   Do not save the query as a snippet, and clear the editor afterwards. If the `WASENDER_API_TOKEN` environment secret holds the old token, replace it as well: `supabase secrets set WASENDER_API_TOKEN=<new token>`.
4. Verify: repeat step 1 (new fingerprint, new `updated_at`). Then the composer send of CR-001 step 3, to an internal test number.
5. Record in the change log: the time, the operator, the session and the rows changed. Never the token.
6. Copies of the current eyad and dubai tokens sit in a developer's local `.env` (names checked 2026-10-17). After rotation they no longer work. Do not copy the new tokens into developer files; local development does not need them.

## Appendix B. Runbook: webhook secret for a Wasender session

1. Confirm `WA_WEBHOOK_AUTH_MODE=log` is set (CR-001 step 5a). Never do step 4 first.
2. Generate a random secret of 32 bytes from a cryptographic generator, one per session, never reused. A 32-character webhook secret for one session already sits in a developer's local `.env`, while the server holds none. Wasender may already be sending it. Do not reuse it: it has left the server side. Do not use `Get-Random`, which is not meant for secrets. PowerShell:
   `$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)`
   or, with OpenSSL, `openssl rand -base64 32`.
3. In the Wasender dashboard, set it as the session's webhook secret. Wasender then sends it in `X-Webhook-Signature` on every delivery.
4. Store it on the server:
   ```sql
   update public.wa_secrets
      set webhook_secret = '<secret>', updated_at = now(), updated_by = '<operator name>'
    where id = 'eyad';   -- the dubai session gets its own secret
   ```
   No `wa_secrets` row and no environment secret held a webhook secret on 2026-10-17 (Verified), so nothing else needs clearing.
5. Watch the logs of `wa-bot-eyad`, `wa-bot-dubai` and `wa-webhook` for "webhook auth" lines. `mismatch` means the two values differ. `missing_header` means Wasender did not send the header for that event type.
6. Record the time, the operator and the session in the change log. Never the secret.
