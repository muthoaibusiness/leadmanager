// Facebook Lead Ads intake: the rules, with no I/O so the Node tests cover them.
// Meta tells us a form was answered (a webhook carrying only ids); we fetch the
// answers, map them onto a CRM lead by the form's configuration (Admin > Facebook
// Leads, tables from migration 0059), and hand it to someone.

import { normPhone } from "./phone.ts";

type Row = Record<string, any>;

// ── is it really Meta? ──────────────────────────────────────────────────────
// Meta signs the raw body with the app secret: X-Hub-Signature-256: sha256=<hex>.
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
export async function verifySignature(raw: string, header: string | null, secret: string): Promise<boolean> {
  if (!secret || !header || !header.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  return same(hex, header.slice(7).toLowerCase());
}

// ── what the webhook says ───────────────────────────────────────────────────
export type Change = { leadgen_id: string; form_id: string; page_id: string };
export function leadgenChanges(body: Row): Change[] {
  const out: Change[] = [];
  for (const entry of Array.isArray(body?.entry) ? body.entry : []) {
    for (const ch of Array.isArray(entry?.changes) ? entry.changes : []) {
      if (ch?.field !== "leadgen") continue;
      const v = ch.value ?? {};
      const id = String(v.leadgen_id ?? "").replace(/\D/g, "");
      if (!id) continue;
      out.push({ leadgen_id: id, form_id: String(v.form_id ?? "").replace(/\D/g, ""), page_id: String(v.page_id ?? entry.id ?? "").replace(/\D/g, "") });
    }
  }
  return out;
}

// ── the answers ─────────────────────────────────────────────────────────────
export type FieldData = { name: string; values?: string[] }[];
// "Phone number", "phone_number" and "PHONE-NUMBER" are one key: case and the
// spaces / underscores / dashes between words do not matter (Bangla included).
export const normKey = (s: unknown): string =>
  String(s ?? "").normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "");

const answerOf = (fd: FieldData, keys: string[]): string => {
  for (const k of keys) {
    const f = fd.find((x) => normKey(x.name) === normKey(k));
    const v = (f?.values ?? []).map((s) => String(s).trim()).filter(Boolean).join(", ");
    if (v) return v;
  }
  return "";
};

// "50 lakh", "৫০,০০০", "BDT 5,000,000": the number in it, or 0.
export function parseBudget(s: string): number {
  const bn = "০১২৩৪৫৬৭৮৯";
  const d = String(s || "").replace(/[০-৯]/g, (c) => String(bn.indexOf(c))).replace(/,/g, "");
  const m = d.match(/\d+(?:\.\d+)?/);
  return m ? Math.round(Number(m[0])) : 0;
}

export type Mapped = { name: string; phone: string; email: string; city: string; budget: number; profession: string; answers: [string, string][] };
export function mapAnswers(fd: FieldData, fieldMap: Record<string, string[]>): Mapped {
  const pick = (t: string) => answerOf(fd, fieldMap?.[t] ?? []);
  const rawPhone = pick("phone");
  return {
    name: pick("name") || "Facebook lead",
    phone: normPhone(rawPhone) || rawPhone.replace(/\D/g, ""),
    email: pick("email"), city: pick("city"), budget: parseBudget(pick("budget")), profession: pick("profession"),
    // every answer as the customer gave it, for the note on the lead
    answers: fd.map((f): [string, string] => [String(f.name), (f.values ?? []).map((s) => String(s).trim()).filter(Boolean).join(", ")]).filter(([, v]) => v),
  };
}
export const summarizeAnswers = (answers: [string, string][]) => answers.map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join("\n");

// ── who gets it ─────────────────────────────────────────────────────────────
export type Person = { id: string; name: string; role: string; team_id?: string | null; is_active?: boolean | null };
export type Assignee = { user: Person | null; why: string };
// `made` is how many leads this form has already produced: it turns a round robin.
export function pickAssignee(form: Row, users: Person[], made: number): Assignee {
  const live = (id: unknown) => users.find((u) => u.id === id && u.is_active !== false);
  switch (form.assign_mode) {
    case "agent": { const u = live(form.assign_agent_id); return u ? { user: u, why: "agent" } : { user: null, why: "the chosen agent is missing or inactive" }; }
    case "team": {
      const u = users.find((x) => x.role === "TEAM_LEAD" && x.team_id === form.assign_team_id && x.is_active !== false);
      return u ? { user: u, why: "team lead" } : { user: null, why: "the team has no active team lead" };
    }
    case "round_robin": {
      const pool = (Array.isArray(form.assign_pool) ? form.assign_pool : []).map(live).filter(Boolean) as Person[];
      return pool.length ? { user: pool[made % pool.length], why: "round robin" } : { user: null, why: "nobody in the rotation is active" };
    }
    default: return { user: null, why: "unassigned by design" };
  }
}

// The question keys Facebook gives its standard fields; a form's own map wins.
export const DEFAULT_FIELD_MAP: Record<string, string[]> = {
  name: ["full_name", "name", "first_name"], phone: ["phone_number", "phone", "whatsapp_number", "what_is_your_phone_number"], email: ["email", "email_address"],
  city: ["city", "town/city", "area"], budget: ["budget"], profession: ["job_title", "profession"],
};
// The form's own keys are tried first, then Facebook's standard ones, so a map saved with
// only "phone_number" still finds a form whose question is called "phone".
export const fieldMapOf = (form: Row): Record<string, string[]> => {
  const own = form?.field_map ?? {};
  const out: Record<string, string[]> = { ...own };
  for (const [k, std] of Object.entries(DEFAULT_FIELD_MAP)) {
    out[k] = [...(Array.isArray(own[k]) ? own[k] : String(own[k] ?? "").split(",")).map((s: string) => s.trim()).filter(Boolean), ...std];
  }
  return out;
};

// ── the backlog drip ────────────────────────────────────────────────────────
// Leads Meta holds for a form that never became a CRM lead are fed in one at a time. A lead is
// "done" once its event is created or duplicate; a failed or skipped one is tried again an hour
// later (so one bad lead cannot hold up the rest), a stuck "received" one after ten minutes.
export type Pending = { id: string; form_id: string; created: string };
export type SeenEvent = { leadgen_id: string; status: string; processed_at?: string | null; received_at?: string | null };
export function pickNext(all: Pending[], events: SeenEvent[], nowMs: number): Pending | null {
  const seen = new Map(events.map((e) => [e.leadgen_id, e]));
  const at = (s: string) => Date.parse(s) || 0;
  for (const l of [...all].sort((a, b) => at(a.created) - at(b.created))) {
    const e = seen.get(l.id);
    if (!e) return l;
    if (e.status === "created" || e.status === "duplicate") continue;
    const wait = e.status === "received" ? 10 * 60_000 : 60 * 60_000;
    if (nowMs - at(e.processed_at || e.received_at || "") >= wait) return l;
  }
  return null;
}
