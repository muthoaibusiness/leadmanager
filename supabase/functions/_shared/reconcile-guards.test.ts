// Static regression guards for the Conversations AI Agent reconciliation
// (2026-11-02). Each invariant mirrors a requested change or a live-only
// behavior that must survive deployment:
//   - persistent ad attribution (storedAdContext / adFor) in both bots
//   - all-customer reply eligibility (no adLead-only gate)
//   - reply eligibility independent of trainer_test_mode
//   - outgoing sender is "AI Agent", never "AI Trainer"
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const read = (rel: string) => readFileSync(`${here}${rel}`, "utf8");

const dubai = read("../wa-bot-dubai/index.ts");
const eyad = read("../wa-bot-eyad/index.ts");
const trainerDeno = read("trainer-deno.ts");

test("outgoing sender is AI Agent, never AI Trainer", () => {
  assert.ok(trainerDeno.includes('senderName: "AI Agent"'), "trainer-deno.ts must send as AI Agent");
  assert.ok(!trainerDeno.includes('senderName: "AI Trainer"'), "no AI Trainer sender remains");
  assert.ok(!dubai.includes('senderName: "AI Trainer"') && !eyad.includes('senderName: "AI Trainer"'), "bots must not send as AI Trainer");
});

test("persistent ad attribution restored in both bots", () => {
  assert.ok(dubai.includes("storedAdContext"), "dubai restores storedAdContext");
  assert.ok(eyad.includes("storedAdContext"), "eyad restores storedAdContext");
  assert.ok(eyad.includes("adFor"), "eyad keeps adFor() ad resolution");
  assert.ok(eyad.includes("ctwa_clid,wa_ad_id"), "eyad reads click id + ad id from prelead");
  assert.ok(dubai.includes("adLead && projectName"), "dubai resolves project from stored ad context");
});

test("reply eligibility is all-customer, no adLead-only gate", () => {
  assert.ok(!dubai.includes("needsAiReply(evt.text, adLead)"), "dubai no two-arg gate");
  assert.ok(!dubai.includes("needsAiReply(p.text, "), "dubai no two-arg gate variant");
  assert.ok(!eyad.includes("needsAiReply(p.text, p.isAd || !!p.ctwaClid)"), "eyad no two-arg gate");
});

test("production eligibility does not depend on trainer_test_mode", () => {
  assert.ok(!dubai.includes("|| settings.trainerTest"), "dubai eligibility doesn't use trainerTest");
  assert.ok(!eyad.includes("|| settings.trainerTest"), "eyad eligibility doesn't use trainerTest");
});
