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
    "wa_projects?is_active=eq.true&select=name,keywords,region,nature,sft,address,brochure_url,photos,floor_plans,floor_plan_labels,video_url,google_map_url,map_image_url",
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
  // Wasender rejects image/document sends with an empty "text" — its
  // validator treats "" as missing, not as a string (confirmed directly
  // against the API: documentUrl + text:"" => 422 "text field must be a
  // string"; a non-empty caption succeeds). Always fall back to something.
  const payload =
    msg.type === "image" ? { to, text: msg.text || "Photo", imageUrl: msg.mediaUrl } :
    msg.type === "document" ? { to, text: msg.text || (msg.fileName || "Document"), documentUrl: msg.mediaUrl, fileName: msg.fileName || "document" } :
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

// ── admin-configurable automation toggles (WA Relay tab) ───────────────────
export type BotName = "eyad" | "dubai";
export interface BotSettings {
  autoForwardEnabled: boolean; autoForwardAfterMessages: number;
  faqAgentEnabled: boolean; aiMediaEnabled: boolean;
  welcomeEnabled: boolean; welcomeMessage: string;
  manualForwardEnabled: boolean; docsCommandEnabled: boolean;
  takeoverEnabled: boolean; notesEnabled: boolean;
  customerNotifyEnabled: boolean; metaCapiEnabled: boolean;
}

// Last 10 digits of a phone: 8801XXXXXXXXX, 01XXXXXXXXX and +880 1XXX… all agree.
const phoneKey = (v: unknown) => String(v ?? "").replace(/\D/g, "").slice(-10);

// Each bot reads its own wa_bot_settings row (migration 0034). A missing row or
// table falls back to the old global wa_settings values, so the functions work
// before the migration is run. Every toggle defaults to ON except Eyad's
// auto-forward, which has always been opt-in.
//
// `phone` is the chat's customer number. When it is one of the bot's
// test_numbers (migration 0035), every toggle reads ON regardless of the
// checklist, so a feature can be tried on the team's own phone while it is Off
// for customers.
export async function getBotSettings(bot: BotName, phone?: string): Promise<BotSettings> {
  const [botRows, globalRows] = await Promise.all([
    sbSelect(`wa_bot_settings?bot=eq.${bot}&select=*`),
    sbSelect("wa_settings?id=eq.default&select=auto_forward_enabled,auto_forward_after_messages,faq_agent_enabled,welcome_enabled,welcome_message"),
  ]);
  const row = botRows?.[0];
  const g = globalRows?.[0] ?? {};
  const src = row ?? {
    ...g,
    auto_forward_enabled: bot === "dubai" ? true : g.auto_forward_enabled === true,
  };
  const on = (v: unknown) => v !== false; // defaults on if the row/column is missing
  const key = phoneKey(phone);
  if (key.length === 10 && Array.isArray(row?.test_numbers) && row.test_numbers.some((n: unknown) => phoneKey(n) === key)) {
    return {
      autoForwardEnabled: true,
      autoForwardAfterMessages: Number.isFinite(src.auto_forward_after_messages) ? src.auto_forward_after_messages : 3,
      faqAgentEnabled: true, aiMediaEnabled: true, welcomeEnabled: true, welcomeMessage: src.welcome_message || "",
      manualForwardEnabled: true, docsCommandEnabled: true, takeoverEnabled: true, notesEnabled: true,
      customerNotifyEnabled: true, metaCapiEnabled: true,
    };
  }
  return {
    autoForwardEnabled: src.auto_forward_enabled === true,
    autoForwardAfterMessages: Number.isFinite(src.auto_forward_after_messages) ? src.auto_forward_after_messages : 3,
    faqAgentEnabled: on(src.faq_agent_enabled),
    aiMediaEnabled: on(src.ai_media_enabled),
    welcomeEnabled: on(src.welcome_enabled),
    welcomeMessage: src.welcome_message || "", // empty = each bot's own hardcoded default
    manualForwardEnabled: on(src.manual_forward_enabled),
    docsCommandEnabled: on(src.docs_command_enabled),
    takeoverEnabled: on(src.takeover_enabled),
    notesEnabled: on(src.notes_enabled),
    customerNotifyEnabled: on(src.customer_notify_enabled),
    metaCapiEnabled: on(src.meta_capi_enabled),
  };
}

// {name} in the admin-set welcome text → the customer's name, same "there"
// fallback the hardcoded templates already use.
export function fillWelcomeTemplate(text: string, name: string): string {
  return text.replace(/\{name\}/g, name || "there");
}

// /send<code> → project name, admin-editable via wa_projects.send_code
// (was a hardcoded CODE_TO_PROJECT map in wa-bot-eyad).
export async function getProjectBySendCode(code: string): Promise<{ name: string } | null> {
  const rows = await sbSelect(`wa_projects?send_code=eq.${encodeURIComponent(code)}&is_active=eq.true&select=name&limit=1`);
  return rows?.[0] ?? null;
}

// ── /n and /f* ... note commands ────────────────────────────────────────────
// Attach the thread to the most recently created lead with this number — the
// same "last 9 digits" tolerance findLeadId uses (prefix/+880 differences).
export async function findLeadForNote(phone: string): Promise<{ id: string; companyId: string | null } | null> {
  const tail = phone.replace(/\D/g, "").slice(-9);
  if (tail.length < 8) return null;
  const rows = await sbSelect(
    `leads?phone=like.*${encodeURIComponent(tail)}&select=id,company_id&order=created_at.desc&limit=1`,
  );
  const row = rows?.[0];
  return row ? { id: row.id, companyId: row.company_id ?? null } : null;
}

// Writes the same shape the app's own NoteModal writes (aToR in src/lib/supabase.js)
// — type NOTE, so it renders in the lead's activity timeline like any manual note.
export async function logNoteActivity(leadId: string, companyId: string | null, description: string, source: string): Promise<boolean> {
  return sbUpsert("activities", [{
    id: crypto.randomUUID(),
    lead_id: leadId,
    type: "NOTE",
    description,
    user_id: null,
    user_name: source,
    duration_seconds: 0,
    timestamp: new Date().toISOString(),
    company_id: companyId,
  }]);
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
