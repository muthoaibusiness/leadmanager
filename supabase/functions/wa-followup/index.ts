// Post-greeting follow-up — the second half of the flow started in each
// bot's handleInbound (see wa-bot-eyad/wa-bot-dubai, "flow_stage"). Not
// triggered by WhatsApp: a pg_cron job hits this on a timer (every 1-2 min
// is enough — the stages themselves wait 5 minutes / 1 hour), since Edge Functions
// have no way to schedule their own future work. No auto-forward anywhere
// in this file — stage 4 only asks; a human still has to act on the answer.
//
// Deploy: npx supabase functions deploy wa-followup --no-verify-jwt
// Schedule (run once in the SQL editor — needs pg_cron + pg_net):
//   select cron.schedule('wa-followup', '*/2 * * * *', $$
//     select net.http_post(
//       url := '<SUPABASE_URL>/functions/v1/wa-followup',
//       headers := '{"Content-Type": "application/json"}'::jsonb
//     );
//   $$);

import { CORS, json, sbSelect, sbPatch, SUPABASE_URL, SERVICE_KEY, getActiveProjects, sendWaMessageMirrored } from "../_shared/wa.ts";
import { buildJolshiriBundle, FLOW_ASK_PROFILE_TEXT, FLOW_AUTO_PROFILE_TEXT, FLOW_ASK_AGENT_TEXT } from "../_shared/ai.ts";

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
  WA: string | null;
  message_logs: string[] | null;
  flow_stage: string;
  stage_msg_count: number | null;
}

// A conversation's id is "<account>:<remoteJid>" (see waConvId() client-side
// and each bot's convId). A hidden-number customer's remoteJid ends in
// "@lid" and is what Wasender needs as `to` — plain digits won't reach them
// (see wa-bot-eyad's ParsedEvent.target for the inbound-side version of
// this same lookup).
async function resolveTarget(account: string, phone: string): Promise<{ to: string; remote: string } | null> {
  const rows = await sbSelect(
    `wa_conversations?phone=eq.${encodeURIComponent(phone)}&account=eq.${account}&select=id&order=last_message_at.desc.nullslast&limit=1`,
  );
  const convId = rows?.[0]?.id;
  if (!convId) return { to: phone, remote: phone }; // no conversation row yet — best effort
  const remote = String(convId).slice(account.length + 1);
  return { to: remote.endsWith("@lid") ? remote : phone, remote };
}

async function sendBundle(account: string, phone: string, message: string, brochures: { project: { name: string }; url: string }[]): Promise<void> {
  const target = await resolveTarget(account, phone);
  if (!target) return;
  const convId = `${account}:${target.remote}`;
  await sendWaMessageMirrored(account, target.to, convId, phone, { type: "text", text: message });
  for (let i = 0; i < brochures.length; i++) {
    await new Promise((r) => setTimeout(r, 5500));
    const b = brochures[i];
    await sendWaMessageMirrored(account, target.to, convId, phone, {
      type: "document", mediaUrl: b.url, fileName: `${b.project.name} Brochure.pdf`, text: `${b.project.name} — Brochure`,
    });
  }
}

async function sendText(account: string, phone: string, message: string): Promise<void> {
  const target = await resolveTarget(account, phone);
  if (!target) return;
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
    `flow_stage=in.(asked_profile,profile_sent)&stage_at=lte.${encodeURIComponent(cutoff)}&takeover=not.is.true&select=id,phone,WA,message_logs,flow_stage,stage_msg_count&limit=200`,
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const greeted = await processGreeted();
    const awaiting = await processAwaitingReply();
    return json({ ok: true, greeted, awaiting });
  } catch (e) {
    console.error("wa-followup error", e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
