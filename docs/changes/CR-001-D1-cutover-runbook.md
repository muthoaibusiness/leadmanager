# CR-001 D1: verified sign-in cutover runbook

| | |
|---|---|
| Status | **Draft. Local rehearsal only. Nothing here has run against production.** |
| Date | 2026-10-31 |
| Gate | AG-3 (auth cutover, plan §11.8). Every production step below needs its own approval. |
| Code | Working tree on `asad-dev`, uncommitted. Migrations 0054 and 0055 are written and tested locally, not applied. |
| Decisions | D1 (no browser-supplied user id as authentication). See `docs/decisions/2026-10-17-management-decisions.md`. |

## 1. What ships together

None of these can go live alone. The client signs in with Supabase Auth; 0054 and 0055 then refuse the anon key, so a partial rollout empties every page.

| Part | What it does | Evidence (local) |
|---|---|---|
| Client (`src/`) | Supabase Auth sign-in and refresh (`auth.js`); session token on every request; Access Management tab; feature changes through `access-admin`; send endpoint fixed at build time | Unit tests; browser walk of 5 real roles on the restored copy |
| `access-admin` function | Role, features, projects, status, password reset, create, delete | 19 unit tests, end-to-end 13/13 |
| `finance`, `ai-trainer`, `wa-send`, `meta-capi` | Caller from the verified session (`actor.ts`); `body.userId` ignored | Unit tests; forged ids refused end-to-end |
| `wa-send` | Verified session, then `checkWaSend`: chat switched on, the numbers' company, the thread's company and lead, an agent only on a lead it holds, `to` equal to the thread's phone, `clientRef` the sender's own PENDING message; the sending number comes from the thread | `wa-send-chat.test.ts`; rehearsal: cross-company, unassigned and rewritten-`to` sends refused before the stub |
| `wa-followup` | `x-followup-key` header gate, fail closed (`cron-key.ts`): without `FOLLOWUP_CRON_KEY` every call is 503 | Unit tests; local pg_cron end-to-end |
| Migration 0054 | `users.auth_user_id`; `users` closed to anon; `access_audit`; `crm_revoke_sessions` | `scripts/test-0054.mjs` |
| Migration 0055 | The other 20 tables closed to anon, company-scoped; WhatsApp threads belong to their company, or to the numbers' company (`wa_settings.company_id`) when they carry none; messages follow their thread; anonymous uploads to `wa-media` and `project-media` closed; deactivated tokens read nothing; bot RPCs service-only | `scripts/test-0055.mjs` |
| `scripts/auth-migrate.mjs` | One Auth user per active account, no usable password, one-time recovery link | `scripts/auth-migrate.test.mjs` |
| `scripts/breakglass-admin.mjs` | Recovers a Management account | `scripts/breakglass-admin.test.mjs` |

Meta CAPI sending stays off: `meta-capi` still refuses retry and the settings and bot switches unless `CAPI_ALLOW_UNVERIFIED_ACTOR=local`, and nothing here enables `CAPI_SCHED_SEND`.

## 1a. Local rehearsal result (2026-10-31)

On a fresh local stack restored from the 2026-10-30 backup, in runbook order: 0053, 0054, 0055, the six changed functions, `auth-migrate.mjs` (27 accounts, one-time links only, no shared password), then the client built against that stack. `scripts/cr001-staging-rehearsal.mjs` passed 12/12 three runs in a row:

- every role signed in through its own one-time link with its own password, and every page it uses loaded in the built client;
- another company saw none of company c1;
- a deactivated account's token read and wrote nothing and could not refresh;
- a human WhatsApp send reached a local Wasender stub once and became SENT;
- the follow-up cron job, with its key, moved a prelead and sent once, and a call without the key got 401;
- break-glass recovered `admin@gmail.com` and ended its older sessions;
- the last Management account could not be removed.

Restored data (27 users, 2814 leads, 15011 activities) was unchanged afterwards. Not covered locally: Netlify deploys, real email delivery of the links, and Storage files.

## 2. Staging (D2)

1. The owner creates a separate Supabase project for staging. It must not share keys with production.
2. Restore and verify:
   ```
   STAGING_DB_URL=<staging db url> BACKUP_DIR=~/wepro-backups/<stamp> \
   CONFIRM_TARGET=<host:port of that url> scripts/staging-restore-check.sh
   ```
   The script refuses the production ref, a mismatched `CONFIRM_TARGET` and a non-empty database. It removes live tokens, switches Meta CAPI off, re-applies 0053 and compares every table's row count with the dump. Rehearsed locally on 2026-10-31: 61 tables, 0 mismatches, `RESTORE CHECK PASS`.
3. The dump does not hold Auth users, Storage files (490 objects, about 2.3 GB), pg_cron jobs, Vault secrets, function code or secrets. Recreate what staging needs; never copy production secrets.

## 3. Cutover order (staging first, then production with approval)

1. Apply 0054, then 0055.
2. Deploy `access-admin`, `finance`, `ai-trainer`, `wa-send`, `meta-capi` and `wa-followup` from the same commit.
3. `scripts/auth-migrate.mjs` dry run, then `--apply --confirm <url> --out <file> --redirect <app url>`. Deliver each link to its owner out of band, then delete the file.
4. Deploy the client.
5. Recover the first admin if needed: `scripts/breakglass-admin.mjs` (section 5).
6. Run the checks in section 6.

`wa-followup`, before it is deployed in step 2 (it fails closed):

1. Set the `FOLLOWUP_CRON_KEY` secret (at least 32 random characters).
2. Update the `wa-followup` cron job to send the same value in `x-followup-key`.
3. Deploy `wa-followup`, then confirm the next run returns 200.

Without the secret every call gets 503, so no follow-up is sent until steps 1 and 2 are done. A cron job without the header gets 401.

## 4. Passwords (plan §8.4)

- No password is carried over and none is shared. `auth-migrate.mjs` gives each sign-in a random password nobody sees; the owner sets their own through the one-time link.
- The local copy used one shared test password for all 27 accounts. That is for local testing only and must never be used on staging or production.
- `users.password` is left in place by 0054 and 0055 so the rollback has it. Clear it, then drop the column, in a later migration once the cutover has held.
- Users who reused their CRM password elsewhere are told to change it there.

## 5. Admin recovery

```
SUPABASE_URL=<project url> SUPABASE_SERVICE_ROLE_KEY=<service role> BREAKGLASS_PASSWORD=<10+ chars> \
node scripts/breakglass-admin.mjs --email admin@gmail.com --confirm <project url>
```

This links or resets the sign-in of a Management account, reactivates it, ends its older sessions and writes `access_audit`. It is an approved emergency change: record who ran it and when.

## 6. Checks after each step

- Every role signs in and its pages load: `scripts/cr001-roles-ui.mjs` (local), or by hand on staging.
- The anon key reads nothing: `curl <url>/rest/v1/leads?select=id -H "apikey: <anon>"` returns `[]` or 401.
- A deactivated account's still-valid token reads nothing (0055 checks `is_active` on every request).
- A human WhatsApp send from Conversations reaches SENT.
- `wa-followup` cron runs return 200.
- The Meta CAPI switches are unchanged.

- Query time under 0055 on the busiest table. Locally, as the user with the most notifications (9203 rows), the list query took 24–39 ms through the policy against 23 ms without it. Three requests timed out (8 s, `57014`) only while the machine was running two other database stacks and disk checkpoints took 42–155 s. On staging, watch the API logs for `57014` during the first hour.

## 7. Rollback

| Step | Rollback | Loses |
|---|---|---|
| 0055 | `supabase/ops/0055_rollback.sql` | Nothing |
| 0054 | `supabase/ops/0054_rollback.sql` (keeps `auth_user_id` and `access_audit`) | Nothing |
| Functions | Redeploy the previous versions | Nothing |
| Client | Publish the previous Netlify deploy | Users sign in the old way again |
| Auth users | Keep them; they are inert without the new client | Nothing |

Roll back in the reverse order: client, then functions, then 0055, then 0054.

## 8. Known limits after cutover

- **0055 is an interim security boundary, not least-privilege authorization.** It separates companies and shuts out anonymous and deactivated callers. Inside a company every active account can still read, and write, every lead, activity, booking and notification, whatever its role, exactly as the app allows today. Role-level policies (an agent sees only its own and previously assigned leads, a Team Lead its team) are a separate change that needs its own design and approval.
- The `finance` page is unchanged in behaviour, but it now needs a session.
- A deactivated account is signed out by the client within 5 minutes, or at once when its tab regains focus (`sessionStillValid`). Its access token reads nothing through PostgREST meanwhile (0055); Realtime may still push events to an open socket until the token expires (up to 1 hour).
- Profile photos in Conversations stay as initials: `wa-send` never had a `get-avatar` action, so that request always failed. It is now not sent.
- The Team Lead dashboard calls three rollup RPCs that do not exist in production (`dashboard_rollup`, `agent_lead_stats`, `activity_rollup`) and selects `leads.offer_sent_at`, which does not exist either. The app falls back to in-browser rollups. This predates CR-001 and is unchanged.
