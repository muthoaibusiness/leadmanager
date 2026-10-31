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
// Access is the caller's Supabase Auth session (actor.ts, decision D1): an
// active Management or Master account. body.user_id is ignored.
import { handleTrainer } from "../_shared/trainer-handler.ts";
import { db, llm, env, modelLlm, embedder, embedWith, probe } from "../_shared/trainer-deno.ts";
import { verifiedActor, actorDepsFromEnv } from "../_shared/actor.ts";

const actorDeps = actorDepsFromEnv((k) => Deno.env.get(k));
const actor = (r: { headers: Headers }) => verifiedActor(r as Request, actorDeps);

const CORS = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  let body: unknown = null;
  try { body = await req.json(); } catch { /* handled below */ }
  // The first x-forwarded-for hop is whatever the client sent; the platform sets cf-connecting-ip and appends the real peer last.
  const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "unknown";
  const res = await handleTrainer({ method: req.method, headers: req.headers, ip, body }, { db, llm, env, actor, probe, modelLlm, embedder, embedWith });
  return new Response(JSON.stringify(res.body), { status: res.status, headers: { ...CORS, "Content-Type": "application/json" } });
});
