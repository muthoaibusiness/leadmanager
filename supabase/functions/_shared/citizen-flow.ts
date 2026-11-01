// The scripted Citizen Avenue lead flow, shared by the Dubai bot (every contact)
// and the Eyad bot (contacts who come in for Citizen Avenue). The pure pieces —
// stages, texts, matchers — live in dubai-flow.ts (Node-tested); this file is
// the part that talks to Wasender and the preleads table. The caller owns what
// differs between the bots: the auto-forward (Dubai only), the AI reply and the
// closing note (the cron).
//
// Each step moves the contact's flow_stage forward with an atomic PATCH before
// sending, so a duplicate webhook delivery claims nothing and sends nothing.

import { SUPABASE_URL, SERVICE_KEY, sendWaMessageMirrored } from "./wa.ts";
import { isPriceQuestion } from "./ai.ts";
import {
  DUBAI_STAGE, DOCS_ASK_PREFIX, DUBAI_PRICE_TEXT, isFloorPlanAsk, isLocationAsk, locationText,
  floorPlanPlan, brochureItem, brochureAskText, consentsTo, refuses, shouldCitizenGreet, type DocItem, type DocsProject,
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
  greetingEnabled: boolean;
  greetingText: string;
  // True when the caller's AI/FAQ branch will answer this same message, so the
  // greeting must stand down (one inbound → one response).
  aiWillAnswer?: boolean;
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

// Returns true when it fully handled this message (the caller stops there).
export async function runCitizenFlow(c: CitizenCtx): Promise<boolean> {
  const now = () => new Date().toISOString();
  const send = (msg: Parameters<typeof sendWaMessageMirrored>[4]) =>
    sendWaMessageMirrored(c.bot, c.waTo, c.convId, c.phone, msg, { replyToMessageId: c.replyToMessageId });
  const sendItem = (d: DocItem) => send(d.type === "text" ? { type: "text", text: d.caption } : { type: d.type, mediaUrl: d.url, fileName: d.fileName, text: d.caption });
  const row = (stage: string) => `id=eq.${c.pid}&flow_stage=eq.${stage}`;
  const text = c.text;

  // A second opening message (a button plus a voice note) lands seconds after
  // the first: part of the same opening, so it must not cancel the follow-up.
  if (!c.isNew && c.stage === DUBAI_STAGE.greeted && c.stageAt && Date.now() - Date.parse(c.stageAt) < 60_000) {
    await patchQuiet(row(DUBAI_STAGE.greeted), { stage_msg_count: c.msgCount });
  }

  // 2. Greeting; it starts the 10-minute clock. Only when no substantive handler
  // below (floor plan, price, location, or the caller's AI reply) will answer the
  // same message — otherwise one inbound gets two logical responses. The stage
  // moves only once the greeting really went out, so a failed send is retried on
  // the next message.
  if (shouldCitizenGreet({
    starting: c.starting, greetingEnabled: c.greetingEnabled, takeover: c.takeover,
    text: c.text, assigned: c.assigned,
    floorPlanAvailable: floorPlanPlan(c.project).length > 0,
    locationAvailable: !!locationText(c.project),
    aiWillAnswer: !!c.aiWillAnswer,
  })) {
    const ok = await send({ type: "text", text: c.greetingText });
    if (ok) await patchQuiet(`id=eq.${c.pid}`, { flow_stage: DUBAI_STAGE.greeted, stage_at: now(), stage_msg_count: c.msgCount });
    else console.error(`citizen-flow(${c.bot}): greeting failed for`, c.phone);
  }

  // 5. "yes" to the floor plan / video offer → send them at once, then ask about the brochure.
  if (!c.isNew && !c.takeover && c.stage === DUBAI_STAGE.askedDocs && text) {
    if (refuses(text)) {
      await patchQuiet(row(DUBAI_STAGE.askedDocs), { flow_stage: DUBAI_STAGE.done, stage_at: now(), stage_msg_count: c.msgCount });
      return true;
    }
    if (consentsTo(text, c.quoted, DOCS_ASK_PREFIX)) {
      if (await claim(row(DUBAI_STAGE.askedDocs), { flow_stage: DUBAI_STAGE.askedBrochure, stage_at: now(), stage_msg_count: c.msgCount })) {
        await sendFloorPlanThenBrochureAsk(true);
      }
      return true;
    }
  }

  // 6. "yes" to the brochure question → send it.
  if (!c.isNew && !c.takeover && c.stage === DUBAI_STAGE.askedBrochure && text) {
    if (refuses(text)) {
      await patchQuiet(row(DUBAI_STAGE.askedBrochure), { flow_stage: DUBAI_STAGE.done, stage_at: now(), stage_msg_count: c.msgCount });
      return true;
    }
    if (consentsTo(text, c.quoted, DOCS_ASK_PREFIX)) {
      const got = await claim(row(DUBAI_STAGE.askedBrochure), { flow_stage: DUBAI_STAGE.brochureSent, stage_at: now(), stage_msg_count: c.msgCount });
      const b = got ? brochureItem(c.project) : null;
      if (b) await sendItem(b);
      return true;
    }
  }

  // 7. Someone who asks for the floor plan themselves gets it now (the ad's
  // floor-plan button counts). Once per contact: the video message in the thread
  // is the marker that it already went out.
  if (!c.takeover && text && isFloorPlanAsk(text) && floorPlanPlan(c.project).length) {
    const sent = await select(`wa_messages?conversation_id=eq.${encodeURIComponent(c.convId)}&direction=eq.OUT&body=like.Project%20video*&select=id&limit=1`);
    const inFlow = ["", DUBAI_STAGE.greeted, DUBAI_STAGE.askedDocs].includes(c.stage);
    let go = false;
    if (!sent.length) {
      go = !inFlow ? true : await claim(`id=eq.${c.pid}&${c.stage ? `flow_stage=eq.${c.stage}` : "flow_stage=is.null"}`,
        { flow_stage: DUBAI_STAGE.askedBrochure, stage_at: now(), stage_msg_count: c.msgCount });
    }
    if (go) {
      if (c.starting) await wait(5500); // after the greeting
      await sendFloorPlanThenBrochureAsk(inFlow);
    }
    return true;
  }

  // 8. A price question: the catalog has no price, so point to the consultant
  // already assigned (only where one really is). Once per contact.
  if (c.assigned && !c.takeover && text && isPriceQuestion(text)) {
    const said = await select(`wa_messages?conversation_id=eq.${encodeURIComponent(c.convId)}&direction=eq.OUT&body=eq.${encodeURIComponent(DUBAI_PRICE_TEXT)}&select=id&limit=1`);
    if (!said.length) await send({ type: "text", text: DUBAI_PRICE_TEXT });
    return true;
  }

  // 9. Where is the project: the catalog's address and map link, then the map
  // picture when the project has one. Each goes once per contact.
  if (!c.takeover && text && isLocationAsk(text)) {
    const loc = locationText(c.project);
    if (loc) {
      const convQ = encodeURIComponent(c.convId);
      const said = await select(`wa_messages?conversation_id=eq.${convQ}&direction=eq.OUT&body=eq.${encodeURIComponent(loc)}&select=id&limit=1`);
      let sentSomething = false;
      if (!said.length) { await send({ type: "text", text: loc }); sentSomething = true; }
      const mapUrl = String(c.project?.map_image_url || "");
      if (/^https:\/\//.test(mapUrl)) {
        const shown = await select(`wa_messages?conversation_id=eq.${convQ}&direction=eq.OUT&media_url=eq.${encodeURIComponent(mapUrl)}&select=id&limit=1`);
        if (!shown.length) {
          if (sentSomething) await wait(5500);
          await send({ type: "image", mediaUrl: mapUrl, text: `${c.project!.name} — location map` });
        }
      }
      return true;
    }
  }

  return false;

  // Floor plan + video, then the brochure question (when the project has a
  // brochure). `advance` is false for a contact who is past the offer stages.
  async function sendFloorPlanThenBrochureAsk(advance: boolean) {
    const items = floorPlanPlan(c.project);
    for (let i = 0; i < items.length; i++) {
      if (i) await wait(5500);
      await sendItem(items[i]);
    }
    if (!advance) return;
    if (c.project && brochureItem(c.project)) {
      await wait(5500);
      await send({ type: "text", text: brochureAskText(c.project) });
      await patchQuiet(row(DUBAI_STAGE.askedBrochure), { stage_at: now() });
    } else {
      await patchQuiet(row(DUBAI_STAGE.askedBrochure), { flow_stage: DUBAI_STAGE.done, stage_at: now() });
    }
  }
}
