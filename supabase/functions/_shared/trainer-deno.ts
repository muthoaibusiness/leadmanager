// Real ports for the AI Trainer under Deno: PostgREST with the service role
// and OpenRouter. Shared by the ai-trainer function and, for test numbers,
// by the two bots (runTrainerTestTurn). The logic stays in the Deno-free
// trainer-handler.ts / trainer-core.ts / trainer-live.ts.
import { _internals, type Db, type Llm } from "./trainer-handler.ts";
import { runTestTurn, type LiveResult } from "./trainer-live.ts";
import { CORE_VERSION, type Bot, type SnapshotContent } from "./trainer-core.ts";
import { SUPABASE_URL, SERVICE_KEY, sbSelect, sbUpsert, sendWaMessageMirroredId } from "./wa.ts";
import { chatCompletion, requestBody, embedRequest, embedWithConfig, type ModelConfig, type ChatRes } from "./trainer-model.ts";
import { httpProbe } from "./trainer-brochure.ts";

const H = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };

export const db: Db = {
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

export const llm: Llm = {
  async chat(req) {
    const key = Deno.env.get("OPENROUTER_API_KEY") ?? "";
    if (!key) return { ok: false, error: "OPENROUTER_API_KEY not configured" };
    // Second pass only when the first came back empty on the token limit
    // (a reasoning model that spent the budget thinking): same request with
    // reasoning off. A model that cannot run without reasoning refuses that
    // pass, and the empty first answer stands.
    let first: ChatRes | null = null;
    for (const reasoningOff of [false, true]) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 30_000);
      try {
        // Override only for a local dev stack (e.g. a stub model); unset in production.
        const r = await fetch(Deno.env.get("AI_TRAINER_LLM_URL") || "https://openrouter.ai/api/v1/chat/completions", {
          method: "POST", signal: ctl.signal,
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": "https://wepro.app", "X-Title": "WEPRO AI Trainer" },
          body: JSON.stringify(requestBody(req, "openrouter", { reasoningOff })),
        });
        if (!r.ok) return first ?? { ok: false, error: `OpenRouter ${r.status}` };
        const j = await r.json();
        const text = String(j?.choices?.[0]?.message?.content ?? "");
        // Usage is cumulative: the empty first pass was billed too.
        const res: ChatRes = { ok: true, text, prompt_tokens: (first?.ok ? first.prompt_tokens : 0) + (j?.usage?.prompt_tokens ?? 0),
          completion_tokens: (first?.ok ? first.completion_tokens : 0) + (j?.usage?.completion_tokens ?? 0) };
        if (text.trim() || String(j?.choices?.[0]?.finish_reason || "") !== "length") return res;
        first = res;
      } catch (e) {
        return first ?? { ok: false, error: e instanceof Error ? e.message : String(e) };
      } finally {
        clearTimeout(timer);
      }
    }
    return first!;
  },
};

// The Playground's configured provider (migration 0043). Every custom-host call
// resolves the host first so a name pointing at a private address is refused.
// This does not stop DNS rebinding: fetch does its own lookup afterwards.
// No records is an empty list; a resolver that is unavailable throws, so the
// call is refused rather than sent unchecked.
const resolveHost = async (host: string) => {
  const rs = await Promise.allSettled([Deno.resolveDns(host, "A"), Deno.resolveDns(host, "AAAA")]);
  const addrs = rs.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  if (!addrs.length && rs.some((r) => r.status === "rejected" && !(r.reason instanceof Deno.errors.NotFound))) throw new Error("dns unavailable");
  return addrs;
};

// Brochure file check: a 1 KB range GET per hop, redirects checked by hand.
// The body is cancelled after the first chunk so a host that ignores Range
// never streams a whole 40 MB PDF into the function.
export const probe = httpProbe({
  resolve: resolveHost,
  fetch: async (url, init) => {
    const r = await fetch(url, init);
    // Chunks until the 12-byte header is in (a WebP needs bytes 8 to 11), then stop.
    const reader = r.body?.getReader();
    let first = new Uint8Array();
    while (reader && first.length < 12) {
      const c = await reader.read();
      if (c.done || !c.value) break;
      const next = new Uint8Array(first.length + c.value.length); next.set(first); next.set(c.value, first.length); first = next;
    }
    await reader?.cancel().catch(() => {});
    return { ok: r.ok, status: r.status, headers: r.headers, arrayBuffer: async () => first.slice(0, 1024).buffer };
  },
});

export const modelLlm = (cfg: ModelConfig, key: string): Llm => ({
  chat: (req) => chatCompletion(cfg, key, req, { fetch: (url, init) => fetch(url, init), resolve: resolveHost }),
});

// The embedding model saved in Model & API (migration 0047).
export const embedWith = (cfg: ModelConfig, key: string) => (text: string) =>
  embedWithConfig(cfg, key, text, { fetch: (url, init) => fetch(url, init), resolve: resolveHost });

export const env = {
  budgetUsd: Number(Deno.env.get("AI_TRAINER_DAILY_BUDGET_USD") ?? "2"),
  replyModel: Deno.env.get("OPENROUTER_MODEL")?.trim() || "anthropic/claude-haiku-5.5",
  judgeModel: Deno.env.get("AI_TRAINER_JUDGE_MODEL")?.trim() || "anthropic/claude-sonnet-5.5",
  // List prices per million tokens; override when the models change.
  pricePerMTok: { in: Number(Deno.env.get("AI_PRICE_IN_PER_MTOK") ?? "2"), out: Number(Deno.env.get("AI_PRICE_OUT_PER_MTOK") ?? "10") },
  // The company whose properties rows hold live stock; unset means no live figures.
  companyId: Deno.env.get("AI_TRAINER_COMPANY_ID")?.trim() || undefined,
  // Vector indexing is off until both are set (e.g. openai/text-embedding-3-small, 1536).
  embeddingModel: Deno.env.get("AI_TRAINER_EMBEDDING_MODEL")?.trim() || undefined,
  embeddingDim: Number(Deno.env.get("AI_TRAINER_EMBEDDING_DIM") ?? "") || undefined,
};

// Embeddings over OpenRouter with the same server key as replies.
export const embedder = env.embeddingModel
  ? (model: string, text: string) => {
    const key = Deno.env.get("OPENROUTER_API_KEY") ?? "";
    if (!key) return Promise.resolve({ ok: false as const, error: "OPENROUTER_API_KEY not configured" });
    return embedRequest("https://openrouter.ai/api/v1", key, model, text, { fetch: (u, i) => fetch(u, i) });
  }
  : undefined;

// The bot's published snapshot, resolved from its pointer (ai_bot_pointers).
// Returns the frozen content + checksum only when the pointer is in snapshot
// mode, the snapshot exists, and its frozen core version equals the current
// core (so a snapshot whose core is ahead of the deployed runtime never runs).
// Returns null otherwise — the caller decides the fallback.
export async function loadPublishedSnapshot(a: { bot: Bot }): Promise<{ content: SnapshotContent; checksum: string } | null> {
  try {
    const ptr = (await sbSelect(`ai_bot_pointers?bot=eq.${a.bot}&select=mode,snapshot_id`))[0] ?? null;
    if (!ptr || ptr.mode !== "snapshot" || !ptr.snapshot_id) return null;
    const snap = (await sbSelect(`ai_snapshots?id=eq.${encodeURIComponent(ptr.snapshot_id)}&select=content,checksum,core_version_frozen`))[0] ?? null;
    if (!snap || snap.core_version_frozen !== CORE_VERSION) return null;
    return { content: snap.content as SnapshotContent, checksum: String(snap.checksum || "") };
  } catch (e) {
    console.error("loadPublishedSnapshot error", a.bot, e);
    return null;
  }
}

// True when a trainer turn actually answered the customer: a message went out
// (sent > 0), or a brochure/handoff sequence produced a reply. A blocked,
// fallback, error or skipped turn is not an answer, so the hybrid caller falls
// through to the legacy FAQ agent.
export function trainerAnswered(r: LiveResult): boolean {
  if (r.sent > 0) return true;
  const o = String(r.outcome || "");
  return o.startsWith("brochure_") || o === "handoff_requested";
}

// One test-number turn on a bot's real chat. Model calls draw on the trainer's
// daily budget, like the Playground. When `production` is true the turn runs
// over the published snapshot (via runTestTurn's publishedContent), never the
// live drafts, and the test-number allow-list is skipped in favour of the
// AI-replies switch.
export async function runTrainerTestTurn(a: {
  bot: Bot; convId: string; phone: string; to: string; text: string; ad: { isAd: boolean; adText?: string }; allowMedia: boolean; production?: boolean; replyToMessageId?: string;
}): Promise<LiveResult> {
  const { callModel, inventory } = _internals.portsFor({ db, llm, env });
  // The same approved-document search as the Playground, so a test number is
  // answered from the uploaded FAQs and fact sheets too.
  // A failed setup is traced on the turn, never thrown into the bot.
  const searchDocs = await _internals.docSearchPort({ db, llm, env, embedWith } as Parameters<typeof _internals.docSearchPort>[0])
    .catch((e) => async () => { throw e; });
  // Production answers run over the published snapshot; a test-number turn
  // runs over the live drafts. Resolve the snapshot up front so a stale or
  // core-mismatched publish is surfaced as a blocked turn, never a reply from
  // content that was never certified.
  const publishedContent = a.production ? await loadPublishedSnapshot(a) : undefined;
  // Production without a compatible published snapshot must never answer from
  // live drafts — the caller (the bot's hybrid FAQ) falls back to the legacy
  // agent instead. No turn row is written for a snapshot that isn't there.
  if (a.production && !publishedContent) {
    return { outcome: "blocked_no_published_snapshot", turnId: null, sent: 0, blocked: "no compatible published snapshot" };
  }
  return runTestTurn({ ...a, replyModel: env.replyModel, allowNonTest: !!a.production, publishedContent }, {
    callModel, inventory, searchDocs, probeDocument: probe, probeImage: probe,
    select: db.select, insert: db.insert, patch: db.patch,
    upsert: (table, row) => sbUpsert(table, [row], table === "ai_conversation_state" ? "conversation_id" : "id"),
    send: (to, msg) => sendWaMessageMirroredId(a.bot, to, a.convId, a.phone, msg, { senderName: "AI Trainer", storeWaId: true, replyToMessageId: a.replyToMessageId }),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  });
}
