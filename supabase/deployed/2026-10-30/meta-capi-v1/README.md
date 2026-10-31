# Production snapshot: `meta-capi` v1

**Read-only evidence and the 0051 rollback bundle. Do not edit these files.**

| | |
|---|---|
| Project | `sbqmougcvnplgjgihpwe` |
| Function | `meta-capi`, version **1**, ACTIVE, `verify_jwt` false |
| Deployed | 2026-10-29 ~12:29 UTC, from the uncommitted worktree `/tmp/wt-capi` (entrypoint path recorded by Supabase), before review |
| Bundle `ezbr_sha256` | `b8102d21cd161b19fe1caf10893ed1bfe904893baf3c68de441e451dfac21b6b` |
| Retrieved | Supabase MCP `get_edge_function` on 2026-10-29 and again on 2026-10-30; both returned version 1 and the same bundle hash |
| Verified | The three files are byte-identical to the 2026-10-29 MCP response (`SHA256SUMS`) |

v1 needs migration 0050 only. It reads leads directly, takes the lead lock with `capi_try_lock`, and has no agent-qualification check, shared limiter or bot switch.

**Roll back 0051:** redeploy these three files as `meta-capi` (entrypoint `functions/meta-capi/index.ts`, `verify_jwt` false) first, then run `supabase/rollback/0051_down.sql`. v1 also runs unchanged on a database with 0051 applied, so redeploying it alone is a safe partial rollback.

**Secrets:** none. Secrets are read only through `Deno.env.get`. The dataset and page ids are identifiers, not credentials.
