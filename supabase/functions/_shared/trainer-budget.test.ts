import { test } from "node:test";
import assert from "node:assert/strict";
import { REPLY_LIMITS, requestBody } from "./trainer-model.ts";

// Found against the real model on 2026-10-19: with max_tokens 600 the hidden
// reasoning used all 600 tokens (finish "length", empty content) on 3 of 8
// real questions, so every one fell back to the handoff template. 2000 with
// effort "low" answered all of them.
test("the reply budget leaves room for an answer after the model's reasoning", () => {
  assert.ok(REPLY_LIMITS.max_tokens >= 2000, `max_tokens ${REPLY_LIMITS.max_tokens}`);
  assert.equal(REPLY_LIMITS.effort, "low");
});

test("an OpenRouter reply call carries the effort, and the system prompt goes first", () => {
  const b = requestBody({ model: "m", max_tokens: 2000, system: "sys", messages: [{ role: "user", content: "hi" }] }, "openrouter");
  assert.deepEqual(b.reasoning, { effort: "low" });
  assert.equal(b.max_tokens, 2000);
  assert.deepEqual(b.messages[0], { role: "system", content: "sys" });
  assert.deepEqual(b.messages.at(-1), { role: "user", content: "hi" });
});

test("other providers and short probes get no OpenRouter-only field", () => {
  for (const p of ["openai", "custom"] as const) assert.equal(requestBody({ model: "m", max_tokens: 2000, system: "s", messages: [] }, p).reasoning, undefined, p);
  assert.equal(requestBody({ model: "m", max_tokens: 5, system: "s", messages: [] }, "openrouter").reasoning, undefined);
});
