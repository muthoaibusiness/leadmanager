import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isForeignNumber, isAdFaqOrSmallTalk, needsAiReply, floorPlanPlan, brochureItem, floorPlanAskText, brochureAskText, consentsTo, refuses, shouldGreet, shouldCitizenGreet, isLocationAsk,
  DUBAI_STAGE, DUBAI_STAGES, DOCS_ASK_PREFIX,
  CITIZEN_FLOW, JOLSHIRI_FLOW, GENERIC_FLOW,
} from "./dubai-flow.ts";

test("foreign number: anything outside +880 with a real phone; hidden-number contacts are not foreign", () => {
  for (const p of ["971562807474", "+971 55 423 6071", "966565844027", "447700900123", "923001234567"]) assert.equal(isForeignNumber(p), true, p);
  for (const p of ["8801866064500", "+880 1866-064500", "8801", "", "123"]) assert.equal(isForeignNumber(p), false, p);
  assert.equal(isForeignNumber("971562807474", true), false, "a lid has no real number");
});

// Real first messages from the Dubai ad (369 contacts): the 197 "বিস্তারিত"
// buttons and friends must get no AI reply; real questions must.
test("ad FAQ buttons, greetings and media placeholders need no custom reply", () => {
  for (const t of [
    "বিস্তারিত জানতে চাই।", "বিস্তারিত জানতে চাই।,এজেন্টের সাথে কথা বলতে চাই", "এজেন্টের সাথে কথা বলতে চাই",
    "ফ্লোর প্ল্যান ও শপের পজিশন দেখতে চাই", "কখন কথা বলতে পারবো ?", "সৌদিতে কি আপনাদের অফিস আছে?", "দুবাই অফিসের ঠিকানা ও অ্যাপয়েন্টমেন্ট চাই", "ওকে", "Hi", "Hello", "Good", "Assalamu Alaikum", "[audio]", "Hi,[audio]", "বিস্তারিত জানতে চাই।,[audio]",
    "👍", "", "Hi WECON Team! আমি আপনাদের ওয়েবসাইটে থাকা Wecon Chowdhury Arcade দেখে আগ্রহী হয়েছি।",
  ]) assert.equal(isAdFaqOrSmallTalk(t), true, t);
});

test("anything of the customer's own is a custom-reply case, but only for ad customers", () => {
  for (const t of ["কোন ফ্লোরে বেচা কিনা চলছে। সুযোগ সুবিধা কি?", "What is the price of a shop in P2P?", "বিস্তারিত জানতে চাই। আর কত তলা?", "Is there parking"]) {
    assert.equal(isAdFaqOrSmallTalk(t), false, t);
    assert.equal(needsAiReply(t, true), true, t);
    assert.equal(needsAiReply(t, false), false, "no ad, no custom reply: " + t);
  }
  assert.equal(needsAiReply("বিস্তারিত জানতে চাই।", true), false);
});

test("floor plan / video: Citizen Avenue gets a floor-plan PDF and a video; none without either", () => {
  const c = floorPlanPlan({ name: "Wecon Citizen Avenue", address: "Plot 1, Sector 16, Jolshiri Abashon, Dhaka" });
  assert.ok(c.length >= 2);
  assert.equal(c[0].type, "document");
  assert.ok(c[0].url.includes("1NVarSO7peq15fbPS_2pMBKcc6bVe9sfS"));
  assert.equal(c[0].fileName, "Wecon Citizen Avenue Floor Plan.pdf");
  assert.equal(c[1].caption.includes("https://www.youtube.com/watch?v=Dc5OR3sEcaU"), true);
  assert.deepEqual(floorPlanPlan({ name: "Momtaz Manor" }), []);
  assert.deepEqual(floorPlanPlan(null), []);
  assert.equal(floorPlanAskText({ name: "Wecon Citizen Avenue" }), "Would you like me to send the floor plan and video of Wecon Citizen Avenue?");
  assert.ok(floorPlanAskText({ name: "Wecon Citizen Avenue" }).startsWith(DOCS_ASK_PREFIX));
  assert.equal(floorPlanAskText({ name: "Momtaz Manor" }), null);
});

test("brochure item and ask text", () => {
  const p = brochureItem({ name: "Wecon Nuznan", address: "Plot 1, Sector 16, Jolshiri Abashon, Dhaka", brochure_url: "https://x/b.pdf" });
  assert.equal(p?.type, "document");
  assert.equal(p?.url, "https://x/b.pdf");
  assert.equal(p?.fileName, "Wecon Nuznan Brochure.pdf");
  assert.equal(brochureItem(null), null);
  assert.equal(brochureItem({ name: "X" }), null);
  assert.equal(brochureAskText({ name: "Wecon Citizen Avenue" }), "Would you like me to send the brochure of Wecon Citizen Avenue?");
  assert.ok(brochureAskText({ name: "X" }).startsWith(DOCS_ASK_PREFIX));
});

test("consent: yes-words, or a non-refusal quoting the question; refusals are refusals", () => {
  assert.equal(consentsTo("Yes", "", DOCS_ASK_PREFIX), true);
  assert.equal(consentsTo("জি", undefined, DOCS_ASK_PREFIX), true);
  assert.equal(consentsTo("Ok thanks", brochureAskText({ name: "X" }), DOCS_ASK_PREFIX), true);
  assert.equal(consentsTo("no thanks", brochureAskText({ name: "X" }), DOCS_ASK_PREFIX), false);
  assert.equal(consentsTo("what is the price?", "", DOCS_ASK_PREFIX), false);
  assert.equal(refuses("no"), true); assert.equal(refuses("না"), true); assert.equal(refuses("yes"), false); assert.equal(refuses("hmm"), false);
});

// Regression: one inbound "ফ্লোর প্ল্যান ও শপের পজিশন দেখতে চাই" must NOT produce
// a greeting AND a substantive reply. The greeting is suppressed whenever a
// handler below will answer the same message.
const GREET_BASE = {
  starting: true, welcomeEnabled: true, takeover: false,
  stage: "", text: undefined, quoted: undefined,
  faqAgentEnabled: true, aiMediaEnabled: true, aiWillAnswer: false,
};
test("shouldGreet: no greeting when a floor-plan ask will be answered (reported duplicate)", () => {
  assert.equal(shouldGreet({ ...GREET_BASE, text: "ফ্লোর প্ল্যান ও শপের পজিশন দেখতে চাই" }), false);
});
test("shouldGreet: no greeting for price or location asks", () => {
  assert.equal(shouldGreet({ ...GREET_BASE, text: "দাম কত?" }), false);
  assert.equal(shouldGreet({ ...GREET_BASE, text: "ঠিকানা কী?" }), false);
});
test("shouldGreet: no greeting when the consent flow will answer, or the AI will", () => {
  assert.equal(shouldGreet({ ...GREET_BASE, stage: DUBAI_STAGE.askedDocs, text: "Yes", quoted: DOCS_ASK_PREFIX }), false);
  assert.equal(shouldGreet({ ...GREET_BASE, text: "what is a shop?", aiWillAnswer: true }), false);
});
test("shouldGreet: a plain opening still gets the greeting", () => {
  assert.equal(shouldGreet({ ...GREET_BASE, text: "hi" }), true);
  assert.equal(shouldGreet({ ...GREET_BASE, text: "" }), true);
});
test("shouldGreet: takeover, welcome-off, or non-starting never greets", () => {
  assert.equal(shouldGreet({ ...GREET_BASE, text: "hi", takeover: true }), false);
  assert.equal(shouldGreet({ ...GREET_BASE, text: "hi", welcomeEnabled: false }), false);
  assert.equal(shouldGreet({ ...GREET_BASE, text: "hi", starting: false }), false);
});
test("shouldGreet: the floor-plan flow itself still has content to send (greeting suppressed, not silent)", () => {
  assert.ok(floorPlanPlan({ name: "Wecon Citizen Avenue" }).length >= 2);
});

// The Citizen flow (deployed `wa-bot-dubai` v74+) greets conditionally. A
// starting contact whose message a substantive handler answers must get that
// answer and NOT a greeting — the deployed double-reply regression.
const CG = {
  starting: true, greetingEnabled: true, takeover: false, text: "",
  assigned: true, floorPlanAvailable: true, locationAvailable: true, aiWillAnswer: false,
  faqAgentEnabled: true,
};
test("shouldCitizenGreet: floor-plan ask → no greeting (FAQ owns it), even with no plan; FAQ-off still greets", () => {
  assert.equal(shouldCitizenGreet({ ...CG, text: "ফ্লোর প্ল্যান ও শপের পজিশন দেখতে চাই" }), false);
  assert.equal(shouldCitizenGreet({ ...CG, text: "ফ্লোর প্ল্যান ও শপের পজিশন দেখতে চাই", floorPlanAvailable: false }), false);
  assert.equal(shouldCitizenGreet({ ...CG, text: "ফ্লোর প্ল্যান ও শপের পজিশন দেখতে চাই", floorPlanAvailable: false, faqAgentEnabled: false }), true);
});
test("shouldCitizenGreet: AI/FAQ will answer → no greeting, incl. a floor-plan ask with no plan", () => {
  assert.equal(shouldCitizenGreet({ ...CG, text: "দাম কত?", aiWillAnswer: true }), false);
  assert.equal(shouldCitizenGreet({ ...CG, text: "ফ্লোর প্ল্যান ও শপের পজিশন দেখতে চাই", floorPlanAvailable: false, aiWillAnswer: true }), false);
});
test("shouldCitizenGreet: price (assigned) and location asks → no greeting", () => {
  assert.equal(shouldCitizenGreet({ ...CG, text: "দাম কত?" }), false);
  assert.equal(shouldCitizenGreet({ ...CG, text: "ঠিকানা কী?" }), false);
});
test("shouldCitizenGreet: a plain opener (small talk, empty ad click) still greets", () => {
  assert.equal(shouldCitizenGreet({ ...CG, text: "Hi" }), true);
  assert.equal(shouldCitizenGreet({ ...CG, text: "Assalamu Alaikum" }), true);
  assert.equal(shouldCitizenGreet({ ...CG, text: "" }), true);
  assert.equal(shouldCitizenGreet({ ...CG, text: "👍" }), true);
});
test("shouldCitizenGreet: non-starting, greeting-off, or takeover never greets", () => {
  assert.equal(shouldCitizenGreet({ ...CG, text: "Hi", starting: false }), false);
  assert.equal(shouldCitizenGreet({ ...CG, text: "Hi", greetingEnabled: false }), false);
  assert.equal(shouldCitizenGreet({ ...CG, text: "Hi", takeover: true }), false);
});
test("shouldCitizenGreet: a substantive question defers to the FAQ — no greeting (reported double-reply cases)", () => {
  // Ad-button questions and real questions are not openers: the FAQ owns them,
  // so the greeting must stand down even when ad-attribution timing made
  // aiWillAnswer false on the first delivery.
  assert.equal(shouldCitizenGreet({ ...CG, text: "সৌদিতে কি আপনাদের অফিস আছে?" }), false);
  assert.equal(shouldCitizenGreet({ ...CG, text: "কখন কথা বলতে পারবো?" }), false);
  assert.equal(shouldCitizenGreet({ ...CG, text: "বিস্তারিত জানতে চাই" }), false);
  assert.equal(shouldCitizenGreet({ ...CG, text: "কোন ফ্লোরে বেচা কিনা চলছে?" }), false);
});
test("shouldCitizenGreet: with the FAQ off, a substantive question still greets (no other owner)", () => {
  assert.equal(shouldCitizenGreet({ ...CG, text: "সৌদিতে কি আপনাদের অফিস আছে?", faqAgentEnabled: false }), true);
});

test("stages are distinct from the Eyad flow's, so the two crons never touch each other's rows", () => {
  const eyad = ["greeted", "asked_profile", "profile_sent", "asked_agent", "agent_ack", "agent_assigned"];
  for (const s of DUBAI_STAGES) { assert.ok(s.startsWith("dubai_"), s); assert.ok(!eyad.includes(s), s); }
  assert.equal(new Set(DUBAI_STAGES).size, Object.keys(DUBAI_STAGE).length);
});

// ── Unified flow configs ──────────────────────────────────────────────────
// The shared engine serves every project via its config; these tests lock the
// greeting-ownership and doc-offer behaviour per config so the same intent is
// handled identically across both numbers.

const G = { faqAgentEnabled: true, aiWillAnswer: false, text: "", assigned: false, locationAvailable: true, floorPlanAvailable: true };
const priceAsk = "দাম কত?";

test("CITIZEN_FLOW: greeting suppressed for FAQ-owned substantive text, price, location, floor-plan", () => {
  assert.equal(CITIZEN_FLOW.greetingSuppressed({ ...G, text: "সৌদিতে কি আপনাদের অফিস আছে?" }), true);
  assert.equal(CITIZEN_FLOW.greetingSuppressed({ ...G, text: "Hi" }), false);
  assert.equal(CITIZEN_FLOW.greetingSuppressed({ ...G, text: "👍" }), false);
  assert.equal(CITIZEN_FLOW.greetingSuppressed({ ...G, text: priceAsk, assigned: true }), true);
  assert.equal(CITIZEN_FLOW.greetingSuppressed({ ...G, text: "ঠিকানা কী?" }), true);
  assert.equal(CITIZEN_FLOW.greetingSuppressed({ ...G, text: "ফ্লোর প্ল্যান ও শপের পজিশন দেখতে চাই" }), true);
});
test("CITIZEN_FLOW: aiWillAnswer suppresses; FAQ-off substantive text still greets", () => {
  assert.equal(CITIZEN_FLOW.greetingSuppressed({ ...G, text: "সৌদিতে কি আপনাদের অফিস আছে?", aiWillAnswer: true }), true);
  assert.equal(CITIZEN_FLOW.greetingSuppressed({ ...G, text: "সৌদিতে কি আপনাদের অফিস আছে?", faqAgentEnabled: false }), false);
});

test("isLocationAsk matches Bengali location phrasings including জাইগাই variants and transliterations", () => {
  for (const q of [
    "এইটা লোহাগাড়া কোন জাইগাই",
    "এটা কোথায়?",
    "কোন জায়গা",
    "কোন জাইগাই",
    "Ata kothai",
    "কোথায় এই প্রজেক্ট",
    "ঠিকানা কী?",
    "where is the project?",
  ]) assert.ok(isLocationAsk(q), q);
  assert.equal(isLocationAsk("অফিসের ঠিকানা কী?"), false);
});

test("JOLSHIRI_FLOW: greeting suppressed for FAQ-owned substantive text and price (Eyad passes assigned:false)", () => {
  assert.equal(JOLSHIRI_FLOW.greetingSuppressed({ ...G, text: "কখন কথা বলতে পারবো?" }), true);
  assert.equal(JOLSHIRI_FLOW.greetingSuppressed({ ...G, text: priceAsk }), true);
  assert.equal(JOLSHIRI_FLOW.greetingSuppressed({ ...G, text: "Hi" }), false);
});
test("JOLSHIRI_FLOW: docs offer is the profile bundle, with lead-in message, no brochure follow-up", () => {
  const projects = [
    { name: "Wecon Osman Bellevue", brochure_url: "https://o/b.pdf" },
    { name: "Wecon Nuznan", brochure_url: "https://n/b.pdf" },
    { name: "Wecon Dakshinayan", brochure_url: "https://d/b.pdf" },
  ];
  const items = JOLSHIRI_FLOW.docs.sendOnYes(null, projects as any);
  assert.equal(items.length, 4); // 1 lead-in text + 3 brochures
  assert.equal(items[0].type, "text");
  assert.equal(items[0].caption.startsWith("We have 3 projects"), true);
  assert.equal(items.slice(1).every((i) => i.type === "document"), true);
  assert.equal(JOLSHIRI_FLOW.docs.askBrochure, false);
});
test("GENERIC_FLOW: greeting suppressed for FAQ-owned substantive text; stages stay out of the crons' namespaces", () => {
  assert.equal(GENERIC_FLOW.greetingSuppressed({ ...G, text: "কোন ফ্লোরে বেচা কিনা চলছে?" }), true);
  assert.equal(GENERIC_FLOW.greetingSuppressed({ ...G, text: "hello" }), false);
  const stages = Object.values(GENERIC_FLOW.stages);
  for (const s of stages) assert.ok(s.startsWith("generic_"), s);
});
