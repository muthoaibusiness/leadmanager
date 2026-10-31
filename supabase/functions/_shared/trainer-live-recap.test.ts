import { test } from "node:test";
import assert from "node:assert/strict";
import { writeRecapNote, RECAP_NOTE_SOURCE, type LivePorts } from "./trainer-live.ts";

const PHONE = "8801604271958";
const LEAD = { id: "e6391d4f-48f4-4517-85f0-0cc86f2f264d", phone: PHONE, company_id: "c1" };
const DESC = "wants a shop, asked price; next step call";

// Minimal ports: leads + activities seeded, patch/upsert recorded.
function portsFor(seed: { leads: any[]; activities: any[] }) {
  const t: Record<string, any[]> = { leads: seed.leads, activities: seed.activities };
  const ops: string[] = [];
  const ports: LivePorts = {
    async callModel() { throw new Error("unused"); },
    async select(path) {
      const [table, q] = path.split("?");
      let rows = [...(t[table] || [])];
      for (const part of (q || "").split("&")) {
        const m = /^(\w+)=eq\.(.+)$/.exec(part);
        if (m) rows = rows.filter((r) => String(r[m[1]]) === decodeURIComponent(m[2]));
        const l = /^(\w+)=like\.\*(.+)$/.exec(part);
        if (l) rows = rows.filter((r) => String(r[l[1]] ?? "").endsWith(decodeURIComponent(l[2])));
      }
      if (/order=timestamp\.desc/.test(q || "")) rows.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
      return rows;
    },
    async insert(table, row: any) { const r = { id: "new", ...row }; t[table].push(r); ops.push(`insert:${table}`); return r; },
    async patch(table, filter, patch) { const [k, v] = filter.split("=eq."); const r = t[table].find((x) => String(x[k]) === decodeURIComponent(v)); if (r) Object.assign(r, patch); ops.push(`patch:${table}`); return !!r; },
    async upsert(table, row: any) { t[table].push(row); ops.push(`upsert:${table}`); return true; },
    async send() { throw new Error("unused"); },
    async sleep() {},
  };
  return { t, ops, ports };
}

test("writeRecapNote updates the existing recap NOTE in place", async () => {
  const note = { id: "n1", lead_id: LEAD.id, type: "NOTE", user_name: RECAP_NOTE_SOURCE, description: "old", timestamp: "2026-10-31T00:00:00Z" };
  const f = portsFor({ leads: [LEAD], activities: [note] });
  assert.equal(await writeRecapNote(f.ports, PHONE, DESC), true);
  assert.ok(f.ops.includes("patch:activities"));
  assert.equal(f.t.activities[0].description, DESC);
  assert.ok(f.t.activities[0].timestamp);
  assert.equal(f.t.activities.length, 1, "no duplicate row");
});

test("writeRecapNote inserts the first recap NOTE when none exists", async () => {
  const f = portsFor({ leads: [LEAD], activities: [] });
  assert.equal(await writeRecapNote(f.ports, PHONE, DESC), true);
  assert.ok(f.ops.includes("upsert:activities"));
  assert.equal(f.t.activities.length, 1);
  assert.equal(f.t.activities[0].user_name, RECAP_NOTE_SOURCE);
  assert.equal(f.t.activities[0].lead_id, LEAD.id);
  assert.equal(f.t.activities[0].company_id, "c1");
});

test("writeRecapNote is a no-op when the phone has no lead", async () => {
  const f = portsFor({ leads: [], activities: [] });
  assert.equal(await writeRecapNote(f.ports, PHONE, DESC), false);
  assert.equal(f.t.activities.length, 0);
});

// A UAE number shares the 9-digit tail 501234567 with a BD number; the suffix
// fetch returns the other company's lead, and nothing may be written on it.
test("writeRecapNote never writes on a lead that only shares the phone suffix", async () => {
  const f = portsFor({ leads: [{ id: "lead-uae", phone: "971501234567", company_id: "c2" }], activities: [] });
  assert.equal(await writeRecapNote(f.ports, "8801501234567", DESC), false);
  assert.equal(f.t.activities.length, 0);
});

test("writeRecapNote accepts a full-number match written in a different format", async () => {
  const f = portsFor({ leads: [{ id: "lead-bd", phone: "01604271958", company_id: "c1" }], activities: [] });
  assert.equal(await writeRecapNote(f.ports, PHONE, DESC), true);
  assert.equal(f.t.activities[0].lead_id, "lead-bd");
});
