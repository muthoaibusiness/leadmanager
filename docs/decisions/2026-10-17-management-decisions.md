# Decision record: WECON AI workflow platform, management decisions

| | |
|---|---|
| Date | 2026-10-17 |
| Status | Approved in principle by management. This is not approval for an unrestricted production rollout. |
| Decided by | Management (recorded from the approval message of 2026-10-17) |
| Applies to | `docs/plans/wecon-visual-ai-workflow-plan.md` (Revision 2) and every change made under it |
| Background | `docs/audits/wecon-ai-agent-audit.md` |

## Decisions

| ID | Decision | What it means in practice | Gate before it takes effect |
|---|---|---|---|
| D1 | Move login to Supabase Auth, with an identity the server can verify, and row-level security (RLS). | No privileged action may rely on a user id sent by the browser as authentication. Until Phase 1B ships, privileged actions that depend on such an id are disabled, not reworked. | AG-3: rehearsal in staging, a user communication plan, the reset-link delivery method, a break-glass path, and contracts CT-09 to CT-12 passing |
| D2 | Use a separate Supabase staging project. | The test site must stop using the production database. Today it uses it: both public sites embed the production anon key and no other (Verified on 2026-10-17). | The owner creates the project. The available access token cannot see the organisation. |
| D3 | Keep Wasender for the current integration. | No provider migration. Automated follow-ups stay disabled. | AG-8: a separate approval for any automated follow-up |
| D4 | `properties` is the canonical project identity, with versioned AI profiles. | `wa_projects` stays until its foreign keys, `site_visits`, the n8n writers and legacy compatibility are reconciled. No project is enabled for AI before its inclusion and approved facts are confirmed. | AG-6 for each project |
| D5 | Keep an adapter boundary for AI providers. | Benchmark the current provider against Anthropic on the same labelled evaluation set before deciding whether both adapters are needed. | Labelled set E0, and approval of the benchmark cost |
| D6 | Live-inventory answers stay disabled by default. | The bot offers a meeting instead, until a project-specific inventory policy is approved. | AG-7 for each project |

## Corrections required before implementation

Each correction is now in plan Revision 2. The section numbers refer to the plan.

| Correction | Where it is addressed |
|---|---|
| Replace the end-to-end "exactly once" sending claim with precise guarantees for deduplication, idempotent enqueueing, provider reconciliation and uncertain outcomes. | §4.10 send outcomes; §9.1 guarantees G3, G4, G4a, G4b. End-to-end exactly-once delivery is not claimed. |
| Define the real PostgreSQL transaction boundary for lead creation, conversation state, audit and outbox effects. | §4.9: seven single-transaction database functions, T1 to T7. Separate Edge Function or RPC calls are never treated as one transaction. |
| Do not describe the interim user-id lookup as authentication. | §8.1 and Phase 1. The browser credential-rotation path is disabled in Phase 1A. `wa-send` "send" is recorded as unauthenticated until Phase 1B. |
| Reassess credential exposure: safe resets for all affected users, session invalidation, secret rotation. | §8.4: all 28 passwords are treated as exposed; no password is carried over; every session ends at cutover; a secret inventory with rotation timing. |
| Describe the Wasender header check accurately. | Shared-secret verification everywhere. Wasender sends the secret itself, not a signature of the body. |
| Preserve existing lead RPC contracts, agent commands, Meta CAPI, human messaging and external n8n workflows. | §11.5 compatibility contracts CT-01 to CT-15, tested before and after each change |

## Authorised scope now

1. Phase 0: reconcile deployed source with git, prepare staging, take the read-only baseline.
2. After reconciliation: prepare the narrowly scoped security fixes, test them in staging, and submit the results for review.
3. An emergency security hotfix only through an explicitly reviewed, clean and traceable deployment (plan §11.3).

## Not authorised without its own approval

- Any production change (AG-1). Before the first one: a short change record with the decision, implementation sequence, rollback procedure, affected components and verification checklist. The first one is `docs/changes/CR-001-phase-1a-security-fixes.md`.
- Customer-facing AI (AG-5), project AI enablement (AG-6), inventory answers (AG-7), automated follow-ups (AG-8).
- Broad production schema changes (AG-4) and the login cutover (AG-3).

## Reporting

Each phase is reported on its own, and scope is not expanded without saying so. Reports: `docs/phases/phase-0-report.md` and `docs/phases/phase-1a-report.md`.
