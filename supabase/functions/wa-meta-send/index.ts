// wa-meta-send: sends one WhatsApp message through Meta's official Cloud API (rules in
// _shared/meta-wa-core.ts, sending in _shared/meta-wa.ts).
//
// Deploy:  npx supabase functions deploy wa-meta-send --no-verify-jwt
// Secrets: META_WA_TOKEN, META_WA_PHONE_ID (see docs/meta-whatsapp-setup.md); FOLLOWUP_CRON_KEY (already set)
//
// Access: the x-followup-key header must equal FOLLOWUP_CRON_KEY, like the follow-up cron and the
// Facebook replay. Nothing else can make it send. Use scripts/meta-wa-send.mjs.
//
// Body: { "to": "8801…", "template": { "name": "…", "lang": "bn", "body": ["Rahim", "…"], "header_image": "https://…" } }
//    or { "to": "8801…", "text": "…" }   (free text: only inside the customer's 24-hour window)

import { CORS, json } from "../_shared/wa.ts";
import { cronKeyGate } from "../_shared/cron-key.ts";
import { sendMetaTemplate, sendMetaText } from "../_shared/meta-wa.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const gate = cronKeyGate(req, Deno.env.get("FOLLOWUP_CRON_KEY"), "x-followup-key");
  if (!gate.ok) return json({ ok: false, error: gate.error }, gate.status);

  let b: any;
  try { b = await req.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }
  const t = b?.template;
  if (t) {
    if (!t.name || !t.lang) return json({ ok: false, error: "template needs name and lang" }, 400);
    const r = await sendMetaTemplate({ to: b.to, name: String(t.name), lang: String(t.lang), body: Array.isArray(t.body) ? t.body : [], headerImage: t.header_image || undefined, headerText: t.header_text || undefined, buttons: Array.isArray(t.buttons) ? t.buttons : undefined });
    return json(r, r.ok ? 200 : 502);
  }
  if (typeof b?.text === "string" && b.text.trim()) {
    const r = await sendMetaText(b.to, b.text.trim());
    return json(r, r.ok ? 200 : 502);
  }
  return json({ ok: false, error: "send a template or a text" }, 400);
});
