import { test } from "node:test";
import assert from "node:assert/strict";
import { runTestTurn, historyFromMessages, isTestNumber, type LivePorts, type LiveInput } from "./trainer-live.ts";

// runTestTurn with fake ports: an in-memory table set, a scripted model and a
// recording send. Covers the allow-list at send time, history filtering,
// ai_turns logging and the failure paths.
const NUZ = {
  id: "p1", kind: "project", revision: 1, status: "active", bots: ["eyad", "dubai"], project_ref: null,
  body: { name: "Wecon Nuznan", aliases: { banglish: ["nuznan"] }, region: "Dhaka", media: { photos: ["https://x.test/a.jpg"] } },
};
const reply = (o: object = {}) => JSON.stringify({ intent: "info", project_ref: null, language: "en", reply: "Which project are you interested in?", media: [], handoff: false, asked: [], used_item_ids: [], clarify: true, ...o });

function fakes(opts: { testMode?: boolean; numbers?: string[]; items?: any[]; messages?: any[]; model?: () => any; sendOk?: boolean; onSend?: (t: any) => void } = {}) {
  const t: Record<string, any[]> = {
    wa_bot_settings: [{ bot: "eyad", trainer_test_mode: opts.testMode ?? true, test_numbers: opts.numbers ?? ["8801711000001"] }],
    ai_trainer_items: opts.items ?? [NUZ], wa_messages: opts.messages ?? [], ai_conversation_state: [], ai_turns: [],
  };
  const sent: any[] = []; const modelReqs: any[] = []; let n = 0;
  const ports: LivePorts = {
    async callModel(req) { modelReqs.push(req); const x = opts.model ? opts.model() : reply(); return typeof x === "string" ? { ok: true, text: x, cost_usd: 0 } : x; },
    async select(path) {
      const [table, q] = path.split("?");
      let rows = [...(t[table] || [])];
      for (const part of (q || "").split("&")) { const m = /^(\w+)=eq\.(.+)$/.exec(part); if (m) rows = rows.filter((r) => String(r[m[1]]) === decodeURIComponent(m[2])); }
      if (/order=wa_timestamp\.desc/.test(q || "")) rows.sort((a, b) => String(b.wa_timestamp).localeCompare(String(a.wa_timestamp)));
      return rows;
    },
    async insert(table, row) { const r = { id: `t${++n}`, ...row }; t[table].push(r); return r; },
    async patch(table, filter, patch) { const [k, v] = filter.split("=eq."); const r = t[table].find((x) => String(x[k]) === decodeURIComponent(v)); if (r) Object.assign(r, patch); return !!r; },
    async upsert(table, row: any) { t[table] = t[table].filter((x) => x.conversation_id !== row.conversation_id); t[table].push(row); return true; },
    async send(to, msg) { sent.push({ to, ...msg }); opts.onSend?.(t); return opts.sendOk === false ? null : `wa${sent.length}`; },
    async sleep() {},
  };
  return { t, sent, modelReqs, ports };
}
const input = (o: Partial<LiveInput> = {}): LiveInput => ({ bot: "eyad", convId: "eyad:8801711000001@s.whatsapp.net", phone: "8801711000001", to: "8801711000001", text: "Nuznan location?", ad: { isAd: false }, replyModel: "m", allowMedia: true, ...o });

test("isTestNumber matches on the last 10 digits", () => {
  assert.equal(isTestNumber(["8801711000001"], "01711000001"), true);
  assert.equal(isTestNumber(["8801711000001"], "+880 1711-000001"), true);
  assert.equal(isTestNumber(["8801711000001"], "8801711000002"), false);
  assert.equal(isTestNumber([], "8801711000001"), false);
  assert.equal(isTestNumber(["8801711000001"], "12345"), false);
});

test("history keeps customer, bot and agent text; drops agent commands, notes and empty rows", () => {
  const h = historyFromMessages([
    { direction: "IN", body: "hi there", type: "text" },
    { direction: "OUT", body: "Hello!", type: "text", sender_name: "AI Agent" },
    { direction: "OUT", body: "/n wants a call tomorrow", type: "text", sender_name: "" },
    { direction: "OUT", body: "/t", type: "text", sender_name: "" },
    { direction: "OUT", body: "/fdh vip", type: "text", sender_name: "" },
    { direction: "OUT", body: "/sendjm", type: "text", sender_name: "" },
    { direction: "OUT", body: "I will call you at 5", type: "text", sender_name: "" },
    { direction: "OUT", body: "", caption: "Nuznan brochure", type: "document", sender_name: "AI Trainer" },
    { direction: "IN", body: "", caption: "", type: "image" },
  ]);
  assert.deepEqual(h, [
    { role: "customer", text: "hi there" },
    { role: "bot", text: "Hello!" },
    { role: "agent", text: "I will call you at 5" },
    { role: "bot", text: "Nuznan brochure" },
  ]);
});

test("a test number gets a core reply, logged to ai_turns with trace, state saved", async () => {
  const f = fakes({ model: () => reply({ intent: "location", project_ref: "p1", reply: "Wecon Nuznan is in Dhaka.", clarify: false }) });
  const r = await runTestTurn(input(), f.ports);
  assert.equal(r.outcome, "ok"); assert.equal(r.sent, 1);
  assert.deepEqual(f.sent, [{ to: "8801711000001", type: "text", text: "Wecon Nuznan is in Dhaka." }]);
  const turn = f.t.ai_turns[0];
  assert.equal(turn.outcome, "ok"); assert.ok(turn.finished_at); assert.ok(turn.snapshot_checksum);
  assert.deepEqual(turn.trace.wa_ids, ["wa1"]);
  assert.deepEqual((turn.trace.project as any).projects, ["p1"]);
  assert.equal(f.t.ai_conversation_state[0].state.active_project, "p1");
});

test("agent commands and notes never reach the model; the message being answered is not doubled", async () => {
  const conv = "eyad:8801711000001@s.whatsapp.net";
  const f = fakes({ messages: [
    { conversation_id: conv, direction: "IN", body: "price?", type: "text", wa_timestamp: "2026-10-18T01:00:00Z" },
    { conversation_id: conv, direction: "OUT", body: "/n VIP customer, call at 5", type: "text", sender_name: "", wa_timestamp: "2026-10-18T01:01:00Z" },
    { conversation_id: conv, direction: "OUT", body: "/fdh", type: "text", sender_name: "", wa_timestamp: "2026-10-18T01:02:00Z" },
    { conversation_id: conv, direction: "IN", body: "Nuznan location?", type: "text", wa_timestamp: "2026-10-18T01:03:00Z" },
  ] });
  await runTestTurn(input(), f.ports);
  const all = JSON.stringify(f.modelReqs[0].messages);
  assert.ok(!all.includes("/n") && !all.includes("VIP") && !all.includes("/fdh"), all);
  assert.equal(f.modelReqs[0].messages.length, 2, all); // "price?" + the new customer message
});

test("a number not on the list gets nothing sent and no model call", async () => {
  const f = fakes({ numbers: ["8801999999999"] });
  const r = await runTestTurn(input(), f.ports);
  assert.equal(r.outcome, "blocked_not_test_number"); assert.equal(f.sent.length, 0); assert.equal(f.modelReqs.length, 0);
  assert.equal(f.t.ai_turns[0].outcome, "blocked_not_test_number");
});

test("test mode off blocks the send even for a listed number", async () => {
  const f = fakes({ testMode: false });
  const r = await runTestTurn(input(), f.ports);
  assert.equal(r.outcome, "blocked_not_test_number"); assert.equal(f.sent.length, 0);
});

test("a recipient other than the sender is refused", async () => {
  const f = fakes();
  const r = await runTestTurn(input({ to: "8801855555555" }), f.ports);
  assert.equal(r.sent, 0); assert.equal(f.sent.length, 0);
});

test("a number removed from the list between sends stops the remaining sends", async () => {
  const f = fakes({
    model: () => reply({ intent: "photo", project_ref: "p1", reply: "Here are photos of Wecon Nuznan.", media: [{ type: "photo", project_ref: "p1" }], clarify: false }),
    onSend: (t) => { t.wa_bot_settings[0].test_numbers = []; },
  });
  const r = await runTestTurn(input(), f.ports);
  assert.equal(f.sent.length, 1, "only the text went out"); assert.equal(r.sent, 1);
  assert.deepEqual(f.t.ai_turns[0].trace.send_errors, ["recipient no longer allowed"]);
});

test("media is skipped when ai media is off", async () => {
  const f = fakes({ model: () => reply({ intent: "photo", project_ref: "p1", reply: "Photos of Wecon Nuznan.", media: [{ type: "photo", project_ref: "p1" }], clarify: false }) });
  await runTestTurn(input({ allowMedia: false }), f.ports);
  assert.deepEqual(f.sent.map((s) => s.type), ["text"]);
});

test("model error sends the fallback and logs the outcome", async () => {
  const f = fakes({ model: () => ({ ok: false, error: "OpenRouter 500" }) });
  const r = await runTestTurn(input(), f.ports);
  assert.equal(r.outcome, "fallback_model_error"); assert.equal(f.sent.length, 1);
  assert.equal(f.t.ai_turns[0].trace.model_error, "OpenRouter 500");
});

test("a failed Wasender send is logged as send_failed", async () => {
  const f = fakes({ sendOk: false });
  const r = await runTestTurn(input(), f.ports);
  assert.equal(r.outcome, "send_failed"); assert.equal(f.t.ai_turns[0].outcome, "send_failed");
});

test("invalid drafts block the turn without a model call", async () => {
  const f = fakes({ items: [{ ...NUZ, body: { name: "x" } }] });
  const r = await runTestTurn(input(), f.ports);
  assert.equal(r.outcome, "blocked_draft_errors"); assert.equal(f.modelReqs.length, 0); assert.equal(f.sent.length, 0);
});

test("a greeting gets no reply but is still logged", async () => {
  const f = fakes();
  const r = await runTestTurn(input({ text: "hello" }), f.ports);
  assert.equal(r.outcome, "skipped_greeting_new"); assert.equal(f.sent.length, 0); assert.equal(f.t.ai_turns[0].outcome, "skipped_greeting_new");
});

test("an exception is caught and logged, never thrown into the bot", async () => {
  const f = fakes(); f.ports.select = async () => { throw new Error("db down"); };
  const r = await runTestTurn(input(), f.ports);
  assert.equal(r.outcome, "error"); assert.equal(f.t.ai_turns[0].outcome, "error");
});
