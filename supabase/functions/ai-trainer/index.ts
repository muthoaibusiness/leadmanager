// ai-trainer: the AI Trainer's server side. All logic is in
// ../_shared/trainer-handler.ts and ../_shared/trainer-core.ts, which have no
// Deno dependency and are tested under Node (npm run test:trainer). The real
// ports (PostgREST with the service role, and OpenRouter) are in
// ../_shared/trainer-deno.ts, shared with the bots' test-number path.
//
// Deploy (owner approval required):
//   npx supabase functions deploy ai-trainer --no-verify-jwt
// Optional secret: AI_TRAINER_DAILY_BUDGET_USD (default 2).
//
// --no-verify-jwt because the CRM mints no Supabase JWT; access is the acting
// user's Management/Master role in the users table (trainer-handler.ts).
import { handleTrainer } from "../_shared/trainer-handler.ts";
import { db, llm, env, modelLlm, embedder, embedWith } from "../_shared/trainer-deno.ts";

const CORS = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "content-type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  let body: unknown = null;
  try { body = await req.json(); } catch { /* handled below */ }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  const res = await handleTrainer({ method: req.method, headers: req.headers, ip, body }, { db, llm, env, modelLlm, embedder, embedWith });
  return new Response(JSON.stringify(res.body), { status: res.status, headers: { ...CORS, "Content-Type": "application/json" } });
});
