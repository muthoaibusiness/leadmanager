// ai-trainer: the AI Trainer's server side. All logic is in
// ../_shared/trainer-handler.ts and ../_shared/trainer-core.ts, which have no
// Deno dependency and are tested under Node (npm run test:trainer). This file
// only wires real ports: PostgREST with the service role, and OpenRouter.
//
// Deploy (owner approval required):
//   npx supabase secrets set AI_TRAINER_KEY=<32+ random bytes, base64> AI_TRAINER_DAILY_BUDGET_USD=2
//   npx supabase functions deploy ai-trainer --no-verify-jwt
//
// --no-verify-jwt because the CRM mints no Supabase JWT; access is the
// X-Trainer-Key header, a temporary shared secret (spec §9).
import { handleTrainer, type Db, type Llm } from "../_shared/trainer-handler.ts";
import { SUPABASE_URL, SERVICE_KEY, sbSelect } from "../_shared/wa.ts";

const H = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };
const CORS = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "content-type, x-trainer-key, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const db: Db = {
  select: sbSelect,
  async insert(table, row) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, { method: "POST", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify(row) });
    if (!r.ok) throw new Error(`insert ${table} failed: ${r.status} ${await r.text()}`);
    return (await r.json())[0];
  },
  async patch(table, filter, patch) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, { method: "PATCH", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify(patch) });
    if (!r.ok) throw new Error(`patch ${table} failed: ${r.status} ${await r.text()}`);
    return true;
  },
  async rpc(fn, args) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: H, body: JSON.stringify(args) });
    const text = await r.text();
    if (!r.ok) return { ok: false, error: text };
    return { ok: true, data: text ? JSON.parse(text) : null };
  },
};

const llm: Llm = {
  async chat(req) {
    const key = Deno.env.get("OPENROUTER_API_KEY") ?? "";
    if (!key) return { ok: false, error: "OPENROUTER_API_KEY not configured" };
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 30_000);
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST", signal: ctl.signal,
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": "https://wepro.app", "X-Title": "WEPRO AI Trainer" },
        body: JSON.stringify({ model: req.model, max_tokens: req.max_tokens, messages: [{ role: "system", content: req.system }, ...req.messages] }),
      });
      if (!r.ok) return { ok: false, error: `OpenRouter ${r.status}` };
      const j = await r.json();
      return { ok: true, text: String(j?.choices?.[0]?.message?.content ?? ""), prompt_tokens: j?.usage?.prompt_tokens ?? 0, completion_tokens: j?.usage?.completion_tokens ?? 0 };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    } finally {
      clearTimeout(timer);
    }
  },
};

const env = {
  trainerKey: Deno.env.get("AI_TRAINER_KEY") ?? "",
  budgetUsd: Number(Deno.env.get("AI_TRAINER_DAILY_BUDGET_USD") ?? "2"),
  replyModel: Deno.env.get("OPENROUTER_MODEL")?.trim() || "anthropic/claude-haiku-5.5",
  judgeModel: Deno.env.get("AI_TRAINER_JUDGE_MODEL")?.trim() || "anthropic/claude-sonnet-5.5",
  // List prices per million tokens; override when the models change.
  pricePerMTok: { in: Number(Deno.env.get("AI_PRICE_IN_PER_MTOK") ?? "2"), out: Number(Deno.env.get("AI_PRICE_OUT_PER_MTOK") ?? "10") },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  let body: unknown = null;
  try { body = await req.json(); } catch { /* handled below */ }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  const res = await handleTrainer({ method: req.method, headers: req.headers, ip, body }, { db, llm, env });
  return new Response(JSON.stringify(res.body), { status: res.status, headers: { ...CORS, "Content-Type": "application/json" } });
});
