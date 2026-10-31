import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isForeignNumber, isAdFaqOrSmallTalk, needsAiReply, docsPlan, docsAskText, consentsTo, refuses,
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

test("docsPlan: brochure; Citizen Avenue also gets floor-plan PDF and video; no brochure means no docs", () => {
  const p = docsPlan({ name: "Wecon Nuznan", address: "Plot 1, Sector 16, Jolshiri Abashon, Dhaka", brochure_url: "https://x/b.pdf", floor_plans: ["https://x/f.jpg"] } as any);
  assert.equal(p.hasDocs, true);
  assert.deepEqual(p.items, [{ type: "document", url: "https://x/b.pdf", fileName: "Wecon Nuznan Brochure.pdf", caption: "Wecon Nuznan (Sector 16, Jolshiri Abashon) — Brochure" }]);
  assert.deepEqual(docsPlan({ name: "P2P Helthcare", brochure_url: "https://x/p.pdf" }).items.length, 1);
  const c = docsPlan({ name: "Wecon Citizen Avenue", brochure_url: "https://x/c.pdf" });
  assert.deepEqual(c.items.map((i) => i.type), ["document", "document", "text"]);
  assert.ok(c.items[1].url.includes("1NVarSO7peq15fbPS_2pMBKcc6bVe9sfS"));
  assert.ok(c.items[2].caption.includes("https://www.youtube.com/watch?v=Dc5OR3sEcaU"));
  assert.equal(docsAskText({ name: "Wecon Citizen Avenue" }), "Would you like me to send the brochure, floor plan and video of Wecon Citizen Avenue?");
  assert.ok(docsAskText({ name: "Wecon Citizen Avenue" }).startsWith(DOCS_ASK_PREFIX));
  assert.equal(docsPlan({ name: "Momtaz Manor" }).hasDocs, false);
  assert.equal(docsPlan(null).hasDocs, false);
  assert.equal(docsAskText({ name: "P2P Helthcare" }), "Would you like me to send the brochure of P2P Helthcare?");
  assert.ok(docsAskText({ name: "X" }).startsWith(DOCS_ASK_PREFIX));
});

test("consent: yes-words, or a non-refusal quoting the question; refusals are refusals", () => {
  assert.equal(consentsTo("Yes", "", DOCS_ASK_PREFIX), true);
  assert.equal(consentsTo("জি", undefined, DOCS_ASK_PREFIX), true);
  assert.equal(consentsTo("Ok thanks", docsAskText({ name: "X" }), DOCS_ASK_PREFIX), true);
  assert.equal(consentsTo("no thanks", docsAskText({ name: "X" }), DOCS_ASK_PREFIX), false);
  assert.equal(consentsTo("what is the price?", "", DOCS_ASK_PREFIX), false);
  assert.equal(refuses("no"), true); assert.equal(refuses("না"), true); assert.equal(refuses("yes"), false); assert.equal(refuses("hmm"), false);
});

test("stages are distinct from the Eyad flow's, so the two crons never touch each other's rows", () => {
  const eyad = ["greeted", "asked_profile", "profile_sent", "asked_agent", "agent_ack", "agent_assigned"];
  for (const s of DUBAI_STAGES) { assert.ok(s.startsWith("dubai_"), s); assert.ok(!eyad.includes(s), s); }
  assert.equal(new Set(DUBAI_STAGES).size, Object.keys(DUBAI_STAGE).length);
});
