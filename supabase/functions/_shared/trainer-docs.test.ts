// node --test — Markdown documents: chunking with section metadata, document
// retrieval feeding the turn with source traceability, grounding and failure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { freezeContent, runTurn, emptyState, buildPrompt, type ItemRow, type Ports } from "./trainer-core.ts";
import { markdownChunks, DOC_CHUNK } from "./trainer-docs.ts";

const NUZ = { id: "p-nuz", kind: "project", revision: 1, status: "active", bots: ["eyad", "dubai"], project_ref: null,
  body: { name: "Wecon Nuznan", aliases: { banglish: ["nuznan"], bn: ["নুজনান"] }, media: {} } } as ItemRow;
const C = freezeContent([NUZ], { reply_model: "m", max_tokens: 600, rubric_version: 1 }).content;
const MD = `# Wecon Nuznan

Residential project in Jolshiri Abashon, Dhaka.

## Location
- Sector 16, Jolshiri Abashon
- 10 minutes from Kuril flyover

## Apartment sizes
| Type | Size |
| --- | --- |
| A | 1,450 sqft |
| B | 1,850 sqft |

## Handover
Handover is planned for December 2027.`;

test("markdownChunks keeps the heading path, lists and tables, and never splits a table row", () => {
  const ch = markdownChunks(MD);
  const by = (s: string) => ch.find((c) => c.section === s)!;
  assert.deepEqual(ch.map((c) => c.section), ["Wecon Nuznan", "Wecon Nuznan > Location", "Wecon Nuznan > Apartment sizes", "Wecon Nuznan > Handover"]);
  assert.match(by("Wecon Nuznan > Location").text, /- Sector 16, Jolshiri Abashon\n- 10 minutes from Kuril flyover/);
  assert.match(by("Wecon Nuznan > Apartment sizes").text, /\| B \| 1,850 sqft \|/);
  assert.ok(ch.every((c) => c.text.startsWith(c.section)), "each chunk carries its section so it reads on its own");
  assert.deepEqual(ch.map((c) => c.chunk_no), [0, 1, 2, 3]);
});

test("a long section splits on paragraph or line boundaries under the limit, table rows intact", () => {
  const rows = Array.from({ length: 120 }, (_, i) => `| U${i} | ${1000 + i} sqft |`).join("\n");
  const ch = markdownChunks(`# P\n## Units\n| Unit | Size |\n| --- | --- |\n${rows}`);
  assert.ok(ch.length > 1);
  assert.ok(ch.every((c) => c.text.length <= DOC_CHUNK.maxChars));
  assert.ok(ch.every((c) => c.text.split("\n").filter((l) => l.startsWith("|")).every((l) => /^\|.*\|$/.test(l))), "no table row is cut");
  assert.equal(markdownChunks("   \n\n").length, 0);
});

const reply = (o: object) => JSON.stringify({ intent: "info", project_ref: "p-nuz", language: "en", reply: "", media: [], handoff: false, asked: [], used_item_ids: [], clarify: false, ...o });
const DOCHIT = { id: "c1", document_id: "d1", document_version: 2, chunk_no: 2, section: "Wecon Nuznan > Apartment sizes", title: "Nuznan fact sheet",
  chunk_text: "Wecon Nuznan > Apartment sizes\n| B | 1,850 sqft |", score: 0.83 };

test("document chunks reach the prompt with their source, ground the reply, and are traced", async () => {
  const calls: any[] = [];
  const ports: Ports = {
    callModel: async (req) => { calls.push(req); return { ok: true, text: reply({ reply: "Type B is 1,850 sqft." }), cost_usd: 0 }; },
    searchDocs: async (q) => { calls.push(["search", q]); return [DOCHIT]; },
  };
  const r = await runTurn({ content: C, bot: "eyad", text: "how big are nuznan flats", history: [], state: emptyState(), ad: { isAd: false }, returning: false, ports });
  assert.equal(r.outcome, "ok"); assert.equal(r.reply, "Type B is 1,850 sqft.");
  const sys = calls.find((c) => c.system)?.system as string;
  assert.ok(sys.includes("Document excerpts"));
  assert.ok(sys.includes("[doc:d1#2] Nuznan fact sheet, Wecon Nuznan > Apartment sizes"));
  assert.deepEqual(r.trace.documents, [{ id: "c1", document_id: "d1", version: 2, chunk_no: 2, section: "Wecon Nuznan > Apartment sizes", score: 0.83 }]);
  const search = calls.find((c) => c[0] === "search")[1];
  assert.equal(search.bot, "eyad"); assert.deepEqual(search.projects, ["p-nuz"]);
});

test("without the document excerpt the same figure is refused, so the excerpt is what grounds it", async () => {
  const ports: Ports = { callModel: async () => ({ ok: true, text: reply({ reply: "Type B is 1,850 sqft." }), cost_usd: 0 }), searchDocs: async () => [] };
  const r = await runTurn({ content: C, bot: "eyad", text: "how big are nuznan flats", history: [], state: emptyState(), ad: { isAd: false }, returning: false, ports });
  assert.notEqual(r.outcome, "ok"); assert.ok(!/1,850/.test(r.reply));
});

test("a failed document search is traced and the turn continues on the snapshot alone", async () => {
  const ports: Ports = {
    callModel: async () => ({ ok: true, text: reply({ reply: "Which size are you interested in?", clarify: true }), cost_usd: 0 }),
    searchDocs: async () => { throw new Error("embedding provider 503"); },
  };
  const r = await runTurn({ content: C, bot: "eyad", text: "how big are nuznan flats", history: [], state: emptyState(), ad: { isAd: false }, returning: false, ports });
  assert.equal(r.outcome, "ok");
  assert.deepEqual(r.trace.documents, { error: "embedding provider 503" });
});

test("no searchDocs port means no documents and no excerpt section", () => {
  const p = buildPrompt(C, "eyad", [], "x", emptyState(), [], "en");
  assert.ok(!p.system.includes("Document excerpts"));
});
