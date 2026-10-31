// Contract copy of the bots' command parsing and routing (spec §10.5). It is
// a line-for-line port of wa-bot-eyad v38 and wa-bot-dubai v34 with I/O
// replaced by an Effects record, so the existing command behaviour can be
// tested under Node without changing or deploying the bots. If a test fails,
// compare this file with the deployed source before touching anything else.

import { brochureCaption } from "../../supabase/functions/_shared/ai.ts";

export type Parsed = { kind: "ignore" | "command" | "inbound"; command: string; text: string; phone: string; remote: string; fromMe: boolean; target: string };
export type Effects = {
  createLead?: { p_phone: string; p_cmd: string }; note?: string; notedPhone?: string | null; takeover?: boolean;
  send: { kind: "text" | "document" | "image"; to: string; url?: string; caption?: string; template?: string }[];
  capi?: boolean; ai?: boolean;
};

function base(payload: any) {
  const msg = payload?.data?.messages ?? {};
  const key = msg?.key ?? {};
  const m = msg?.message ?? {};
  const remote = String(key?.remoteJid ?? "");
  const cleaned = String(key?.cleanedSenderPn || "").trim();
  const phone = String(cleaned || remote).replace(/@.*$/, "").replace(/\D/g, "");
  const fromMe = key?.fromMe === true;
  const text = String(msg?.messageBody || m?.conversation || m?.extendedTextMessage?.text || m?.imageMessage?.caption || "").trim();
  let kind: Parsed["kind"] = "ignore";
  if (!phone || remote.endsWith("@g.us")) kind = "ignore";
  else if (fromMe && text.startsWith("/")) kind = "command";
  else if (!fromMe) kind = "inbound";
  return { kind, phone, remote, fromMe, text, cleaned, command: kind === "command" ? text.toLowerCase().split(/\s+/)[0] : "" };
}

// Eyad v38: send target is the phone when a real number exists, else the raw JID.
export function parseEyad(payload: any): Parsed {
  const b = base(payload);
  return { kind: b.kind, command: b.command, text: b.text, phone: b.phone, remote: b.remote, fromMe: b.fromMe, target: b.cleaned ? b.phone : b.remote };
}

// Dubai v34: a hidden-number (@lid) sender is addressed as "<digits>@lid".
export function parseDubai(payload: any): Parsed {
  const b = base(payload);
  const isLid = !b.cleaned && b.remote.endsWith("@lid");
  return { kind: b.kind, command: b.command, text: b.text, phone: b.phone, remote: b.remote, fromMe: b.fromMe, target: isLid ? `${b.phone}@lid` : b.phone };
}

export function extractTrailingNote(rawText: string): string {
  return rawText.trim().split(/\s+/).slice(1).join(" ").trim();
}

// Copied verbatim from deployed wa-bot-eyad v38 _shared/wa.ts.
const BD_MOBILE = /^(?:880)?1[3-9]\d{8}$/;
function looksLikeRealPhone(phone: string): boolean {
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

export function routeCommand(
  bot: "eyad" | "dubai", p: Parsed,
  ctx: { settings: Record<string, boolean>; leadResult?: { status: string; notify?: boolean; ctwa_clid?: string } | null;
    project?: { name: string; address?: string | null; brochure_url?: string; photos?: string[] } | null; leadForNote?: boolean },
): Effects {
  const e: Effects = { send: [] };
  const s = ctx.settings;
  if (p.kind !== "command") return e;
  if (p.command === "/t") {
    if (!s.takeoverEnabled) return e;
    e.takeover = true;
    // Both bots address the dialable target (v38 handleTakeover: p.target; Dubai: evt.waTo).
    e.send.push({ kind: "text", to: p.target, template: "handover" });
    return e;
  }
  if (p.command === "/n") {
    if (!s.notesEnabled) return e;
    const raw = extractTrailingNote(p.text);
    if (raw && ctx.leadForNote) e.note = raw;
    return e;
  }
  if (p.command.startsWith("/f")) {
    if (!s.manualForwardEnabled) return e;
    e.createLead = { p_phone: p.phone, p_cmd: p.command };
    const r = ctx.leadResult;
    // Both bots throw when wa_create_lead returns nothing; the webhook then
    // answers 500 and nothing else runs (eyad handleCreateLead, dubai handleCommand).
    if (!r) throw new Error("wa_create_lead failed");
    const trailing = extractTrailingNote(p.text);
    if (trailing) { const sp = splitPhoneFromNote(trailing); e.note = sp.text || trailing; if (sp.phone) e.notedPhone = sp.phone; }
    if (s.metaCapiEnabled && r.status === "created" && (r.ctwa_clid || "") !== "") e.capi = true;
    const to = p.target;
    if (!s.customerNotifyEnabled) { /* no customer message */ }
    else if (r.status === "created" && r.notify === true) e.send.push({ kind: "text", to, template: "assigned" });
    else if (r.status === "exists") e.send.push({ kind: "text", to, template: "already_assigned" });
    return e;
  }
  if (bot === "eyad" && p.command.startsWith("/send")) {
    if (!s.docsCommandEnabled) return e;
    const pr = ctx.project;
    if (!pr) return e;
    // wa-bot-eyad v59+: the caption names the sector (brochureCaption, _shared/ai.ts).
    if (pr.brochure_url) e.send.push({ kind: "document", to: p.target, url: pr.brochure_url, caption: brochureCaption(pr) });
    for (const url of (pr.photos || []).slice(0, 3)) e.send.push({ kind: "image", to: p.target, url, caption: pr.name });
    return e;
  }
  return e;
}
