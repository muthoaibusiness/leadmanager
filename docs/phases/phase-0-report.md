# Phase 0 report: reconciliation, staging preparation, read-only baseline

| | |
|---|---|
| Date | 2026-10-17 (facts current at 11:20 UTC) |
| Scope | Plan Revision 2, Phase 0, as authorised on 2026-10-17 (`docs/decisions/2026-10-17-management-decisions.md`) |
| Result | Reconciliation done. Staging prepared and verified locally; the staging project itself is waiting on the owner. Baseline taken. The Phase 0 exit gate is **not yet met**; section 7 lists what is open. |
| Production changes | None. No deploy, no data or schema change, no WhatsApp message. Section 8 lists every action taken. |

## 1. Summary

- **Every deployed function now has an exact git source, tagged locally.** The two bots running in production match commit `5e370ff` file for file (drift check, exit 0).
- **The deploy freeze is not in effect.** The bots were deployed three times on 2026-10-17, at about 08:00, 09:23 and 10:24 UTC. None of these deploys came from a pushed commit: no remote branch contains the running source (Verified with `git ls-remote` at 11:17 UTC).
- **The test site still uses the production database.** Both public sites embed only the production anon key, and no service-role or secret key (Verified).
- **Staging is ready to build but does not exist.** The available access token cannot see the Supabase organisation, so the owner has to create the project. The production schema baseline and the synthetic seed rebuild production's schema exactly in a local Postgres: 749 of 749 inventory rows, 0 differences.
- **Baseline taken, aggregates only** (section 4). It confirms the audit's security findings and adds one new observation: 117,403 notifications were created in 7 days.
- **One defect in the Phase 0 tooling was found and fixed** (section 5).
- **The "30% booking money" auto-reply (F21, U7) is narrowed down** (section 6). The CRM bots and the composer did not send it.

## 2. Deployed source reconciled with git

| Function | Deployed version (UTC) | Git commit | Local tag | Drift check |
|---|---|---|---|---|
| `wa-bot-eyad` | v35, 2026-10-17 10:24:15 | `5e370ff` (recovered from the deployed bundle) | `deployed/wa-bot-eyad-v35` | Exit 0 at 11:20 |
| `wa-bot-dubai` | v34, 2026-10-17 10:24:35 | `5e370ff` | `deployed/wa-bot-dubai-v34` | Exit 0 at 11:20 |
| `wa-webhook` | v10, 2026-10-14 11:49:17 | `e760194` (existing commit) | `deployed/wa-webhook-v10` | Byte-identical to its tag |
| `wa-send` | v9, 2026-10-14 18:14:48 | `e4162a0`: snapshot of `9fe8c06` plus the deployed `_shared/wa.ts` | `deployed/wa-send-v9` | Byte-identical to its tag |
| `finance` | v18, 2026-10-15 09:03:42 | `3f97106`: snapshot of `a3245ed` plus the deployed `finance-core.ts` and `finance-doc.js` | `deployed/finance-v18` | Byte-identical to its tag |

The two earlier deploys of the day are kept too: v34 and v33 are `6342808` (tags `deployed/wa-bot-eyad-v34` and `deployed/wa-bot-dubai-v33`); v33 and v32 were the starting point.

**What the latest deploy changed.** In v35 and v34 a `messages.upsert` event from a customer is handled as an inbound message. The commit message of `5e370ff` describes it.

**Consequence for the next deploy.** `wa-webhook` v10 and `wa-send` v9 bundle an older `_shared/wa.ts` than the bots. On the reconciled line, none of the 12 symbols `wa-webhook` imports from it, or the 8 that `wa-send` imports, has changed (Verified). Deploying the four WhatsApp functions together from the reconciled line therefore changes those two only in code they never call.

**Where it lives.** Local branch `phase0/reconcile-deployed-2026-10-17`, based on `origin/dev` (`0f9999d`):

| Commit | Content |
|---|---|
| `6342808` | Deployed bot source at v34 and v33 |
| `5e370ff` | Deployed bot source at v35 and v34 |
| `5ac866c` | Phase 0 tooling (section 3), tag `phase0/tooling-2026-10-17` |
| `dfbd20b` | Fix to the schema inventory query (section 5) |

The snapshot commits `e4162a0` and `3f97106` sit on no branch; only their tags hold them. **Nothing is pushed.** Pushing the branches and the tags needs approval.

## 3. Staging preparation (D2)

**Ready, in commit `5ac866c`:**

| File | Purpose |
|---|---|
| `supabase/ops/phase0/generate_schema_baseline.sql` | Read-only catalog query that writes the schema as DDL |
| `scripts/baseline-to-sql.mjs` | Turns its output into one SQL file |
| `supabase/baseline/production-schema-2026-10-17.sql` | 250 statements: 34 tables, 16 functions, 11 triggers, 54 constraints, 47 indexes, grants, RLS, policies, buckets. No data and no secrets. It is never applied to production. |
| `supabase/ops/phase0/schema_inventory.sql` | Normalised list of schema objects for comparisons |
| `supabase/ops/phase0/baseline_metrics.sql` | The aggregate metrics in section 4 |
| `scripts/baseline-smoke-test.mjs` | Applies baseline and seed to a local Postgres (PGlite) and compares inventories |
| `supabase/staging/seed_synthetic.sql` | Synthetic data only: 2 companies (one a second test tenant), 3 teams, 6 users with random passwords and `.invalid` emails, 6 agent routes with all-zero phone numbers, bot settings with the AI agent off, 11 projects and 4 knowledge rules copied from production (business content, no personal data), no secrets |
| `supabase/staging/README.md` | Staging runbook: rules, owner steps, engineer steps |
| `scripts/deploy-functions.sh` | Deploy guard: refuses a dirty tree, an untagged commit, a partial WhatsApp group, and production without `CONFIRM_PRODUCTION=<sha>` |
| `scripts/check-deployed-drift.sh` | Read-only comparison of deployed bundles with a git revision |

**Verified locally.** Baseline plus seed applied to PGlite gives 749 inventory rows, identical to production's 749, with 0 differences either way. Re-run on 2026-10-17 with the corrected inventory query of section 5: same result. PGlite has no Supabase roles, storage, realtime or vault, so the script stands in for them; the staging apply is the real test.

**Blocked on the owner.**
1. Create the staging project. The access token in use cannot see the organisation `ylppbiadquoteiskszfl`.
2. After the engineer has applied baseline and seed, switch the test site's Netlify environment (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) to staging.

## 4. Read-only baseline, 2026-10-17

Aggregates only, from `supabase/ops/phase0/baseline_metrics.sql`. No names, numbers or message text.

| Area | Measure | Value |
|---|---|---|
| Security | Users / with a hashed password / Supabase Auth users | 28 / 0 / 0 |
| Security | Anon key can read `users.password` | Yes |
| Security | `users` is in the realtime publication | Yes |
| Security | Public tables with RLS off, and writable with the anon key | 21 and 21 |
| Security | Anon key can execute `wa_bump_unread` | Yes. Raw ACL `{=X/postgres,postgres=X/postgres,service_role=X/postgres}`. |
| Security | `wa-media` bucket MIME allow-list | None |
| Bots | Wasender API token stored for eyad, dubai, default | Yes, yes, yes (in `wa_secrets`, which the anon key cannot read) |
| Bots | Webhook secret configured | None, in `wa_secrets` or in the function environment (Verified, names only) |
| Bots | `wa_settings.relay_url` | Equals `<SUPABASE_PROJECT_URL>/functions/v1/wa-send` |
| Bots | FAQ agent for customers, eyad / dubai | Off / off. Test numbers: 2 per bot. |
| Bots | Auto-forward, eyad / dubai | Off / on |
| Traffic, 7 days | Inbound messages, eyad / dubai | 117 / 20 |
| Traffic, 7 days | Outbound messages, eyad / dubai | 183 / 14 |
| Traffic, 7 days | Webhook events: `messages.upsert`, `messages-personal.received`, `message.sent`, `messages.received` | 321, 224, 62, 33 |
| Traffic, 7 days | Dedupe-ledger claims, eyad bot / dubai bot | 99 / 23 |
| Traffic, 7 days | New preleads / new leads | 30 / 20 |
| AI | Bot replies mirrored, 7 days and all time | 36 and 36 |
| AI | Active knowledge rules / corrections | 4 / 0. The corrections table is empty. |
| Delivery | Failed messages (all time) / pending for over 1 hour | 5 / 12 |
| Data | Notifications created in 7 days / notifications without a company | 117,403 / 99,719 |
| Data | Conversations without a company / split conversation pairs | 1,329 / 6 |

**New observation.** 117,403 notifications in 7 days is about 600 per user per day, against 20 new leads in the same week. It suggests a notification loop or a fan-out bug. It is outside Phase 0 and Phase 1A and needs its own investigation.

**Secrets on a developer machine (names and lengths only, Noted).** The local `leadmanager/.env` holds:
- copies of the eyad and dubai Wasender API tokens;
- a 32-character webhook secret for one session, which the server does not have;
- `VITE_SUPABASE_SERVICE_ROLE`, a 219-character service-role key. The `VITE_` prefix makes a local `vite` dev server or build put it into browser code, and on 2026-10-17 the local dev server did serve it.

Neither public site contains it (Verified), because Netlify builds with its own environment. **Remove that line now.** Rotation is assessed in plan §8.4. CR-001 runbooks A and B replace the tokens and do not reuse the local webhook secret.

**Inbound volume** declined from mid-September, with no drop at the 14 October mirror cutover, so there is no sign that messages are being lost in the mirror.

**AI quality baseline.** Not measured. It needs the labelled set E0 and cost approval.

## 5. Tooling defect found and fixed

`schema_inventory.sql` built each function's grant list with `string_agg(..., order by 1)`. Inside an aggregate, `order by 1` sorts by the constant 1, so the list followed the internal order of the ACL. Two databases with the same privileges could report different rows. The Phase 1A rollback test exposed it. Fixed in `dfbd20b`: the list is sorted by the grant text, as the table grants already were. The production inventory was taken again with the fixed query (read-only), and the comparison still shows 0 differences.

## 6. The "30% booking money" auto-reply (F21, U7)

Read-only aggregates over `wa_messages`, with no text printed:

- One fixed text mentioning 30 percent was sent **470 times to 455 conversations** from the Eyad number, from 2026-09-17 to 2026-09-28. It has not appeared since.
- It matches no stored bot welcome message or knowledge rule (compared by fingerprint).
- It was not sent by the CRM composer, which records the sending user, nor by the current bots, whose mirrored sends get a different id format. It reached the CRM through the webhook mirror, as the number's own message.
- So it came from the WhatsApp Business app on that number (a greeting or quick reply) or from another program using the Wasender API, such as an n8n workflow, active in that window.
- Six later messages (2026-10-04, 10-16 and 10-17) mention 30 percent in three other texts. They came the same way, so they were typed on the phone or sent by an external program.

**Owner check:** the n8n execution history and the WhatsApp Business app's automated messages on the Eyad number, for 17 to 28 September.

## 7. Phase 0 exit gate

| Exit criterion (plan Phase 0) | Status |
|---|---|
| Deployed and git source identical for all functions | **Met**, locally tagged. Becomes durable once pushed. |
| Baseline schema rebuilds in staging with no difference | **Partly.** Verified in local PGlite; staging pending (owner). |
| D1 to D6 decided | **Met**, 2026-10-17 |
| E0 labelled: at least 200 turns, κ ≥ 0.8 | **Not started.** It needs a decision on handling the conversation data and labelling time. |
| Baseline report published | **Partly.** Operational baseline in section 4; AI baseline pending cost approval. |
| Deploy freeze agreed (sequence step 1) | **Open.** Three uncoordinated deploys today. |
| n8n workflow inventory exported (sequence step 4) | **Open**, owner |
| Threat model signed off (sequence step 9) | **Open** |
| Architecture decision records for D1 to D14 | D1 to D6 recorded in the decision record; D7 to D14 still open |

## 8. Everything this phase touched

- **Local git only.** Two worktrees in the session scratchpad, the branches `phase0/reconcile-deployed-2026-10-17` and `phase1a/security-fixes-prep`, and the tags listed above. Nothing pushed.
- **Production, read-only.** SELECT queries through the Supabase CLI; function listing and source download; secret **names** (no values or digests); a few aggregate queries to the Management API logs endpoint, which all failed (the old endpoint is removed; the new one returned backend errors).
- **Local `.env`, read only.** Variable names, and for three of them whether the value is empty and its length. The personal access token in it was passed to the CLI and to the Management API through an environment variable. No value was printed or copied.
- **One platform-side effect.** `supabase db query --linked` without a database password makes the CLI create or refresh a temporary login role, `cli_login_postgres`, whose password expires within minutes (Supabase documentation). No application table, schema object, setting or data was changed.
- **Not done.** No deploy, no migration, no data change, no Wasender change, no WhatsApp message, no push.
- **Documents added**, not yet committed, under `docs/`: this report, the decision record, `docs/changes/CR-001-phase-1a-security-fixes.md` and `docs/phases/phase-1a-report.md`.

## 9. Owner actions

1. Create the Supabase staging project (D2), then switch the test site to it once seeded.
2. Agree the deploy freeze on the WhatsApp functions with the team.
3. Approve pushing the branches and tags listed in section 2.
4. Export the n8n workflow inventory, and check the 30% message source (section 6).
5. Decide how conversation data may be used for the E0 labelled set, and approve the cost of the AI baseline.
6. Decide who investigates the notification volume (section 4).
7. Remove `VITE_SUPABASE_SERVICE_ROLE` from the local `.env`, and confirm whether the dev server was ever reachable from outside the machine (section 4).
