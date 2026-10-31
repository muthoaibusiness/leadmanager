import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isForeignNumber, isAdFaqOrSmallTalk, needsAiReply, floorPlanPlan, brochureItem, floorPlanAskText, brochureAskText, consentsTo, refuses,
  DUBAI_STAGE, DUBAI_STAGES, DOCS_ASK_PREFIX,
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

test("stages are distinct from the Eyad flow's, so the two crons never touch each other's rows", () => {
  const eyad = ["greeted", "asked_profile", "profile_sent", "asked_agent", "agent_ack", "agent_assigned"];
  for (const s of DUBAI_STAGES) { assert.ok(s.startsWith("dubai_"), s); assert.ok(!eyad.includes(s), s); }
  assert.equal(new Set(DUBAI_STAGES).size, Object.keys(DUBAI_STAGE).length);
});
