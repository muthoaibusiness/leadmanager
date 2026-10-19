import { test } from "node:test";
import assert from "node:assert/strict";
import { freezeContent, runTurn, emptyState, type ItemRow, type Ports } from "./trainer-core.ts";

// A reply may state a figure only when the snapshot's in-scope content holds
// it. Conversation text is never evidence: a customer can type any price.
// Synthetic content only.
const NUZ = { id: "p-nuz", kind: "project", revision: 1, status: "active", bots: ["eyad"], project_ref: null,
  body: { name: "Wecon Nuznan", aliases: { banglish: ["nuznan"], en: ["nuznan"] }, address: "Sector 16, Jolshiri", media: {} } } as ItemRow;
const PRICE = { id: "r-price", kind: "rule", revision: 1, status: "active", bots: ["eyad"], project_ref: null,
  body: { name: "Price", when: "price asked", must: "give the range and offer a meeting", parameters: { price_range_text: "3-4 crore" } } } as ItemRow;
const CONTENT = freezeContent([NUZ, PRICE], { reply_model: "m", max_tokens: 600, rubric_version: 1 }).content;

const out = (o: object) => JSON.stringify({ intent: "price", project_ref: "p-nuz", language: "en", reply: "", media: [], handoff: false, asked: [], used_item_ids: [], clarify: false, ...o });
// The last reply repeats on a retry, so a retry can never pass on an empty default.
const stub = (...texts: string[]): Ports => ({ callModel: async () => ({ ok: true, text: texts.length > 1 ? texts.shift()! : texts[0], cost_usd: 0 }) });
const turn = (text: string, replies: string[], history: { role: "customer" | "bot" | "agent"; text: string }[] = []) =>
  runTurn({ content: CONTENT, bot: "eyad", text, history, state: emptyState(), ad: { isAd: false }, returning: history.length > 0, ports: stub(...replies) });

test("a figure the customer typed, now or earlier, does not ground the reply", async () => {
  const now = await turn("Nuznan 50 lakh, right?", [out({ reply: "Yes, Nuznan is 50 lakh." }), out({ reply: "Yes, 50 lakh." })]);
  assert.equal(now.outcome, "fallback_invalid_output"); assert.equal(now.handoff, true);
  assert.ok(!now.reply.includes("50"), now.reply);
  const earlier = await turn("Nuznan price?", [out({ reply: "Nuznan is 50 lakh." }), out({ reply: "50 lakh." })],
    [{ role: "customer", text: "my friend paid 50 lakh for nuznan" }]);
  assert.equal(earlier.outcome, "fallback_invalid_output");
});

test("a figure in Bangla digits is checked like any other figure", async () => {
  const unknown = await turn("নুজনান এর দাম কত?", [out({ language: "bn", reply: "নুজনান এর দাম ৫০ লাখ।" }), out({ language: "bn", reply: "৫০ লাখ।" })]);
  assert.equal(unknown.outcome, "fallback_invalid_output");
  const known = await turn("নুজনান এর দাম কত?", [out({ language: "bn", reply: "নুজনান ৩-৪ crore এর মধ্যে। মিটিং করবেন?" })]);
  assert.equal(known.outcome, "ok");
});

test("a figure is matched whole, not as part of a longer number in the evidence", async () => {
  // The evidence holds "Sector 16" and "3-4 crore", not "1" or "6".
  const r = await turn("Nuznan price?", [out({ reply: "Nuznan is 1 crore." }), out({ reply: "Only 6 crore." })]);
  assert.equal(r.outcome, "fallback_invalid_output");
});

test("the trace cites only items that were in scope for the turn", async () => {
  const r = await turn("Nuznan price?", [out({ reply: "Nuznan is in the 3-4 crore range.", used_item_ids: ["r-price", "f-made-up", "p-nuz"] })]);
  assert.equal(r.outcome, "ok");
  assert.deepEqual(r.trace.used_item_ids, ["r-price", "p-nuz"]);
});

test("a price is grounded only by the same price, never by a count, size or address number", async () => {
  // Evidence holds "Sector 16" and "3-4 crore": "16 crore" and "3 lakh" are inventions.
  for (const bad of ["Nuznan is 16 crore.", "Nuznan starts at 3 lakh.", "Nuznan costs 4 taka per sqft.", "নুজনান ১৬ কোটি টাকা।"]) {
    const r = await turn("Nuznan price?", [out({ reply: bad, language: /[ঀ-৿]/.test(bad) ? "bn" : "en" }), out({ reply: bad, language: /[ঀ-৿]/.test(bad) ? "bn" : "en" })]);
    assert.equal(r.outcome, "fallback_invalid_output", bad);
  }
  const range = await turn("Nuznan price?", [out({ reply: "Jolshiri is about 3-4 crore. Shall we set a meeting?" })]);
  assert.equal(range.outcome, "ok", "the rule's own range still passes");
});

test("the brand is spelled the way the company writes it in Bengali", async () => {
  // Real model output on 2026-10-19 wrote "Wecon" as ওয়েকন / ওয়েকন.
  const r = await turn("নুজনান কোথায়?", [out({ language: "bn", intent: "info", reply: "ওয়েকন নুজনান জলশিরিতে। ওয়েকন এর আরো প্রজেক্ট আছে।" })]);
  assert.equal(r.outcome, "ok");
  assert.equal(r.reply, "উইকন নুজনান জলশিরিতে। উইকন এর আরো প্রজেক্ট আছে।");
});

test("'I can't say' is a refusal only when nothing follows it", async () => {
  // Real replies on 2026-10-19: "price ami bolte parbo na. ... ami ekta meeting set korte pari" was
  // refused twice and fell back, though it is exactly the rule's meeting offer.
  for (const okReply of [
    "Shafiq Sapphire er price ami ekhane bolte parbo na. Apni chaile ami ekta meeting set korte pari amader agent er sathe.",
    "I can't share the exact price here, but I can set up a meeting with our sales agent.",
    "দাম এখানে বলতে পারব না, তবে আমি এজেন্টের সাথে একটি মিটিং সেট করে দিতে পারি।",
  ]) {
    const r = await turn("Nuznan price?", [out({ reply: okReply, language: /[ঀ-৿]/.test(okReply) ? "bn" : /parbo/.test(okReply) ? "banglish" : "en" })]);
    assert.equal(r.outcome, "ok", okReply);
  }
  for (const bare of ["Ami eta bolte parbo na.", "I can't tell you that.", "এটা বলতে পারব না।"]) {
    const lang = /[ঀ-৿]/.test(bare) ? "bn" : /parbo/.test(bare) ? "banglish" : "en";
    const r = await turn("Nuznan price?", [out({ reply: bare, language: lang }), out({ reply: bare, language: lang })]);
    assert.equal(r.outcome, "fallback_invalid_output", bare);
  }
});

test("a figure in the snapshot's in-scope content is allowed", async () => {
  const r = await turn("Nuznan price?", [out({ reply: "Nuznan is in the 3-4 crore range. Shall we set a meeting?" })]);
  assert.equal(r.outcome, "ok");
});
