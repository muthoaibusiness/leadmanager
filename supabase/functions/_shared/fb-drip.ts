// Feeds Facebook leads that never became CRM leads into the CRM, one every 5 minutes (switch:
// fb_lead_settings.backlog_drip, migration 0061). Run by wa-followup. The leads are listed from Meta
// itself (and from fb_lead_backlog, queued by id); each is handled by processLeadgen exactly like a live one.

import { sbSelect, claimEvent } from "./wa.ts";
import { GRAPH } from "./capi-core.ts";
import { processLeadgen, type Outcome } from "./fb-leads.ts";
import { pickNext, type Pending } from "./fb-leads-core.ts";

export const DRIP_MS = 5 * 60_000;
const PAGES = 5;   // 100 leads a page

async function listLeads(formId: string, token: string): Promise<Pending[]> {
  const out: Pending[] = [];
  let url: string | null = `${GRAPH}/${formId}/leads?fields=id,created_time&limit=100`;
  for (let i = 0; i < PAGES && url; i++) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Facebook refused the list for form ${formId} (${r.status}): ${String(j?.error?.message ?? "").split(token).join("[redacted]").slice(0, 200)}`);
    for (const l of j.data ?? []) out.push({ id: String(l.id), form_id: formId, created: String(l.created_time ?? "") });
    url = j.paging?.next ?? null;
  }
  return out;
}

export async function dripBacklog(nowMs = Date.now()): Promise<Outcome | { status: "off" | "waiting" | "empty" }> {
  const settings = (await sbSelect("fb_lead_settings?id=eq.default&select=enabled,backlog_drip"))[0];
  if (settings?.enabled !== true || settings?.backlog_drip !== true) return { status: "off" };
  const token = Deno.env.get("FB_PAGE_ACCESS_TOKEN") ?? "";
  if (!token) return { status: "off" };
  // One lead per 5-minute slot, however many cron runs fall in it.
  if (!(await claimEvent(`fbdrip:${Math.floor(nowMs / DRIP_MS)}`, "fb_drip"))) return { status: "waiting" };

  const forms = await sbSelect("fb_lead_forms?active=eq.true&select=form_id");
  const all: Pending[] = [];
  // One form Meta will not list must not hold up the others.
  const errors: string[] = [];
  for (const f of forms) {
    try { all.push(...(await listLeads(String(f.form_id), token))); }
    catch (e) { errors.push(e instanceof Error ? e.message : "error"); }
  }
  // Leads queued by id (fb_lead_backlog): they do not depend on Meta being willing to list a form.
  const queued = await sbSelect("fb_lead_backlog?select=leadgen_id,form_id,created_time&limit=1000");
  const have = new Set(all.map((l) => l.id));
  for (const q of queued) if (!have.has(String(q.leadgen_id))) all.push({ id: String(q.leadgen_id), form_id: String(q.form_id), created: String(q.created_time ?? "") });
  if (errors.length) console.error("fb-drip:", errors.join(" | "));
  if (!all.length && errors.length) throw new Error(errors.join(" | "));
  const events: any[] = [];
  for (let i = 0; i < all.length; i += 100) {
    const ids = all.slice(i, i + 100).map((l) => l.id).join(",");
    events.push(...(await sbSelect(`fb_lead_events?leadgen_id=in.(${ids})&select=leadgen_id,status,processed_at,received_at`)));
  }
  const next = pickNext(all, events, nowMs);
  if (!next) return { status: "empty" };
  return await processLeadgen({ leadgen_id: next.id, form_id: next.form_id, page_id: "" }, { replay: true });
}
