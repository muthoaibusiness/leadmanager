// Dubai WhatsApp bot — the scripted lead flow (Dubai bot only; the Eyad bot's
// Jolshiri flow lives in ai.ts / wa-followup and is untouched). Deno-free so
// the Node tests cover it.
//
//   1. a foreign (non-880) number is forwarded to the Dubai agent at once,
//      without telling the customer;
//   2. every new contact gets a greeting the moment they write;
//   3. an ad customer who writes something outside the ad's own FAQ buttons
//      gets a grounded AI reply; the button texts and small talk get none;
//   4. 10 minutes after the greeting with no reply → "shall I send the
//      brochure?";
//   5. a "yes" → send it;
//   6. 1 hour of silence after that → "shall we set up a meeting?".
// Each step happens once per contact (the stage moves forward, never back).

import { isAffirmative, isNegative } from "./ai.ts";

export const DUBAI_STAGE = {
  greeted: "dubai_greeted",
  askedDocs: "dubai_asked_docs",
  docsSent: "dubai_docs_sent",
  askedMeeting: "dubai_asked_meeting",
  meetingYes: "dubai_meeting_yes",
  done: "dubai_done",
} as const;
export const DUBAI_STAGES: string[] = Object.values(DUBAI_STAGE);

// The Dubai ad campaign running now. wa_bot_settings.campaign_project (migration
// 0050) overrides it per campaign without a redeploy.
export const DUBAI_CAMPAIGN_PROJECT = "Wecon Citizen Avenue";

export const DUBAI_DOCS_WAIT_MS = 10 * 60 * 1000;
export const DUBAI_MEETING_WAIT_MS = 60 * 60 * 1000;

export const DUBAI_GREETING_TEXT =
  "Assalamu Alaikum.\nThank you for contacting Wecon Properties. How can I help you today?";
export const DUBAI_MEETING_ASK_TEXT = "Would you like to set up a meeting with our sales consultant?";
export const DUBAI_MEETING_ASK_PREFIX = DUBAI_MEETING_ASK_TEXT;
export const DUBAI_MEETING_YES_TEXT = "Sure. Which day and time suits you best?";

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

// What a "yes" to the docs offer sends: the brochure, then the project's
// floor-plan PDF and video link when it has them. No brochure means nothing to
// offer at all.
export function docsPlan(p: DocsProject | null | undefined): { hasDocs: boolean; items: DocItem[] } {
  if (!p || !p.brochure_url) return { hasDocs: false, items: [] };
  const m = (p.address || "").match(/sector\s*[-:]?\s*(\d+)/i);
  const where = m ? ` (Sector ${m[1]}${/jolshiri/i.test(p.address || "") ? ", Jolshiri Abashon" : ""})` : "";
  const items: DocItem[] = [{ type: "document", url: p.brochure_url, fileName: `${p.name} Brochure.pdf`, caption: `${p.name}${where} — Brochure` }];
  const fp = PROJECT_FLOOR_PLAN_DOC[p.name];
  if (fp) items.push({ type: "document", url: fp, fileName: `${p.name} Floor Plan.pdf`, caption: `${p.name} — Floor Plan` });
  const video = p.video_url || PROJECT_VIDEO_FALLBACK[p.name];
  if (video) items.push({ type: "text", url: video, caption: `${p.name} — Project video:
${video}` });
  return { hasDocs: true, items };
}

export const docsAskText = (p: DocsProject) =>
  PROJECT_FLOOR_PLAN_DOC[p.name] ? `Would you like me to send the brochure, floor plan and video of ${p.name}?` : `Would you like me to send the brochure of ${p.name}?`;
// The start of every ask wording ever sent, so a customer's quoted reply still
// counts as an answer.
export const DOCS_ASK_PREFIX = "Would you like me to send the brochure";

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
