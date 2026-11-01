// Live price and availability for one project, read from the CRM's properties
// row (Projects → Available Units). Deno-free. Read-only: nothing here writes.
// Static knowledge never states current stock; only this read does, and its
// figures carry the time they were read.

export type InventoryType = { name: string; size: number; available: number; minPrice: number | null; maxPrice: number | null; unpriced: number };
export type Inventory = {
  propertyId: string; name: string; asOf: string;
  counts: { available: number; hold: number; sold: number; total: number };
  types: InventoryType[];
};

// Same rule as src/lib/projects.js: anything not 'sold' or 'available' is a hold.
const baseStatus = (s: unknown) => (s === "sold" ? "sold" : s === "available" ? "available" : "hold");
const unitSize = (u: any, v: any) => (u?.size > 0 ? u.size : v?.size || 0);
const unitPrice = (u: any, v: any) => (u?.price > 0 ? u.price : (v?.listRate || 0) * unitSize(u, v));
// Taka per sqft a Bangladesh unit can plausibly cost. Real CRM rows hold test
// values (price 43, size 108), so a figure outside this range is never shown.
const RATE = { min: 2000, max: 100000 };
const plausible = (price: number, size: number) => price > 0 && size > 0 && price / size >= RATE.min && price / size <= RATE.max;

export function inventoryFromRow(row: any, now: Date = new Date()): Inventory {
  const counts = { available: 0, hold: 0, sold: 0, total: 0 };
  const types: InventoryType[] = [];
  for (const v of Array.isArray(row?.variants) ? row.variants : []) {
    const prices: number[] = [];
    let available = 0, unpriced = 0;
    for (const u of Array.isArray(v?.units) ? v.units : []) {
      const s = baseStatus(u?.status);
      counts[s]++; counts.total++;
      if (s !== "available") continue;
      available++;
      const p = unitPrice(u, v);
      if (plausible(p, unitSize(u, v))) prices.push(p); else unpriced++;
    }
    types.push({ name: String(v?.name || "Unit"), size: Number(v?.size) || 0, available, unpriced,
      minPrice: prices.length ? Math.min(...prices) : null, maxPrice: prices.length ? Math.max(...prices) : null });
  }
  return { propertyId: String(row?.id ?? ""), name: String(row?.name ?? ""), asOf: now.toISOString(), counts, types };
}

// The text the model and the number guard see. A project with no units is
// unknown, so it is never presented as sold out.
// `prices: false` (the default) leaves every price out, so a rule that says
// "no exact price" cannot be overridden by what the CRM happens to hold.
export function inventoryEvidence(inv: Inventory, o: { prices?: boolean } = {}): string {
  if (!inv.counts.total) return `Live inventory for ${inv.name} (read ${inv.asOf}): no unit data. Do not state availability or price; offer a consultant.`;
  const price = (t: InventoryType) => !o.prices ? ""
    : t.minPrice ? `, price ${t.minPrice}${t.maxPrice !== t.minPrice ? ` to ${t.maxPrice}` : ""} taka${t.unpriced ? ` (${t.unpriced} without a verified price)` : ""}`
    : ", price not set";
  const lines = inv.types.filter((t) => t.available > 0).map((t) =>
    `- ${t.name}${t.size ? `, ${t.size} sqft` : ""}: ${t.available} available${price(t)}`);
  return [`Live inventory for ${inv.name} (read ${inv.asOf}): ${inv.counts.available} available, ${inv.counts.hold} on hold, ${inv.counts.sold} sold.`, ...lines].join("\n");
}

// One scoped read. Any failure is null (unavailable), never an empty inventory.
export async function lookupInventory(
  db: { select(path: string): Promise<any[]> }, a: { propertyId: string; companyId: string }, now: () => Date = () => new Date(),
): Promise<Inventory | null> {
  if (!a.propertyId || !a.companyId) return null;
  try {
    const row = (await db.select(`properties?id=eq.${encodeURIComponent(a.propertyId)}&company_id=eq.${encodeURIComponent(a.companyId)}&select=id,name,company_id,variants,updated_at`))[0];
    return row ? inventoryFromRow(row, now()) : null;
  } catch {
    return null;
  }
}
