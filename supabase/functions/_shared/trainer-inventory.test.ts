import { test } from "node:test";
import assert from "node:assert/strict";
import { inventoryFromRow, inventoryEvidence, lookupInventory } from "./trainer-inventory.ts";

// A properties row as Projects → Available Units stores it (variants[].units[]).
// Synthetic data only.
const ROW = {
  id: "prop-1", name: "Wecon Nuznan", company_id: "c1", updated_at: "2026-10-19T08:00:00Z",
  variants: [
    { id: "v-a", name: "Type A", size: 1850, listRate: 9000, units: [
      { id: "A1", status: "available" }, { id: "A2", status: "sold" }, { id: "A3", status: "hold" },
      { id: "A4", status: "available", size: 1900, price: 18000000 },
    ] },
    { id: "v-b", name: "Type B", size: 2400, listRate: 0, units: [{ id: "B1", status: "available" }] },
  ],
};

test("counts units by base status and prices only units that have a price", () => {
  const inv = inventoryFromRow(ROW, new Date("2026-10-19T09:00:00Z"));
  assert.deepEqual(inv.counts, { available: 3, hold: 1, sold: 1, total: 5 });
  const a = inv.types.find((t) => t.name === "Type A")!;
  // A1: 1850 × 9000 = 16,650,000; A4 has its own 18,000,000.
  assert.deepEqual([a.available, a.minPrice, a.maxPrice], [2, 16650000, 18000000]);
  const b = inv.types.find((t) => t.name === "Type B")!;
  assert.equal(b.minPrice, null, "a zero list rate is no price, not 0 taka");
  assert.equal(inv.asOf, "2026-10-19T09:00:00.000Z");
});

test("an implausible unit price or size is left out, never shown as a price", () => {
  // Real Shafiq Sapphire data on 2026-10-19: unit A1 price 43, size 108; A2 price 57900.
  const row = { id: "ss", name: "Shafiq Sapphire", variants: [{ name: "Block A", size: 1460, listRate: 7500, units: [
    { id: "A1", status: "available", price: 43, size: 108 }, { id: "A2", status: "available", price: 57900, size: 1200 },
    { id: "A3", status: "available", price: 1200000, size: 1600 }, { id: "A4", status: "available" },
  ] }] };
  const t = inventoryFromRow(row, new Date("2026-10-19T09:00:00Z")).types[0];
  // A3 at 750 taka/sqft is also implausible; A4 uses the list rate: 1460 × 7500 = 10,950,000.
  assert.deepEqual([t.available, t.minPrice, t.maxPrice, t.unpriced], [4, 10950000, 10950000, 3]);
  const ev = inventoryEvidence(inventoryFromRow(row, new Date("2026-10-19T09:00:00Z")), { prices: true });
  assert.doesNotMatch(ev, /\b43\b|57900|1200000/);
  assert.match(ev, /10950000/);
  assert.match(ev, /3 without a verified price/);
});

test("without the price opt-in the evidence carries counts and no price at all", () => {
  const ev = inventoryEvidence(inventoryFromRow(ROW, new Date("2026-10-19T09:00:00Z")));
  assert.match(ev, /3 available/);
  assert.doesNotMatch(ev, /16650000|18000000|taka|price/);
});

test("a project with no units is unknown, never 'sold out'", () => {
  const inv = inventoryFromRow({ ...ROW, variants: [] }, new Date("2026-10-19T09:00:00Z"));
  assert.equal(inv.counts.total, 0);
  assert.match(inventoryEvidence(inv), /no unit data/i);
  assert.doesNotMatch(inventoryEvidence(inv), /sold out|0 available/i);
});

test("evidence states figures with their read time, so the guard can ground them", () => {
  const ev = inventoryEvidence(inventoryFromRow(ROW, new Date("2026-10-19T09:00:00Z")), { prices: true });
  assert.match(ev, /3 available/); assert.match(ev, /16650000/); assert.match(ev, /2026-10-19T09:00:00/);
});

test("lookupInventory reads only the linked properties row, scoped by company", async () => {
  const seen: string[] = [];
  const select = async (path: string) => { seen.push(path); return path.includes("id=eq.prop-1") && path.includes("company_id=eq.c1") ? [ROW] : []; };
  const inv = await lookupInventory({ select }, { propertyId: "prop-1", companyId: "c1" }, () => new Date("2026-10-19T09:00:00Z"));
  assert.equal(inv?.counts.available, 3);
  assert.equal(seen.length, 1);
  assert.equal(await lookupInventory({ select }, { propertyId: "prop-1", companyId: "c2" }), null, "another company's row is not returned");
  assert.equal(await lookupInventory({ select }, { propertyId: "", companyId: "c1" }), null);
});

test("a failed read is reported as unavailable, not as zero stock", async () => {
  const inv = await lookupInventory({ select: async () => { throw new Error("db down"); } }, { propertyId: "prop-1", companyId: "c1" });
  assert.equal(inv, null);
});
