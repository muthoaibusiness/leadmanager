// Outbound relay. The browser POSTs here; this function holds the Wasender
// credential and talks to the API.
//
// Deploy:  npx supabase functions deploy wa-send --no-verify-jwt
// Secrets: npx supabase secrets set WASENDER_API_TOKEN=...
//
// --no-verify-jwt is required because the CRM authenticates its own users and
// never mints a Supabase JWT. Admin-only actions are checked against the users
// table instead (see isAdminUser).

import {
  CORS, json, WASENDER_BASE, getCredentials, isAdminUser, sbPatch, sbUpsert, phoneToJid,
} from "../_shared/wa.ts";

interface SendBody {
  action: "send" | "set-credentials";
  to?: string;
  conversationId?: string;
  clientRef?: string;
  type?: "text" | "image" | "document" | "video" | "audio";
  text?: string;
  caption?: string;
  mediaUrl?: string;
  mediaName?: string;
  mediaMime?: string;
  userId?: string | null;
  sessionName?: string;
  apiToken?: string;
  webhookSecret?: string;
}

// Map our message type onto the Wasender payload shape.
function buildPayload(b: SendBody) {
  const to = b.to || "";
  switch (b.type) {
    case "image":
      return { to, text: b.caption || "", imageUrl: b.mediaUrl };
    case "video":
      return { to, text: b.caption || "", videoUrl: b.mediaUrl };
    case "audio":
      return { to, audioUrl: b.mediaUrl };
    case "document":
      return { to, text: b.caption || "", documentUrl: b.mediaUrl, fileName: b.mediaName || "file" };
    default:
      return { to, text: b.text || "" };
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

  // ── rotate/store credentials (admin only) ────────────────────────────────
  if (body.action === "set-credentials") {
    if (!(await isAdminUser(body.userId ?? null))) return json({ error: "Not authorised" }, 403);
    if (!body.apiToken) return json({ error: "apiToken is required" }, 400);
    const ok = await sbUpsert("wa_secrets", [{
      id: "default",
      api_token: body.apiToken,
      webhook_secret: body.webhookSecret || null,
      updated_at: new Date().toISOString(),
      updated_by: body.userId ?? null,
    }]);
    return ok ? json({ ok: true }) : json({ error: "Could not store credentials" }, 500);
  }

  if (body.action !== "send") return json({ error: "Unknown action" }, 400);
  if (!body.to || !body.clientRef || !body.conversationId) {
    return json({ error: "to, clientRef and conversationId are required" }, 400);
  }

  const { token } = await getCredentials();
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
