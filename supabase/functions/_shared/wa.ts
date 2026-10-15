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
