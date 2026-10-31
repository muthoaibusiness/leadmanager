import { test } from "node:test";
import assert from "node:assert/strict";
import { validateToolCall, runToolCalls, FORWARD_COMMANDS, type ToolCall } from "./trainer-tools.ts";
import { FORWARD } from "../../../scripts/command-compat/fixtures.ts";

// The model only proposes a tool call; this module decides. Synthetic data only.
const CTX = { bot: "eyad" as const, paused: false, turnId: "turn-1", phone: "8801711000001" };

test("the forward map is exactly the agent /f… commands, unchanged", () => {
  assert.deepEqual([...FORWARD_COMMANDS].sort(), FORWARD.map((f) => f[0]).sort());
});

test("forward_to_agent accepts only a known /f… command", () => {
  assert.deepEqual(validateToolCall({ tool: "forward_to_agent", args: { command: "/fdh", reason: "wants a visit" } }, CTX), []);
  assert.ok(validateToolCall({ tool: "forward_to_agent", args: { command: "/fnobody", reason: "x" } }, CTX).length);
  assert.ok(validateToolCall({ tool: "forward_to_agent", args: { command: "/fdh; drop", reason: "x" } }, CTX).length);
});

test("qualify_lead takes only typed preference fields within bounds", () => {
  assert.deepEqual(validateToolCall({ tool: "qualify_lead", args: { budget_band: "3-4 crore", area: "Uttara", size_sqft: 1200, purpose: "own use" } }, CTX), []);
  assert.ok(validateToolCall({ tool: "qualify_lead", args: { budget_band: "x".repeat(81) } }, CTX).length);
  assert.ok(validateToolCall({ tool: "qualify_lead", args: { size_sqft: -5 } }, CTX).length);
  assert.ok(validateToolCall({ tool: "qualify_lead", args: { purpose: "own use", phone: "01711000001" } }, CTX).length, "unknown field refused");
});

test("add_note refuses empty text and text over 500 characters", () => {
  assert.deepEqual(validateToolCall({ tool: "add_note", args: { text: "Prefers a morning call" } }, CTX), []);
  assert.ok(validateToolCall({ tool: "add_note", args: { text: "  " } }, CTX).length);
  assert.ok(validateToolCall({ tool: "add_note", args: { text: "x".repeat(501) } }, CTX).length);
});

test("unknown tools and every tool on a paused conversation are refused, except handover", () => {
  assert.ok(validateToolCall({ tool: "send_brochure", args: {} } as unknown as ToolCall, CTX).length);
  const paused = { ...CTX, paused: true };
  assert.ok(validateToolCall({ tool: "add_note", args: { text: "x" } }, paused).length);
  assert.deepEqual(validateToolCall({ tool: "handover", args: { reason: "asked for a person" } }, paused), []);
});

test("runToolCalls executes valid calls once per turn and tool, and reports every decision", async () => {
  const done: string[] = [];
  const seen = new Set<string>();
  const exec = {
    claim: async (key: string) => (seen.has(key) ? false : (seen.add(key), true)),
    run: async (c: ToolCall) => { done.push(c.tool); return { ok: true }; },
  };
  const calls: ToolCall[] = [
    { tool: "add_note", args: { text: "Prefers morning" } },
    { tool: "add_note", args: { text: "again" } },
    { tool: "forward_to_agent", args: { command: "/fnobody", reason: "x" } },
  ];
  const first = await runToolCalls(calls, CTX, exec);
  assert.deepEqual(done, ["add_note"]);
  assert.deepEqual(first.map((r) => r.status), ["done", "duplicate", "refused"]);
  // A retried turn does nothing new.
  const again = await runToolCalls(calls.slice(0, 1), CTX, exec);
  assert.deepEqual(again.map((r) => r.status), ["duplicate"]); assert.equal(done.length, 1);
});

test("without an executor every call is recorded as proposed, never run", async () => {
  const r = await runToolCalls([{ tool: "handover", args: { reason: "angry customer" } }], CTX, null);
  assert.deepEqual(r.map((x) => x.status), ["proposed"]);
});

test("an executor failure is reported, not thrown", async () => {
  const r = await runToolCalls([{ tool: "add_note", args: { text: "x" } }], CTX, { claim: async () => true, run: async () => { throw new Error("rpc down"); } });
  assert.equal(r[0].status, "failed"); assert.equal(r[0].error, "rpc down");
});
