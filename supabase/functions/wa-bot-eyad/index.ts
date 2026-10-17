// Wecon WA Bot (Eyad) — ported from the "Wecon WA Bot" n8n workflow
// (id 4QzK4hDctIZllt1S, webhook path /wecon-whatsapp). This IS the Eyad
// session's one Wasender webhook target (a session can only have one). It
// forwards the untouched payload to wa-webhook itself (see forwardToMirror
// below) so the CRM-chat mirror still runs, then handles its own command
// routing / welcome message / auto-forward / CAPI logic, exactly as the n8n
// graph did.
//
// Deploy:  npx supabase functions deploy wa-bot-eyad --no-verify-jwt
// Secrets: npx supabase secrets set META_CAPI_ACCESS_TOKEN=...
//          npx supabase secrets set WA_DRIP_WEBHOOK_URL_EYAD=...   (optional, see triggerDrip below)
//          npx supabase secrets set OPENROUTER_API_KEY=...         (FAQ agent — see runFaqAgent / _shared/ai.ts)
//          (WASENDER_API_TOKEN / WASENDER_WEBHOOK_SECRET are already shared
//          with wa-send/wa-webhook via wa_secrets / env, see _shared/wa.ts)
//
// Responsibilities (mirrors the n8n node-by-node spec exactly, including its
// dead/disabled branches — see the comments at each site):
//   Parse Event → Route → either the inbound branch (upsert prelead, welcome
//   message, forward-eligibility bookkeeping) or the command branch
//   (/t takeover, /f* create lead + Meta CAPI + assigned messages, /send*
//   drip-doc push).

import {
  CORS, json, SUPABASE_URL, SERVICE_KEY, WASENDER_BASE,
  claimEvent, getCredentials, getActiveProjects, getRecentHistory, sendWaMessageMirrored, getKnowledge, getCorrections,
  findLeadForNote, logNoteActivity, getBotSettings, getProjectBySendCode, fillWelcomeTemplate, fixLeadPhoneFromNote, splitPhoneFromNote,
  logConversationHistory,
} from "../_shared/wa.ts";
import type { BotSettings } from "../_shared/wa.ts";
import { askAgent, resolveMedia, fixGrammar } from "../_shared/ai.ts";

// ── fixed literals from the source workflow ──────────────────────────────
// Hard-coded in the live n8n workflow for this one bot instance (Eyad /
// Wecon Properties). Ported as-is per the spec — NOT guessed at or
// "corrected" — but flagged: see the judgment-call summary returned
// alongside this file.
const COMPANY_ID = "c1";
const PRELEAD_LOCATION = "Chitagong"; // sic — verbatim from the n8n node, misspelling included
const WA_TAG = "Eyad";

// Region → forwarding-pool command (Compute Forward's REGION_CMD map).
const REGION_CMD: Record<string, string> = { Dhaka: "/fdh", Chattogram: "/fctg", Cumilla: "/fcml" };

// ── customer-facing message templates, verbatim from §3 of the spec ─────
const firstToken = (name: string) => (name || "").trim().split(/\s+/)[0] || "";

const welcomeText = (name: string) =>
  `Hi ${name || "there"},\nThis is Eayd 👋\n\nThank you for your interest in Wecon Properties Limited.\n\nI will help you to make your property journey easier.`;

const handoverText = (name: string) =>
  `Hello ${firstToken(name) || "there"}, 👋\n\nThank you for your patience! 🙏\nI’m Eayd from Wecon Properties, and I’ll be continuing this conversation to assist you further.\n\nI’m currently reviewing your previous messages and requirements to make sure I guide you properly. 🤝\n\nPlease allow me a moment — I’ll get back to you shortly with the relevant details.`;

const assignedText = (firstName: string, agentName: string, agentPhone: string) =>
  `প্রিয় ${firstName || "there"},\n\nআপনার জন্য একজন ডেডিকেটেড এক্সপার্ট নির্ধারণ করা হয়েছে।\n\n👨‍💼 ${agentName}\n📞 ${agentPhone}\n\nতিনি শীঘ্রই আপনার সাথে যোগাযোগ করে সব কিছু বুঝিয়ে দেবেন।`;

const alreadyAssignedText = (firstName: string, agentName: string, agentPhone: string) =>
  `প্রিয় ${firstName || "there"},\n\nআপনি ইতিমধ্যে আমাদের একজন ডেডিকেটেড এক্সপার্টের সাথে যুক্ত আছেন।\n\n👨‍💼 ${agentName}\n📞 ${agentPhone}\n\nতিনি আপনার সব প্রশ্নের উত্তর দিতে থাকবেন।`;

// ── service-role REST, extended with what _shared/wa.ts doesn't expose ───
// sbRpc() in _shared/wa.ts only returns a boolean (it's used by wa-webhook
// for fire-and-forget RPCs like wa_bump_unread). This bot needs the RPC's
// JSON body (wa_upsert_prelead's should_drip/is_new/id/property_interest,
// wa_create_lead's status/lead_id/agent_name/...), so it calls PostgREST
// directly here rather than widening the shared helper's return type for
// callers that don't need it.
const svcHeaders = () => ({
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
});

async function sbRpcJson(fn: string, args: Record<string, unknown>): Promise<any> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { ...svcHeaders(), Prefer: "return=representation" },
    body: JSON.stringify(args),
  });
  if (!r.ok) {
    console.error(`sbRpcJson ${fn} failed`, r.status, await r.text());
    return null;
  }
  try {
    const body = await r.json();
    return Array.isArray(body) ? body[0] ?? null : body;
  } catch {
    return null;
  }
}

async function sbSelectJson(path: string): Promise<any[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: svcHeaders() });
  if (!r.ok) {
    console.error("sbSelectJson failed", path, r.status, await r.text());
    return [];
  }
  return r.json();
}

async function sbPatchJson(table: string, filter: string, patch: unknown) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: "PATCH",
    headers: { ...svcHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) console.error(`sbPatchJson ${table} failed`, r.status, await r.text());
  return r.ok;
}

// Small retry wrapper matching the n8n WaSender/CAPI nodes' own settings
// (retryOnFail: true, maxTries: 3, waitBetweenTries: 5000ms, onError:
// continueRegularOutput — i.e. never throw, just give up after 3 tries).
async function withRetry(fn: () => Promise<boolean>, tries = 3, delayMs = 5000): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    try {
      if (await fn()) return true;
    } catch (e) {
      console.error("withRetry attempt failed", e);
    }
    if (i < tries - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

async function sendWaText(to: string, text: string): Promise<boolean> {
  const { token } = await getCredentials("eyad");
  if (!token) {
    console.error("sendWaText: no Wasender token configured");
    return false;
  }
  return withRetry(async () => {
    const res = await fetch(`${WASENDER_BASE}/send-message`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to, text }),
    });
    if (!res.ok) {
      console.error("sendWaText failed", res.status, await res.text());
      return false;
    }
    return true;
  });
}

// Fire-and-forget hand-off to the "Wecon WA Drip" sub-workflow (n8n id
// sNh2UJeQboG70nJW). That sub-workflow's own node graph was not included in
// the export this port is based on (see spec §4.4 / open question #4), so
// its document-sending logic cannot be reproduced here. WA_DRIP_WEBHOOK_URL_EYAD
// is an escape hatch: if set, this forwards the same {phone, name, project}
// contract n8n's executeWorkflow call used, so the existing n8n sub-workflow
// (or whatever eventually replaces it) can still be triggered unchanged.
// Without that secret configured, this logs and no-ops rather than silently
// pretending to have sent anything.
async function triggerDrip(phone: string, name: string, project: string): Promise<void> {
  const url = Deno.env.get("WA_DRIP_WEBHOOK_URL_EYAD");
  if (!url) {
    console.warn("triggerDrip: WA_DRIP_WEBHOOK_URL_EYAD not configured — drip not sent", { phone, project });
    return;
  }
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, name, project }),
    });
  } catch (e) {
    console.error("triggerDrip failed", e);
  }
}

// ── Parse Event, ported field-for-field ──────────────────────────────────
interface ParsedEvent {
  kind: "ignore" | "command" | "inbound";
  event: string;
  phone: string;
  remote: string;
  fromMe: boolean;
  name: string;
  text: string;
  message: string;
  isAd: boolean;
  adText: string;
  ctwaClid: string;
  command: string;
  deliveryId: string;
}

function parseEvent(payload: any): ParsedEvent {
  const event = String(payload?.event ?? "");
  const data = payload?.data ?? {};
  const msg = data?.messages ?? {};
  const key = msg?.key ?? {};
  const m = msg?.message ?? {};
  const remote = String(key?.remoteJid ?? "");

  const ad =
    (m.extendedTextMessage || m.imageMessage || m.audioMessage || m.videoMessage || {})
      ?.contextInfo?.externalAdReply || null;

  const phone = String(key?.cleanedSenderPn || remote).replace(/@.*$/, "").replace(/\D/g, "");
  const fromMe = key?.fromMe === true;
  // || not ?? — the source falls through on an empty string too (WaSender can
  // send messageBody: "" while the real text sits in a different field).
  const text = String(
    msg?.messageBody || m?.conversation || m?.extendedTextMessage?.text || m?.imageMessage?.caption || "",
  ).trim();
  const mediaLabel = m.imageMessage ? "[image]" : m.audioMessage ? "[audio]" : m.videoMessage ? "[video]" : m.documentMessage ? "[document]" : "";

  let kind: ParsedEvent["kind"] = "ignore";
  if (!phone || remote.endsWith("@g.us")) {
    kind = "ignore";
  } else if (fromMe && text.startsWith("/")) {
    kind = "command";
  } else if (!fromMe) {
    kind = "inbound";
  }

  const deliveryId = key?.id ? String(key.id) : "";

  return {
    kind,
    event,
    phone,
    remote,
    fromMe,
    name: String(msg?.pushName || "").trim(),
    text,
    message: text || mediaLabel,
    isAd: ad?.sourceType === "ad",
    adText: ad ? String(ad.greetingMessageBody || ad.title || ad.body || "") : "",
    ctwaClid: ad ? String(ad.ctwaClid || "") : "",
    command: kind === "command" ? text.toLowerCase().split(/\s+/)[0] : "",
    deliveryId,
  };
}

// ── FAQ agent (OpenRouter) — answers general questions about WECON projects
// and, on request, follows up with a photo / floor plan / brochure. See
// _shared/ai.ts for the prompt and _shared/wa.ts for send+mirror.
async function runFaqAgent(account: string, phone: string, remote: string, text: string, adProject?: string, allowMedia = true): Promise<void> {
  try {
    const convId = `${account}:${remote}`;
    const [projects, history, knowledge, corrections] = await Promise.all([
      getActiveProjects(), getRecentHistory(convId), getKnowledge(), getCorrections(),
    ]);
    const result = await askAgent(history, text, projects, adProject, knowledge, corrections);
    if (result.reply) {
      await sendWaMessageMirrored(account, phone, convId, phone, { type: "text", text: result.reply });
      // Wasender's account-protection rate limit is 1 message per 5s — a
      // media send right behind the text reply gets a 429 and is dropped.
      if (allowMedia && result.send) await new Promise((r) => setTimeout(r, 5500));
    }
    if (allowMedia && result.send) {
      const mediaList = resolveMedia(result.send, projects);
      for (let i = 0; i < mediaList.length; i++) {
        const media = mediaList[i];
        await sendWaMessageMirrored(account, phone, convId, phone, {
          type: media.type, mediaUrl: media.url, fileName: media.fileName, text: media.caption,
        });
        // Rate limit is 1 message per 5s — needed between every item, not
        // just before the first (a multi-floor "send all" is several sends).
        if (i < mediaList.length - 1) await new Promise((r) => setTimeout(r, 5500));
      }
    }
  } catch (e) {
    console.error("runFaqAgent error", e);
  }
}

// ── inbound branch (customer message) ────────────────────────────────────
async function handleInbound(p: ParsedEvent): Promise<void> {
  const upsert = await sbRpcJson("wa_upsert_prelead", {
    p_phone: p.phone,
    p_name: p.name,
    p_message: p.message,
    p_ad_text: p.isAd ? p.adText : "",
    p_ctwa_clid: p.ctwaClid || "",
    p_location: PRELEAD_LOCATION,
  });
  if (!upsert) {
    console.error("handleInbound: wa_upsert_prelead returned nothing", p.phone);
    // Original: a failing RPC node throws and halts (routed to n8n's
    // configured error workflow). Closest equivalent here: surface it as a
    // hard failure so it's loud in logs/monitoring rather than swallowed.
    throw new Error("wa_upsert_prelead failed");
  }

  const preleadId = upsert.id;
  const settings = await getBotSettings("eyad", p.phone);

  // ── Save Prelead WA: tag which bot handled this contact (swallows failure) ─
  if (preleadId) {
    await sbPatchJson("preleads", `id=eq.${encodeURIComponent(preleadId)}`, { WA: WA_TAG }).catch(() => {});
  }

  // ── Should Drip? / New Contact? ─────────────────────────────────────────
  // Should Drip?'s TRUE branch (Start Drip → "Wecon WA Drip") is disabled in
  // the live workflow, so it's a dead end there — meaning welcome is
  // SUPPRESSED whenever should_drip is true and takeover is false, regardless
  // of is_new. Welcome only fires via the FALSE branch → New Contact? (true).
  const shouldDrip = upsert.should_drip === true && upsert.takeover !== true;
  if (settings.welcomeEnabled && !shouldDrip && upsert.is_new === true) {
    await sendWaText(p.phone, settings.welcomeMessage ? fillWelcomeTemplate(settings.welcomeMessage, p.name) : welcomeText(p.name));
  }

  // ── FAQ agent — not part of the n8n port, an addition on top of it.
  // Never runs once a human has taken over (/t), and only on real text (an
  // ad click with no message body, or a photo with no caption, has nothing
  // for the model to answer).
  console.log("faq-agent gate", {
    phone: p.phone, faqAgentEnabled: settings.faqAgentEnabled, hasText: !!p.text,
    takeover: upsert.takeover, remote: p.remote,
  });
  if (settings.faqAgentEnabled && p.text && upsert.takeover !== true && p.remote) {
    await runFaqAgent("eyad", p.phone, p.remote, p.text, upsert.property_interest || undefined, settings.aiMediaEnabled);
  }

  // ── Get Prelead Status → Get Projects → Compute Forward ────────────────
  if (!preleadId) return;
  const [statusRows, projects] = await Promise.all([
    sbSelectJson(`preleads?id=eq.${encodeURIComponent(preleadId)}&select=forwarded,message_logs`),
    sbSelectJson("wa_projects?select=name,region"),
  ]);
  const status = statusRows?.[0] ?? {};
  const msgCount = Array.isArray(status.message_logs) ? status.message_logs.length : 0;

  const phoneDigits = p.phone.replace(/\D/g, "");
  const isBD = phoneDigits.startsWith("880");
  const proj = (projects as any[]).find((x) => x.name === upsert.property_interest);
  const projectRegion: string | null = proj ? proj.region : null;

  let forwardCmd = "";
  if (!isBD) forwardCmd = "/fdu";
  else if (projectRegion && REGION_CMD[projectRegion]) forwardCmd = REGION_CMD[projectRegion];

  const eligible =
    msgCount >= settings.autoForwardAfterMessages && status.forwarded !== true && upsert.takeover !== true && !!forwardCmd;

  // Has Region? → Save Prelead Region (this part IS live/enabled).
  if (projectRegion) {
    await sbPatchJson("preleads", `id=eq.${encodeURIComponent(preleadId)}`, { region: projectRegion });
  }

  // Eligible? → Auto Forward Create Lead was DISABLED in the source n8n
  // workflow (the lead-create call was wired but never actually ran) — now
  // admin-controlled via wa_settings.auto_forward_enabled (WA Relay tab),
  // off by default to match that original behavior until someone turns it
  // on. The region-sync side effect that followed it in the n8n graph stays
  // live either way.
  if (eligible) {
    if (settings.autoForwardEnabled) {
      const result = await sbRpcJson("wa_create_lead", {
        p_phone: p.phone,
        p_cmd: forwardCmd,
        p_company_id: COMPANY_ID,
      });
      console.log("auto-forward: wa_create_lead", { preleadId, phone: p.phone, forwardCmd, result: result?.status });
    } else {
      console.log("auto-forward eligible (auto_forward_enabled is off — lead-create skipped)", {
        preleadId, phone: p.phone, forwardCmd, msgCount,
      });
    }
    if (projectRegion) {
      await sbPatchJson("leads", `phone=eq.${encodeURIComponent(p.phone)}`, { region: projectRegion });
    }
  }
}

// ── command branch ────────────────────────────────────────────────────────
async function handleTakeover(p: ParsedEvent): Promise<void> {
  await sbPatchJson("preleads", `phone=eq.${encodeURIComponent(p.phone)}`, { takeover: true });
  // n8n read the handover name off Set Takeover's own response (the native
  // Supabase "update" node's return value), which doesn't carry a `name`
  // field on the preleads table — so in production this always fell back to
  // "there". Using the inbound command's own pushName instead is a
  // deliberate judgment call (more useful, and the original's behavior was
  // very likely an accident) — see the summary returned with this file.
  await sendWaText(p.phone, handoverText(p.name));
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
    await logNoteActivity(leadId, COMPANY_ID, fixed, source);
  } catch (e) {
    console.error("writeNoteForLead error", e);
  }
}

async function handleNote(p: ParsedEvent): Promise<void> {
  const raw = p.text.trim().split(/\s+/).slice(1).join(" ").trim();
  if (!raw) return;
  const lead = await findLeadForNote(p.phone);
  if (!lead) {
    console.warn("handleNote: no lead found for phone", p.phone);
    return;
  }
  await writeNoteForLead(lead.id, raw, "Eyad Bot (WhatsApp /n)");
}

async function handleCreateLead(p: ParsedEvent, settings: BotSettings): Promise<void> {
  const lead = await sbRpcJson("wa_create_lead", {
    p_phone: p.phone,
    p_cmd: p.command,
    p_company_id: COMPANY_ID,
  });
  if (!lead) {
    console.error("handleCreateLead: wa_create_lead returned nothing", p.phone, p.command);
    throw new Error("wa_create_lead failed");
  }

  // "/fdh note ..." — log the trailing note against whichever lead this
  // command just touched, new or already existing. A phone number mentioned
  // in it moves to the lead's own phone field (if the WA one is a LID) and
  // is stripped out of the note text — it has a home of its own now.
  const trailingNote = extractTrailingNote(p.text);
  if (trailingNote && lead.lead_id) {
    const { phone: notedPhone, text: noteText } = splitPhoneFromNote(trailingNote);
    await writeNoteForLead(String(lead.lead_id), noteText || trailingNote, `Eyad Bot (WhatsApp ${p.command})`);
    await fixLeadPhoneFromNote(String(lead.lead_id), p.phone, notedPhone);
  }
  if (lead.lead_id) await logConversationHistory(String(lead.lead_id), COMPANY_ID, p.phone, `Eyad Bot (WhatsApp ${p.command})`);

  // Branch 1 — Lead CTWA? → Send Meta CAPI Event → CAPI OK? → Mark CAPI Sent
  // Only a newly-created lead with a Meta click id goes to CAPI.
  if (settings.metaCapiEnabled && lead.status === "created" && lead.ctwa_clid) {
    await sendMetaCapiEvent(lead, p);
  }

  // Branch 2 — Lead Result → customer-facing messages
  if (!settings.customerNotifyEnabled) {
    // admin turned off the customer-facing "expert assigned" messages
  } else if (lead.status === "created" && lead.notify === true) {
    await sendWaText(p.phone, assignedText(lead.first_name, lead.agent_name, lead.agent_phone));
  } else if (lead.status === "exists") {
    await sendWaText(p.phone, alreadyAssignedText(lead.first_name, lead.agent_name, lead.agent_phone));
  }
  // status === 'error' | 'unknown_command' | 'no_agent_available', or
  // 'created' with notify !== true: no customer message, no agent feedback
  // — ported silent, exactly as the n8n graph behaves (spec §2.4.2 / open
  // question #7). Flag to the user if they want this gap fixed.

  // Branch 3 — Get Prelead Region → Has Region for Lead? → Save Lead Region
  // Runs unconditionally, parallel to the above, regardless of lead.status.
  const regionRows = await sbSelectJson(`preleads?phone=eq.${encodeURIComponent(p.phone)}&select=region&limit=1`);
  const region = regionRows?.[0]?.region;
  if (region) {
    await sbPatchJson("leads", `phone=eq.${encodeURIComponent(p.phone)}`, { region });
  }
}

async function sendMetaCapiEvent(lead: any, p: ParsedEvent): Promise<void> {
  // The source workflow hard-codes this access token in plaintext in the
  // workflow JSON. That is a real secret and is NOT reproduced here — it
  // must be set as the META_CAPI_ACCESS_TOKEN secret before this path can
  // work. Pixel/page ids are not credentials, so they stay as literals.
  const accessToken = Deno.env.get("META_CAPI_ACCESS_TOKEN") ?? "";
  if (!accessToken) {
    console.error("sendMetaCapiEvent: META_CAPI_ACCESS_TOKEN not configured — skipping CAPI send");
    return;
  }

  const PIXEL_ID = "869790160551668";
  const PAGE_ID = "104718884272119";

  const eventId = lead.lead_id ? String(lead.lead_id) : "";
  const ctwaClid = (lead.ctwa_clid || p.ctwaClid || "");

  // Retry (3x/5s) covers HTTP-level failure only — matches the n8n node's own
  // retryOnFail. "CAPI OK?" (events_received >= 1) is a SEPARATE gate that
  // only decides whether to run Mark CAPI Sent afterward; a 200 response with
  // events_received < 1 is not itself a failure and must not trigger a
  // resend (the original never resends on that condition — it would double
  // -report the same lead to Meta).
  let eventsReceived = 0;
  const sent = await withRetry(async () => {
    const res = await fetch(`https://graph.facebook.com/v26.0/${PIXEL_ID}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: [{
          action_source: "business_messaging",
          custom_data: { currency: "USD", value: 100 },
          event_name: "LeadSubmitted",
          event_id: eventId,
          event_time: Math.floor(Date.now() / 1000),
          messaging_channel: "whatsapp",
          user_data: { ctwa_clid: ctwaClid, page_id: PAGE_ID },
        }],
        access_token: accessToken,
      }),
    });
    if (!res.ok) {
      console.error("sendMetaCapiEvent failed", res.status, await res.text());
      return false;
    }
    const body = await res.json().catch(() => ({}));
    eventsReceived = body?.events_received ?? 0;
    return true; // HTTP accepted it — that's "success" for retry purposes
  });

  if (!sent) { console.warn("sendMetaCapiEvent: send failed after retries"); return; }
  // CAPI OK? → events_received >= 1 → Mark CAPI Sent
  if (eventsReceived >= 1 && eventId) {
    await sbPatchJson("leads", `id=eq.${encodeURIComponent(eventId)}`, { CAPI_STATUS: "LeadSubmitted" });
  }
}

async function handleSendDocs(p: ParsedEvent): Promise<void> {
  // Admin-editable mapping (wa_projects.send_code — see the WA Relay tab),
  // replacing the old hardcoded CODE_TO_PROJECT map.
  const project = await getProjectBySendCode(p.command);
  if (!project) return; // unrecognized /send... code — silent no-op, matches source
  await triggerDrip(p.phone, p.name, project.name);
}

// ── entry point ────────────────────────────────────────────────────────────
// Wasender only lets a session point at one webhook URL — this is it for
// Eyad, so wa-webhook's own chat-mirror job (wa_conversations/wa_messages)
// never gets its own subscription. Forward the untouched payload there
// ourselves, fire-and-forget, instead of relying on Wasender fanning out to
// two URLs (it can't). ?account=eyad keeps its conversation ids in step
// with the client's waConvId(account, jid) convention.
function forwardToMirror(rawBody: string, headers: Headers): void {
  const sig = headers.get("x-webhook-signature") ?? headers.get("x-wasender-signature");
  const fwdHeaders: Record<string, string> = { "Content-Type": "application/json" };
  if (sig) { fwdHeaders["x-webhook-signature"] = sig; fwdHeaders["x-wasender-signature"] = sig; }
  fetch(`${SUPABASE_URL}/functions/v1/wa-webhook?account=eyad`, {
    method: "POST",
    headers: fwdHeaders,
    body: rawBody,
  }).catch((e) => console.error("wa-bot-eyad: forwardToMirror error", e));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const rawBody = await req.text();
  forwardToMirror(rawBody, req.headers);

  // No signature check here, deliberately — the source "WhatsApp Webhook"
  // node has no auth at all (options:{}) and accepts any POST. Adding one
  // would silently drop real traffic if Wasender's delivery to this specific
  // endpoint doesn't carry a header matching wa_secrets.webhook_secret. If
  // you want this endpoint authenticated, confirm Wasender actually sends
  // that header for this bot subscription first, then reintroduce the same
  // check wa-webhook uses (getCredentials + safeEqual).

  let payload: any;
  try { payload = JSON.parse(rawBody); } catch { return json({ error: "Invalid JSON" }, 400); }

  const p = parseEvent(payload);

  // ── dedup ────────────────────────────────────────────────────────────────
  // n8n kept an in-memory/workflow-static array of raw message ids (key.id
  // ALONE — no event name in the key), capped at 500, specifically so the
  // same WhatsApp message delivered under more than one event collapses to
  // one. This uses the durable wa_webhook_events table wa-webhook already
  // claims against, keyed on the message id alone (prefixed "eyadbot:" only
  // to avoid colliding with wa-webhook's own distinct `${event}:${id}` key
  // format for the SAME delivery fanned out to both functions — not to
  // reintroduce a per-event key, which would defeat the original's whole
  // reason for keying on id alone).
  const isReplay = (req.headers.get("x-replay") ?? "") === "1";
  if (p.kind !== "ignore" && p.deliveryId && !isReplay) {
    const fresh = await claimEvent(`eyadbot:${p.deliveryId}`, p.event);
    if (!fresh) return json({ ok: true, duplicate: true });
  }

  try {
    if (p.kind === "inbound") {
      await handleInbound(p);
    } else if (p.kind === "command") {
      const cmdSettings = await getBotSettings("eyad", p.phone);
      if (p.command === "/t") {
        if (cmdSettings.takeoverEnabled) await handleTakeover(p);
      } else if (p.command === "/n") {
        if (cmdSettings.notesEnabled) await handleNote(p);
      } else if (p.command.startsWith("/f")) {
        if (cmdSettings.manualForwardEnabled) await handleCreateLead(p, cmdSettings);
      } else if (p.command.startsWith("/send")) {
        if (cmdSettings.docsCommandEnabled) await handleSendDocs(p);
      }
      // any other /command: unrecognized → silent no-op, matches source
    }
    // kind === 'ignore': no-op
  } catch (e) {
    console.error("wa-bot-eyad handler error", e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }

  return json({ ok: true });
});
