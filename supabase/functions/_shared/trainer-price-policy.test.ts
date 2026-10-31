import { test } from "node:test";
import assert from "node:assert/strict";
import { freezeContent, runTurn, emptyState, buildPrompt, type ItemRow, type Ports } from "./trainer-core.ts";
import { inventoryFromRow } from "./trainer-inventory.ts";

// Why the Shafiq Sapphire price was not used (2026-10-19, real data):
// 1. the CRM unit prices were test values (43 taka); fixed in trainer-inventory.
// 2. the live rules say a non-Jolshiri price question gets a meeting offer, and
//    "unit availability is not in the catalog". The model obeyed them over the
//    live inventory. Live figures now win only where a rule allows them.
const SS = { id: "p-ss", kind: "project", revision: 1, status: "active", bots: ["eyad"], project_ref: null,
  body: { name: "Shafiq Sapphire", aliases: { en: ["sapphire"] }, crm_property_id: "prop-ss", media: {} } } as ItemRow;
const NO_PRICE_RULE = { id: "r-price", kind: "rule", revision: 1, status: "active", bots: ["eyad"], project_ref: null,
  body: { name: "Price", when: "price asked", must: "for a non-Jolshiri project, offer a meeting instead of a price" } } as ItemRow;
const LIVE_OK_RULE = { ...NO_PRICE_RULE, id: "r-live", body: { name: "Live price", when: "price asked", must: "quote the live inventory price when one is verified", parameters: { live_prices: "quote" } } } as ItemRow;
const LIVE = inventoryFromRow({ id: "prop-ss", name: "Shafiq Sapphire", variants: [{ name: "Block B", size: 1460, listRate: 7500, units: [{ id: "B1", status: "available" }] }] }, new Date("2026-10-19T09:00:00Z"));
const NOPRICE = inventoryFromRow({ id: "prop-ss", name: "Shafiq Sapphire", variants: [{ name: "Block B", size: 1460, listRate: 0, units: [{ id: "B1", status: "available" }] }] }, new Date("2026-10-19T09:00:00Z"));
const out = (reply: string) => JSON.stringify({ intent: "price", project_ref: "p-ss", language: "en", reply, media: [], handoff: false, asked: [], used_item_ids: [], clarify: false });
const content = (rules: ItemRow[]) => freezeContent([SS, ...rules], { reply_model: "m", max_tokens: 2000, rubric_version: 1 }).content;
const run = (c: any, inv: any, replies: string[]) => {
  const systems: string[] = [];
  const ports: Ports = { callModel: async (r) => { systems.push(r.system); return { ok: true, text: replies.shift() ?? out(""), cost_usd: 0 }; }, inventory: async () => inv };
  return runTurn({ content: c, bot: "eyad", text: "sapphire price?", history: [], state: emptyState(), ad: { isAd: false }, returning: false, ports }).then((r) => ({ r, systems }));
};

test("when a rule allows live prices, the verified price is offered and grounds the reply", async () => {
  const { r, systems } = await run(content([LIVE_OK_RULE]), LIVE, [out("Block B units are 10950000 taka. Shall I set a meeting?")]);
  assert.equal(r.outcome, "ok");
  assert.match(systems[0], /may quote the live inventory price/i);
  assert.match(systems[0], /10950000/);
});

test("when the rules say no price, the live price is not even shown to the model", async () => {
  const { r, systems } = await run(content([NO_PRICE_RULE]), LIVE, [out("Block B is 10950000 taka."), out("It is 10950000.")]);
  assert.doesNotMatch(systems[0], /10950000/, "price hidden from the model");
  assert.match(systems[0], /4 available|1 available/);
  assert.equal(r.outcome, "fallback_invalid_output", "a price it was not shown is refused");
});

test("with no verified price, a figure is never invented, even when live prices are allowed", async () => {
  const { r, systems } = await run(content([LIVE_OK_RULE]), NOPRICE, [out("It is about 1 crore."), out("Roughly 95 lakh.")]);
  assert.match(systems[0], /price not set/);
  assert.equal(r.outcome, "fallback_invalid_output");
});

test("the policy is explicit in the prompt, not left to the model", () => {
  const sys = buildPrompt(content([NO_PRICE_RULE]), "eyad", [], "sapphire price?", emptyState(), ["p-ss"], "en", "Live inventory for Shafiq Sapphire (read t): 1 available.").system;
  assert.match(sys, /do not quote a price/i);
});
