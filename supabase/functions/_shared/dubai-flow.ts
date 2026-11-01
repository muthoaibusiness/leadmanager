// Dubai WhatsApp bot — the scripted lead flow (Dubai bot only; the Eyad bot's
// Jolshiri flow lives in ai.ts / wa-followup and is untouched). Deno-free so
// the Node tests cover it.
//
//   1. a foreign (non-880) number is forwarded to the Dubai agent at once,
//      without telling the customer;
//   2. every new contact gets a greeting the moment they write;
//   3. an ad customer who writes something outside the ad's own FAQ buttons
//      gets a grounded AI reply; the button texts and small talk get none;
//   4. 10 minutes after the greeting with no reply → "shall I send the floor
//      plan and video?";
//   5. a "yes" → send them at once; no answer within 5 minutes → taken as a
//      yes and sent anyway;
//   6. right after the floor plan and video → "shall I send the brochure?";
//      a "yes" sends it;
//   7. 1 hour of silence after that → the closing "an agent is already
//      assigned, keep in touch" message.
// Each step happens once per contact (the stage moves forward, never back).

import { isAffirmative, isNegative, isPriceQuestion, isProfileConsent, buildJolshiriBundle, isJolshiriProject, FLOW_ASK_PROFILE_TEXT, FLOW_AUTO_PROFILE_TEXT, FLOW_PRICE_AGENT_TEXT, FLOW_AGENT_YES_TEXT, brochureCaption } from "./ai.ts";
import type { ProjectRow } from "./ai.ts";

export const DUBAI_STAGE = {
  greeted: "dubai_greeted",
  askedDocs: "dubai_asked_docs", // floor plan + video offered
  askedBrochure: "dubai_asked_brochure",
  brochureSent: "dubai_brochure_sent",
  done: "dubai_done",
} as const;
export const DUBAI_STAGES: string[] = Object.values(DUBAI_STAGE);

// The Dubai ad campaign running now. wa_bot_settings.campaign_project (migration
// 0050) overrides it per campaign without a redeploy.
export const DUBAI_CAMPAIGN_PROJECT = "Wecon Citizen Avenue";

export const DUBAI_DOCS_WAIT_MS = 10 * 60 * 1000; // silence after the greeting → offer
export const DUBAI_AUTO_SEND_WAIT_MS = 5 * 60 * 1000; // silence after the offer → send anyway
export const DUBAI_FINAL_WAIT_MS = 60 * 60 * 1000; // silence after the brochure ask → closing note

export const DUBAI_GREETING_TEXT =
  "Assalamu Alaikum.\nThank you for contacting Wecon Properties. How can I help you today?";
// Anyone who asks for the floor plan themselves (or taps the ad's floor-plan
// button) gets it at once, without waiting for the follow-up offer.
export const isFloorPlanAsk = (text: string): boolean =>
  /floor\s*-?\s*plan|ফ্লোর\s*প্ল্যান|ফ্লোর\s*প্লান|ফ্লোর\s*লে\s*আউট|ফ্লোর\s*ডিজাইন/i.test(String(text || ""));

// A price question has no answer in the catalog; the assigned consultant has it.
export const DUBAI_PRICE_TEXT = "A sales consultant has already been assigned to you for pricing and payment details. Please keep in touch with them.";
// Where is the project? Answered from the catalog (address + map link), never
// by the model. An office-address question is a different thing and is left out.
export const isLocationAsk = (text: string): boolean => {
  const t = String(text || "");
  if (/অফিস|office/i.test(t)) return false;
  // জায়গা has multiple common spellings-transজায়গা, জাইগাই, জায়গাই,
  // জাইগা — and the location questions are often transliterated (kothai /
  // kothay) or drop the "কোন" (a bare "Ata kothai" / "এটা কোথায়").
  return /locat|লোকেশন|ঠিকানা|address|\bmap\b|ম্যাপ|কোথায়|কোথাই|কোন\s*খানে|কোনখানে|কোন\s*জায়গা|কোন\s*জাইগাই|কোন\s*জায়গাই|কোন\s*জাইগা|জাইগাই|জায়গাই|kothai|kothay|kotha\b|where\s+(is|are|will|can)/i.test(t);
};
export const locationText = (p: { name: string; address?: string | null; google_map_url?: string | null } | null | undefined): string | null => {
  if (!p || !p.address) return null;
  return p.name + " is located at " + p.address + "." + (p.google_map_url ? "\nGoogle Map: " + p.google_map_url : "");
};
export const DUBAI_FINAL_TEXT = "A sales consultant has already been assigned to you. Please keep in touch with them.";

export type DocsProject = { name: string; address?: string | null; brochure_url?: string | null; video_url?: string | null };
export type DocItem = { type: "document" | "image" | "text"; url: string; fileName?: string; caption: string };

// Floor-plan PDFs that are not stored in wa_projects (it only holds floor-plan
// images). Drive "download" form so Wasender can fetch the file itself.
const driveFile = (id: string) => `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`;
export const PROJECT_FLOOR_PLAN_DOC: Record<string, string> = {
  "Wecon Citizen Avenue": driveFile("1NVarSO7peq15fbPS_2pMBKcc6bVe9sfS"),
};
export const PROJECT_VIDEO_FALLBACK: Record<string, string> = {
  "Wecon Citizen Avenue": "https://www.youtube.com/watch?v=Dc5OR3sEcaU",
};

// The floor-plan PDF and the video link, in the order they are sent. Empty when
// the project has neither (then the flow goes straight to the brochure ask).
export function floorPlanPlan(p: DocsProject | null | undefined): DocItem[] {
  if (!p) return [];
  const items: DocItem[] = [];
  const fp = PROJECT_FLOOR_PLAN_DOC[p.name];
  if (fp) items.push({ type: "document", url: fp, fileName: `${p.name} Floor Plan.pdf`, caption: `${p.name} — Floor Plan` });
  const video = p.video_url || PROJECT_VIDEO_FALLBACK[p.name];
  if (video) items.push({ type: "text", url: video, caption: `Project video — ${p.name}\n${video}` });
  return items;
}

// The brochure PDF; null when the project has none.
export function brochureItem(p: DocsProject | null | undefined): DocItem | null {
  if (!p || !p.brochure_url) return null;
  const m = (p.address || "").match(/sector\s*[-:]?\s*(\d+)/i);
  const where = m ? ` (Sector ${m[1]}${/jolshiri/i.test(p.address || "") ? ", Jolshiri Abashon" : ""})` : "";
  return { type: "document", url: p.brochure_url, fileName: `${p.name} Brochure.pdf`, caption: `${p.name}${where} — Brochure` };
}

// The first offer: floor plan and/or video, named as the project has them.
// null when the project has neither.
export function floorPlanAskText(p: DocsProject): string | null {
  const items = floorPlanPlan(p);
  if (!items.length) return null;
  const what = items.map((i) => (i.type === "text" ? "video" : "floor plan")).join(" and ");
  return `Would you like me to send the ${what} of ${p.name}?`;
}
export const brochureAskText = (p: DocsProject) => `Would you like me to send the brochure of ${p.name}?`;
// Both asks start this way, so a customer's quoted reply to either counts as an
// answer (the stage says which question it was).
export const DOCS_ASK_PREFIX = "Would you like me to send the";

// A phone number outside Bangladesh. The Dubai bot only auto-forwards these
// (Bangladeshi numbers are handled by hand). A hidden-number contact has no
// real phone, so it is never "foreign" — a human has to pick it up.
export function isForeignNumber(phone: string, isLid = false): boolean {
  if (isLid) return false;
  const d = String(phone || "").replace(/\D/g, "");
  if (d.length < 8 || d.length > 15) return false;
  return !d.startsWith("880");
}

const norm = (s: string) =>
  String(s || "").toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s\[\]]/gu, " ").replace(/\s+/g, " ").trim();

// The buttons the Dubai ad offers (Meta ice-breakers) and the website
// template — what customers send first, taken from real traffic. Anything made
// only of these is already covered by the greeting.
const AD_FAQ = [
  "বিস্তারিত জানতে চাই",
  "এজেন্টের সাথে কথা বলতে চাই",
  "ফ্লোর প্ল্যান ও শপের পজিশন দেখতে চাই",
  "মূল্য ও পেমেন্ট প্ল্যান জানতে চাই",
  "দাম ও পেমেন্ট প্ল্যান জানতে চাই",
  "আমার বাজেট জানাতে চাই",
  "সাইট ভিজিট বুক করতে চাই",
  // Citizen Avenue campaign (Oct 31): the buttons its ad offers.
  "কখন কথা বলতে পারবো",
  "সৌদিতে কি আপনাদের অফিস আছে",
  "দুবাই অফিসের ঠিকানা ও অ্যাপয়েন্টমেন্ট চাই",
].map(norm);
const AD_FAQ_STARTS = ["hi wecon team"].map(norm);

const SMALL_TALK = new Set([
  "hi", "hii", "hiii", "hello", "helo", "hey", "good", "good morning", "good afternoon", "good evening", "good night",
  "salam", "salaam", "assalamualaikum", "assalamu alaikum", "assalamu alaykum", "as salamu alaikum", "asslamualikum", "assalamualikum",
  "walaikum assalam", "walaikum assalaam", "ok", "okay", "thanks", "thank you", "thx", "tnx", "ধন্যবাদ", "হ্যালো", "হাই", "আসসালামু আলাইকুম",
  "আসসালামুয়ালাইকুম", "সালাম", "ওকে", "[audio]", "[image]", "[video]", "[document]", "[sticker]",
]);

function isCoveredPart(part: string): boolean {
  if (!part) return true;
  if (SMALL_TALK.has(part) || AD_FAQ.includes(part)) return true;
  if (AD_FAQ_STARTS.some((s) => part.startsWith(s))) return true;
  return !/[\p{L}\p{N}]/u.test(part); // emoji / symbols only
}

// True when the message is only ad buttons, greetings, media placeholders or
// emoji — nothing a custom reply could add to.
export function isAdFaqOrSmallTalk(text: string): boolean {
  const parts = String(text || "").split(/[,।\n]+/).map(norm).filter(Boolean);
  if (!parts.length) return true;
  return parts.every(isCoveredPart);
}

// An ad customer who wrote something of their own gets the grounded AI reply.
// Anyone who did not come through the ad gets none (nobody asked us anything
// the greeting doesn't cover).
export const needsAiReply = (text: string, adLead: boolean) => adLead && !isAdFaqOrSmallTalk(text);

// A pure opener: only greetings, small talk, emoji and media placeholders — no
// substance a substantive answer could add. Ad-button questions are NOT openers
// (the FAQ often answers them), so they defer to the FAQ like any other question.
export function isPlainSmallTalk(text: string): boolean {
  const parts = String(text || "").split(/[,।\n]+/).map(norm).filter(Boolean);
  if (!parts.length) return true;
  return parts.every((p) => SMALL_TALK.has(p) || !/[\p{L}\p{N}]/u.test(p));
}

// "yes" to one of the bot's questions: a yes-word, or any non-refusal that
// quotes the question it answers (WhatsApp's reply-to feature).
export function consentsTo(text: string, quoted: string | undefined, askPrefix: string): boolean {
  if (isAffirmative(text)) return true;
  const q = (quoted || "").trim();
  return !!q && q.startsWith(askPrefix) && !isNegative(text);
}
export function refuses(text: string): boolean {
  return isNegative(text) && !isAffirmative(text);
}

// Decide whether the greeting should go out for this inbound. Greeting only a
// plain opening: when a substantive handler below (consent/"yes", floor-plan,
// price, location, or the AI reply) will answer the same message, sending the
// greeting too would produce two logical responses for one inbound. Called
// before the greeting; aiWillAnswer mirrors the AI block's own gate.
export interface GreetDecision {
  starting: boolean;
  welcomeEnabled: boolean;
  takeover: boolean;
  stage: string;
  text: string | undefined;
  quoted: string | undefined;
  faqAgentEnabled: boolean;
  aiMediaEnabled: boolean;
  aiWillAnswer: boolean;
}
export function shouldGreet(d: GreetDecision): boolean {
  if (!d.starting || !d.welcomeEnabled || d.takeover) return false;
  const t = d.text ?? "";
  if (t) {
    if (d.stage === DUBAI_STAGE.askedDocs && (refuses(t) || consentsTo(t, d.quoted, DOCS_ASK_PREFIX))) return false;
    if (d.stage === DUBAI_STAGE.askedBrochure && (refuses(t) || consentsTo(t, d.quoted, DOCS_ASK_PREFIX))) return false;
    if (d.faqAgentEnabled && d.aiMediaEnabled && isFloorPlanAsk(t)) return false;
    if (d.faqAgentEnabled && (isPriceQuestion(t) || isLocationAsk(t))) return false;
    if (d.aiWillAnswer) return false;
  }
  return true;
}

// The Citizen flow's greeting guard (shared by both bots via citizen-flow.ts).
// Returns false when any substantive handler below will answer the same message:
// the caller's AI/FAQ branch (aiWillAnswer), the floor-plan send, the assigned-
// consultant price line, or the catalog location line. An empty message (an ad
// click with no body) and a plain opening still get the greeting.
export interface CitizenGreetD {
  starting: boolean;
  greetingEnabled: boolean;
  takeover: boolean;
  text: string | undefined;
  assigned: boolean;
  floorPlanAvailable: boolean;
  locationAvailable: boolean;
  aiWillAnswer: boolean;
  // The FAQ/AI agent is on for this bot. When it is, a substantive question is
  // that agent's to answer — so the greeting stands down and the FAQ becomes the
  // sole owner. De-coupled from ad-attribution timing, which can flip between
  // duplicate webhook deliveries and let both greeting and answer go out.
  faqAgentEnabled: boolean;
}
export function shouldCitizenGreet(d: CitizenGreetD): boolean {
  if (!d.starting || !d.greetingEnabled || d.takeover) return false;
  const t = String(d.text ?? "");
  if (!t) return true;
  if (d.aiWillAnswer) return false;
  if (d.faqAgentEnabled && !isPlainSmallTalk(t)) return false;
  if (isFloorPlanAsk(t) && d.floorPlanAvailable) return false;
  if (d.assigned && isPriceQuestion(t)) return false;
  if (isLocationAsk(t) && d.locationAvailable) return false;
  return true;
}

// ── Unified flow configuration ──────────────────────────────────────────
// One shared engine (citizen-flow.ts) serves every project's customer
// conversation; the project supplies a config describing its scripted
// stages, greeting ownership, doc offer, price and location behaviour. Both
// WhatsApp numbers pass the config for the project the contact belongs to,
// so a given intent is handled identically across Dubai and Eyad.

export interface FlowCfg {
  // The stages this project's script runs. Jolshiri reuses the bare stages
  // the wa-followup cron already drives (greeted/asked_profile/…); Citizen
  // uses its own dubai_* set so the two crons never touch each other's rows.
  stages: {
    greeted: string;
    askedDocs: string;      // offer pending (floor plan / profile bundle)
    askedBrochure: string;  // second offer (brochure), or = askedDocs when none
    brochureSent: string;
    done: string;
  };
  // True when a substantive handler below will answer this message, so the
  // greeting must stand down (one inbound → one response).
  greetingSuppressed: (d: { faqAgentEnabled: boolean; aiWillAnswer: boolean; text: string; assigned: boolean; locationAvailable: boolean; floorPlanAvailable: boolean }) => boolean;
  // The doc offer ("shall I send …?"): the text to ask, the quote-prefix to
  // recognise a reply to it, the optional specific consent check, what to send
  // on "yes", and whether a brochure ask follows the send.
  docs: {
    askText: (project: DocsProject | null, projects: ProjectRow[]) => string | null;
    askQuotePrefix: string;
    consent?: (text: string, quoted: string | undefined) => boolean;
    sendOnYes: (project: DocsProject | null, projects: ProjectRow[]) => DocItem[];
    askBrochure: boolean;
  };
  brochure?: {
    askText: (project: DocsProject | null) => string | null;
    askQuotePrefix: string;
    consent?: (text: string, quoted: string | undefined) => boolean;
    sendOnYes: (project: DocsProject | null) => DocItem | null;
  };
  // Price questions: a Citizen contact has an assigned consultant (a line
  // pointing at them); a Jolshiri contact is offered a dedicated agent (the
  // flow jumps to the agent stage).
  price: { mode: "assigned" | "agent"; text: string };
  location?: { text: (project: DocsProject | null) => string | null };
  // A "yes" to the dedicated-agent offer (stage 4) — Jolshiri only.
  agentConsent?: { stage: string; ackText: string; doneStage: string; consent?: (text: string, quoted: string | undefined) => boolean };
}

// ── Citizen Avenue ────────────────────────────────────────────────────────
export const CITIZEN_FLOW: FlowCfg = {
  stages: {
    greeted: DUBAI_STAGE.greeted,
    askedDocs: DUBAI_STAGE.askedDocs,
    askedBrochure: DUBAI_STAGE.askedBrochure,
    brochureSent: DUBAI_STAGE.brochureSent,
    done: DUBAI_STAGE.done,
  },
  // Greeting stands down when the FAQ (whose gate mirrors shouldCitizenGreet)
  // owns the text — the citizen guard's faqAgentEnabled branch already covers
  // this, so we re-use the same predicate by delegating the substantive part.
  greetingSuppressed: (d) => {
    if (d.aiWillAnswer) return true;
    if (d.faqAgentEnabled && !isPlainSmallTalk(d.text)) return true;
    if (isFloorPlanAsk(d.text) && d.floorPlanAvailable) return true;
    if (d.assigned && isPriceQuestion(d.text)) return true;
    if (isLocationAsk(d.text) && d.locationAvailable) return true;
    return false;
  },
  docs: {
    askText: (p) => (p ? floorPlanAskText(p) : null),
    askQuotePrefix: DOCS_ASK_PREFIX,
    sendOnYes: (p) => (p ? floorPlanPlan(p) : []),
    askBrochure: true,
  },
  brochure: {
    askText: (p) => (p ? brochureAskText(p) : null),
    askQuotePrefix: DOCS_ASK_PREFIX,
    sendOnYes: (p) => brochureItem(p),
  },
  price: { mode: "assigned", text: DUBAI_PRICE_TEXT },
  location: { text: locationText },
};

// ── Jolshiri ──────────────────────────────────────────────────────────────
// The scripted Jolshiri flow: a profile offer (the 3-project brochure bundle)
// replaces Citizen's floor-plan + brochure offer, and a price question offers
// a dedicated agent (jumping to the agent stage) instead of pointing at an
// already-assigned consultant. Stages are the bare names wa-followup drives,
// so the cron's passes and the bot's replies agree on the same row.
export const JOLSHIRI_FLOW: FlowCfg = {
  stages: {
    greeted: "greeted",
    askedDocs: "asked_profile",
    askedBrochure: "asked_profile", // single offer — no separate brochure ask
    brochureSent: "profile_sent",
    done: "profile_sent",
  },
  greetingSuppressed: (d) => {
    if (d.aiWillAnswer) return true;
    if (d.faqAgentEnabled && !isPlainSmallTalk(d.text)) return true;
    if (isPriceQuestion(d.text)) return true; // price → agent offer (always fires for Jolshiri)
    return false;
  },
  docs: {
    askText: () => FLOW_ASK_PROFILE_TEXT,
    // a profile-quoted reply counts as consent (matches the legacy isProfileConsent)
    askQuotePrefix: FLOW_ASK_PROFILE_TEXT.slice(0, 40),
    consent: (text, quoted) => isProfileConsent(text, quoted),
    sendOnYes: (_p, projects) => {
      const b = buildJolshiriBundle(projects, FLOW_AUTO_PROFILE_TEXT);
      if (!b) return [];
      return [
        { type: "text" as const, url: "", caption: b.message },
        ...b.brochures.map((br) => ({
          type: "document" as const, url: br.url, fileName: `${br.project.name} Brochure.pdf`, caption: brochureCaption(br.project),
        })),
      ];
    },
    askBrochure: false,
  },
  price: { mode: "agent", text: FLOW_PRICE_AGENT_TEXT },
  agentConsent: { stage: "asked_agent", ackText: FLOW_AGENT_YES_TEXT, doneStage: "agent_ack", consent: (text) => isAffirmative(text) },
};

// ── Generic / direct-knock contacts ───────────────────────────────────────
// A non-project contact (no named project, no explicit; direct knock) has no
// scripted docs/price/location arc — but it still runs through the same
// engine for single-owner greeting + FAQ handling. Its stages use a private
// namespace so the wa-followup cron (which matches bare greeted/asked_*
// names and dubai_*) never pulls these rows into a project script.
export const GENERIC_FLOW: FlowCfg = {
  stages: {
    greeted: "generic_greeted",
    askedDocs: "generic_asked_profile",
    askedBrochure: "generic_asked_profile",
    brochureSent: "generic_profile_sent",
    done: "generic_done",
  },
  greetingSuppressed: (d) => {
    if (d.aiWillAnswer) return true;
    if (d.faqAgentEnabled && !isPlainSmallTalk(d.text)) return true;
    if (isPriceQuestion(d.text)) return true;
    return false;
  },
  docs: {
    askText: () => null,
    askQuotePrefix: "",
    sendOnYes: () => [],
    askBrochure: false,
  },
  price: { mode: "agent", text: FLOW_PRICE_AGENT_TEXT },
  agentConsent: { stage: "generic_asked_agent", ackText: FLOW_AGENT_YES_TEXT, doneStage: "generic_agent_ack", consent: (text) => isAffirmative(text) },
};


