// Wecon WA Bot Dubai — ported from the n8n workflow "Wecon WA Bot Dubai"
// (id j7LDr3ERXJJWLj2P). This IS the Dubai session's one Wasender webhook
// target (a session can only have one). It forwards the untouched payload
// to wa-webhook itself (see forwardToMirror below) so the CRM-chat mirror
// still runs, then handles its own prelead/lead/CAPI/drip logic, exactly
// like n8n's "WhatsApp Webhook" trigger fanned out to "Parse Event" (this
// file) and "Forward to CRM Chat" (now wa-webhook) in parallel.
//
// Deploy:  npx supabase functions deploy wa-bot-dubai --no-verify-jwt
// Secrets: npx supabase secrets set META_CAPI_ACCESS_TOKEN=...
//          npx supabase secrets set WA_DRIP_WEBHOOK_URL_DUBAI=...   (optional, see "Start Drip" below)
//          npx supabase secrets set OPENROUTER_API_KEY=...          (FAQ agent — see runFaqAgent / _shared/ai.ts)
//          (WASENDER_API_TOKEN / WASENDER_WEBHOOK_SECRET are already set for wa-send/wa-webhook and are reused here)
//
// Scope notes (see the port's summary for the full list of judgment calls):
//  - "Forward to CRM Chat" is NOT reimplemented here. In the source workflow
//    it was a side-effecting mirror with no bearing on this bot's own logic;
//    in this codebase that job is wa-webhook's, reached by Wasender's own
//    second webhook subscription — there is nothing left for this file to do.
//  - The two disabled/orphaned n8n maintenance sub-flows (the daily
//    "mark forwarded" sweep and the unreachable "P2P Helthcare" backfill)
//    are not ported: neither one ran in production (one's trigger was
//    disabled, the other was missing a wire even if enabled).
//  - "Start Drip" called an n8n sub-workflow by internal id, which has no
//    HTTP address in this export. If WA_DRIP_WEBHOOK_URL_DUBAI is configured
//    this POSTs {phone, name, project} to it, fire-and-forget, exactly like
//    the sub-workflow call (waitForSubWorkflow:false); otherwise it logs and
//    no-ops. See Open Questions in the spec.
//  - The Meta CAPI access token is read from a secret (META_CAPI_ACCESS_TOKEN)
//    instead of being embedded as a literal, per the spec's own flag that the
//    plaintext token in the source workflow is a security concern to fix on
//    the port, not reproduce.
//  - Every outbound send uses the one Wasender credential this codebase
//    already has (wa_secrets id:"dubai" / WASENDER_API_TOKEN_DUBAI, via
//    getCredentials("dubai")) — matching the source's separate "Send
//    Handover" credential, since Dubai and Eyad are different Wasender
//    sessions and must never send through each other's number.

import {
  CORS, json, SUPABASE_URL, SERVICE_KEY, WASENDER_BASE,
  claimEvent, getCredentials, getActiveProjects, getRecentHistory, sendWaMessageMirrored, getKnowledge, getCorrections,
  findLeadForNote, logNoteActivity, getBotSettings, aiStillOn, verifyWebhook, fillWelcomeTemplate, fixLeadPhoneFromNote, splitPhoneFromNote,
  logConversationHistory,
} from "../_shared/wa.ts";
import {
  askAgent, resolveMedia, fixGrammar, matchJolshiriBundle, buildJolshiriBundle,
  FLOW_AUTO_PROFILE_TEXT, FLOW_AGENT_YES_TEXT, GENERIC_WELCOME_TEXT, isAffirmative, isProfileConsent,
  leadContext, matchNamedProject, isPriceQuestion, isLandOffer, FLOW_PRICE_AGENT_TEXT, brochureCaption,
} from "../_shared/ai.ts";
import { runTrainerTestTurn } from "../_shared/trainer-deno.ts";

// ── local REST helpers ───────────────────────────────────────────────────
// _shared/wa.ts's sbRpc/sbPatch deliberately return only ok/not-ok (wa-send
// and wa-webhook never need the response body). This bot's branching runs
// entirely on what wa_upsert_prelead / wa_create_lead / the takeover patch
// hand back, so it needs the JSON body — kept local rather than widening the
// shared helpers' contract for every other caller.
const svcHeaders = () => ({
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
});

async function sbRpcJson(fn: string, args: Record<string, unknown>): Promise<any> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: svcHeaders(),
      body: JSON.stringify(args),
    });
    if (!r.ok) {
      console.error(`sbRpcJson ${fn} failed`, r.status, await r.text());
      return null;
    }
    return await r.json();
  } catch (e) {
    console.error(`sbRpcJson ${fn} error`, e);
    return null;
  }
}

async function sbSelectJson(path: string): Promise<any[]> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: svcHeaders() });
    if (!r.ok) {
      console.error("sbSelectJson failed", path, r.status, await r.text());
      return [];
    }
    return await r.json();
  } catch (e) {
    console.error("sbSelectJson error", path, e);
    return [];
  }
}

async function sbPatchJson(table: string, filter: string, patch: unknown): Promise<any> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
      method: "PATCH",
      headers: { ...svcHeaders(), Prefer: "return=representation" },
      body: JSON.stringify(patch),
    });
    if (!r.ok) {
      console.error(`sbPatchJson ${table} failed`, r.status, await r.text());
      return null;
    }
    const rows = await r.json();
    return Array.isArray(rows) ? rows[0] ?? null : rows;
  } catch (e) {
    console.error(`sbPatchJson ${table} error`, e);
    return null;
  }
}

async function sbInsertJson(table: string, row: Record<string, unknown>): Promise<any> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: { ...svcHeaders(), Prefer: "return=representation" },
      body: JSON.stringify(row),
    });
    if (!r.ok) {
      console.error(`sbInsertJson ${table} failed`, r.status, await r.text());
      return null;
    }
    const rows = await r.json();
    return Array.isArray(rows) ? rows[0] ?? null : rows;
  } catch (e) {
    console.error(`sbInsertJson ${table} error`, e);
    return null;
  }
}

// Fire-and-forget PATCH, used where the source workflow never looked at the
// row it just updated (Update a row1's WA/forwarded stamp).
async function sbPatchFireAndForget(table: string, filter: string, patch: unknown): Promise<void> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
      method: "PATCH",
      headers: { ...svcHeaders(), Prefer: "return=minimal" },
      body: JSON.stringify(patch),
    });
    if (!r.ok) console.error(`sbPatchFireAndForget ${table} failed`, r.status, await r.text());
  } catch (e) {
    console.error(`sbPatchFireAndForget ${table} error`, e);
  }
}

// Same retry/continue-on-error shape every send/HTTP node in the source
// workflow declared (retryOnFail:true, maxTries:3, waitBetweenTries:5000,
// onError:continueRegularOutput) — a failure here never stops the bot.
async function withRetry<T>(label: string, fn: () => Promise<T>, tries = 3, waitMs = 5000): Promise<T | null> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  console.error(`${label} exhausted retries`, lastErr);
  return null;
}

// ── outbound WhatsApp send ───────────────────────────────────────────────
// Every send in the source workflow used `to: Parse Event.waTo` — never the
// raw remoteJid, never a re-derived phone. Keep that single source of truth.
async function sendWaText(to: string, text: string): Promise<void> {
  const { token } = await getCredentials("dubai");
  if (!token) {
    console.error("wa-bot-dubai: no Wasender token configured, dropping send to", to);
    return;
  }
  await withRetry("sendWaText", async () => {
    const res = await fetch(`${WASENDER_BASE}/send-message`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to, text }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`send-message ${res.status}: ${body.slice(0, 300)}`);
    }
  });
}

// ── message templates, verbatim (including the source's own trailing spaces
// before several line breaks — kept exactly, not "cleaned up") ─────────────
const welcomeMessage = (name: string) =>
  `Hi ${name || "there"},\nThis is Eayd 👋\n\nThank you for your interest in Wecon Properties Limited.\n\nI will help you to make your property journey easier.`;

const handoverMessage = (firstName: string) =>
  `Hello ${firstName || "there"}, \n\nThank you for your patience! \nI’m Eayd from Wecon Properties, and I’ll be continuing this conversation to assist you further.\n\nI’m currently reviewing your previous messages and requirements to make sure I guide you properly. \n\nPlease allow me a moment — I’ll get back to you shortly with the relevant details.`;

const assignedMessage = (firstName: string, agentName: string, agentPhone: string) =>
  `Hello ${firstName || "there"}, \n\nA dedicated sales consultant has been assigned to assist you.\n\n👨‍💼 ${agentName}\n📞 ${agentPhone}\n\nHe will contact you shortly and guide you through everything. 🤝\n\nIf you need anything in the meantime, feel free to reach out. Thank you! 💙`;

const alreadyAssignedMessage = (firstName: string, agentName: string, agentPhone: string) =>
  `Hello ${firstName || "there"}, \n\nThanks for reaching out again! \nYou’re already connected with one of our dedicated sales consultants.\n\n👨‍💼 ${agentName}\n📞 ${agentPhone}\n\nHe is handling your query and will continue assisting you with all the details. \n\nIf you have any new questions or need further support, feel free to let us know anytime. Thank you! `;

// ── Parse Event (the exact classification logic from the n8n Code node) ────
type Kind = "ignore" | "inbound" | "command";

interface ParsedEvent {
  kind: Kind;
  event: string;
  phone: string;
  remote: string;
  isLid: boolean;
  waTo: string;
  fromMe: boolean;
  name: string;
  text: string;
  message: string;
  isAd: boolean;
  adText: string;
  ctwaClid: string;
  command: string;
  messageId: string;
  // Text of the message the customer replied to (WhatsApp quote), if any.
  quoted: string;
}

function parseWasenderEvent(payload: any): ParsedEvent {
  const event = String(payload?.event ?? "");
  const data = payload?.data ?? {};
  const msg = data?.messages ?? {};
  const key = msg?.key ?? {};
  const m = msg?.message ?? {};
  const remote = String(key?.remoteJid ?? "");

  const ad =
    (m.extendedTextMessage || m.imageMessage || m.audioMessage || m.videoMessage || {})?.contextInfo
      ?.externalAdReply || null;

  const cleanedSenderPn = String(key?.cleanedSenderPn || "").trim();
  const isLid = !cleanedSenderPn && remote.endsWith("@lid");
  const phone = String(cleanedSenderPn || remote)
    .replace(/@.*$/, "")
    .replace(/\D/g, "");
  const waTo = isLid ? `${phone}@lid` : phone;
  const fromMe = key?.fromMe === true;
  // || not ?? — the source falls through on an empty string too.
  const text = String(
    msg?.messageBody || m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || "",
  ).trim();
  const mediaLabel = m.imageMessage
    ? "[image]"
    : m.audioMessage
    ? "[audio]"
    : m.videoMessage
    ? "[video]"
    : m.documentMessage
    ? "[document]"
    : "";

  let kind: Kind = "ignore";
  if (!phone || remote.endsWith("@g.us")) {
    kind = "ignore"; // no sender / group chat
  } else if (fromMe && text.startsWith("/")) {
    kind = "command"; // agent typed a bot command
  } else if (!fromMe) {
    kind = "inbound"; // genuine customer message
  }

  return {
    kind,
    event,
    phone,
    remote,
    isLid,
    waTo,
    fromMe,
    name: String(msg?.pushName || "").trim(),
    text,
    message: text || mediaLabel,
    isAd: ad?.sourceType === "ad",
    adText: ad ? String(ad.greetingMessageBody || ad.title || ad.body || "") : "",
    ctwaClid: ad ? String(ad.ctwaClid || "") : "",
    command: kind === "command" ? text.toLowerCase().split(/\s+/)[0] : "",
    messageId: key?.id ? String(key.id) : "",
    quoted: String(m?.extendedTextMessage?.contextInfo?.quotedMessage?.conversation
      || m?.extendedTextMessage?.contextInfo?.quotedMessage?.extendedTextMessage?.text || "").trim(),
  };
}

// ── Send Meta CAPI Event (shared terminal step) ──────────────────────────
// The source workflow detected which branch it came from with a
// try{ $('Create Lead')... }catch{} node-existence probe — fragile outside
// n8n. Ported as explicit flags from the caller instead, per the spec's own
// recommendation.
async function sendMetaCapiEvent(opts: { leadId: string; ctwaClid: string }): Promise<void> {
  const accessToken = Deno.env.get("META_CAPI_ACCESS_TOKEN") ?? "";
  if (!accessToken) {
    console.error("wa-bot-dubai: META_CAPI_ACCESS_TOKEN not configured, skipping CAPI event for lead", opts.leadId);
    return;
  }
  if (!opts.leadId) {
    console.error("wa-bot-dubai: no lead id to attach to CAPI event, skipping");
    return;
  }

  const result = await withRetry("sendMetaCapiEvent", async () => {
    const res = await fetch("https://graph.facebook.com/v26.0/869790160551668/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: [
          {
            action_source: "business_messaging",
            custom_data: { currency: "USD", value: 100 },
            event_name: "LeadSubmitted",
            event_id: opts.leadId,
            event_time: Math.floor(Date.now() / 1000),
            messaging_channel: "whatsapp",
            user_data: { ctwa_clid: opts.ctwaClid, page_id: "104718884272119" },
          },
        ],
        access_token: accessToken,
      }),
    });
    const parsed = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`CAPI ${res.status}: ${JSON.stringify(parsed).slice(0, 300)}`);
    return parsed;
  });

  // CAPI OK? — events_received >= 1
  const eventsReceived = Number(result?.events_received ?? 0);
  if (eventsReceived >= 1) {
    // Mark CAPI Sent — stops the hourly Conversion APIs backfill (not part of
    // this export) from resending this lead.
    await sbPatchFireAndForget("leads", `id=eq.${encodeURIComponent(opts.leadId)}`, {
      CAPI_STATUS: "LeadSubmitted",
    });
  }
}

// ── Start Drip (fire-and-forget; see the scope note at the top of the file) ─
async function startDrip(phone: string, name: string, project: string): Promise<void> {
  const url = Deno.env.get("WA_DRIP_WEBHOOK_URL_DUBAI") ?? "";
  if (!url) {
    console.warn("wa-bot-dubai: WA_DRIP_WEBHOOK_URL_DUBAI not configured, skipping drip start for", phone);
    return;
  }
  try {
    // waitForSubWorkflow:false in the source — never await/inspect the result.
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, name, project }),
    }).catch((e) => console.error("wa-bot-dubai: startDrip error", e));
  } catch (e) {
    console.error("wa-bot-dubai: startDrip error", e);
  }
}

// ── Branch A: inbound customer message ───────────────────────────────────
async function handleInbound(evt: ParsedEvent): Promise<void> {
  const settings = await getBotSettings("dubai", evt.phone);

  // Upsert Prelead
  const prelead = await sbRpcJson("wa_upsert_prelead", {
    p_phone: evt.phone,
    p_name: evt.name,
    p_message: evt.message,
    p_ad_text: evt.isAd ? evt.adText : "",
    p_ctwa_clid: evt.ctwaClid || "",
    // Hard-coded in the source workflow regardless of this being the Dubai
    // bot — preserved verbatim, see the port's Open Questions.
    p_location: "Chattogram",
  });
  if (!prelead) {
    console.error("wa-bot-dubai: wa_upsert_prelead returned nothing for", evt.phone);
    // Original: a failing RPC node throws and halts (routed to n8n's
    // configured error workflow). Closest equivalent here: surface it loudly.
    throw new Error("wa_upsert_prelead failed");
  }

  // Update a row1 — stamps WA/forwarded on every inbound message. Original
  // filters by the prelead row's own primary key (the id wa_upsert_prelead
  // just returned), not by phone — address the same row the same way.
  await sbPatchFireAndForget("preleads", `id=eq.${encodeURIComponent(prelead.id)}`, {
    WA: "Jaber",
    forwarded: "true",
  });

  // Create a row1 — unconditional insert, every qualifying inbound message,
  // no "does a lead already exist for this phone" check (contrast with the
  // /f* command path below, which dedupes via wa_create_lead itself).
  // "Auto forward" for this bot = create a lead for every inbound contact.
  // Admin can switch it off (WA Relay tab); the prelead above is still saved.
  const lead = !settings.autoForwardEnabled ? null : await sbInsertJson("leads", {
    name: prelead.name,
    phone: prelead.phone ?? evt.phone,
    property_interest: prelead.property_interest,
    notes: prelead.call_logs,
    city: "Dubai",
    source: "WHATSAPP_ADS",
    status: "NEW",
    assigned_to: "uxxmxs7nhmsvpba8g",
    assigned_to_name: "Dubai(Initial)",
    assigned_role: "INITIAL_AGENT", // pre-migration-0020 role name, preserved verbatim
    team_id: "txo3gm1fwmsvp5ycl",
    ctwa_clid: prelead.ctwa_clid ?? "",
  });
  if (settings.autoForwardEnabled && !lead) {
    console.error("wa-bot-dubai: lead insert failed for", evt.phone);
    throw new Error("leads insert failed");
  }

  // (A1) Should Drip?
  const shouldDrip = prelead.should_drip === true;
  const takeover = prelead.takeover === true;
  const flowRows = await sbSelectJson(`preleads?id=eq.${encodeURIComponent(prelead.id)}&select=message_logs,flow_stage,ctwa_clid,wa_ad_id`);
  const flowStatus = flowRows?.[0] ?? {};
  const msgCount = Array.isArray(flowStatus.message_logs) ? flowStatus.message_logs.length : 0;

  if (shouldDrip && !takeover && settings.docsCommandEnabled) {
    await startDrip(evt.waTo, evt.name, prelead.property_interest ?? "");
  }
  // Welcome is no longer an else-branch of the drip check: the n8n graph
  // greeted nobody who came from an ad (should_drip true), and the drip
  // webhook it relied on isn't configured, so ad leads got nothing at all.
  // What the customer actually wrote wins over the ad they clicked: naming a
  // project makes it theirs, and only a Jolshiri project gets the Jolshiri
  // welcome + follow-up flow.
  const named = evt.text ? matchNamedProject(evt.text, await getActiveProjects()) : null;
  if (named && named.name !== prelead.property_interest) {
    prelead.property_interest = named.name;
    await sbPatchFireAndForget("preleads", `id=eq.${encodeURIComponent(prelead.id)}`, { property_interest: named.name });
  }
  // A land seller who happened to click an ad is not a Jolshiri buyer:
  // generic hello, no brochure flow; the LLM's land rule keeps the rest silent.
  const landOffer = !!evt.text && isLandOffer(evt.text);
  // A defaulted property_interest is not a Jolshiri lead (leadContext in ai.ts).
  const ctx = leadContext({ named, isAd: evt.isAd, status: flowStatus, propertyInterest: prelead.property_interest });
  if (settings.welcomeEnabled && !takeover && prelead.is_new === true) {
    if (ctx.jolshiriLead && !landOffer) {
      // Jolshiri lead (ad or named): the admin welcome and the follow-up clock —
      // 5 minutes of silence asks about the profiles, an hour of silence
      // after that asks about a dedicated agent. No auto-forward.
      await sendWaText(evt.waTo, settings.welcomeMessage ? fillWelcomeTemplate(settings.welcomeMessage, evt.name) : welcomeMessage(evt.name));
      await sbPatchFireAndForget("preleads", `id=eq.${encodeURIComponent(prelead.id)}`, {
        flow_stage: "greeted", stage_at: new Date().toISOString(), stage_msg_count: msgCount,
      });
    } else {
      // Direct knock, or a non-Jolshiri project: generic hello, no Jolshiri flow.
      await sendWaText(evt.waTo, GENERIC_WELCOME_TEXT);
    }
  }

  // ── Follow-up flow stage 3 — "yes" to the stage 2a profile offer sends
  // the bundle right away instead of waiting for the next cron tick.
  if (flowStatus.flow_stage === "asked_profile" && !takeover && isProfileConsent(evt.text, evt.quoted)) {
    const convId = `dubai:${evt.remote}`;
    const bundle = buildJolshiriBundle(await getActiveProjects(), FLOW_AUTO_PROFILE_TEXT);
    if (bundle) {
      await sendWaMessageMirrored("dubai", evt.waTo, convId, evt.phone, { type: "text", text: bundle.message });
      for (let i = 0; i < bundle.brochures.length; i++) {
        await new Promise((r) => setTimeout(r, 5500));
        const b = bundle.brochures[i];
        await sendWaMessageMirrored("dubai", evt.waTo, convId, evt.phone, {
          type: "document", mediaUrl: b.url, fileName: `${b.project.name} Brochure.pdf`, text: brochureCaption(b.project),
        });
      }
      await sbPatchFireAndForget("preleads", `id=eq.${encodeURIComponent(prelead.id)}`, {
        flow_stage: "profile_sent", stage_at: new Date().toISOString(), stage_msg_count: msgCount,
      });
      return;
    }
  }

  // (A2) Ad Lead?
  if (settings.metaCapiEnabled && lead && (evt.ctwaClid || "") !== "") {
    await sendMetaCapiEvent({ leadId: String(lead.id ?? ""), ctwaClid: evt.ctwaClid || "" });
  }

  // ── FAQ agent — not part of the n8n port, an addition on top of it.
  // Never runs once a human has taken over (/t), and only on real text (an
  // ad click with no message body, or a photo with no caption, has nothing
  // for the model to answer).
  // ── Follow-up flow stage 4 — "yes" to the dedicated-agent question gets a
  // one-line acknowledgement and closes the flow. Deliberately no auto
  // lead/forward here: a human reads the thread and acts.
  if (flowStatus.flow_stage === "asked_agent" && !takeover && isAffirmative(evt.text)) {
    await sendWaMessageMirrored("dubai", evt.waTo, `dubai:${evt.remote}`, evt.phone, { type: "text", text: FLOW_AGENT_YES_TEXT });
    await sbPatchFireAndForget("preleads", `id=eq.${encodeURIComponent(prelead.id)}`, {
      flow_stage: "agent_ack", stage_at: new Date().toISOString(), stage_msg_count: msgCount,
    });
    return;
  }

  // Price / payment question (not the very first ad message — that one gets
  // the greeting + brochure flow): offer a dedicated agent, jump to stage 4.
  const agentAlreadyOffered = ["asked_agent", "agent_ack", "agent_assigned"].includes(flowStatus.flow_stage);
  if (prelead.is_new !== true && evt.text && isPriceQuestion(evt.text) && !agentAlreadyOffered && !takeover) {
    await sendWaMessageMirrored("dubai", evt.waTo, `dubai:${evt.remote}`, evt.phone, { type: "text", text: FLOW_PRICE_AGENT_TEXT });
    await sbPatchFireAndForget("preleads", `id=eq.${encodeURIComponent(prelead.id)}`, {
      flow_stage: "asked_agent", stage_at: new Date().toISOString(), stage_msg_count: msgCount,
    });
    return;
  }

  // Once the profiles are out (keyword, stage 2b or stage 3) the bundle is
  // never sent again — the gated LLM answer still runs for other questions.
  const profilesAlreadySent = ["profile_sent", "asked_agent", "agent_ack", "agent_assigned"].includes(flowStatus.flow_stage);
  if (settings.faqAgentEnabled && evt.text && !takeover && evt.remote) {
    // Test mode on and an allow-listed number (getBotSettings): the AI Trainer
    // core answers instead of the legacy agent. Everything else runs unchanged.
    if (settings.trainerTest) {
      const r = await runTrainerTestTurn({ bot: "dubai", convId: `dubai:${evt.remote}`, phone: evt.phone, to: evt.waTo, text: evt.text,
        ad: { isAd: evt.isAd, adText: evt.adText }, allowMedia: settings.aiMediaEnabled });
      console.log("trainer test turn", { phone: evt.phone, outcome: r.outcome, sent: r.sent, turnId: r.turnId });
      return;
    }
    const sent = await runFaqAgent("dubai", evt.waTo, evt.remote, evt.text, {
      adProject: ctx.adProject, profilesAlreadySent: profilesAlreadySent || landOffer, allowMedia: settings.aiMediaEnabled,
    });
    if (sent) {
      await sbPatchFireAndForget("preleads", `id=eq.${encodeURIComponent(prelead.id)}`, {
        flow_stage: "profile_sent", stage_at: new Date().toISOString(), stage_msg_count: msgCount,
      });
    }
  }
}

// ── FAQ agent: Jolshiri bundle on keyword, otherwise a tightly gated
// OpenRouter answer. The model only speaks when it marks itself confident
// AND the answer is grounded in wa_projects / wa_knowledge; anything else
// (price it doesn't have, "book me a meeting", small talk) is silence, and a
// human picks the thread up from Conversations. It never announces actions
// — the wa-followup flow owns those. Returns true only when the bundle went
// out, so the caller marks profile_sent and it is never sent twice.
interface FaqOpts { adProject?: string; profilesAlreadySent: boolean; allowMedia: boolean }
async function runFaqAgent(account: string, to: string, remote: string, text: string, opts: FaqOpts): Promise<boolean> {
  try {
    const convId = `${account}:${remote}`;
    const phone = to.replace(/@.*$/, "");
    const [projects, history, knowledge, corrections] = await Promise.all([
      getActiveProjects(), getRecentHistory(convId), getKnowledge(), getCorrections(),
    ]);

    const bundle = opts.profilesAlreadySent ? null : matchJolshiriBundle(text, projects);
    if (bundle) {
      if (!(await aiStillOn("dubai", phone))) return false;
      await sendWaMessageMirrored(account, to, convId, phone, { type: "text", text: bundle.message });
      for (let i = 0; i < bundle.brochures.length; i++) {
        await new Promise((r) => setTimeout(r, 5500));
        const b = bundle.brochures[i];
        if (!(await aiStillOn("dubai", phone))) return false;
        await sendWaMessageMirrored(account, to, convId, phone, {
          type: "document", mediaUrl: b.url, fileName: `${b.project.name} Brochure.pdf`, text: brochureCaption(b.project),
        });
      }
      return true;
    }

    const result = await askAgent(history, text, projects, opts.adProject, knowledge, corrections);
    if (!result.confident) return false; // out of knowledge → say nothing
    // A brochure the flow already delivered is not sent again (no-repeat rule).
    const send = result.send && !(result.send.type === "brochure" && opts.profilesAlreadySent) ? result.send : null;
    if (!result.reply && !send) return false;

    if (result.reply) {
      if (!(await aiStillOn("dubai", phone))) return false;
      await sendWaMessageMirrored(account, to, convId, phone, { type: "text", text: result.reply });
      // Wasender's account-protection rate limit is 1 message per 5s.
      if (opts.allowMedia && send) await new Promise((r) => setTimeout(r, 5500));
    }
    if (opts.allowMedia && send) {
      const mediaList = resolveMedia(send, projects);
      for (let i = 0; i < mediaList.length; i++) {
        const media = mediaList[i];
        if (!(await aiStillOn("dubai", phone))) return false;
      await sendWaMessageMirrored(account, to, convId, phone, {
          type: media.type, mediaUrl: media.url, fileName: media.fileName, text: media.caption,
        });
        if (i < mediaList.length - 1) await new Promise((r) => setTimeout(r, 5500));
      }
    }
    return false;
  } catch (e) {
    console.error("runFaqAgent error", e);
    return false;
  }
}

// A command line can carry trailing free text as a note, e.g.
// "/fdh this client wants a morning call" — everything after the command
// token itself is the note, no special keyword needed. "/n <note>" is the
// standalone form (no command/lead action attached, just logs the note).
function extractTrailingNote(rawText: string): string {
  const tokens = rawText.trim().split(/\s+/);
  return tokens.slice(1).join(" ").trim();
}

async function writeNoteForLead(leadId: string, rawNote: string, source: string): Promise<void> {
  if (!rawNote) return;
  try {
    const fixed = await fixGrammar(rawNote);
    await logNoteActivity(leadId, "c1", fixed, source);
  } catch (e) {
    console.error("writeNoteForLead error", e);
  }
}

async function handleNote(evt: ParsedEvent): Promise<void> {
  const raw = evt.text.trim().split(/\s+/).slice(1).join(" ").trim();
  if (!raw) return;
  const lead = await findLeadForNote(evt.phone);
  if (!lead) {
    console.warn("handleNote: no lead found for phone", evt.phone);
    return;
  }
  await writeNoteForLead(lead.id, raw, "Dubai Bot (WhatsApp /n)");
}

// ── Branch B: agent-typed command ────────────────────────────────────────
async function handleCommand(evt: ParsedEvent): Promise<void> {
  const settings = await getBotSettings("dubai", evt.phone);

  if (evt.command === "/t") {
    if (!settings.takeoverEnabled) return;
    // Set Takeover
    const row = await sbPatchJson("preleads", `phone=eq.${encodeURIComponent(evt.phone)}`, {
      takeover: "true",
    });
    const firstName = String(row?.name ?? "").trim().split(/\s+/)[0] ?? "";
    await sendWaText(evt.waTo, handoverMessage(firstName));
    return; // dead end, as in the source
  }

  if (evt.command === "/n") {
    if (settings.notesEnabled) await handleNote(evt);
    return;
  }

  if (evt.command.startsWith("/f")) {
    if (!settings.manualForwardEnabled) return;
    // Create Lead
    const result = await sbRpcJson("wa_create_lead", {
      p_phone: evt.phone,
      p_cmd: evt.command,
      p_company_id: "c1", // hard-coded in the source workflow, preserved verbatim
    });
    if (!result) {
      console.error("wa-bot-dubai: wa_create_lead returned nothing for", evt.phone, evt.command);
      throw new Error("wa_create_lead failed");
    }

    // "/fdh note ..." — log the trailing note against whichever lead this
    // command just touched, new or already existing. A phone number mentioned
    // in it moves to the lead's own phone field (if the WA one is a LID) and
    // is stripped out of the note text — it has a home of its own now.
    const trailingNote = extractTrailingNote(evt.text);
    if (trailingNote && result.lead_id) {
      const { phone: notedPhone, text: noteText } = splitPhoneFromNote(trailingNote);
      await writeNoteForLead(String(result.lead_id), noteText || trailingNote, `Dubai Bot (WhatsApp ${evt.command})`);
      await fixLeadPhoneFromNote(String(result.lead_id), evt.phone, notedPhone);
    }
    if (result.lead_id) await logConversationHistory(String(result.lead_id), "c1", evt.phone, `Dubai Bot (WhatsApp ${evt.command})`);
    // A human agent now owns this customer — the automated follow-up flow
    // must not ask "want a dedicated agent?" after one was just assigned.
    await sbPatchFireAndForget("preleads", `phone=eq.${encodeURIComponent(evt.phone)}`, {
      flow_stage: "agent_assigned", stage_at: new Date().toISOString(),
    });

    // (B1) Lead CTWA?
    if (settings.metaCapiEnabled && result.status === "created" && (result.ctwa_clid || "") !== "") {
      await sendMetaCapiEvent({ leadId: String(result.lead_id ?? ""), ctwaClid: result.ctwa_clid || "" });
    }

    // (B2) Lead Result
    const firstName = String(result.first_name ?? "").trim();
    if (!settings.customerNotifyEnabled) {
      // admin turned off the customer-facing "expert assigned" messages
    } else if (result.status === "created" && result.notify === true) {
      await sendWaText(evt.waTo, assignedMessage(firstName, result.agent_name ?? "", result.agent_phone ?? ""));
    } else if (result.status === "exists") {
      await sendWaText(evt.waTo, alreadyAssignedMessage(firstName, result.agent_name ?? "", result.agent_phone ?? ""));
    }
    // 'error' / 'unknown_command' / 'no_agent_available' / (created, notify:false)
    // → no customer-facing message, exactly as in the source (Lead Result
    // has no rule for them).
    return;
  }

  // No rule for any other "/..." command — silently dropped, as in the source.
}

// Wasender only lets a session point at one webhook URL — this is it for
// Dubai, so wa-webhook's own chat-mirror job (wa_conversations/wa_messages)
// never gets its own subscription. Forward the untouched payload there
// ourselves, fire-and-forget, instead of relying on Wasender fanning out to
// two URLs (it can't). ?account=dubai keeps its conversation ids in step
// with the client's waConvId(account, jid) convention.
function forwardToMirror(rawBody: string, headers: Headers): void {
  const sig = headers.get("x-webhook-signature") ?? headers.get("x-wasender-signature");
  const fwdHeaders: Record<string, string> = { "Content-Type": "application/json" };
  if (sig) { fwdHeaders["x-webhook-signature"] = sig; fwdHeaders["x-wasender-signature"] = sig; }
  fetch(`${SUPABASE_URL}/functions/v1/wa-webhook?account=dubai`, {
    method: "POST",
    headers: fwdHeaders,
    body: rawBody,
  }).catch((e) => console.error("wa-bot-dubai: forwardToMirror error", e));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const rawBody = await req.text();

  // Same rule as wa-webhook (shared verifyWebhook): with a webhook secret configured the
  // X-Webhook-Signature header must equal it. Unset secret → accepted with a warning.
  const auth = await verifyWebhook("dubai", req.headers);
  if (!auth.ok) {
    console.warn("wa-bot-dubai: rejected webhook: bad signature");
    return json({ error: "Invalid signature" }, 401);
  }
  forwardToMirror(rawBody, req.headers);

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const evt = parseWasenderEvent(payload);

  // ── de-duplicate ─────────────────────────────────────────────────────────
  // The source workflow kept a 500-entry in-memory array in n8n's workflow
  // static data. An Edge Function isolate has no durable memory across
  // invocations, so this uses the same durable claim table wa-webhook already
  // relies on — a stricter, not a weaker, guard than what it replaces. The
  // "dubai-bot:" prefix keeps this bot's claims in their own namespace,
  // independent of wa-webhook's own replay guard on the same delivery.
  // x-replay: 1 bypasses the check (verified requests only), same as the source (that header
  // is how a failed delivery gets safely redelivered without being swallowed
  // as a dup).
  const isReplay = auth.strong && (req.headers.get("x-replay") ?? "") === "1"; // only a verified sender may skip dedupe
  if (evt.messageId && evt.kind !== "ignore" && !isReplay) {
    const fresh = await claimEvent(`dubai-bot:${evt.messageId}`, evt.event);
    if (!fresh) return json({ ok: true, duplicate: true });
  }

  // ── Route (no fallback output — anything still 'ignore' stops here) ──────
  try {
    if (evt.kind === "inbound") {
      await handleInbound(evt);
    } else if (evt.kind === "command") {
      await handleCommand(evt);
    }
  } catch (e) {
    console.error("wa-bot-dubai handler error", e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }

  return json({ ok: true });
});
