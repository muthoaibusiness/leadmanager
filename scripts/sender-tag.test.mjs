// Regression guards for Conversations sender-tag naming (2026-11-02):
//   - the feature toggle stays "AI Trainer on/off"
//   - message-level sender tags display as "AI AGENT"
//   - the trainer backend sends as "AI Trainer" (the tag above is what Conversations shows)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { senderDisplayTag } from "../src/lib/senderTag.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(`${root}${rel}`, "utf8");

test("senderDisplayTag: AI Agent and AI Trainer both render as AI AGENT", () => {
  assert.equal(senderDisplayTag("AI Agent"), "AI AGENT");
  assert.equal(senderDisplayTag("AI Trainer"), "AI AGENT");
  assert.equal(senderDisplayTag("ai trainer"), "AI AGENT");
  assert.equal(senderDisplayTag(""), "");
  assert.equal(senderDisplayTag(null), null);
  assert.equal(senderDisplayTag("Ismail H. Rahat"), "Ismail H. Rahat");
  assert.equal(senderDisplayTag("Ismail"), "Ismail");
});

test("Conversations toggle label stays 'AI Trainer on' (feature switch, not renamed)", () => {
  const v = read("src/components/views/ConversationsView.jsx");
  assert.ok(v.includes("'AI Trainer on'"), "toggle must keep 'AI Trainer on'");
  assert.ok(!v.includes("'AI Agent on'"), "toggle must NOT be renamed to AI Agent");
});

test("message bubble renders sender tags through senderDisplayTag", () => {
  const b = read("src/components/chat/MessageBubble.jsx");
  assert.ok(b.includes("senderDisplayTag(msg.senderName)"), "bubble must normalize sender tag");
});

test("the trainer backend sends as AI Trainer (the bubble shows it as AI AGENT)", () => {
  const d = read("supabase/functions/_shared/trainer-deno.ts");
  assert.ok(d.includes('senderName: "AI Trainer"'), "trainer-deno sends as AI Trainer");
});test('the trainer backend sends as AI Trainer (the bubble shows it as AI AGENT)', () => {
  const d = read('supabase/functions/_shared/trainer-deno.ts');
  assert.ok(d.includes('senderName: "AI Trainer"'), 'trainer-deno sends as AI Trainer');
});