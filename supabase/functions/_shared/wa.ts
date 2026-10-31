// Shared helpers for the two WhatsApp Edge Functions.
//
// Everything that touches a credential lives on this side of the wire. The
// browser bundle never imports this file.

import { samePhone } from "./phone.ts";

// Override only for a local dev stack (a fake Wasender); unset in production.
export const WASENDER_BASE = Deno.env.get("WASENDER_BASE") || "https://wasenderapi.com/api";

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

// Like sbSelect but null on error, so a failed read is not mistaken for "no rows".
export async function sbSelectOrNull(path: string): Promise<any[] | null> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: svcHeaders() });
    if (!r.ok) { console.error("sbSelect failed", path, r.status, await r.text()); return null; }
    return await r.json();
  } catch (e) { console.error("sbSelect threw", path, e); return null; }
}

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
    "wa_projects?is_active=eq.true&select=name,keywords,region,nature,sft,address,office_address,brochure_url,photos,floor_plans,floor_plan_labels,video_url,google_map_url,map_image_url",
  );
}

// Last few turns of this thread, oldest first, as plain {role, text} so the
// model sees the conversation the way it actually happened.
// The model must always read the thread before answering (user's rule), so
// the window is generous. Ordered by created_at: manually relayed rows can
// carry a null wa_timestamp and would otherwise float to the wrong end.
export async function getRecentHistory(
  convId: string,
  limit = 30,
): Promise<{ role: "user" | "assistant"; text: string }[]> {
  const rows = await sbSelect(
    `wa_messages?conversation_id=eq.${encodeURIComponent(convId)}&select=direction,body,caption,type&order=created_at.desc&limit=${limit}`,
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
  // storeWaId on for the legacy agent too: the fromMe echo wa-webhook mirrors
  // back then collides on the wa_id index instead of showing as a second
  // copy of every bot message, and the id is the handle for a later unsend.
  return (await sendWaMessageMirroredId(account, to, convId, phone, msg, { senderName: "AI Agent", storeWaId: true })) !== null;
}

// Same as sendWaMessageMirrored, returning the Wasender message id ("" when
// Wasender sent none) or null on failure. With storeWaId the id is kept as
// wa_id, so wa-webhook's delivery receipts update this row (and its fromMe
// echo of the send, which carries the same id, is refused by the unique
// wa_id index instead of showing twice). The legacy FAQ agent keeps its
// original row shape (no wa_id).
export async function sendWaMessageMirroredId(
  account: string,
  to: string,
  convId: string,
  phone: string,
  msg: { type: "text" | "image" | "document"; text?: string; mediaUrl?: string; fileName?: string },
  opts: { senderName: string; storeWaId: boolean },
): Promise<string | null> {
  const { token } = await getCredentials(account);
  if (!token) {
    console.error("sendWaMessageMirrored: no Wasender token configured for", account);
    return null;
  }
  // Wasender rejects image/document sends with an empty "text" — its
  // validator treats "" as missing, not as a string (confirmed directly
  // against the API: documentUrl + text:"" => 422 "text field must be a
  // string"; a non-empty caption succeeds). Always fall back to something.
  const payload =
    msg.type === "image" ? { to, text: msg.text || "Photo", imageUrl: msg.mediaUrl } :
    msg.type === "document" ? { to, text: msg.text || (msg.fileName || "Document"), documentUrl: msg.mediaUrl, fileName: msg.fileName || "document" } :
    { to, text: msg.text || "" };

  // Wasender's account protection allows 1 send per 5s per session. Two
  // code paths (e.g. the follow-up cron and an inbound reply) can collide,
  // so a 429 is retried after the window instead of dropping the message.
  let ok = false;
  let waId = "";
  for (let attempt = 0; attempt < 3 && !ok; attempt++) {
    try {
      const res = await fetch(`${WASENDER_BASE}/send-message`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      ok = res.ok;
      if (ok) {
        // Same id lookup as wa-send: Wasender has moved this field between versions.
        const j = await res.json().catch(() => ({}));
        waId = String(j?.data?.msgId ?? j?.data?.id ?? j?.data?.key?.id ?? j?.msgId ?? j?.id ?? "");
        break;
      }
      const text = await res.text();
      if (res.status === 429 && attempt < 2) {
        let wait = 5500;
        try { wait = Math.max(1000, (JSON.parse(text)?.retry_after ?? 5) * 1000 + 500); } catch { /* keep default */ }
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      console.error("sendWaMessageMirrored: send-message failed", res.status, text);
    } catch (e) {
      console.error("sendWaMessageMirrored: send-message error", e);
    }
  }
  if (!ok) return null;

  const now = new Date().toISOString();
  await sbUpsert("wa_conversations", [{
    id: convId, phone, account,
    last_message_at: now,
    last_message_preview: msg.type === "text" ? (msg.text || "") : (msg.fileName || msg.type),
    last_message_dir: "OUT",
  }]);
  await sbUpsert("wa_messages", [{
    id: crypto.randomUUID(),
    ...(opts.storeWaId && waId ? { wa_id: waId } : {}),
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
    // Tags this row as bot-authored (not a template send, not a human agent's
    // own typed reply): "AI Agent" for the legacy FAQ agent, which the Training
    // UI lists, "AI Trainer" for a test-number reply.
    sender_name: opts.senderName,
    wa_timestamp: now,
  }]);
  return waId;
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
  // True only when the bot's trainer_test_mode is on (migration 0038) AND this
  // chat's number is in its test_numbers: the AI Trainer answers instead of
  // the legacy FAQ agent. Always false for every other chat.
  trainerTest: boolean;
  // The project this bot's current ad campaign is about (migration 0050). Empty =
  // the bot's own built-in default. A prelead's property_interest is only a
  // default for contacts the ad did not name, so it cannot stand in for this.
  campaignProject: string;
}

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
    sbSelectOrNull(`wa_bot_settings?bot=eq.${bot}&select=*`),
    sbSelect("wa_settings?id=eq.default&select=auto_forward_enabled,auto_forward_after_messages,faq_agent_enabled,welcome_enabled,welcome_message"),
  ]);
  if (botRows === null) {
    console.error("getBotSettings: read failed, customer automations OFF", bot);
    return { // fail closed for customers; agent commands stay usable
      autoForwardEnabled: false, autoForwardAfterMessages: 3, faqAgentEnabled: false, aiMediaEnabled: false,
      welcomeEnabled: false, welcomeMessage: "", manualForwardEnabled: true, docsCommandEnabled: true,
      takeoverEnabled: true, notesEnabled: true, customerNotifyEnabled: false, metaCapiEnabled: false, trainerTest: false, campaignProject: "",
    };
  }
  const row = botRows[0];
  const g = globalRows?.[0] ?? {};
  const src = row ?? {
    ...g,
    auto_forward_enabled: bot === "dubai" ? true : g.auto_forward_enabled === true,
  };
  const on = (v: unknown) => v !== false; // defaults on if the row/column is missing
  if (Array.isArray(row?.test_numbers) && row.test_numbers.some((n: unknown) => samePhone(n, phone))) {
    return {
      autoForwardEnabled: true,
      autoForwardAfterMessages: Number.isFinite(src.auto_forward_after_messages) ? src.auto_forward_after_messages : 3,
      faqAgentEnabled: true, aiMediaEnabled: true, welcomeEnabled: true, welcomeMessage: src.welcome_message || "",
      manualForwardEnabled: true, docsCommandEnabled: true, takeoverEnabled: true, notesEnabled: true,
      customerNotifyEnabled: true, metaCapiEnabled: true,
      trainerTest: row?.trainer_test_mode === true, campaignProject: String(row?.campaign_project || ""),
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
    trainerTest: false,
    campaignProject: String(src.campaign_project || ""),
  };
}

// Re-read just before each customer send so an OFF toggle mid-turn is honoured.
export async function aiStillOn(bot: BotName, phone?: string): Promise<boolean> {
  return (await getBotSettings(bot, phone)).faqAgentEnabled;
}

// {name} in the admin-set welcome text → the customer's name, same "there"
// fallback the hardcoded templates already use.
export function fillWelcomeTemplate(text: string, name: string): string {
  return text.replace(/\{name\}/g, name || "there");
}

// /send<code> → project name, admin-editable via wa_projects.send_code
// (was a hardcoded CODE_TO_PROJECT map in wa-bot-eyad).
export async function getProjectBySendCode(code: string): Promise<any | null> {
  const rows = await sbSelect(
    `wa_projects?send_code=eq.${encodeURIComponent(code)}&is_active=eq.true&select=name,keywords,region,nature,sft,address,office_address,brochure_url,photos,floor_plans,floor_plan_labels,video_url,google_map_url,map_image_url&limit=1`,
  );
  return rows?.[0] ?? null;
}

// Admin-editable behavioral rules (WA Relay tab → Knowledge & Rules) —
// replaces what used to be hardcoded in the system prompt (land-team
// contact, price-range wording, etc.). Every active row is appended as-is.
export async function getKnowledge(): Promise<{ title: string; body: string }[]> {
  return sbSelect("wa_knowledge?is_active=eq.true&select=title,body&order=created_at.asc");
}

// Admin corrections of past AI replies (WA Relay tab → Training) — fed back
// into the prompt as few-shot examples. Capped by the caller via `limit` so
// the prompt doesn't grow unbounded as corrections pile up.
export async function getCorrections(limit = 25): Promise<{ customer_message: string; corrected_reply: string }[]> {
  return sbSelect(
    `wa_message_corrections?is_active=eq.true&select=customer_message,corrected_reply&order=created_at.desc&limit=${limit}`,
  );
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

// A WhatsApp contact sometimes only exposes a LID (linked/multi-device id),
// not a real phone — the bot still has to pick *some* phone for the row, so
// it ends up with a long non-standard digit string that can't actually be
// dialed. Bangladeshi mobile numbers are 01[3-9]XXXXXXXX (11 digits) or
// 880 + that (13 digits) — anything else is treated as "not a real number".
const BD_MOBILE = /^(?:880)?1[3-9]\d{8}$/;
export function looksLikeRealPhone(phone: string): boolean {
  return BD_MOBILE.test(String(phone || "").replace(/\D/g, ""));
}

// Pulls the first Bangladeshi mobile number mentioned in free text — an
// agent's "/f* note: ... his number is 01730078392" is the main source, for
// a contact whose WhatsApp phone turned out to be a LID (see
// looksLikeRealPhone above) — and returns the note with that mention
// stripped out, so it isn't left sitting in the note once the number has
// its own place (the lead's phone field).
export function splitPhoneFromNote(text: string): { phone: string | null; text: string } {
  const raw = String(text || "");
  const m = raw.match(/(?:\+?880[\s-]?|0)1[3-9]\d(?:[\s-]?\d){7}/);
  if (!m) return { phone: null, text: raw };
  const digits = m[0].replace(/\D/g, "");
  const norm = digits.startsWith("880") ? digits : "880" + digits.replace(/^0/, "");
  if (!looksLikeRealPhone(norm)) return { phone: null, text: raw };
  // Drop the number itself plus a short leading "his/her number is" /
  // "number:" style lead-in right before it, if there is one — otherwise
  // the note reads like a sentence missing its object ("his number is .").
  const cleaned = raw
    .replace(new RegExp(`(?:\\b(?:his|her|my|the|contact|phone|number)\\b[^.]{0,20})?${m[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"), "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,!?])/g, "$1")
    .replace(/^[\s.,-]+|[\s.,-]+$/g, "")
    .trim();
  return { phone: norm, text: cleaned };
}

// If the WA-sourced phone on a lead isn't a real, dialable number (a LID)
// but the agent's forward note mentions one, that's a better phone for the
// CRM than the LID — swap it in. Preleads keep the WA-identity phone as-is
// (that's still the right key for matching future messages from this
// contact); only the CRM-facing leads row gets the dialable number.
export async function fixLeadPhoneFromNote(leadId: string, waPhone: string, phone: string | null): Promise<void> {
  if (looksLikeRealPhone(waPhone) || !phone) return;
  await sbPatch("leads", `id=eq.${encodeURIComponent(leadId)}`, { phone });
}

// The pre-forward WhatsApp conversation (preleads.message_logs) gets logged
// onto the lead as one activity when it's forwarded, so whoever receives it
// can see what the customer already said without needing chat access — the
// CRM activity timeline, unlike Conversations, is open to every role.
export async function logConversationHistory(leadId: string, companyId: string | null, phone: string, source: string): Promise<void> {
  const tail = phone.replace(/\D/g, "").slice(-9);
  if (tail.length < 8) return;
  const rows = await sbSelect(`preleads?phone=like.*${encodeURIComponent(tail)}&select=message_logs&order=updated_at.desc&limit=1`);
  const logs = rows?.[0]?.message_logs;
  if (!Array.isArray(logs) || !logs.length) return;
  const transcript = logs.map((m, i) => `${i + 1}. ${m}`).join("\n");
  await logNoteActivity(leadId, companyId, `WhatsApp conversation before forward:\n${transcript}`, source);
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

// ── phone / jid ─────────────────────────────────────────────────────────────
export const jidToPhone = (jid: string) => (jid || "").split("@")[0].split(":")[0].replace(/\D/g, "");

// One customer can reach the bot under two JIDs: the phone JID (…@s.whatsapp.net)
// and, when WhatsApp hides the number, a LID (…@lid). Both must land in the same
// conversation, so the conversation key prefers the phone JID whenever a real
// Bangladeshi number is known; a LID with no real number stays as-is.
export const canonicalConvJid = (remote: string, phone: string): string => {
  const r = String(remote || "");
  if (r.endsWith("@s.whatsapp.net")) return r;
  if (r.endsWith("@lid")) {
    // Normalize to the BD international form (8801XXXXXXXXXX) so the LID thread
    // matches the phone-JID thread of the same customer exactly.
    let p = String(phone || "").replace(/\D/g, "");
    if (p.startsWith("0")) p = p.slice(1);
    if (/^1[3-9]\d{8}$/.test(p)) p = "880" + p;
    if (looksLikeRealPhone(p)) return `${p}@s.whatsapp.net`;
    return r;
  }
  return r;
};

// Click-to-WhatsApp ad referral. Wasender surfaces this either pre-flattened or
// nested on contextInfo.externalAdReply — accept both. Besides the ad creative,
// capture Meta's structured identifiers (ad/campaign/adcreative/click) when the
// payload carries them, so an ad can be traced to its campaign, not just its
// creative text. Empty fields fall through; returns null when nothing ad-like
// is present.
export function extractAdReply(msg: any, payload: any): Record<string, unknown> | null {
  const ctx =
    msg?.extendedTextMessage?.contextInfo?.externalAdReply ??
    msg?.imageMessage?.contextInfo?.externalAdReply ??
    msg?.contextInfo?.externalAdReply ??
    payload?.externalAdReply ??
    payload?.adReply ??
    null;
  if (!ctx) return null;
  const r = payload?.referral ?? null;
  const ad: Record<string, unknown> = {
    title: ctx.title ?? ctx.adTitle ?? "",
    description: ctx.description ?? ctx.adDescription ?? "",
    body: ctx.body ?? ctx.adText ?? ctx.text ?? "",
    conversionSource: ctx.conversionSource ?? ctx.sourceType ?? ctx.source ?? "",
    sourceUrl: ctx.sourceUrl ?? ctx.url ?? "",
    greetingMessageBody: ctx.greetingMessageBody ?? ctx.greeting ?? "",
    thumbnailUrl: ctx.thumbnailUrl ?? ctx.thumbnail ?? "",
    adId: ctx.adId ?? ctx.ad_id ?? r?.ad_id ?? "",
    campaignId: ctx.campaignId ?? ctx.campaign_id ?? r?.campaign_id ?? "",
    adcreativeId: ctx.adcreativeId ?? ctx.adcreative_id ?? r?.adcreative_id ?? "",
    clickId: ctx.clickId ?? ctx.click_id ?? r?.click_id ?? ctx.ctwaClid ?? "",
  };
  return Object.values(ad).some(Boolean) ? ad : null;
}

// First real, dialable Bangladeshi number among payload JID/sender candidates,
// normalized to the international 880 form (the form leads are stored in). A
// LID's digits are not a real number and are never returned.
export function realPhoneFrom(candidates: unknown[]): string {
  for (const c of candidates) {
    const d = String(c ?? "").replace(/\D/g, "");
    if (!d) continue;
    const n = d.length === 11 && d.startsWith("01") ? "880" + d.slice(1)
      : d.length === 10 && d.startsWith("1") ? "880" + d
      : d;
    if (looksLikeRealPhone(n)) return n;
  }
  return "";
}

// Wasender echoes a bot's own send back as a fromMe message whose key.id is not
// the msgId the send API returned, so the wa_id index never catches it. The
// echo is the same OUT text, in the same thread, seconds after a bot-sent row.
export const isBotEcho = (
  recentOut: { body?: string | null; sender_name?: string | null; wa_timestamp?: string | null }[], body: string, at: string, windowMs = 120_000,
): boolean =>
  !!body && recentOut.some((r) => (r.body || "") === body && ["AI Agent", "AI Trainer"].includes(String(r.sender_name || ""))
    && Math.abs(new Date(at).getTime() - new Date(r.wa_timestamp || 0).getTime()) <= windowMs);
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

// Same rule as wa-webhook: with a secret configured the header must match it;
// none configured → accepted as before. `strong` = verified against a secret.
export async function verifyWebhook(account: string, headers: Headers): Promise<{ ok: boolean; strong: boolean }> {
  const { webhookSecret } = await getCredentials(account);
  if (!webhookSecret) {
    console.warn(`verifyWebhook: no webhook secret for ${account}, accepting unauthenticated`);
    return { ok: true, strong: false };
  }
  const sig = headers.get("x-webhook-signature") ?? headers.get("x-wasender-signature") ?? "";
  return { ok: safeEqual(sig, webhookSecret), strong: true };
}
