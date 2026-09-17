// Inbound webhook. Point Wasender straight at this URL, or have n8n forward the
// untouched payload here.
//
// Deploy:  npx supabase functions deploy wa-webhook --no-verify-jwt
// Secrets: npx supabase secrets set WASENDER_WEBHOOK_SECRET=...
//
// Responsibilities: verify the signature, drop replays, copy media into Storage
// so it stays viewable, upsert the conversation (with ad referral), insert the
// message, and apply delivery receipts to outbound rows.

import {
  CORS, json, SUPABASE_URL, SERVICE_KEY, claimEvent, getCredentials,
  jidToPhone, sbPatch, sbRpc, sbSelect, sbUpsert, safeEqual,
} from "../_shared/wa.ts";

const BUCKET = "wa-media";

// Wasender status strings → our ladder.
const STATUS_MAP: Record<string, string> = {
  pending: "PENDING", sent: "SENT", server_ack: "SENT",
  delivered: "DELIVERED", delivery_ack: "DELIVERED",
  read: "READ", played: "READ",
  failed: "FAILED", error: "FAILED",
};

// Status only ever moves forward, so a late receipt can't undo a later one.
const STATUS_RANK: Record<string, number> = { PENDING: 0, SENT: 1, DELIVERED: 2, READ: 3, FAILED: 4 };

// Pull the human-readable text out of the many shapes a WhatsApp message takes.
function extractText(m: any): string {
  return (
    m?.conversation ??
    m?.extendedTextMessage?.text ??
    m?.imageMessage?.caption ??
    m?.videoMessage?.caption ??
    m?.documentMessage?.caption ??
    m?.buttonsResponseMessage?.selectedDisplayText ??
    m?.listResponseMessage?.title ??
    // Wasender's flat shape puts the text straight on the message node.
    m?.messageBody ??
    m?.text ??
    ""
  );
}

function extractMedia(m: any): { type: string; url?: string; mime?: string; name?: string; size?: number } {
  if (m?.imageMessage) return { type: "image", url: m.imageMessage.url, mime: m.imageMessage.mimetype, name: "image.jpg", size: Number(m.imageMessage.fileLength) || 0 };
  if (m?.videoMessage) return { type: "video", url: m.videoMessage.url, mime: m.videoMessage.mimetype, name: "video.mp4", size: Number(m.videoMessage.fileLength) || 0 };
  if (m?.audioMessage) return { type: "audio", url: m.audioMessage.url, mime: m.audioMessage.mimetype, name: "audio.ogg", size: Number(m.audioMessage.fileLength) || 0 };
  if (m?.documentMessage) return { type: "document", url: m.documentMessage.url, mime: m.documentMessage.mimetype, name: m.documentMessage.fileName || "document", size: Number(m.documentMessage.fileLength) || 0 };
  if (m?.stickerMessage) return { type: "sticker", url: m.stickerMessage.url, mime: m.stickerMessage.mimetype, name: "sticker.webp", size: 0 };
  // Flat shape: messageType: "imageMessage" with the URL alongside it.
  const flat = String(m?.messageType ?? "").replace(/Message$/, "").toLowerCase();
  const flatUrl = m?.mediaUrl ?? m?.url ?? "";
  if (flatUrl && ["image", "video", "audio", "document", "sticker"].includes(flat)) {
    return { type: flat, url: flatUrl, mime: m.mimetype ?? "", name: m.fileName ?? flat, size: Number(m.fileLength) || 0 };
  }
  return { type: "text" };
}

// Click-to-WhatsApp ad referral. Wasender surfaces this either pre-flattened or
// nested on contextInfo.externalAdReply — accept both.
function extractAd(msg: any, payload: any): Record<string, unknown> | null {
  const ctx =
    msg?.extendedTextMessage?.contextInfo?.externalAdReply ??
    msg?.imageMessage?.contextInfo?.externalAdReply ??
    msg?.contextInfo?.externalAdReply ??
    payload?.externalAdReply ??
    payload?.adReply ??
    null;
  if (!ctx) return null;
  const ad = {
    title: ctx.title ?? ctx.adTitle ?? "",
    description: ctx.description ?? ctx.adDescription ?? "",
    body: ctx.body ?? ctx.adText ?? ctx.text ?? "",
    conversionSource: ctx.conversionSource ?? ctx.sourceType ?? ctx.source ?? "",
    sourceUrl: ctx.sourceUrl ?? ctx.url ?? "",
    greetingMessageBody: ctx.greetingMessageBody ?? ctx.greeting ?? "",
    thumbnailUrl: ctx.thumbnailUrl ?? ctx.thumbnail ?? "",
  };
  return Object.values(ad).some(Boolean) ? ad : null;
}

// WhatsApp media links expire and need auth, so mirror the file into Storage and
// keep the durable public URL on the message row. Failure is non-fatal — the
// message still lands, just without a preview.
async function mirrorMedia(url: string, name: string, mime: string): Promise<string> {
  try {
    const res = await fetch(url);
    if (!res.ok) { console.error("media fetch failed", res.status); return ""; }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const safe = (name || "file").replace(/[^\w.\-]/g, "_");
    const path = `in/${Date.now()}_${crypto.randomUUID().slice(0, 8)}_${safe}`;
    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": mime || "application/octet-stream",
      },
      body: bytes,
    });
    if (!up.ok) { console.error("media upload failed", up.status, await up.text()); return ""; }
    return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
  } catch (e) {
    console.error("mirrorMedia error", e);
    return "";
  }
}

// Attach the thread to an existing CRM lead by the last 9 digits of the number,
// which survives +880 / 880 / 0-prefix differences.
async function findLeadId(phone: string): Promise<string | null> {
  const tail = phone.slice(-9);
  if (tail.length < 8) return null;
  const rows = await sbSelect(`leads?phone=like.*${encodeURIComponent(tail)}&select=id&limit=1`);
  return rows?.[0]?.id ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const rawBody = await req.text();

  // ── signature ────────────────────────────────────────────────────────────
  const { webhookSecret } = await getCredentials();
  if (webhookSecret) {
    const sig = req.headers.get("x-webhook-signature") ?? req.headers.get("x-wasender-signature") ?? "";
    if (!safeEqual(sig, webhookSecret)) {
      console.warn("rejected webhook: bad signature");
      return json({ error: "Invalid signature" }, 401);
    }
  }

  let payload: any;
  try { payload = JSON.parse(rawBody); } catch { return json({ error: "Invalid JSON" }, 400); }

  const event: string = payload.event ?? payload.type ?? "unknown";
  const data = payload.data ?? payload;

  // ── replay guard ─────────────────────────────────────────────────────────
  const deliveryId =
    payload.id ?? payload.eventId ??
    data?.key?.id ?? data?.messages?.key?.id ?? data?.msgId ?? null;
  if (deliveryId) {
    const fresh = await claimEvent(`${event}:${deliveryId}`, event);
    if (!fresh) return json({ ok: true, duplicate: true });
  }

  // Extract up front: an event carrying a real body is a message, not a receipt.
  // A reply typed on the phone arrives with fromMe true (often as message.sent)
  // and has to land in the thread, not just patch a status.
  const msgNode = data?.messages ?? data?.message ?? data;
  const key = msgNode?.key ?? data?.key ?? {};
  const inner = msgNode?.message ?? msgNode ?? {};
  const text = extractText(inner);
  const media = extractMedia(inner);
  const hasContent = !!(text || media.type !== "text");

  // ── delivery receipts for our outbound messages ──────────────────────────
  if (!hasContent && (event.includes("update") || event.includes("receipt") || event === "message.sent")) {
    const updates = Array.isArray(data) ? data : [data];
    for (const u of updates) {
      const id = u?.key?.id ?? u?.msgId ?? u?.id;
      const rawStatus = String(u?.status ?? u?.update?.status ?? "").toLowerCase();
      const status = STATUS_MAP[rawStatus];
      if (!id || !status) continue;
      // Outbound rows keep their client-generated PK, so match on wa_id.
      await sbPatch("wa_messages", `wa_id=eq.${encodeURIComponent(String(id))}`, { status });
    }
    return json({ ok: true });
  }

  // ── message: inbound, or outbound typed on the phone (fromMe) ────────────
  const jid: string = key.remoteJid ?? msgNode?.remoteJid ?? data?.from ?? "";
  if (!jid || jid.endsWith("@g.us")) return json({ ok: true, skipped: "not a 1:1 chat" });

  const fromMe = !!key.fromMe;
  const msgId: string = key.id ?? msgNode?.id ?? crypto.randomUUID();
  // WhatsApp addresses some chats by LID (…@lid), whose digits are not a phone
  // number — sending to them fails with "The provided JID does not exist on
  // WhatsApp." The payload carries the real phone JID alongside, so prefer that
  // for the phone column. senderPn is only the customer's when !fromMe.
  const phoneJidCandidates: string[] = [
    key.remoteJid, key.remoteJidAlt, msgNode?.remoteJidAlt, data?.remoteJidAlt,
    ...(fromMe ? [] : [key.senderPn, key.participantPn, msgNode?.senderPn, data?.senderPn]),
    data?.from,
  ].filter(Boolean).map(String);
  const phoneJid = phoneJidCandidates.find((j) => j.endsWith("@s.whatsapp.net")) ?? "";
  const phone = jidToPhone(phoneJid || jid);
  const ad = extractAd(inner, data);
  const pushName: string = msgNode?.pushName ?? data?.pushName ?? "";
  const tsSeconds = Number(msgNode?.messageTimestamp ?? data?.timestamp ?? 0);
  const at = tsSeconds ? new Date(tsSeconds * 1000).toISOString() : new Date().toISOString();

  let mediaUrl = "";
  if (media.url) mediaUrl = await mirrorMedia(media.url, media.name ?? "file", media.mime ?? "");

  // Conversation first, so the message never references a missing thread.
  const existing = await sbSelect(`wa_conversations?id=eq.${encodeURIComponent(jid)}&select=id,name,lead_id,source`);
  const leadId = existing?.[0]?.lead_id ?? (await findLeadId(phone));

  // pushName on a fromMe message is our own WhatsApp profile name, not the
  // customer's — it must never overwrite the thread title.
  const convRow: Record<string, unknown> = {
    id: jid,
    phone,
    name: (fromMe ? "" : pushName) || existing?.[0]?.name || phone,
    lead_id: leadId,
  };
  // Only stamp the ad payload once — the referral arrives on the first message
  // and must not be wiped by later plain messages in the same thread.
  if (ad) { convRow.source = "AD"; convRow.ad_meta = ad; }
  else if (!existing?.length) { convRow.source = "WHATSAPP"; }

  await sbUpsert("wa_conversations", [convRow]);

  // A receipt may already have advanced this row past SENT; don't drag it back.
  let status = fromMe ? "SENT" : "DELIVERED";
  if (fromMe) {
    const prevRows = await sbSelect(`wa_messages?id=eq.${encodeURIComponent(msgId)}&select=status`);
    const prev: string | undefined = prevRows?.[0]?.status;
    if (prev && (STATUS_RANK[prev] ?? 0) > STATUS_RANK.SENT) status = prev;
  }

  const preview = text || media.name || media.type;
  await sbUpsert("wa_messages", [{
    id: msgId,
    wa_id: msgId,
    conversation_id: jid,
    phone,
    direction: fromMe ? "OUT" : "IN",
    type: media.type,
    body: media.type === "text" ? text : "",
    caption: media.type === "text" ? "" : text,
    media_url: mediaUrl,
    media_mime: media.mime ?? "",
    media_name: media.name ?? "",
    media_size: media.size ?? 0,
    status,
    sender_name: fromMe ? "" : pushName,
    wa_timestamp: at,
  }]);

  // Atomic — two messages landing together can't clobber each other's count.
  await sbRpc("wa_bump_unread", {
    p_conv: jid,
    p_preview: String(preview).slice(0, 180),
    p_at: at,
    p_dir: fromMe ? "OUT" : "IN",
  });

  return json({ ok: true });
});
