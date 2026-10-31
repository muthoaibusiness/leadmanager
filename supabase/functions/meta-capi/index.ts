// meta-capi: the server side of Admin › Meta CAPI. All logic is in
// ../_shared/capi-core.ts (actions, access, eligibility, Meta outcome) and
// ../_shared/capi-rest.ts (PostgREST + Meta), both Deno-free and tested under
// Node (npm run test:capi). Needs migrations 0050 and 0051.
//
// Deploy (owner approval required):
//   npx supabase functions deploy meta-capi --no-verify-jwt
//
// --no-verify-jwt only so OPTIONS preflight works; every POST is checked
// against the caller's Supabase Auth session (actor.ts, decision D1), then the
// account's role or 'metacapi' grant (capi-core.ts loadActor). META_CAPI_ACCESS_TOKEN is
// read here and never returned.
import { handleCapi } from "../_shared/capi-core.ts";
import { restDeps } from "../_shared/capi-rest.ts";

const deps = restDeps({
  url: Deno.env.get("SUPABASE_URL") ?? "",
  serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  anonKey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
  token: () => Deno.env.get("META_CAPI_ACCESS_TOKEN") ?? "",
  fetch: (u, i) => fetch(u, i),
  now: () => Date.now(),
  // Unset in production: sending and settings stay off until verified sign-in
  // exists (CR-001 D1). A local development stack sets it to "local".
  allowUnverified: Deno.env.get("CAPI_ALLOW_UNVERIFIED_ACTOR") ?? "",
  // Local development only: a Meta stub on a loopback address. Ignored otherwise.
  graphBase: Deno.env.get("CAPI_GRAPH_BASE") ?? "",
});

Deno.serve((req) => handleCapi(req, deps, Deno.env.get("ALLOWED_ORIGIN") ?? "*"));
