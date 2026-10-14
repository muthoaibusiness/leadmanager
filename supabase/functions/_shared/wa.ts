// Shared helpers for the two WhatsApp Edge Functions.
//
// Everything that touches a credential lives on this side of the wire. The
// browser bundle never imports this file.

export const WASENDER_BASE = "https://wasenderapi.com/api";

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
export const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

export const CORS = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

// ── PostgREST with the service role (bypasses RLS) ──────────────────────────
const svcHeaders = () => ({
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
});

export async function sbSelect(path: string): Promise<any[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: svcHeaders() });
  if (!r.ok) {
    console.error("sbSelect failed", path, r.status, await r.text());
    return [];
  }
  return r.json();
}

export async function sbUpsert(table: string, rows: unknown[], onConflict = "id") {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: "POST",
    headers: { ...svcHeaders(), Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!r.ok) console.error(`sbUpsert ${table} failed`, r.status, await r.text());
  return r.ok;
}

export async function sbPatch(table: string, filter: string, patch: unknown) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: "PATCH",
    headers: { ...svcHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) console.error(`sbPatch ${table} failed`, r.status, await r.text());
  return r.ok;
}

export async function sbRpc(fn: string, args: Record<string, unknown>) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: svcHeaders(),
    body: JSON.stringify(args),
  });
  if (!r.ok) console.error(`sbRpc ${fn} failed`, r.status, await r.text());
  return r.ok;
}

// Insert-once guard. Returns true when this delivery id has NOT been seen
// before, so the caller should process it; false means it's a replay.
export async function claimEvent(id: string, eventType: string): Promise<boolean> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/wa_webhook_events`, {
    method: "POST",
    headers: { ...svcHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify([{ id, event_type: eventType }]),
  });
  if (r.ok) return true;
  if (r.status === 409) return false;     // duplicate primary key → already handled
  console.error("claimEvent unexpected status", r.status, await r.text());
  return true;                            // fail open: better a rare dupe than a lost message
}

// ── credentials ─────────────────────────────────────────────────────────────
// wa_secrets wins so a token can be rotated from the admin UI without a
// redeploy; the env var is the bootstrap/fallback. Dubai and Eyad are
// separate Wasender sessions with separate tokens — a row per account
// (id: "dubai" | "eyad"), each falling back to its own env var, then to the
// old shared "default" row / WASENDER_API_TOKEN for anything not yet split.
export async function getCredentials(account = "eyad"): Promise<{ token: string; webhookSecret: string }> {
  const acc = account === "dubai" ? "dubai" : "eyad";
  const rows = await sbSelect(`wa_secrets?id=in.(${acc},default)&select=id,api_token,webhook_secret`);
  const byId = Object.fromEntries((rows || []).map((r: any) => [r.id, r]));
  const row = byId[acc] ?? {};
  const fallback = byId["default"] ?? {};
  const envToken = Deno.env.get(`WASENDER_API_TOKEN_${acc.toUpperCase()}`) ?? Deno.env.get("WASENDER_API_TOKEN") ?? "";
  const envSecret = Deno.env.get(`WASENDER_WEBHOOK_SECRET_${acc.toUpperCase()}`) ?? Deno.env.get("WASENDER_WEBHOOK_SECRET") ?? "";
  return {
    token: row.api_token || fallback.api_token || envToken || "",
    webhookSecret: row.webhook_secret || fallback.webhook_secret || envSecret || "",
  };
}

// ── AI agent support (wa-bot-eyad / wa-bot-dubai FAQ replies) ───────────────
// wa_projects is the knowledge base: brochure/floor-plan/photo links per
// project, small enough (a dozen rows) to hand the model whole rather than
// building a vector index for it.
export async function getActiveProjects(): Promise<any[]> {
  return sbSelect(
    "wa_projects?is_active=eq.true&select=name,keywords,region,nature,sft,address,brochure_url,photos,floor_plans,video_url,google_map_url",
  );
}

// Last few turns of this thread, oldest first, as plain {role, text} so the
// model sees the conversation the way it actually happened.
export async function getRecentHistory(
  convId: string,
  limit = 10,
): Promise<{ role: "user" | "assistant"; text: string }[]> {
  const rows = await sbSelect(
    `wa_messages?conversation_id=eq.${encodeURIComponent(convId)}&select=direction,body,caption,type&order=wa_timestamp.desc&limit=${limit}`,
  );
  return (rows || [])
    .reverse()
    .map((r: any) => ({
      role: r.direction === "IN" ? "user" : "assistant",
      text: r.type === "text" ? r.body : (r.caption || `[${r.type}]`),
    }))
    .filter((m: { text: string }) => m.text);
}

// Send through Wasender AND mirror into wa_conversations/wa_messages, so an
// AI-authored reply shows up in the Conversations UI exactly like a human
// agent's — without this, the agent watching the thread would see the
// customer's question but never the bot's answer.
export async function sendWaMessageMirrored(
  account: string,
  to: string,
  convId: string,
  phone: string,
  msg: { type: "text" | "image" | "document"; text?: string; mediaUrl?: string; fileName?: string },
): Promise<boolean> {
  const { token } = await getCredentials(account);
  if (!token) {
    console.error("sendWaMessageMirrored: no Wasender token configured for", account);
    return false;
  }
  const payload =
    msg.type === "image" ? { to, text: msg.text || "", imageUrl: msg.mediaUrl } :
    msg.type === "document" ? { to, text: msg.text || "", documentUrl: msg.mediaUrl, fileName: msg.fileName || "document" } :
    { to, text: msg.text || "" };

  let ok = false;
  try {
    const res = await fetch(`${WASENDER_BASE}/send-message`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    ok = res.ok;
    if (!ok) console.error("sendWaMessageMirrored: send-message failed", res.status, await res.text());
  } catch (e) {
    console.error("sendWaMessageMirrored: send-message error", e);
  }
  if (!ok) return false;

  const now = new Date().toISOString();
  await sbUpsert("wa_conversations", [{
    id: convId, phone, account,
    last_message_at: now,
    last_message_preview: msg.type === "text" ? (msg.text || "") : (msg.fileName || msg.type),
    last_message_dir: "OUT",
  }]);
  await sbUpsert("wa_messages", [{
    id: crypto.randomUUID(),
    conversation_id: convId,
    phone,
    account,
    direction: "OUT",
    type: msg.type,
    body: msg.type === "text" ? (msg.text || "") : "",
    caption: msg.type === "text" ? "" : (msg.text || ""),
    media_url: msg.mediaUrl || "",
    media_name: msg.fileName || "",
    status: "SENT",
    wa_timestamp: now,
  }]);
  return true;
}

// The CRM has no Supabase Auth session, so an admin action is authorised by
// checking the acting user's role in the users table. Same trust boundary the
// rest of the app already runs on — it stops a non-admin agent from rotating
// the token, not someone holding the anon key.
export async function isAdminUser(userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const rows = await sbSelect(`users?id=eq.${encodeURIComponent(userId)}&select=role,is_active`);
  const u = rows?.[0];
  return !!u && u.is_active !== false && (u.role === "MANAGEMENT" || u.role === "MASTER");
}

// ── phone / jid ─────────────────────────────────────────────────────────────
export const jidToPhone = (jid: string) => (jid || "").split("@")[0].split(":")[0].replace(/\D/g, "");
export const phoneToJid = (phone: string) => {
  const d = (phone || "").replace(/\D/g, "");
  return d ? `${d}@s.whatsapp.net` : "";
};

// Constant-time-ish comparison so a wrong secret doesn't leak length by timing.
export function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
