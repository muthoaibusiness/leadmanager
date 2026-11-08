// Outbound relay. The browser POSTs here; this function holds the Wasender
// credential and talks to the API.
//
// Deploy:  npx supabase functions deploy wa-send --no-verify-jwt
// Secrets: npx supabase secrets set WASENDER_API_TOKEN=...
//
// Every call needs the caller's Supabase Auth session (wa-send-auth.ts,
// decision D1); body.userId is ignored. set-credentials answers 410: tokens
// are rotated by an operator with CR-001 runbook A.

import {
  CORS, json, WASENDER_BASE, SUPABASE_URL, SERVICE_KEY, getCredentials, sbPatch, sbUpsert, phoneToJid,
} from "../_shared/wa.ts";
import { verifiedActor, actorDepsFromEnv } from "../_shared/actor.ts";
import { normPhone } from "../_shared/phone.ts";
import { authorizeWaSend, checkWaSend, restChatDeps, claimSend, restPatch } from "../_shared/wa-send-auth.ts";

const actorDeps = actorDepsFromEnv((k) => Deno.env.get(k));
const chatDeps = restChatDeps(actorDeps.url, actorDeps.serviceKey);
const msgPatch = restPatch(actorDeps.url, actorDeps.serviceKey);

interface SendBody {
  action: "send" | "get-avatar" | "set-credentials";
  account?: string;
  to?: string;
  conversationId?: string;
  clientRef?: string;
  type?: "text" | "image" | "document" | "video" | "audio";
  text?: string;
  caption?: string;
  mediaUrl?: string;
  mediaName?: string;
  mediaMime?: string;
  sessionName?: string;
}

// Map our message type onto the Wasender payload shape. Wasender rejects an
// image/document/video send with an empty "text" (its validator treats ""
// as missing, not as a string — confirmed directly against the API), so a
// caption-less send always needs a fallback.
function buildPayload(b: SendBody) {
  const to = b.to || "";
  switch (b.type) {
    case "image":
      return { to, text: b.caption || "Photo", imageUrl: b.mediaUrl };
    case "video":
      return { to, text: b.caption || "Video", videoUrl: b.mediaUrl };
    case "audio":
      return { to, audioUrl: b.mediaUrl };
    case "document":
      return { to, text: b.caption || (b.mediaName || "Document"), documentUrl: b.mediaUrl, fileName: b.mediaName || "file" };
    default:
      return { to, text: b.text || "" };
  }
}

async function keepPicture(conversationId: string, url: string): Promise<string> {
  try {
    const img = await fetch(url);
    if (!img.ok) { console.error("avatar download failed", img.status); return ""; }
    const mime = img.headers.get("content-type") || "image/jpeg";
    const path = `avatars/${conversationId.replace(/[^\w.\-]/g, "_")}.jpg`;
    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/wa-media/${path}`, {
      method: "POST",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": mime, "x-upsert": "true" },
      body: new Uint8Array(await img.arrayBuffer()),
    });
    if (!up.ok) { console.error("avatar upload failed", up.status, await up.text()); return ""; }
    return `${SUPABASE_URL}/storage/v1/object/public/wa-media/${path}?v=${Date.now()}`;
  } catch (e) {
    console.error("keepPicture error", e);
    return "";
  }
}

// The customer's WhatsApp profile picture, saved on the thread so the list shows
// it. The browser may not write wa_conversations or hold the token, so the
// lookup and the save both happen here, for a signed-in user whose company owns
// the thread. Nothing is guessed: no picture (or a hidden one) is ok:false.
async function getAvatar(actor: { role?: string; company_id?: string | null }, conversationId?: string): Promise<Response> {
  if (!conversationId) return json({ error: "conversationId is required" }, 400);
  let conv;
  try { conv = await chatDeps.conversation(conversationId); }
  catch (e) { console.error("get-avatar read failed", e); return json({ error: "Could not read the conversation" }, 503); }
  if (!conv) return json({ error: "No such conversation" }, 404);
  if (actor.role !== "MASTER" && conv.company_id && conv.company_id !== actor.company_id) return json({ error: "This conversation belongs to another company" }, 403);
  const phone = normPhone(conv.phone);
  if (!phone) return json({ ok: false, reason: "no phone on this thread" });
  const { token } = await getCredentials(conv.account === "dubai" ? "dubai" : "eyad");
  if (!token) return json({ ok: false, reason: "no token" });
  try {
    const r = await fetch(`${WASENDER_BASE}/contacts/${phone}/picture`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return json({ ok: false, reason: `wasender ${r.status}` });
    const j = await r.json().catch(() => ({}));
    const url = String(j?.data?.imgUrl ?? j?.data?.url ?? j?.imgUrl ?? "");
    if (!/^https:\/\//.test(url)) return json({ ok: false, reason: "no picture" });
    // WhatsApp's picture links expire within days, so the picture is copied into our
    // own storage and the stable link is what gets saved.
    const stored = await keepPicture(conversationId, url);
    if (!stored) return json({ ok: false, reason: "could not store the picture" });
    await sbPatch("wa_conversations", `id=eq.${encodeURIComponent(conversationId)}`, { avatar_url: stored });
    return json({ ok: true, avatarUrl: stored });
  } catch (e) {
    console.error("get-avatar failed", e);
    return json({ ok: false, reason: "lookup failed" });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: SendBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const auth = await authorizeWaSend(req, body, (r) => verifiedActor(r, actorDeps));
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  if (body.action === "get-avatar") return await getAvatar(auth.actor, body.conversationId);

  // Chat access, company and thread ownership, server-side (wa-send-auth.ts).
  let chat;
  try { chat = await checkWaSend(auth.actor, body as unknown as Record<string, unknown>, chatDeps); }
  catch (e) { console.error("wa-send access check failed", e); return json({ error: "Could not check chat access" }, 503); }
  if (chat.status !== 200) return json({ error: chat.error }, chat.status);
  // Send from the thread's own number, to the thread's own phone, never values named in the body.
  const account = chat.conversation?.account === "dubai" ? "dubai" : "eyad";
  body.to = chat.to;
  try { if (!(await claimSend(body.clientRef as string, msgPatch))) return json({ error: "This message is already being sent" }, 409); }
  catch (e) { console.error("wa-send claim failed", e); return json({ error: "Could not reserve the message" }, 503); }

  const { token } = await getCredentials(account);
  if (!token) {
    await sbPatch("wa_messages", `id=eq.${encodeURIComponent(body.clientRef)}`, {
      status: "FAILED", error: "No Wasender token configured on the server.",
    });
    return json({ error: "No Wasender token configured" }, 500);
  }

  // ── deliver ──────────────────────────────────────────────────────────────
  try {
    const res = await fetch(`${WASENDER_BASE}/send-message`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildPayload(body)),
    });

    const raw = await res.text();
    let parsed: any = {};
    try { parsed = JSON.parse(raw); } catch { /* non-JSON error body */ }

    if (!res.ok) {
      const reason = (parsed?.message || raw || `HTTP ${res.status}`).slice(0, 400);
      await sbPatch("wa_messages", `id=eq.${encodeURIComponent(body.clientRef)}`, {
        status: "FAILED", error: reason,
      });
      return json({ error: reason }, 502);
    }

    // Wasender has moved this field around between versions; accept the usual spots.
    const waId =
      parsed?.data?.msgId ?? parsed?.data?.id ?? parsed?.data?.key?.id ??
      parsed?.msgId ?? parsed?.id ?? null;

    await sbPatch("wa_messages", `id=eq.${encodeURIComponent(body.clientRef)}`, {
      status: "SENT",
      wa_id: waId ? String(waId) : null,
      error: null,
    });

    // Make sure the thread exists and floats to the top of the rail.
    await sbUpsert("wa_conversations", [{
      id: body.conversationId,
      phone: body.to,
      last_message_at: new Date().toISOString(),
      last_message_preview: body.type === "text" ? (body.text || "") : (body.mediaName || body.type || ""),
      last_message_dir: "OUT",
    }]);

    return json({ ok: true, waId, jid: phoneToJid(body.to) });
  } catch (e) {
    const reason = (e instanceof Error ? e.message : String(e)).slice(0, 400);
    await sbPatch("wa_messages", `id=eq.${encodeURIComponent(body.clientRef)}`, {
      status: "FAILED", error: reason,
    });
    return json({ error: reason }, 500);
  }
});
