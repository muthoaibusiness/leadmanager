// Finance (Admin → Inventory): the only road to the finance_* tables.
//
// The browser never reads or writes those tables over PostgREST — they carry
// no anon policy (migration 0023). Every read and write comes through here,
// where the acting user's role and grants are checked against the users table
// and the rows are fetched with the service role.
//
// Deploy:  npx supabase functions deploy finance --no-verify-jwt
//
// --no-verify-jwt stays only so OPTIONS and the public statement share page
// (GET ?share=) work without a session. Every POST is checked against the
// caller's Supabase Auth session (actor.ts, decision D1); a userId in the body
// is ignored. All of the logic is in
// ../_shared/finance-core.ts, which has no Deno dependency, so it is also
// exercised under Node by the test harness. The statement page it serves is
// drawn by ../_shared/finance-doc.js, which the app imports too.

import { handleFinance } from "../_shared/finance-core.ts";

Deno.serve((req) => handleFinance(req, {
  url: Deno.env.get("SUPABASE_URL") ?? "",
  serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  anonKey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
  allowedOrigin: Deno.env.get("ALLOWED_ORIGIN") ?? "*",
}));
