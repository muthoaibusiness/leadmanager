import { test } from "node:test";
import assert from "node:assert/strict";
import { _internals } from "./trainer-handler.ts";
import { lookupInventory } from "./trainer-inventory.ts";

// Company isolation for live inventory: the only path from a turn to a
// properties row is lookupInventory, and it always filters by company.
const ROWS = [
  { id: "prop-1", name: "Ours", company_id: "c1", variants: [{ name: "A", size: 1000, listRate: 5000, units: [{ id: "A1", status: "available" }] }] },
  { id: "prop-2", name: "Theirs", company_id: "c2", variants: [{ name: "B", size: 1000, listRate: 9000, units: [{ id: "B1", status: "available" }, { id: "B2", status: "available" }] }] },
];
// A PostgREST stand-in that honours eq. filters, so a missing filter would leak.
const db = {
  paths: [] as string[],
  async select(path: string) {
    this.paths.push(path);
    const [table, q] = path.split("?");
    if (table !== "properties") return [];
    let rows = [...ROWS];
    for (const part of (q || "").split("&")) { const m = /^(\w+)=eq\.(.+)$/.exec(part); if (m) rows = rows.filter((r: any) => String(r[m[1]]) === decodeURIComponent(m[2])); }
    return rows;
  },
};

test("a linked property of another company is never read, even by id", async () => {
  assert.equal(await lookupInventory(db, { propertyId: "prop-2", companyId: "c1" }), null);
  assert.equal((await lookupInventory(db, { propertyId: "prop-1", companyId: "c1" }))?.counts.available, 1);
});

test("every properties read the trainer makes carries the company filter", async () => {
  db.paths.length = 0;
  const deps: any = { db, llm: { chat: async () => ({ ok: false, error: "x" }) }, env: { budgetUsd: 1, replyModel: "m", judgeModel: "j", pricePerMTok: { in: 1, out: 1 }, companyId: "c1" } };
  await _internals.portsFor(deps).inventory!("prop-2");
  await _internals.portsFor(deps).inventory!("prop-1");
  assert.equal(db.paths.length, 2);
  assert.ok(db.paths.every((p) => p.includes("company_id=eq.c1")), db.paths.join("\n"));
});

test("an id carrying a filter of its own cannot widen the read", async () => {
  // Unencoded, "prop-2&company_id=eq.c2" would add a second company_id filter;
  // PostgREST would AND it with c1 and return nothing, but "&or=(...)" could widen it.
  db.paths.length = 0;
  await lookupInventory(db, { propertyId: "prop-2&or=(company_id.eq.c2)", companyId: "c1" });
  const q = db.paths[0].split("?")[1];
  const params = new URLSearchParams(q);
  assert.equal(params.get("or"), null, "the id became a filter of its own");
  assert.deepEqual([...params.keys()].filter((k) => k !== "select"), ["id", "company_id"]);
});
