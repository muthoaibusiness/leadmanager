import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isForeignNumber, isAdFaqOrSmallTalk, needsAiReply, floorPlanPlan, floorPlanAskText, isFloorPlanAsk, isLocationAsk, locationText, brochureItem, brochureAskText, consentsTo, refuses,
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

test("flow files: Citizen Avenue offers floor plan + video first, the brochure second; no brochure means none", () => {
  const cit = { name: "Wecon Citizen Avenue", brochure_url: "https://x/c.pdf" };
  assert.deepEqual(floorPlanPlan(cit).map((i) => i.type), ["document", "text"]);
  assert.ok(floorPlanPlan(cit)[0].url.includes("1NVarSO7peq15fbPS_2pMBKcc6bVe9sfS"));
  assert.ok(floorPlanPlan(cit)[1].caption.includes("https://www.youtube.com/watch?v=Dc5OR3sEcaU"));
  assert.equal(floorPlanAskText(cit), "Would you like me to send the floor plan and video of Wecon Citizen Avenue?");
  assert.equal(brochureAskText(cit), "Would you like me to send the brochure of Wecon Citizen Avenue?");
  assert.ok(floorPlanAskText(cit)!.startsWith(DOCS_ASK_PREFIX) && brochureAskText(cit).startsWith(DOCS_ASK_PREFIX));
  const b = brochureItem({ name: "Wecon Nuznan", address: "Plot 1, Sector 16, Jolshiri Abashon, Dhaka", brochure_url: "https://x/b.pdf" });
  assert.deepEqual(b, { type: "document", url: "https://x/b.pdf", fileName: "Wecon Nuznan Brochure.pdf", caption: "Wecon Nuznan (Sector 16, Jolshiri Abashon) — Brochure" });
  const p2p = { name: "P2P Helthcare", brochure_url: "https://x/p.pdf" };
  assert.deepEqual(floorPlanPlan(p2p), []);
  assert.equal(floorPlanAskText(p2p), null);
  assert.equal(brochureItem({ name: "Momtaz Manor" }), null);
  assert.equal(brochureItem(null), null);
  assert.deepEqual(floorPlanPlan(null), []);
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

test("floor-plan ask: typed in English or Bangla, or the ad button; a payment plan is not one", () => {
  for (const t of ["ফ্লোর প্ল্যান ও শপের পজিশন দেখতে চাই", "floor plan please", "Send me the floorplan", "ফ্লোর প্ল্যান দেন"]) assert.equal(isFloorPlanAsk(t), true, t);
  for (const t of ["মূল্য ও পেমেন্ট প্ল্যান জানতে চাই", "price?", "বিস্তারিত জানতে চাই"]) assert.equal(isFloorPlanAsk(t), false, t);
});

test("location ask: where is the project; office questions are not one; text comes from the catalog", () => {
  for (const t of ["লোকেশন কোথায় জানান", "মার্কেট কোন খানে হচ্ছে?", "send location", "where is the project"]) assert.equal(isLocationAsk(t), true, t);
  for (const t of ["সৌদিতে কি আপনাদের অফিস আছে", "দুবাই অফিসের ঠিকানা ও অ্যাপয়েন্টমেন্ট চাই", "price?", "ফ্লোর প্ল্যান দেখতে চাই"]) assert.equal(isLocationAsk(t), false, t);
  assert.equal(locationText({ name: "Wecon Citizen Avenue", address: "Amirabad, Lohagara, Chattogram", google_map_url: "https://maps.app.goo.gl/x" }), "Wecon Citizen Avenue is located at Amirabad, Lohagara, Chattogram.\nGoogle Map: https://maps.app.goo.gl/x");
  assert.equal(locationText({ name: "X" }), null);
});
