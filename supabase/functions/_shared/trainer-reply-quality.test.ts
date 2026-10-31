import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt, emptyState, freezeContent, guardReply, type ItemRow, type ModelOut } from "./trainer-core.ts";

// Owner rule (2026-10-31): one reply per message, at most 5 short lines.
const NUZ = { id: "p-nuz", kind: "project", revision: 1, status: "active", bots: ["eyad", "dubai"], project_ref: null,
  body: { name: "Wecon Nuznan", aliases: { banglish: ["nuznan"] }, media: {} } } as ItemRow;
const C = freezeContent([NUZ], { reply_model: "m", max_tokens: 600, rubric_version: 1 }).content;
const out = (reply: string): ModelOut => ({ intent: "info", project_ref: "p-nuz", language: "en", reply, media: [], handoff: false, asked: [], used_item_ids: [], clarify: false });

test("a reply longer than 5 lines is rejected with 'length'; 5 lines pass; blank lines do not count", () => {
  assert.ok(guardReply(out(["a", "b", "c", "d", "e", "f"].join("\n")), C, ["p-nuz"], "").includes("length"));
  assert.ok(!guardReply(out(["a", "b", "c", "d", "e"].join("\n")), C, ["p-nuz"], "").includes("length"));
  assert.ok(!guardReply(out("a\n\n\nb\n\nc\n\n\n\nd\n\ne"), C, ["p-nuz"], "").includes("length"));
});

test("the prompt asks for at most 5 short lines and for every question to be answered in order", () => {
  const { system } = buildPrompt(C, "eyad", [], "location? parking?", emptyState(), ["p-nuz"], "en");
  assert.ok(system.includes("At most 5 short lines"));
  assert.ok(system.includes("Answer every question in the message, in order"));
});
