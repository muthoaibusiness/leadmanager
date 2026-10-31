// Who may call wa-send (decision D1). set-credentials is retired: credentials
// are rotated by an operator with runbook A (CR-001 CR-3), so it answers 410
// before anything is looked up. "send" needs a verified, active CRM session;
// body.userId is ignored. Deno-free so the Node tests drive it.
import type { ActorRow } from "./actor.ts";
import { samePhone, normPhone } from "./phone.ts";

type Verify = (req: Request) => Promise<ActorRow>;
export type WaSendAuth = { ok: true; actor: ActorRow } | { ok: false; status: number; error: string };

export async function authorizeWaSend(req: Request, body: { action?: string }, verify: Verify): Promise<WaSendAuth> {
  if (body?.action === "set-credentials") return { ok: false, status: 410, error: "Credential rotation moved to the operator runbook (CR-001)." };
  if (body?.action !== "send") return { ok: false, status: 400, error: "Unknown action" };
  try {
    return { ok: true, actor: await verify(req) };
  } catch (e: any) {
    return { ok: false, status: typeof e?.status === "number" ? e.status : 401, error: e?.message || "Sign in required" };
  }
}

// What the sender may touch (the server copy of waCanChatLead +
// isLeadAssignedOrForwardedTo in src/lib/wa.js, which are only UX). The rows
// are read with the service role; a failed read throws, so wa-send fails closed.
type Row = Record<string, any> | null;
export type ChatDeps = {
  conversation(id: string): Promise<Row>;
  lead(id: string): Promise<Row>;
  leadsByPhone(phone: string): Promise<Row[]>;
  message(id: string): Promise<Row>;
  settings(): Promise<Row>;
};
export type ChatCheck = { status: number; error?: string; conversation?: Row; to?: string };
const no = (status: number, error: string): ChatCheck => ({ status, error });
const ADMIN = ["MANAGEMENT", "MASTER"];

export async function checkWaSend(actor: ActorRow, body: Record<string, unknown>, deps: ChatDeps): Promise<ChatCheck> {
  const { conversationId, clientRef, to } = body;
  if (![conversationId, clientRef, to].every((v) => typeof v === "string" && v)) return no(400, "to, clientRef and conversationId are required");
  const s = await deps.settings();
  if (s?.enabled === false) return no(403, "WhatsApp chat is switched off");
  const master = actor.role === "MASTER";
  const mine = (co: unknown) => master || (!!actor.company_id && co === actor.company_id);
  // The WhatsApp numbers belong to the wa_settings company; most threads carry
  // no company of their own. With no owner company only Master may send.
  if (!(s?.company_id ? mine(s.company_id) : master)) return no(403, "These WhatsApp numbers belong to another company");
  const conv = await deps.conversation(conversationId as string);
  if (!conv) return no(404, "No such conversation");
  if (!samePhone(to, conv.phone)) return no(403, "to is not this conversation's number");
  if (conv.company_id && !mine(conv.company_id)) return no(403, "This conversation belongs to another company");
  const lead = conv.lead_id ? await deps.lead(conv.lead_id) : null;
  if (lead && !mine(lead.company_id)) return no(403, "This lead belongs to another company");
  if (lead && !samePhone(conv.phone, lead.phone)) return no(403, "This conversation's number is not the lead's");
  if (!ADMIN.includes(actor.role)) {
    const holds = (l: Row) => !!l && mine(l.company_id) && samePhone(conv.phone, l.phone) && (l.assigned_to === actor.id
      || (Array.isArray(l.previous_assignees) && l.previous_assignees.includes(actor.id))
      || (actor.role === "TEAM_LEAD" && !!actor.team_id && l.team_id === actor.team_id));
    // An unlinked thread: the UI matches it to a lead by phone, so the server does too.
    const held = lead ? holds(lead) : (await deps.leadsByPhone(normPhone(conv.phone))).some(holds);
    if (!held) return no(403, "This lead is not assigned to you");
  }
  const m = await deps.message(clientRef as string);
  if (!m) return no(404, "No such message");
  // Admins may view as another account (impersonate) and send its message.
  if (m.conversation_id !== conv.id || m.direction !== "OUT" || (!ADMIN.includes(actor.role) && m.sent_by !== actor.id)) {
    return no(403, "clientRef is not your outgoing message in this conversation");
  }
  // waRetry writes a new PENDING row, so only PENDING is ever sent.
  if (m.status !== "PENDING") return no(409, "This message was already sent");
  return { status: 200, conversation: conv, to: normPhone(conv.phone) };
}

// Take the message PENDING -> SENDING in one conditional write, so two
// concurrent calls with one clientRef cannot both reach Wasender.
type Patch = (filter: string, body: Record<string, unknown>) => Promise<Row[]>;
export async function claimSend(id: string, patch: Patch): Promise<boolean> {
  return (await patch(`id=eq.${encodeURIComponent(id)}&status=eq.PENDING`, { status: "SENDING" })).length === 1;
}
export function restPatch(url: string, serviceKey: string, f: typeof fetch = fetch): Patch {
  return async (filter, body) => {
    const r = await f(`${url}/rest/v1/wa_messages?${filter}&select=id`, {
      method: "PATCH", headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`wa_messages claim failed (${r.status})`);
    return (await r.json()) as Row[];
  };
}

// The real lookups inside wa-send: PostgREST with the service role.
export function restChatDeps(url: string, serviceKey: string, f: typeof fetch = fetch): ChatDeps {
  const H = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const all = async (path: string): Promise<Row[]> => {
    const r = await f(`${url}/rest/v1/${path}`, { headers: H });
    if (!r.ok) throw new Error(`${path.split("?")[0]} lookup failed (${r.status})`);
    return (await r.json()) as Row[];
  };
  const one = async (path: string): Promise<Row> => (await all(path))[0] ?? null;
  const e = encodeURIComponent;
  return {
    conversation: (id) => one(`wa_conversations?id=eq.${e(id)}&select=id,phone,account,company_id,lead_id`),
    lead: (id) => one(`leads?id=eq.${e(id)}&select=id,company_id,assigned_to,previous_assignees,team_id,phone`),
    // Narrowed by the last 9 digits, then matched exactly by samePhone.
    leadsByPhone: (p) => p ? all(`leads?phone=like.*${e(p.slice(-9))}&select=id,company_id,assigned_to,previous_assignees,team_id,phone&limit=20`) : Promise.resolve([]),
    message: (id) => one(`wa_messages?id=eq.${e(id)}&select=id,conversation_id,direction,status,sent_by`),
    settings: () => one("wa_settings?id=eq.default&select=enabled,company_id"),
  };
}
