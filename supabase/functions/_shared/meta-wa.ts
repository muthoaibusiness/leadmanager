// Sends through WhatsApp Business Cloud API. Secrets (Edge Function secrets, never in a table):
//   META_WA_TOKEN     a permanent System User token (whatsapp_business_messaging + whatsapp_business_management)
//   META_WA_PHONE_ID  the sending number's Phone Number ID (not the phone number)
// Rules and error kinds are in meta-wa-core.ts.

import { metaResult, templatePayload, textPayload, metaTo, type MetaResult, type TemplateInput } from "./meta-wa-core.ts";

const GRAPH = "https://graph.facebook.com/v26.0";

export async function metaSend(payload: Record<string, unknown>): Promise<MetaResult> {
  const token = Deno.env.get("META_WA_TOKEN") ?? "";
  const phoneId = Deno.env.get("META_WA_PHONE_ID") ?? "";
  if (!token || !phoneId) return { ok: false, kind: "token", message: "META_WA_TOKEN and META_WA_PHONE_ID are not both set" };
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(new Error("timeout")), 20_000);
    try {
      const r = await fetch(`${GRAPH}/${phoneId}/messages`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: ctl.signal,
      });
      return metaResult(r.status, await r.json().catch(() => ({})), token);
    } finally { clearTimeout(timer); }
  } catch (e) {
    return { ok: false, kind: "other", message: (e instanceof Error ? e.message : "error").split(token).join("[redacted]").slice(0, 200) };
  }
}

export const sendMetaTemplate = (t: Omit<TemplateInput, "to"> & { to: unknown }): Promise<MetaResult> => {
  const to = metaTo(t.to);
  return to ? metaSend(templatePayload({ ...t, to })) : Promise.resolve({ ok: false, kind: "not_whatsapp" as const, message: "not a sendable phone number" });
};
export const sendMetaText = (to: unknown, text: string): Promise<MetaResult> => {
  const n = metaTo(to);
  return n ? metaSend(textPayload(n, text)) : Promise.resolve({ ok: false, kind: "not_whatsapp" as const, message: "not a sendable phone number" });
};
