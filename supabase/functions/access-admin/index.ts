// access-admin: role, feature access, projects, active status, password reset,
// and account create/delete (CR-001 D1). The caller is the verified Supabase
// Auth session (actor.ts); the rules are access-rules.js, shared with the app.
// Logic: ../_shared/access-admin-core.ts, tested under Node.
//
// Deploy (owner approval required; needs migration 0054):
//   npx supabase functions deploy access-admin --no-verify-jwt
// --no-verify-jwt only so OPTIONS preflight works; every POST is verified by
// verifiedActor against GoTrue.
import { handleAccessAdmin } from "../_shared/access-admin-core.ts";
import { restAdminDeps } from "../_shared/access-admin-rest.ts";
import { verifiedActor, actorDepsFromEnv, ActorError } from "../_shared/actor.ts";

const env = (k: string) => Deno.env.get(k);
const actorDeps = actorDepsFromEnv(env);
const deps = restAdminDeps({ url: env("SUPABASE_URL") ?? "", serviceKey: env("SUPABASE_SERVICE_ROLE_KEY") ?? "", fetch: (u, i) => fetch(u, i) });
const CORS = {
  "Access-Control-Allow-Origin": env("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }
  try {
    const actor = await verifiedActor(req, actorDeps);
    const r = await handleAccessAdmin(actor, body, deps);
    return json(r.body, r.status);
  } catch (e) {
    if (e instanceof ActorError) return json({ ok: false, error: e.message }, e.status);
    console.error("access-admin error", e);
    return json({ ok: false, error: "Something went wrong" }, 500);
  }
});
