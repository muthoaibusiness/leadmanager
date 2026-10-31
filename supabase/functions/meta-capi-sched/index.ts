// meta-capi-sched: the pg_cron target for scheduled Meta CAPI work (migration
// 0052). Server-to-server only; there is no browser user, so the operator's
// deploy switch authorizes it, not an actor check. It reuses the same deps as
// meta-capi (capi-rest.ts). Real sending stays OFF unless the deployer sets
// CAPI_SCHED_SEND=true, and even then the CR-001 D1 verified-sign-in blocker
// must be resolved first (see capi-core.ts decision D1). Until then the send
// job only dry-runs.
import { restDeps } from "../_shared/capi-rest.ts";
import { runSched, type SchedGates } from "../_shared/capi-sched.ts";

const deps = restDeps({
  url: Deno.env.get("SUPABASE_URL") ?? "",
  serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  token: () => Deno.env.get("META_CAPI_ACCESS_TOKEN") ?? "",
  fetch: (u, i) => fetch(u, i),
  now: () => Date.now(),
});

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  const key = Deno.env.get("CAPI_SCHED_KEY");
  if (!key) return json({ ok: false, error: "Scheduler is not configured (CAPI_SCHED_KEY missing)" }, 503);
  if (req.headers.get("x-api-key") !== key) return json({ ok: false, error: "Unauthorized" }, 401);
  let body: { action?: string };
  try { body = await req.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }
  const gates: SchedGates = {
    sendEnabled: Deno.env.get("CAPI_SCHED_SEND") === "true",
    maxBatch: Number(Deno.env.get("CAPI_SCHED_BATCH") ?? 50),
  };
  try {
    const data = await runSched(body.action === "send" ? "send" : "check", deps, gates, Date.now());
    return json({ ok: true, data });
  } catch (e) {
    console.error("meta-capi-sched error", e instanceof Error ? e.message : e);
    return json({ ok: false, error: "Something went wrong" }, 500);
  }
});
