import { test } from "node:test";
import assert from "node:assert/strict";
import { backfillCustomer } from "./trainer-backfill.ts";

// History comes only from the CRM's own wa_messages; Wasender has no inbound
// history API. Synthetic data only.
const msg = (id: string, conv: string, dir: "IN" | "OUT", body: string, ts: string, wa_id: string | null = null, sender_name: string | null = null) =>
  ({ id, conversation_id: conv, direction: dir, type: "text", body, caption: null, wa_id, sender_name, wa_timestamp: ts });

function db(rows: any[], convs: any[]) {
  const paths: string[] = [];
  return {
    paths,
    async select(path: string) {
      paths.push(path);
      const [table, q] = path.split("?");
      const p = new URLSearchParams(q);
      if (table === "wa_conversations") return convs.filter((c) => c.account === p.get("account")?.replace("eq.", "") && String(c.phone).endsWith(String(p.get("phone")).replace("like.*", "")));
      if (table !== "wa_messages") throw new Error(`unexpected table ${table}`);
      const ids = String(p.get("conversation_id")).replace(/^in\.\(|\)$/g, "").split(",").map((x) => decodeURIComponent(x).replace(/^"|"$/g, ""));
      // PostgREST `or=(wa_timestamp.gt."T",and(wa_timestamp.eq."T",id.gt."I"))`, ordered by (wa_timestamp, id).
      const cur = /wa_timestamp\.gt\."([^"]+)",and\(wa_timestamp\.eq\."[^"]+",id\.gt\."([^"]+)"\)/.exec(p.get("or") || "");
      const limit = Number(p.get("limit"));
      return rows.filter((r) => ids.includes(r.conversation_id) && (!cur || r.wa_timestamp > cur[1] || (r.wa_timestamp === cur[1] && r.id > cur[2])))
        .sort((a, b) => a.wa_timestamp.localeCompare(b.wa_timestamp) || a.id.localeCompare(b.id)).slice(0, limit);
    },
  };
}

const CONVS = [
  { id: "eyad:8801711000001@s.whatsapp.net", account: "eyad", phone: "8801711000001" },
  { id: "eyad:555@lid", account: "eyad", phone: "8801711000001" },
  { id: "eyad:971711000001@s.whatsapp.net", account: "eyad", phone: "971711000001" },
];

test("merges every thread of the same customer in time order, paging through all rows", async () => {
  const rows = [
    msg("1", CONVS[0].id, "IN", "nuznan price?", "2026-10-01T10:00:00Z"),
    msg("2", CONVS[1].id, "IN", "and location?", "2026-10-02T10:00:00Z"),
    msg("3", CONVS[0].id, "OUT", "Which floor?", "2026-10-01T10:01:00Z", null, "AI Agent"),
  ];
  const d = db(rows, CONVS);
  const r = await backfillCustomer(d, { bot: "eyad", phone: "01711000001", pageSize: 2 });
  assert.deepEqual(r.turns.map((t) => t.text), ["nuznan price?", "Which floor?", "and location?"]);
  assert.deepEqual(r.threads.sort(), [CONVS[0].id, CONVS[1].id].sort());
  assert.ok(d.paths.filter((p) => p.startsWith("wa_messages")).length >= 2, "paged");
});

test("messages that share a timestamp across a page edge are all kept", async () => {
  const ts = "2026-10-01T10:00:00Z";
  const rows = ["a", "b", "c", "d"].map((x) => msg(x, CONVS[0].id, "IN", `m-${x}`, ts));
  const r = await backfillCustomer(db(rows, CONVS), { bot: "eyad", phone: "8801711000001", pageSize: 2 });
  assert.deepEqual(r.turns.map((t) => t.text).sort(), ["m-a", "m-b", "m-c", "m-d"]);
});

test("a foreign number sharing the last 10 digits is not merged", async () => {
  const rows = [msg("1", CONVS[2].id, "IN", "uae customer", "2026-10-01T10:00:00Z")];
  const r = await backfillCustomer(db(rows, CONVS), { bot: "eyad", phone: "8801711000001" });
  assert.equal(r.turns.length, 0);
});

test("the same WhatsApp message stored twice (bot mirror and echo) appears once", async () => {
  const rows = [
    msg("1", CONVS[0].id, "OUT", "Which floor?", "2026-10-01T10:01:00Z", "wa-9", "AI Agent"),
    msg("2", CONVS[0].id, "OUT", "Which floor?", "2026-10-01T10:01:02Z", "wa-9"),
  ];
  const r = await backfillCustomer(db(rows, CONVS), { bot: "eyad", phone: "8801711000001" });
  assert.equal(r.turns.length, 1); assert.equal(r.duplicates, 1);
});

test("agent commands and notes are dropped; a cap bounds the result", async () => {
  const rows = Array.from({ length: 30 }, (_, i) => msg(String(i), CONVS[0].id, "IN", `q${i}`, `2026-10-01T10:${String(i).padStart(2, "0")}:00Z`));
  rows.push(msg("c", CONVS[0].id, "OUT", "/fdh wants call", "2026-10-01T11:00:00Z"));
  const r = await backfillCustomer(db(rows, CONVS), { bot: "eyad", phone: "8801711000001", maxTurns: 10 });
  assert.equal(r.turns.length, 10);
  assert.equal(r.turns.at(-1)!.text, "q29", "keeps the most recent");
  assert.ok(!r.turns.some((t) => t.text.startsWith("/")));
});

test("no history is a clean empty result, and a read failure says so", async () => {
  const empty = await backfillCustomer(db([], CONVS), { bot: "eyad", phone: "8801799999999" });
  assert.deepEqual([empty.turns.length, empty.status], [0, "none"]);
  const broken = await backfillCustomer({ select: async () => { throw new Error("db down"); } }, { bot: "eyad", phone: "8801711000001" });
  assert.equal(broken.status, "unavailable");
});
