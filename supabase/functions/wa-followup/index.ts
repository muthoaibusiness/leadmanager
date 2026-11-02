// Post-greeting follow-up — the second half of the flow started in each
// bot's handleInbound (see wa-bot-eyad/wa-bot-dubai, "flow_stage"). Not
// triggered by WhatsApp: a pg_cron job hits this on a timer (every 1-2 min
// is enough — the stages themselves wait 5 minutes / 1 hour), since Edge Functions
// have no way to schedule their own future work. Stage 4 only asks "want a
// dedicated agent?" and a human acts on the answer — and never asks a contact
// who already has one. The one pass that forwards is forwardDueContacts
// (_shared/forward.ts): Eyad contacts, 5 minutes in, when its switch is on.
//
// Deploy: npx supabase functions deploy wa-followup --no-verify-jwt
// Schedule (run once in the SQL editor — needs pg_cron + pg_net):
//   select cron.schedule('wa-followup', '*/2 * * * *', $$
//     select net.http_post(
//       url := '<SUPABASE_URL>/functions/v1/wa-followup',
//       headers := '{"Content-Type": "application/json", "x-followup-key": "<FOLLOWUP_CRON_KEY>"}'::jsonb
//     );
//   $$);

import { inviteLead, recentlyContactedLeadIds } from "../_shared/mela-invite.ts";
import { sendQualifiedLead, recentlyInterestedLeadIds } from "../_shared/capi-qualified.ts";
import { CORS, json, sbPatch, SUPABASE_URL, SERVICE_KEY, getActiveProjects, sendWaMessageMirrored, resolveTarget } from "../_shared/wa.ts";
import { forwardDueContacts } from "../_shared/forward.ts";
import { dripBacklog } from "../_shared/fb-drip.ts";
import { buildJolshiriBundle, FLOW_ASK_PROFILE_TEXT, FLOW_AUTO_PROFILE_TEXT, FLOW_ASK_AGENT_TEXT, brochureCaption } from "../_shared/ai.ts";
import {
  DUBAI_STAGE, DUBAI_DOCS_WAIT_MS, DUBAI_AUTO_SEND_WAIT_MS, DUBAI_FINAL_WAIT_MS, DUBAI_FINAL_TEXT,
  floorPlanPlan, floorPlanAskText, brochureItem, brochureAskText, type DocItem,
} from "../_shared/dubai-flow.ts";
import { cronKeyGate } from "../_shared/cron-key.ts";

// The cron job runs every 1-2 minutes; a run can still be going (brochure
// sends are rate-limited to 1 every 5.5s) when the next one fires. Claiming
// rows with an atomic PATCH — not a plain SELECT — means a concurrent run's
// same WHERE clause simply matches nothing for rows this run already
// grabbed, instead of both runs sending the same message twice.
async function claimRows(filter: string, claimPatch: Record<string, unknown>): Promise<FlowRow[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/preleads?${filter}`, {
    method: "PATCH",
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json", Prefer: "return=representation",
    },
    body: JSON.stringify(claimPatch),
  });
  if (!r.ok) {
    console.error("wa-followup: claimRows failed", r.status, await r.text());
    return [];
  }
  return await r.json();
}

const FIVE_MIN_MS = 5 * 60 * 1000;
// Stage 4 ("want a dedicated agent?") waits a full hour after the profile
// offer/send — asking that 5 minutes later felt like pestering.
const ONE_HOUR_MS = 60 * 60 * 1000;
const BOT_FOR_TAG: Record<string, string> = { Eyad: "eyad", Jaber: "dubai" };

interface FlowRow {
  id: string;
  phone: string;
  property_interest?: string | null;
  WA: string | null;
  message_logs: string[] | null;
  flow_stage: string;
  stage_msg_count: number | null;
}

async function sendBundle(account: string, phone: string, message: string, brochures: { project: { name: string; address?: string | null }; url: string }[]): Promise<void> {
  const target = await resolveTarget(account, phone);
  const convId = `${account}:${target.remote}`;
  await sendWaMessageMirrored(account, target.to, convId, phone, { type: "text", text: message });
  for (let i = 0; i < brochures.length; i++) {
    await new Promise((r) => setTimeout(r, 5500));
    const b = brochures[i];
    await sendWaMessageMirrored(account, target.to, convId, phone, {
      type: "document", mediaUrl: b.url, fileName: `${b.project.name} Brochure.pdf`, text: brochureCaption(b.project),
    });
  }
}

async function sendText(account: string, phone: string, message: string): Promise<void> {
  const target = await resolveTarget(account, phone);
  await sendWaMessageMirrored(account, target.to, `${account}:${target.remote}`, phone, { type: "text", text: message });
}

function botFor(row: FlowRow): string | null {
  return BOT_FOR_TAG[row.WA || ""] ?? null;
}

async function processGreeted(): Promise<number> {
  const cutoff = new Date(Date.now() - FIVE_MIN_MS).toISOString();
  const rows: FlowRow[] = await claimRows(
    `flow_stage=eq.greeted&stage_at=lte.${encodeURIComponent(cutoff)}&takeover=not.is.true&select=id,phone,WA,message_logs,flow_stage,stage_msg_count&limit=200`,
    { flow_stage: "greeted_claimed" },
  );
  const projects = rows.length ? await getActiveProjects() : [];
  let acted = 0;
  for (const row of rows) {
    const bot = botFor(row);
    if (!bot) continue;
    const count = Array.isArray(row.message_logs) ? row.message_logs.length : 0;
    const delta = count - (row.stage_msg_count ?? 0);
    const now = new Date().toISOString();
    if (delta >= 3) {
      const bundle = buildJolshiriBundle(projects, FLOW_AUTO_PROFILE_TEXT);
      if (bundle) await sendBundle(bot, row.phone, bundle.message, bundle.brochures);
      await sbPatch("preleads", `id=eq.${encodeURIComponent(row.id)}`, {
        flow_stage: "profile_sent", stage_at: now, stage_msg_count: count,
      });
    } else if (delta === 0) {
      await sendText(bot, row.phone, FLOW_ASK_PROFILE_TEXT);
      await sbPatch("preleads", `id=eq.${encodeURIComponent(row.id)}`, {
        flow_stage: "asked_profile", stage_at: now, stage_msg_count: count,
      });
    } else {
      // 1-2 replies — neither silent nor clearly "engaged"; let the normal
      // FAQ flow carry the conversation instead of guessing.
      await sbPatch("preleads", `id=eq.${encodeURIComponent(row.id)}`, { flow_stage: null, stage_at: null });
    }
    acted++;
  }
  return acted;
}

async function processAwaitingReply(): Promise<number> {
  const cutoff = new Date(Date.now() - ONE_HOUR_MS).toISOString();
  const rows: FlowRow[] = await claimRows(
    `flow_stage=in.(asked_profile,profile_sent)&stage_at=lte.${encodeURIComponent(cutoff)}&takeover=not.is.true&forwarded=not.is.true&select=id,phone,WA,message_logs,flow_stage,stage_msg_count&limit=200`,
    { flow_stage: "awaiting_claimed" },
  );
  let acted = 0;
  for (const row of rows) {
    const bot = botFor(row);
    if (!bot) continue;
    const count = Array.isArray(row.message_logs) ? row.message_logs.length : 0;
    const delta = count - (row.stage_msg_count ?? 0);
    const now = new Date().toISOString();
    if (delta === 0) {
      await sendText(bot, row.phone, FLOW_ASK_AGENT_TEXT);
      await sbPatch("preleads", `id=eq.${encodeURIComponent(row.id)}`, {
        flow_stage: "asked_agent", stage_at: now, stage_msg_count: count,
      });
    } else {
      // Customer replied (just not with a recognized "yes") — drop out of
      // the automated flow and let the FAQ agent answer normally.
      await sbPatch("preleads", `id=eq.${encodeURIComponent(row.id)}`, { flow_stage: null, stage_at: null });
    }
    acted++;
  }
  return acted;
}

// ── Dubai bot (stages in _shared/dubai-flow.ts; separate names, so the Eyad
// passes above never match these rows and these never match theirs) ─────────
// Contacts are claimed with an atomic PATCH, exactly like the Eyad passes, so
// two overlapping runs cannot send the same message twice.
const DUBAI_COLS = "select=id,phone,WA,property_interest,message_logs,flow_stage,stage_msg_count&limit=200";
const messageCount = (r: FlowRow) => (Array.isArray(r.message_logs) ? r.message_logs.length : 0);

async function sendDocItem(account: string, phone: string, d: DocItem): Promise<void> {
  const target = await resolveTarget(account, phone);
  await sendWaMessageMirrored(account, target.to, `${account}:${target.remote}`, phone,
    d.type === "text" ? { type: "text", text: d.caption } : { type: d.type, mediaUrl: d.url, fileName: d.fileName, text: d.caption });
}
const patchRow = (row: FlowRow, stage: string, count: number) =>
  sbPatch("preleads", `id=eq.${encodeURIComponent(row.id)}`, { flow_stage: stage, stage_at: new Date().toISOString(), stage_msg_count: count });

// 10 minutes after the greeting with no reply → offer the floor plan and video
// (or, for a project that has neither, go straight to the brochure question).
async function processDubaiGreeted(): Promise<number> {
  const cutoff = new Date(Date.now() - DUBAI_DOCS_WAIT_MS).toISOString();
  const rows = await claimRows(
    `flow_stage=eq.${DUBAI_STAGE.greeted}&WA=in.(Jaber,Eyad)&stage_at=lte.${encodeURIComponent(cutoff)}&takeover=not.is.true&${DUBAI_COLS}`,
    { flow_stage: "dubai_claim_docs" },
  );
  const projects = rows.length ? await getActiveProjects() : [];
  let acted = 0;
  for (const row of rows) {
    const count = messageCount(row);
    const replied = count - (row.stage_msg_count ?? 0) > 0;
    const project = projects.find((p: any) => p.name === row.property_interest) as any;
    if (replied || !project) { await patchRow(row, DUBAI_STAGE.done, count); acted++; continue; }
    const fpAsk = floorPlanAskText(project);
    if (fpAsk) {
      await sendText(botFor(row) ?? "dubai", row.phone, fpAsk);
      await patchRow(row, DUBAI_STAGE.askedDocs, count);
    } else if (brochureItem(project)) {
      await sendText(botFor(row) ?? "dubai", row.phone, brochureAskText(project));
      await patchRow(row, DUBAI_STAGE.askedBrochure, count);
    } else {
      await patchRow(row, DUBAI_STAGE.done, count);
    }
    acted++;
  }
  return acted;
}

// 5 minutes after the floor plan / video offer with no reply → taken as a yes:
// send them, then ask about the brochure.
async function processDubaiAutoSend(): Promise<number> {
  const cutoff = new Date(Date.now() - DUBAI_AUTO_SEND_WAIT_MS).toISOString();
  const rows = await claimRows(
    `flow_stage=eq.${DUBAI_STAGE.askedDocs}&WA=in.(Jaber,Eyad)&stage_at=lte.${encodeURIComponent(cutoff)}&takeover=not.is.true&${DUBAI_COLS}`,
    { flow_stage: "dubai_claim_auto" },
  );
  const projects = rows.length ? await getActiveProjects() : [];
  let acted = 0;
  for (const row of rows) {
    const count = messageCount(row);
    const replied = count - (row.stage_msg_count ?? 0) > 0;
    const project = projects.find((p: any) => p.name === row.property_interest) as any;
    if (replied || !project) { await patchRow(row, DUBAI_STAGE.done, count); acted++; continue; }
    const items = floorPlanPlan(project);
    for (let i = 0; i < items.length; i++) {
      if (i) await new Promise((r) => setTimeout(r, 5500));
      await sendDocItem(botFor(row) ?? "dubai", row.phone, items[i]);
    }
    if (brochureItem(project)) {
      await new Promise((r) => setTimeout(r, 5500));
      await sendText(botFor(row) ?? "dubai", row.phone, brochureAskText(project));
      await patchRow(row, DUBAI_STAGE.askedBrochure, count);
    } else {
      await patchRow(row, DUBAI_STAGE.done, count);
    }
    acted++;
  }
  return acted;
}

// 1 hour after the brochure question / the brochure with no reply → the closing note.
async function processDubaiFinal(): Promise<number> {
  const cutoff = new Date(Date.now() - DUBAI_FINAL_WAIT_MS).toISOString();
  const rows = await claimRows(
    `flow_stage=in.(${DUBAI_STAGE.askedBrochure},${DUBAI_STAGE.brochureSent})&WA=in.(Jaber,Eyad)&stage_at=lte.${encodeURIComponent(cutoff)}&takeover=not.is.true&${DUBAI_COLS}`,
    { flow_stage: "dubai_claim_final" },
  );
  let acted = 0;
  for (const row of rows) {
    const count = messageCount(row);
    const replied = count - (row.stage_msg_count ?? 0) > 0;
    // Only the Dubai bot auto-forwards, so only there is a consultant really assigned.
    if (!replied && botFor(row) === "dubai") await sendText("dubai", row.phone, DUBAI_FINAL_TEXT);
    await patchRow(row, DUBAI_STAGE.done, count);
    acted++;
  }
  return acted;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  // Access (CR-001 D1): the x-followup-key header must equal the
  // FOLLOWUP_CRON_KEY secret (cron-key.ts). Without the secret every call is
  // refused (503): set the secret and the cron header before deploying this.
  const gate = cronKeyGate(req, Deno.env.get("FOLLOWUP_CRON_KEY"), "x-followup-key");
  if (!gate.ok) return json({ ok: false, error: gate.error }, gate.status);
  try {
    // First: it is the one pass with a clock the customer can feel (5 minutes), and the
    // passes below can run long (a brochure goes out every 5.5 s).
    const forwarded = await forwardDueContacts().catch((e) => { console.error("wa-followup: auto-forward failed", e); return 0; });
    // Facebook leads that never reached the CRM, one per 5 minutes (off unless fb_lead_settings.backlog_drip).
    const fbDrip = await dripBacklog().catch((e) => { console.error("wa-followup: fb drip failed", e); return { status: "failed" }; });
    const greeted = await processGreeted();
    const awaiting = await processAwaitingReply();
    const dubaiDocs = await processDubaiGreeted();
    const dubaiAuto = await processDubaiAutoSend();
    const dubaiFinal = await processDubaiFinal();
    // Mela invitations for leads contacted in the last half hour that the CRM call missed.
    let mela = 0;
    for (const id of await recentlyContactedLeadIds(30)) if ((await inviteLead(id)).status === "sent") mela++;
    // Leads that went Interested in the last half hour and were not reported to Meta yet.
    let qualified = 0;
    for (const id of await recentlyInterestedLeadIds(30)) if ((await sendQualifiedLead(id)).status === "sent") qualified++;
    return json({ ok: true, forwarded, fbDrip, greeted, awaiting, dubaiDocs, dubaiAuto, dubaiFinal, mela, qualified });
  } catch (e) {
    console.error("wa-followup error", e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
