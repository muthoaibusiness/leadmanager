// The scripted project lead flow, shared by every customer conversation on
// both WhatsApp numbers (Dubai and Eyad) and every project (Citizen Avenue,
// Jolshiri, …). The pure pieces — stages, texts, matchers, per-project flow
// config — live in dubai-flow.ts (Node-tested); this file is the part that
// talks to Wasender and the preleads table. The caller owns what differs
// between bots: the auto-forward (Dubai only), the AI reply and the closing
// note (the cron). Which project's script runs is decided by the config the
// caller passes; every project funnels through this same engine, so the same
// intent is answered identically regardless of which number the customer
// messaged.
//
// Each step moves the contact's flow_stage forward with an atomic PATCH
// before sending, so a duplicate webhook delivery claims nothing and sends
// nothing.

import { SUPABASE_URL, SERVICE_KEY, sendWaMessageMirrored } from "./wa.ts";
import { isPriceQuestion } from "./ai.ts";
import {
  CITIZEN_FLOW, isLocationAsk, locationText, floorPlanPlan,
  consentsTo, refuses, isPlainSmallTalk,
  type FlowCfg, type DocItem, type DocsProject, type ProjectRow,
} from "./dubai-flow.ts";

export interface CitizenCtx {
  bot: "dubai" | "eyad";
  // True when a consultant has really been assigned (Dubai auto-forwards; Eyad
  // does not), which decides whether the "already assigned" price line may be said.
  assigned: boolean;
  pid: string; // already URL-encoded prelead id
  convId: string;
  phone: string;
  waTo: string;
  text: string;
  quoted?: string;
  isNew: boolean;
  starting: boolean; // a new contact, or an old one we never answered
  stage: string;
  stageAt?: string | null;
  takeover: boolean;
  msgCount: number;
  project: DocsProject | null;
  projects?: ProjectRow[]; // full catalog; needed for multi-project bundles (Jolshiri)
  greetingEnabled: boolean;
  greetingText: string;
  // The per-project flow config; defaults to Citizen.
  cfg?: FlowCfg;
  // True when the caller's AI/FAQ branch will answer this same message, so the
  // greeting must stand down (one inbound → one response).
  aiWillAnswer?: boolean;
  // True when the caller's AI/FAQ agent is enabled; a substantive question then
  // belongs to that agent and the greeting stands down too (greeting only ever
  // answers a plain opening).
  faqAgentEnabled?: boolean;
  // The merged FAQ/AI answerer: owned by the flow, so a substantive question
  // gets exactly one response (the greeting never doubles with it). Passed by
  // the caller; undefined when the agent is off or the message is an opening.
  faq?: () => Promise<unknown>;
  // The inbound wa_messages id this turn answers, linked on every outbound send.
  replyToMessageId?: string;
}

const H = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function select(path: string): Promise<any[]> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: H });
    return r.ok ? await r.json() : [];
  } catch { return []; }
}
// PATCH returning the matched row (null when nothing matched) — the claim.
async function claim(filter: string, patch: Record<string, unknown>): Promise<boolean> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/preleads?${filter}`, {
      method: "PATCH", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify(patch),
    });
    if (!r.ok) return false;
    const rows = await r.json();
    return Array.isArray(rows) && rows.length > 0;
  } catch { return false; }
}
const patchQuiet = async (filter: string, patch: Record<string, unknown>) => { await claim(filter, patch); };

// The consent check for a config step: its own override, else the shared
// quote-prefix / affirmative matcher.
const consent = (cfg: FlowCfg["docs"] | NonNullable<FlowCfg["brochure"]> | NonNullable<FlowCfg["agentConsent"]>, text: string, quoted: string | undefined): boolean => {
  if ("consent" in cfg && cfg.consent) return cfg.consent(text, quoted);
  const prefix = "askQuotePrefix" in cfg ? (cfg.askQuotePrefix as string) : "";
  return consentsTo(text, quoted, prefix);
};

// Returns true when it fully handled this message (the caller stops there).
export async function runCitizenFlow(c: CitizenCtx): Promise<boolean> {
  const cfg: FlowCfg = c.cfg ?? CITIZEN_FLOW;
  const now = () => new Date().toISOString();
  const send = (msg: Parameters<typeof sendWaMessageMirrored>[4]) =>
    sendWaMessageMirrored(c.bot, c.waTo, c.convId, c.phone, msg, { replyToMessageId: c.replyToMessageId });
  const sendItem = (d: DocItem) => send(d.type === "text" ? { type: "text", text: d.caption } : { type: d.type, mediaUrl: d.url, fileName: d.fileName, text: d.caption });
  const row = (stage: string) => `id=eq.${c.pid}&flow_stage=eq.${stage}`;
  const text = c.text;

  // Duplicate webhook deliveries of the same inbound must not produce a second
  // response: once this message already has an outbound linked to it, cede.
  if (c.replyToMessageId) {
    const already = await select(`wa_messages?reply_to_message_id=eq.${encodeURIComponent(c.replyToMessageId)}&select=id&limit=1`);
    if (already.length) return true;
  }

  // A second opening message (a button plus a voice note) lands seconds after
  // the first: part of the same opening, so it must not cancel the follow-up.
  if (!c.isNew && c.stage === cfg.stages.greeted && c.stageAt && Date.now() - Date.parse(c.stageAt) < 60_000) {
    await patchQuiet(row(cfg.stages.greeted), { stage_msg_count: c.msgCount });
  }

  // 2. Greeting; it starts the flow's clock. Only when no substantive handler
  // below (docs offer, price, location, or the caller's AI reply) will answer
  // the same message — otherwise one inbound gets two logical responses. The
  // stage moves only once the greeting really went out, so a failed send is
  // retried on the next message.
  const locationAvailable = !!cfg.location && !!locationText(c.project);
  const floorPlanAvailable = floorPlanPlan(c.project).length > 0;
  const greetingSuppressed = cfg.greetingSuppressed({
    faqAgentEnabled: !!c.faqAgentEnabled,
    aiWillAnswer: !!c.aiWillAnswer,
    text: c.text,
    assigned: c.assigned,
    locationAvailable,
    floorPlanAvailable,
  });
  if (c.starting && c.greetingEnabled && !c.takeover && !greetingSuppressed) {
    const ok = await send({ type: "text", text: c.greetingText });
    if (ok) await patchQuiet(`id=eq.${c.pid}`, { flow_stage: cfg.stages.greeted, stage_at: now(), stage_msg_count: c.msgCount });
    else console.error(`citizen-flow(${c.bot}): greeting failed for`, c.phone);
  }

  // 5. "yes" to the docs offer (floor plan / video for Citizen, the profile
  // bundle for Jolshiri) → send them at once, then ask about the brochure
  // (Citizen only). A refusal closes the flow.
  if (!c.isNew && !c.takeover && c.stage === cfg.stages.askedDocs && text) {
    if (refuses(text)) {
      await patchQuiet(row(cfg.stages.askedDocs), { flow_stage: cfg.stages.done, stage_at: now(), stage_msg_count: c.msgCount });
      return true;
    }
    if (consent(cfg.docs, text, c.quoted)) {
      const next = cfg.docs.askBrochure ? cfg.stages.askedBrochure : cfg.stages.brochureSent;
      if (await claim(row(cfg.stages.askedDocs), { flow_stage: next, stage_at: now(), stage_msg_count: c.msgCount })) {
        await sendDocsThenMaybeBrochureAsk(true);
      }
      return true;
    }
  }

  // 6. "yes" to the brochure question (Citizen) → send it. The same brochure
  // is never resent: if it already went out in this conversation (a previous
  // "yes", or the ad's direct trigger) the consent is still honoured and the
  // stage moves, but no duplicate copy is sent.
  if (!c.isNew && !c.takeover && cfg.brochure && c.stage === cfg.stages.askedBrochure && text) {
    if (refuses(text)) {
      await patchQuiet(row(cfg.stages.askedBrochure), { flow_stage: cfg.stages.done, stage_at: now(), stage_msg_count: c.msgCount });
      return true;
    }
    if (consent(cfg.brochure, text, c.quoted)) {
      const got = await claim(row(cfg.stages.askedBrochure), { flow_stage: cfg.stages.brochureSent, stage_at: now(), stage_msg_count: c.msgCount });
      const b = got ? cfg.brochure.sendOnYes(c.project) : null;
      if (b) {
        const sent = await select(`wa_messages?conversation_id=eq.${encodeURIComponent(c.convId)}&direction=eq.OUT&body=like.${encodeURIComponent(`%${b.fileName}%`)}&select=id&limit=1`);
        if (!sent.length) await sendItem(b);
      }
      return true;
    }
  }

  // 7. Someone who asks for the docs themselves (the ad's floor-plan button
  // for Citizen) gets them now. Once per contact: the video message in the
  // thread is the marker that it already went out. Jolshiri has no direct
  // trigger — its offer is the cron's; a project-naming message belongs to
  // the FAQ agent below.
  if (cfg === CITIZEN_FLOW && !c.takeover && text && /floor\s*-?\s*plan|ফ্লোর\s*প্ল্যান|ফ্লোর\s*প্লান|ফ্লোর\s*লে\s*আউট|ফ্লোর\s*ডিজাইন/i.test(text) && floorPlanPlan(c.project).length) {
    const sent = await select(`wa_messages?conversation_id=eq.${encodeURIComponent(c.convId)}&direction=eq.OUT&body=like.Project%20video*&select=id&limit=1`);
    const inFlow = ["", cfg.stages.greeted, cfg.stages.askedDocs].includes(c.stage);
    let go = false;
    if (!sent.length) {
      go = !inFlow ? true : await claim(`id=eq.${c.pid}&${c.stage ? `flow_stage=eq.${c.stage}` : "flow_stage=is.null"}`,
        { flow_stage: cfg.stages.askedBrochure, stage_at: now(), stage_msg_count: c.msgCount });
    }
    if (go) {
      if (c.starting) await wait(5500); // after the greeting
      await sendDocsThenMaybeBrochureAsk(inFlow);
    }
    return true;
  }

  // 8. A price question. Citizen: point to the consultant already assigned
  // (only where one really is). Jolshiri: offer a dedicated agent (flow jumps
  // to the agent stage). Once per contact.
  const priceFires = cfg.price.mode === "assigned" ? c.assigned : true;
  if (priceFires && !c.takeover && text && isPriceQuestion(text)) {
    const said = await select(`wa_messages?conversation_id=eq.${encodeURIComponent(c.convId)}&direction=eq.OUT&body=eq.${encodeURIComponent(cfg.price.text)}&select=id&limit=1`);
    if (!said.length) {
      if (cfg.price.mode === "agent") {
        // claim the agent offer stage so a "yes" here is recognized next turn
        await patchQuiet(`id=eq.${c.pid}${c.stage ? `&flow_stage=eq.${c.stage}` : ""}`,
          { flow_stage: cfg.agentConsent?.stage ?? cfg.stages.done, stage_at: now(), stage_msg_count: c.msgCount });
      }
      await send({ type: "text", text: cfg.price.text });
    }
    return true;
  }

  // 9. Where is the project (Citizen only): the catalog's address and map link.
  if (cfg.location && !c.takeover && text && isLocationAsk(text)) {
    const loc = locationText(c.project);
    if (loc) {
      const convQ = encodeURIComponent(c.convId);
      const said = await select(`wa_messages?conversation_id=eq.${convQ}&direction=eq.OUT&body=eq.${encodeURIComponent(loc)}&select=id&limit=1`);
      let sentSomething = false;
      if (!said.length) { await send({ type: "text", text: loc }); sentSomething = true; }
      // Then the map picture, when the project has one. Each goes once per contact.
      const mapUrl = String(c.project?.map_image_url || "");
      if (mapUrl.startsWith("https://")) {
        const shown = await select(`wa_messages?conversation_id=eq.${convQ}&direction=eq.OUT&media_url=eq.${encodeURIComponent(mapUrl)}&select=id&limit=1`);
        if (!shown.length) {
          if (sentSomething) await wait(5500);
          await send({ type: "image", mediaUrl: mapUrl, text: `${c.project!.name} — location map` });
        }
      }
      return true;
    }
  }

  // 10. "yes" to the dedicated-agent offer (Jolshiri stage 4) → ack and close.
  if (cfg.agentConsent && !c.isNew && !c.takeover && c.stage === cfg.agentConsent.stage && text) {
    if (refuses(text)) {
      await patchQuiet(row(cfg.agentConsent.stage), { flow_stage: cfg.stages.done, stage_at: now(), stage_msg_count: c.msgCount });
      return true;
    }
    if (consent(cfg.agentConsent, text, c.quoted)) {
      await claim(row(cfg.agentConsent.stage), { flow_stage: cfg.agentConsent.doneStage, stage_at: now(), stage_msg_count: c.msgCount });
      await send({ type: "text", text: cfg.agentConsent.ackText });
      return true;
    }
  }

  // 11. Any substantive question no scripted handler answered belongs to the FAQ
  // agent — the single owner for it. The greeting already stood down, so this is
  // the only response this inbound gets.
  if (c.faqAgentEnabled && !isPlainSmallTalk(text) && c.faq) {
    await c.faq();
    return true;
  }

  return false;

  // Docs (floor plan + video / profile bundle), then the brochure question when
  // the project has one and the config asks it. `advance` is false for a
  // contact who is past the offer stages.
  async function sendDocsThenMaybeBrochureAsk(advance: boolean) {
    const items = cfg.docs.sendOnYes(c.project, c.projects ?? []);
    for (let i = 0; i < items.length; i++) {
      if (i) await wait(5500);
      await sendItem(items[i]);
    }
    if (!advance) return;
    if (cfg.docs.askBrochure && cfg.brochure && c.project && cfg.brochure.askText(c.project)) {
      // Never re-offer the same project's brochure: once its question (or the
      // brochure itself) has gone out in this conversation, don't ask again.
      const ask = cfg.brochure.askText(c.project);
      const asked = await select(`wa_messages?conversation_id=eq.${encodeURIComponent(c.convId)}&direction=eq.OUT&body=eq.${encodeURIComponent(ask)}&select=id&limit=1`);
      if (!asked.length) {
        await wait(5500);
        await send({ type: "text", text: ask });
        await patchQuiet(row(cfg.stages.askedBrochure), { stage_at: now() });
      }
    } else {
      await patchQuiet(row(cfg.stages.askedBrochure), { flow_stage: cfg.stages.done, stage_at: now(), stage_msg_count: c.msgCount });
    }
  }
}
