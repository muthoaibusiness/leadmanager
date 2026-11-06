// Static regression guards for the bots' AI behavior. Each invariant is a live behavior that must
// survive a deploy:
//   - persistent ad attribution (storedAdContext / adFor) in both bots
//   - AI replies go to ad customers only (needsAiReply(text, adLead)); a trainer_test_mode chat is always eligible
//   - the trainer's outgoing sender stays "AI Trainer" (Conversations shows both as "AI AGENT": src/lib/senderTag.js)
// Decision 2026-11-05 (merge of asad-dev into dev): the bots keep dev's behavior, which is what production runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const read = (rel: string) => readFileSync(`${here}${rel}`, "utf8");

const dubai = read("../wa-bot-dubai/index.ts");
const eyad = read("../wa-bot-eyad/index.ts");
const trainerDeno = read("trainer-deno.ts");

test("the trainer sends as AI Trainer", () => {
  assert.ok(trainerDeno.includes('senderName: "AI Trainer"'), "trainer-deno.ts must send as AI Trainer");
});

test("persistent ad attribution restored in both bots", () => {
  assert.ok(dubai.includes("storedAdContext"), "dubai restores storedAdContext");
  assert.ok(eyad.includes("storedAdContext"), "eyad restores storedAdContext");
  assert.ok(eyad.includes("adFor"), "eyad keeps adFor() ad resolution");
  assert.ok(eyad.includes("ctwa_clid,wa_ad_id"), "eyad reads click id + ad id from prelead");
  assert.ok(dubai.includes("adLead && projectName"), "dubai resolves project from stored ad context");
});

test("reply eligibility is ad customers only, via needsAiReply(text, adLead)", () => {
  assert.ok(dubai.includes("needsAiReply(evt.text, adLead)"), "dubai gates on adLead");
  assert.ok(eyad.includes("needsAiReply(p.text, adLead)"), "eyad gates on adLead");
});

test("a trainer_test_mode chat is always eligible", () => {
  assert.ok(dubai.includes("|| settings.trainerTest"), "dubai eligibility includes trainerTest");
  assert.ok(eyad.includes("|| settings.trainerTest"), "eyad eligibility includes trainerTest");
});
