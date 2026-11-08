// WhatsApp Business Cloud API (Meta's official route), the rules with no I/O so the Node tests cover them.
// The bots send through Wasender (an unofficial session); this is the route for what Meta insists on:
// a message to someone who has not written in the last 24 hours must be an approved TEMPLATE, and only
// a reply inside that window can be free text. meta-wa.ts does the sending, wa-meta-send the endpoint.

import { normPhone } from "./phone.ts";

export type Row = Record<string, any>;

// The number as Meta wants it: digits with the country code, no plus. A WhatsApp LID (a hidden number's
// internal id, 15+ digits with no country) cannot be sent to by Meta, so it gives "".
export function metaTo(raw: unknown): string {
  const d = normPhone(raw);
  return d.length >= 10 && d.length <= 15 ? d : "";
}

export type TemplateInput = { to: string; name: string; lang: string; body?: string[]; headerImage?: string; headerText?: string; buttons?: { index: number; sub: "url" | "quick_reply"; value: string }[] };

// A template message. `body` fills {{1}}, {{2}}, … in order; the header is an image (a public https link) or one text variable.
export function templatePayload(t: TemplateInput): Row {
  const components: Row[] = [];
  if (t.headerImage) components.push({ type: "header", parameters: [{ type: "image", image: { link: t.headerImage } }] });
  else if (t.headerText) components.push({ type: "header", parameters: [{ type: "text", text: t.headerText }] });
  if (t.body?.length) components.push({ type: "body", parameters: t.body.map((text) => ({ type: "text", text: String(text) })) });
  for (const b of t.buttons ?? []) {
    components.push({ type: "button", sub_type: b.sub, index: String(b.index), parameters: [b.sub === "url" ? { type: "text", text: b.value } : { type: "payload", payload: b.value }] });
  }
  return {
    messaging_product: "whatsapp", recipient_type: "individual", to: t.to, type: "template",
    template: { name: t.name, language: { code: t.lang }, ...(components.length ? { components } : {}) },
  };
}

// Free text: Meta delivers it only while the customer's own message is under 24 hours old.
export const textPayload = (to: string, text: string, previewUrl = false): Row => ({
  messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body: text, preview_url: previewUrl },
});

export type MetaKind = "ok" | "token" | "window" | "not_whatsapp" | "template" | "rate" | "quality" | "payment" | "other";
export type MetaResult = { ok: boolean; kind: MetaKind; wamid?: string; code?: number; message?: string };

// What Meta answered, in the few kinds that need different action. The codes are Meta's documented ones.
const KIND: [MetaKind, number[]][] = [
  ["token", [190, 102, 10, 200, 100000]],               // expired or wrong token, missing permission
  ["window", [131047]],                                  // free text to someone outside the 24-hour window: use a template
  ["not_whatsapp", [131026, 131030]],                    // the number is not on WhatsApp / not in the allowed list
  ["template", [132000, 132001, 132005, 132007, 132012, 132015, 132016, 131009]],   // missing, paused, or parameters do not match
  ["rate", [130429, 131056, 80007, 4, 17, 613]],         // sending too fast or the messaging tier is used up
  ["quality", [131048, 131049]],                         // spam-rate limit, or Meta chose not to deliver a marketing message
  ["payment", [131042]],                                 // no payment method on the WhatsApp account
];
export function metaResult(status: number, j: Row | null | undefined, token = ""): MetaResult {
  const scrub = (s: unknown) => (token ? String(s ?? "").split(token).join("[redacted]") : String(s ?? ""));
  const e = j?.error;
  const wamid = j?.messages?.[0]?.id ? String(j.messages[0].id) : "";
  if (status >= 200 && status < 300 && wamid && !e) return { ok: true, kind: "ok", wamid };
  const code = Number(e?.error_data?.code ?? e?.code);
  const hit = KIND.find(([, codes]) => codes.includes(code));
  const kind: MetaKind = hit ? hit[0] : status === 401 ? "token" : status === 429 ? "rate" : "other";
  const message = scrub(e?.error_user_msg || e?.error_data?.details || e?.message || `HTTP ${status}`).slice(0, 300);
  return { ok: false, kind, code: Number.isFinite(code) ? code : undefined, message };
}
