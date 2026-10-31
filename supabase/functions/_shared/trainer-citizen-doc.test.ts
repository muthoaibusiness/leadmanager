import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { markdownChunks } from "./trainer-docs.ts";

// The drafted Citizen Avenue knowledge document (docs/Projects) must chunk one
// section per question, carry its heading, and hold each key fact in Bangla,
// Banglish and English, so a Banglish question like "koto tola?" retrieves it.
// The live document is a headingless sheet and chunks mid-answer (D10).
const MD = readFileSync(new URL("../../../docs/Projects/citizen-avenue-knowledge.md", import.meta.url), "utf8");
const chunks = markdownChunks(MD);

test("every chunk has a section heading and no chunk repeats the 'give your mobile number' boilerplate", () => {
  assert.ok(chunks.length >= 15, `${chunks.length} chunks`);
  assert.ok(chunks.every((c) => c.section.startsWith("Wecon Citizen Avenue")), "section path kept");
  assert.ok(chunks.every((c) => !c.text.includes("মোবাইল নম্বরটি দিলে")), "boilerplate removed");
});

test("key facts sit in one chunk each, in all three scripts", () => {
  const find = (re: RegExp) => chunks.find((c) => re.test(c.text));
  const floors = find(/koto tola/);
  assert.ok(floors && /৯ তলা/.test(floors.text) && /9 tola/.test(floors.text) && /9 floors/.test(floors.text));
  const parking = find(/47 ti gari/);
  assert.ok(parking && /৪৭টি গাড়ি/.test(parking.text) && /47 cars and 6 motorcycles/.test(parking.text));
  const handover = find(/December 2031/);
  assert.ok(handover && /ডিসেম্বর ২০৩১/.test(handover.text));
  const price = find(/No figure is published/);
  assert.ok(price && !/\d+\s*(taka|crore|lakh)/i.test(price.text), "no price figure anywhere in the price section");
});
