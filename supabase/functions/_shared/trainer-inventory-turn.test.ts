import { test } from "node:test";
import assert from "node:assert/strict";
import { freezeContent, runTurn, emptyState, validateItem, type ItemRow, type Ports } from "./trainer-core.ts";
import { inventoryFromRow } from "./trainer-inventory.ts";

// Live price and availability reach the reply only through ports.inventory,
// and only for the resolved project. Synthetic data only.
const NUZ = { id: "p-nuz", kind: "project", revision: 1, status: "active", bots: ["eyad"], project_ref: null,
  body: { name: "Wecon Nuznan", aliases: { en: ["nuznan"] }, crm_property_id: "prop-1", media: {} } } as ItemRow;
// The live-price rule opts this project in (trainer-price-policy.test.ts covers the opt-out).
const LIVE_RULE = { id: "r-live", kind: "rule", revision: 1, status: "active", bots: ["eyad"], project_ref: null,
  body: { name: "Live price", when: "price asked", must: "quote the verified live price", parameters: { live_prices: "quote" } } } as ItemRow;
const CONTENT = freezeContent([NUZ, LIVE_RULE], { reply_model: "m", max_tokens: 2000, rubric_version: 1 }).content;
const LIVE = inventoryFromRow({ id: "prop-1", name: "Wecon Nuznan", variants: [{ name: "Type A", size: 1850, listRate: 9000,
  units: [{ id: "A1", status: "available" }, { id: "A2", status: "available" }, { id: "A3", status: "sold" }] }] }, new Date("2026-10-19T09:00:00Z"));

const out = (reply: string) => JSON.stringify({ intent: "price", project_ref: "p-nuz", language: "en", reply, media: [], handoff: false, asked: [], used_item_ids: [], clarify: false });
function ports(replies: string[], inventory?: Ports["inventory"]) {
  const systems: string[] = [];
  const p: Ports = { callModel: async (r) => { systems.push(r.system); return { ok: true, text: replies.shift() ?? out(""), cost_usd: 0 }; }, inventory };
  return { p, systems };
}
const turn = (p: Ports) => runTurn({ content: CONTENT, bot: "eyad", text: "nuznan price and availability?", history: [], state: emptyState(), ad: { isAd: false }, returning: false, ports: p });

test("a project may link to a CRM property", () => {
  assert.deepEqual(validateItem("project", NUZ.body), []);
});

test("live figures read this turn ground the reply and are shown to the model with their time", async () => {
  const seen: string[] = [];
  const { p, systems } = ports([out("Nuznan has 2 units available, from 16650000 taka.")], async (id) => { seen.push(id); return LIVE; });
  const r = await turn(p);
  assert.equal(r.outcome, "ok");
  assert.deepEqual(seen, ["prop-1"]);
  assert.match(systems[0], /Live inventory for Wecon Nuznan \(read 2026-10-19T09:00:00/);
  assert.equal((r.trace.inventory as any).available, 2);
});

test("without a live read, a stock or price figure falls back to a consultant", async () => {
  const none = ports([out("Nuznan has 2 units available."), out("2 units left.")], async () => null);
  const r = await turn(none.p);
  assert.equal(r.outcome, "fallback_invalid_output"); assert.equal(r.handoff, true);
  assert.match(none.systems[0], /Live inventory: unavailable/);
  const noPort = await turn(ports([out("Nuznan has 2 units available."), out("2 left.")]).p);
  assert.equal(noPort.outcome, "fallback_invalid_output");
});

test("the inventory port is not called when no project is resolved or the project has no CRM link", async () => {
  let calls = 0;
  const p: Ports = { callModel: async () => ({ ok: true, text: out("Which project are you interested in?"), cost_usd: 0 }), inventory: async () => { calls++; return LIVE; } };
  await runTurn({ content: CONTENT, bot: "eyad", text: "what is the price?", history: [], state: emptyState(), ad: { isAd: false }, returning: false, ports: p });
  const unlinked = freezeContent([{ ...NUZ, body: { ...NUZ.body, crm_property_id: undefined } }], { reply_model: "m", max_tokens: 600, rubric_version: 1 }).content;
  await runTurn({ content: unlinked, bot: "eyad", text: "nuznan price?", history: [], state: emptyState(), ad: { isAd: false }, returning: false, ports: p });
  assert.equal(calls, 0);
});

test("a failing inventory port never breaks the turn", async () => {
  const { p } = ports([out("Which unit type would you like?")], async () => { throw new Error("db down"); });
  const r = await turn(p);
  assert.equal(r.outcome, "ok");
  assert.equal((r.trace.inventory as any).error, "db down");
});
