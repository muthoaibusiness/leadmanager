// AI Trainer core. Every rule of the trainer's reply path lives here, with no
// Deno or browser dependency, so the Edge Function, the bots (at cutover) and
// the Node test runner all execute the same code. Design:
// docs/superpowers/specs/2026-10-18-wecon-ai-trainer-design.md
//
// Bump CORE_VERSION on any change that can alter a reply, a verdict or a
// checksum. Test runs and published snapshots are certified per version.

export const CORE_VERSION = "1.7.0";

import { docExcerpts, type DocHit } from "./trainer-docs.ts";
import { inventoryEvidence, type Inventory } from "./trainer-inventory.ts";

export type Kind = "project" | "fact" | "rule" | "behaviour" | "example";
export type Bot = "eyad" | "dubai";
export const KINDS: Kind[] = ["project", "fact", "rule", "behaviour", "example"];
export const BOTS: Bot[] = ["eyad", "dubai"];

// ── canonical JSON and checksums ────────────────────────────────────────────
// Keys sorted recursively, array order kept, no whitespace. The checksum of a
// snapshot is sha256 over this string, so two runtimes agree byte for byte.
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const checksumOf = (content: unknown) => sha256Hex(canonicalJson(content));
export const contentHash = (kind: Kind, body: unknown) => sha256Hex(`${kind}|${canonicalJson(body)}`);

// ── item schemas ────────────────────────────────────────────────────────────
// A small hand-rolled validator: each field is [type, required]. Unknown keys
// are errors, so a typo in the editor cannot silently drop content.
type FieldType = "string" | "string[]" | "number" | "object" | "turns" | "aliases" | "media" | "params";
type Shape = Record<string, [FieldType, boolean]>;

const SHAPES: Record<Kind, Shape> = {
  project: {
    name: ["string", true], aliases: ["aliases", true], region: ["string", false], type: ["string", false],
    address: ["string", false], size_text: ["string", false], tags: ["string[]", false], media: ["media", true],
    send_code: ["string", false], legacy_wa_project_id: ["number", false], crm_property_id: ["string", false],
  },
  fact: { topic: ["string", true], text: ["string", true], source: ["string", false], languages: ["string[]", false] },
  rule: {
    name: ["string", true], when: ["string", true], must: ["string", true], must_not: ["string", false],
    parameters: ["params", false], priority: ["number", false],
  },
  behaviour: { aspect: ["string", true], instruction: ["string", true], do: ["string[]", false], dont: ["string[]", false] },
  example: {
    conversation: ["turns", true], original_reply: ["string", false], ideal_reply: ["string", true],
    reason: ["string", true], source: ["string", true], source_ref: ["string", false], language: ["string", false],
  },
};

const ASPECTS = ["tone", "language", "greeting", "discovery", "pricing", "objection", "meeting", "handoff"];
const SOURCES = ["playground", "real", "handwritten"];
const isStr = (x: unknown) => typeof x === "string";
const isStrArr = (x: unknown) => Array.isArray(x) && x.every(isStr);

function checkField(t: FieldType, v: unknown): boolean {
  switch (t) {
    case "string": return isStr(v);
    case "string[]": return isStrArr(v);
    case "number": return typeof v === "number" && Number.isFinite(v);
    case "object": return !!v && typeof v === "object" && !Array.isArray(v);
    case "params": return !!v && typeof v === "object" && !Array.isArray(v) &&
      Object.values(v as object).every((x) => isStr(x) || typeof x === "number");
    case "turns": return Array.isArray(v) && v.length > 0 && v.every((t) =>
      t && typeof t === "object" && ["customer", "bot", "agent"].includes((t as any).role) && isStr((t as any).text));
    case "aliases": return !!v && typeof v === "object" &&
      ["bn", "banglish", "en"].every((k) => (v as any)[k] === undefined || isStrArr((v as any)[k]));
    case "media": {
      if (!v || typeof v !== "object") return false;
      const m = v as any;
      const urlOk = (u: unknown) => u === undefined || u === "" || (isStr(u) && /^https?:\/\//.test(u as string));
      return (m.photos === undefined || (isStrArr(m.photos) && m.photos.every(urlOk))) &&
        (m.floor_plans === undefined || (Array.isArray(m.floor_plans) && m.floor_plans.every((p: any) =>
          p && typeof p === "object" && urlOk(p.url) && isStr(p.url) && (p.label === undefined || isStr(p.label))))) &&
        urlOk(m.brochure) && urlOk(m.map_image) && urlOk(m.video);
    }
  }
}

export function validateItem(kind: Kind, body: unknown): string[] {
  const shape = SHAPES[kind];
  if (!shape) return [`unknown kind: ${kind}`];
  if (!body || typeof body !== "object" || Array.isArray(body)) return ["body must be an object"];
  const b = body as Record<string, unknown>;
  const errs: string[] = [];
  for (const k of Object.keys(b)) if (!shape[k]) errs.push(`unknown field: ${k}`);
  for (const [k, [t, req]] of Object.entries(shape)) {
    const v = b[k];
    if (v === undefined || v === null) { if (req) errs.push(`${k} is required`); continue; }
    if (!checkField(t, v)) errs.push(`${k} has the wrong type`);
    else if (t === "string" && req && !(v as string).trim()) errs.push(`${k} is required`);
  }
  if (kind === "behaviour" && isStr(b.aspect) && !ASPECTS.includes(b.aspect as string)) errs.push("aspect is not allowed");
  if (kind === "example" && isStr(b.source) && !SOURCES.includes(b.source as string)) errs.push("source is not allowed");
  return errs;
}

// ── scope ───────────────────────────────────────────────────────────────────
export function validateScope(kind: Kind, bots: unknown, projectRef: unknown, activeProjectIds: Set<string>): string[] {
  const errs: string[] = [];
  if (!Array.isArray(bots) || bots.length === 0 || !bots.every((b) => BOTS.includes(b as Bot)) ||
      new Set(bots).size !== bots.length) {
    errs.push("bots must be a non-empty subset of eyad, dubai");
  }
  if (projectRef !== null && projectRef !== undefined) {
    if (kind === "project" || kind === "behaviour") errs.push(`${kind} items cannot be project-scoped`);
    else if (!isStr(projectRef) || !activeProjectIds.has(projectRef as string)) errs.push("project_ref is not an active project");
  }
  return errs;
}

export function itemApplies(item: { bots: Bot[]; project_ref: string | null }, bot: Bot, resolved: string[]): boolean {
  if (!item.bots.includes(bot)) return false;
  return item.project_ref === null || resolved.includes(item.project_ref);
}

// ── snapshot freeze ─────────────────────────────────────────────────────────
export type ItemRow = {
  id: string; kind: Kind; revision: number; status: "active" | "retired";
  bots: Bot[]; project_ref: string | null; body: any;
};
// "vector" pins the embedding model and the exact chunk ids (spec 4.3 rule 2),
// so a rollback reproduces retrieval scope as well as content.
export type Retrieval = { mode: "full" } | { mode: "vector"; embedding_model: string; embedding_dim: number; chunk_ids: string[]; k: number };
export type SnapshotContent = {
  schema: 1; projects: ItemRow[]; items: ItemRow[]; retrieval: Retrieval;
  model_config: { reply_model: string; max_tokens: number }; prompt_version: string;
  rubric: { key: string; version: number };
  // The operator's System Prompt per bot (migration 0046), absent when none is set.
  system_prompts?: Partial<Record<Bot, { id: string; version_no: number; sha256: string; body: string }>>;
};
export const PROMPT_VERSION = "p1";

const norm = (s: string) => s.normalize("NFC").replace(/[\u200B-\u200D\uFEFF]/g, "").toLowerCase().trim();

function aliasesOf(p: ItemRow): string[] {
  const a = p.body?.aliases || {};
  return [p.body?.name, ...(a.bn || []), ...(a.banglish || []), ...(a.en || [])]
    .filter((x) => typeof x === "string" && x.trim()).map(norm);
}

// Copies active rows by value, sorted by id, so the content (and its checksum)
// depends only on what is active, not on load order.
export function freezeContent(
  rows: ItemRow[], cfg: { reply_model: string; max_tokens: number; rubric_version: number },
): { content: SnapshotContent; errors: string[] } {
  const active = rows.filter((r) => r.status === "active");
  const byId = (a: ItemRow, b: ItemRow) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const projects = active.filter((r) => r.kind === "project").sort(byId);
  const items = active.filter((r) => r.kind !== "project").sort(byId);
  const errors: string[] = [];
  const pids = new Set(projects.map((p) => p.id));
  for (const r of active) {
    for (const e of validateItem(r.kind, r.body)) errors.push(`${r.kind} ${r.id}: ${e}`);
    if (r.project_ref && !pids.has(r.project_ref)) errors.push(`${r.kind} ${r.id}: project ${r.project_ref} is not in the snapshot`);
  }
  const seen = new Map<string, string>();
  for (const p of projects) for (const a of new Set(aliasesOf(p))) {
    const other = seen.get(a);
    if (other && other !== p.id) errors.push(`alias "${a}" is used by ${other} and ${p.id}`);
    seen.set(a, p.id);
  }
  const strip = (r: ItemRow): ItemRow => ({
    id: r.id, kind: r.kind, revision: r.revision, status: r.status, bots: [...r.bots].sort() as Bot[],
    project_ref: r.project_ref, body: r.body,
  });
  return {
    errors,
    content: {
      schema: 1, projects: projects.map(strip), items: items.map(strip), retrieval: { mode: "full" },
      model_config: { reply_model: cfg.reply_model, max_tokens: cfg.max_tokens },
      prompt_version: PROMPT_VERSION, rubric: { key: "sales-default", version: cfg.rubric_version },
    },
  };
}

// ── language ────────────────────────────────────────────────────────────────
const BANGLISH = ["ami", "apni", "apnar", "koto", "dam", "taka", "ache", "achhe", "chai", "den", "dao", "kothay",
  "jomi", "kemon", "er", "ki", "na", "hobe", "korte", "bolen", "dite", "pathan", "kobe", "kono", "shob", "sob"];

export function detectLanguage(text: string): "bn" | "banglish" | "en" {
  const t = norm(text);
  const letters = [...t].filter((c) => /\p{L}/u.test(c));
  if (!letters.length) return "en";
  const bangla = letters.filter((c) => /[ঀ-৿]/.test(c)).length;
  if (bangla / letters.length >= 0.3 || bangla >= 2) return "bn";
  const words = t.split(/[^a-z]+/).filter(Boolean);
  const hits = words.filter((w) => BANGLISH.includes(w)).length;
  return hits >= 1 && hits / words.length >= 0.2 ? "banglish" : "en";
}

// ── conversation state and project resolution ───────────────────────────────
export type Turn = { role: "customer" | "bot" | "agent"; text: string };
export type ConvState = {
  active_project: string | null; active_source: "explicit" | "ad" | "state" | null;
  language: "bn" | "banglish" | "en" | null; first_price_at: Record<string, string>; asked: string[]; paused: boolean;
};
export const emptyState = (): ConvState => ({
  active_project: null, active_source: null, language: null, first_price_at: {}, asked: [], paused: false,
});

// A word that is a common English word never resolves a project on its own;
// it only counts as part of a longer alias such as "summer breeze".
const GENERIC = new Set(["summer", "arcade", "heritage", "breeze", "wecon", "mall", "manor", "orchid", "dale"]);

// \p{M} is kept: Bangla vowel signs and the hasanta are combining marks, and
// dropping them would split a word like "ওসমান" in two.
function mentioned(text: string, projects: ItemRow[]): string[] {
  const t = ` ${norm(text).replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")} `;
  const hit = new Set<string>();
  for (const p of projects) {
    for (const a of aliasesOf(p)) {
      const alias = a.replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim();
      if (!alias || GENERIC.has(alias)) continue;
      if (t.includes(` ${alias} `) || (/[ঀ-৿]/.test(alias) && t.includes(alias))) { hit.add(p.id); break; }
    }
  }
  return [...hit];
}

export function resolveProject(
  text: string, state: ConvState, ad: { isAd: boolean; adText?: string }, projects: ItemRow[],
): { projects: string[]; source: "explicit" | "state" | "ad" | null; ambiguous: boolean } {
  const named = mentioned(text, projects);
  if (named.length) return { projects: named, source: "explicit", ambiguous: false };
  if (state.active_project && projects.some((p) => p.id === state.active_project)) {
    return { projects: [state.active_project], source: "state", ambiguous: false };
  }
  if (ad.isAd && ad.adText) {
    const fromAd = mentioned(ad.adText, projects);
    if (fromAd.length === 1) return { projects: fromAd, source: "ad", ambiguous: false };
    if (fromAd.length > 1) return { projects: [], source: null, ambiguous: true };
  }
  return { projects: [], source: null, ambiguous: false };
}

// ── history ────────────────────────────────────────────────────────────────
// Agent commands (/f…, /n…, /t) and empty rows never reach the model; human
// agent messages are labelled as the sales agent, not as the bot.
export function buildHistory(rows: Turn[], limit = 20): Turn[] {
  return rows.filter((r) => r.text && r.text.trim() && !(r.role === "agent" && r.text.trim().startsWith("/")))
    .slice(-limit);
}

// Retrieval, spec 5.1 "full" mode: rules, behaviour and facts in full; examples ranked.
const STOP = new Set(["the", "is", "an", "of", "to", "and", "in", "er", "ki", "na", "কি", "এর"]);
const tokensOf = (s: string) => new Set(norm(s).split(/[^\p{L}\p{M}\p{N}]+/u)
  .filter((w) => [...w].length >= 2 && !STOP.has(w)));
const exampleText = (e: ItemRow) => `${e.body?.conversation?.filter((t: Turn) => t.role === "customer").at(-1)?.text ?? ""} ${e.body?.ideal_reply ?? ""}`;

// Shared tokens plus 2 when query and document name the same project.
// Sales intents a customer asks about, in English, Banglish and Bangla. A query
// and a document that share an intent score as if they shared 3 words, so a
// paraphrase ("koto taka lagbe") still finds the price fact. Patterns are
// matched on normalised text; Bangla needs no word boundary.
const INTENTS: Record<string, RegExp[]> = {
  price: [/\b(price|prices|pricing|cost|costs|pay|budget|rate|how much|total)\b/, /\b(dam|daam|taka|koto taka|budget)\b/, /(দাম|টাকা|খরচ|মূল্য|বাজেট)/],
  location: [/\b(where|location|located|address|area|neighbou?rhood|whereabouts)\b/, /\b(kothay|kothai|jayga|jaiga|thikana|kon dike|kon elaka|elaka)\b/, /(কোথায়|ঠিকানা|এলাকা|অবস্থান|লোকেশন)/],
  size: [/\b(size|sqft|square|feet|big|large|bedroom|bed|katha)\b/, /\b(koto boro|boro|sqft|ghor|rum|room|katha)\b/, /(সাইজ|বড়|স্কয়ার|ফিট|কাঠা|বেডরুম|রুম)/],
  amenities: [/\b(amenit\w*|facilit\w*|pool|swim|gym|parking|park|lift|elevator|generator|garden|playground|mosque|security)\b/, /\b(suvidha|subidha|gari|lift|generator)\b/, /(সুবিধা|গাড়ি|পার্কিং|লিফট|জেনারেটর|সুইমিং|জিম)/],
  availability: [/\b(available|availability|left|vacant|unsold|in stock|remaining|still)\b/, /\b(baki|khali|ache ki|paowa jabe|pawa jabe|ekhono)\b/, /(বাকি|খালি|পাওয়া|এখনো|এখনও)/],
  media: [/\b(photo|photos|picture|pictures|pic|pics|image|images|brochure|video)\b/, /\b(chobi|chhobi|photo|pic)\b/, /(ছবি|ব্রোশিওর|ভিডিও|ফটো)/],
};
export function intentsOf(text: string): Set<string> {
  const t = norm(text);
  return new Set(Object.entries(INTENTS).filter(([, rs]) => rs.some((r) => r.test(t))).map(([k]) => k));
}

export function lexicalScore(query: string, doc: string, projects: ItemRow[]): number {
  const q = tokensOf(query);
  let n = 0;
  for (const w of tokensOf(doc)) if (q.has(w)) n++;
  const qi = intentsOf(query);
  if (qi.size) for (const i of intentsOf(doc)) if (qi.has(i)) n += 3;
  const qp = mentioned(query, projects);
  return n + (qp.length && mentioned(doc, projects).some((id) => qp.includes(id)) ? 2 : 0);
}

export function rankByScore(rows: ItemRow[], text: (r: ItemRow) => string, query: string, projects: ItemRow[]): { row: ItemRow; score: number }[] {
  return rows.map((row) => ({ row, score: lexicalScore(query, text(row), projects) }))
    .sort((a, b) => b.score - a.score || (a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0));
}

// Synchronous "full" selection. Vector snapshots go through retrieve(), which
// falls back here; calling this directly on one is a programming error.
export function retrieveContext(content: SnapshotContent, bot: Bot, text: string, resolved: string[]): {
  items: ItemRow[]; examples: ItemRow[]; trace: { mode: "full"; examples: { id: string; score: number }[] };
} {
  if ((content.retrieval?.mode as string) !== "full") throw new Error(`retrieval mode "${content.retrieval?.mode}" is not implemented`);
  return fullSelection(content, bot, text, resolved);
}

function fullSelection(content: SnapshotContent, bot: Bot, text: string, resolved: string[]) {
  const scoped = content.items.filter((i) => itemApplies(i, bot, resolved));
  const top = rankByScore(scoped.filter((i) => i.kind === "example"), exampleText, text, content.projects).slice(0, 6);
  return {
    items: scoped.filter((i) => i.kind !== "example"), examples: top.map((x) => x.row),
    trace: { mode: "full" as const, examples: top.map((x) => ({ id: x.row.id, score: x.score })) },
  };
}

// Facts and examples become chunks (spec 5.2); rules and behaviour are always
// sent in full and never chunked. 1,600 characters stays under 512 tokens.
export type Chunk = { item_id: string; item_revision: number; chunk_no: number; chunk_text: string };
const CHUNK_CHARS = 1600;
export function chunksFor(item: ItemRow): Chunk[] {
  const text = item.kind === "fact" ? `${item.body.topic}: ${item.body.text}`
    : item.kind === "example" ? exampleText(item) : "";
  if (!text.trim()) return [];
  const words = text.split(/\s+/); const parts: string[] = []; let cur = "";
  for (const w of words) {
    if (cur && cur.length + 1 + w.length > CHUNK_CHARS) { parts.push(cur); cur = ""; }
    cur = cur ? `${cur} ${w}` : w.slice(0, CHUNK_CHARS);
  }
  if (cur) parts.push(cur);
  return parts.map((chunk_text, chunk_no) => ({ item_id: item.id, item_revision: item.revision, chunk_no, chunk_text }));
}

export type RetrievalTrace = { mode: "full" | "vector"; examples?: { id: string; score: number }[]; chunks?: { id: string; score: number }[]; fallback?: string };

// Per-turn selection. Vector mode needs both ports; any failure falls back to
// "full" for this turn (spec 6.6 ok_retrieval_fallback), never to nothing.
export async function retrieve(content: SnapshotContent, bot: Bot, text: string, resolved: string[], ports: Ports): Promise<{ items: ItemRow[]; examples: ItemRow[]; trace: RetrievalTrace }> {
  const r = content.retrieval;
  if (r.mode !== "vector") return fullSelection(content, bot, text, resolved);
  const fallback = (why: string) => { const f = fullSelection(content, bot, text, resolved); return { ...f, trace: { ...f.trace, fallback: why } }; };
  if (!ports.embed || !ports.matchChunks) return fallback("no vector ports");
  try {
    const q = await ports.embed(r.embedding_model, text);
    if (q.length !== r.embedding_dim) return fallback(`embedding has ${q.length} dimensions, snapshot expects ${r.embedding_dim}`);
    const hits = await ports.matchChunks({ chunkIds: r.chunk_ids, model: r.embedding_model, query: q, bot, projects: resolved, k: r.k });
    const scoped = content.items.filter((i) => itemApplies(i, bot, resolved));
    // A hit counts only when it is a chunk of an item revision frozen in this snapshot.
    const pinned = new Map(scoped.map((i) => [`${i.id}@${i.revision}`, i]));
    const hitItems = [...new Map(hits.map((h) => pinned.get(`${h.item_id}@${h.item_revision}`)).filter((i): i is ItemRow => !!i).map((i) => [i.id, i])).values()];
    return {
      items: [...scoped.filter((i) => i.kind === "rule" || i.kind === "behaviour"), ...hitItems.filter((i) => i.kind === "fact")],
      examples: hitItems.filter((i) => i.kind === "example").slice(0, 6),
      trace: { mode: "vector", chunks: hits.map((h) => ({ id: h.id, score: h.score })) },
    };
  } catch (e) {
    return fallback(e instanceof Error ? e.message : String(e));
  }
}

// ── prompt ──────────────────────────────────────────────────────────────────
export type ModelOut = {
  intent: string; project_ref: string | null; language: "bn" | "banglish" | "en"; reply: string;
  media: { type: "photo" | "floorplan" | "brochure" | "map"; project_ref: string; floor?: string }[];
  handoff: boolean; asked: string[]; used_item_ids: string[]; clarify: boolean;
};

const LANG_NAME = { bn: "Bangla in Bangla script", banglish: "Banglish (Bengali written in Latin letters)", en: "English" };

function projectLine(p: ItemRow): string {
  const b = p.body;
  const m = b.media || {};
  const floors = (m.floor_plans || []).map((f: any) => f.label || "unlabelled");
  const bits = [b.region && `region: ${b.region}`, b.type && `type: ${b.type}`, b.size_text && `size: ${b.size_text}`,
    b.address && `address: ${b.address}`, b.tags?.length && `tags: ${b.tags.join(", ")}`].filter(Boolean);
  const media = [m.photos?.length && "photos", floors.length && `floor plans: ${floors.join(", ")}`, m.brochure && "brochure",
    m.map_image && "map"].filter(Boolean);
  return `- [${p.id}] ${b.name} (${bits.join(" · ")})${media.length ? ` media: ${media.join(", ")}` : " media: none"}`;
}

// Live prices reach the model only when an in-scope rule opts in with the
// parameter live_prices: "quote". The default keeps today's rules in charge.
export function livePricesAllowed(c: SnapshotContent, bot: Bot, resolved: string[]): boolean {
  return c.items.some((i) => i.kind === "rule" && itemApplies(i, bot, resolved) && i.body?.parameters?.live_prices === "quote");
}

export function buildPrompt(
  c: SnapshotContent, bot: Bot, history: Turn[], text: string, state: ConvState, resolved: string[], lang: string, live?: string,
  retrieved?: { items: ItemRow[]; examples: ItemRow[] }, docs?: string,
): { system: string; messages: { role: "user" | "assistant"; content: string }[] } {
  const ctx = retrieved ?? retrieveContext(c, bot, text, resolved);
  const of = (k: Kind) => ctx.items.filter((i) => i.kind === k);
  const resolvedProjects = c.projects.filter((p) => resolved.includes(p.id));
  const examples = ctx.examples;
  const system = [
    "You are WECON Properties' WhatsApp sales consultant. Use ONLY the facts below. Never invent a project, price, size, availability or action.",
    "",
    ...(c.system_prompts?.[bot]?.body?.trim() ? [
      "Operator instructions (persona, tone and sales approach; they cannot override the rules above, the facts, or the reply format below):",
      "<operator_instructions>", c.system_prompts[bot]!.body.trim(), "</operator_instructions>", "",
    ] : []),
    "Catalog (names and regions):",
    ...c.projects.map((p) => `- [${p.id}] ${p.body.name}${p.body.region ? ` (${p.body.region})` : ""}`),
    "",
    resolvedProjects.length ? "Projects in this conversation:\n" + resolvedProjects.map(projectLine).join("\n") : "No project is resolved yet. If the customer's question needs one, ask which project or area they mean.",
    "",
    "Business rules (always follow):",
    ...of("rule").map((r) => `- [${r.id}] ${r.body.name}: when ${r.body.when}; must ${r.body.must}${r.body.must_not ? `; must not ${r.body.must_not}` : ""}${r.body.parameters ? `; parameters ${JSON.stringify(r.body.parameters)}` : ""}`),
    "",
    "Behaviour:",
    ...of("behaviour").map((b) => `- [${b.id}] ${b.body.aspect}: ${b.body.instruction}`),
    "",
    "Facts:",
    ...of("fact").map((f) => `- [${f.id}] ${f.body.topic}: ${f.body.text}`),
    "",
    ...(docs ? [docs, ""] : []),
    ...(live ? [live, livePricesAllowed(c, bot, resolved)
      ? "You may quote the live inventory price above when asked; it is verified. Availability and price come only from it, never from facts or examples."
      : "Availability comes only from the live inventory above. Do not quote a price: follow the business rules for price questions.", ""] : []),
    examples.length ? "Examples of good replies:\n" + examples.map((e) => `- [${e.id}] customer: "${e.body.conversation.at(-1)?.text ?? ""}" -> ideal: "${e.body.ideal_reply}"`).join("\n") : "",
    "",
    `Conversation state: ${JSON.stringify({ active_project: state.active_project, first_price_given_for: Object.keys(state.first_price_at), already_asked: state.asked })}`,
    `Reply in ${LANG_NAME[lang as keyof typeof LANG_NAME] ?? "English"}. Short, friendly, no emoji. Do not ask again for anything in already_asked.`,
    "Never say you cannot answer and stop. Never say a person has been informed or that anything was booked or sent.",
    "Only request media that the project lists. Use project ids from the catalog.",
    'Return STRICT JSON only: {"intent": string, "project_ref": string|null, "language": "bn"|"banglish"|"en", "reply": string, "media": [{"type": "photo"|"floorplan"|"brochure"|"map", "project_ref": string, "floor"?: string}], "handoff": boolean, "asked": [string], "used_item_ids": [string], "clarify": boolean}',
  ].join("\n");
  const messages = [
    ...history.map((h) => ({ role: (h.role === "customer" ? "user" : "assistant") as "user" | "assistant",
      content: h.role === "agent" ? `[sales agent] ${h.text}` : h.text })),
    { role: "user" as const, content: `<customer_message>\n${text}\n</customer_message>` },
  ];
  return { system, messages };
}

// ── output parsing and guards ───────────────────────────────────────────────
export function parseModelOutput(raw: string): ModelOut | null {
  const t = String(raw || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s === -1 || e <= s) return null;
  try {
    const o = JSON.parse(t.slice(s, e + 1));
    if (typeof o?.reply !== "string" || !["bn", "banglish", "en"].includes(o.language)) return null;
    return {
      intent: String(o.intent || ""), project_ref: typeof o.project_ref === "string" ? o.project_ref : null,
      language: o.language, reply: o.reply, handoff: o.handoff === true, clarify: o.clarify === true,
      media: Array.isArray(o.media) ? o.media.filter((m: any) => m && ["photo", "floorplan", "brochure", "map"].includes(m.type) && typeof m.project_ref === "string") : [],
      asked: Array.isArray(o.asked) ? o.asked.filter(isStr) : [],
      used_item_ids: Array.isArray(o.used_item_ids) ? o.used_item_ids.filter(isStr) : [],
    };
  } catch { return null; }
}

const REFUSAL = [/parbo\s*na/i, /bolte\s*parbo/i, /confirm\s*korte\s*parbo/i, /can'?t\s+(tell|discuss|share|say)/i,
  /cannot\s+(tell|discuss|share|say)/i, /বলতে\s*পারব\s*না/, /পারব\s*না/];
const CLAIM = [/\binformed\b/i, /\bnotified\b/i, /jaanie\s*dichi/i, /janiye\s*dichi/i, /\bbooked\b/i, /have\s+sent/i,
  /জানিয়ে\s*দিয়েছি/];
// "I can't say the price, but I can set a meeting" is the rule's own answer;
// the guard targets a reply that refuses and stops (spec 6.2 step 8).
const NEXT_STEP = [/meeting/i, /\bagent\b/i, /consultant/i, /brochure/i, /\bcall\b/i, /মিটিং/, /এজেন্ট/, /কনসালট্যান্ট/, /ব্রোশি?উ?র/];
const refusesAndStops = (r: string) => REFUSAL.some((x) => x.test(r)) && !NEXT_STEP.some((x) => x.test(r));

// The model transliterates "Wecon" as ওয়েকন (both encodings of য়); the
// company writes উইকন. Fixed in code because a prompt instruction did not hold.
const brandSpelling = (s: string) => s.replace(/ও(?:য়|য়)েকন/g, "উইকন");

// Bangla digits (০-৯) fold to ASCII so "৫০" is checked as "50".
const asciiDigits = (s: string) => s.replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6));

// "3-4 crore" yields "3 crore" and "4 crore"; units fold to one spelling.
const MONEY_UNIT: Record<string, string> = { crore: "crore", cr: "crore", "কোটি": "crore", lakh: "lakh", lac: "lakh", lakhs: "lakh", "লাখ": "lakh", "লক্ষ": "lakh",
  taka: "taka", tk: "taka", bdt: "taka", "টাকা": "taka", "৳": "taka" };
function moneyIn(s: string): string[] {
  const out: string[] = [];
  const re = /(\d+(?:[.,]\d+)?)(?:\s*(?:-|–|to|থেকে)\s*(\d+(?:[.,]\d+)?))?\s*(crore|cr|lakhs?|lac|taka|tk|bdt|কোটি|লাখ|লক্ষ|টাকা|৳)(?![a-z])/gi;
  for (const m of asciiDigits(s).matchAll(re)) {
    const u = MONEY_UNIT[m[3].toLowerCase()] ?? m[3];
    out.push(`${m[1]} ${u}`); if (m[2]) out.push(`${m[2]} ${u}`);
  }
  for (const m of asciiDigits(s).matchAll(/৳\s*(\d+(?:[.,]\d+)?)/g)) out.push(`${m[1]} taka`);
  return out;
}

export function guardReply(out: ModelOut, c: SnapshotContent, resolved: string[], evidenceText: string): string[] {
  const errs: string[] = [];
  const r = out.reply;
  if (refusesAndStops(r)) errs.push("refusal");
  if (CLAIM.some((x) => x.test(r))) errs.push("claim");
  const numbersIn = (s: string) => asciiDigits(s).match(/\d+(?:[.,]\d+)?/g) || [];
  const ev = new Set(numbersIn(evidenceText));
  if (numbersIn(r).some((n) => !ev.has(n))) errs.push("number");
  // A money figure needs the same figure with a money unit in the evidence, so
  // "16 crore" is not grounded by "Sector 16" nor "2 lakh" by "2 available".
  else {
    const evMoney = new Set(moneyIn(evidenceText));
    if (moneyIn(r).some((m) => !evMoney.has(m))) errs.push("number");
  }
  const ids = new Set(c.projects.map((p) => p.id));
  if ((out.project_ref && !ids.has(out.project_ref)) || out.media.some((m) => !resolved.includes(m.project_ref))) errs.push("project");
  if (r.trim()) {
    const scriptBn = /[ঀ-৿]/.test(r);
    if (out.language === "bn" && !scriptBn) errs.push("script");
    if (out.language !== "bn" && scriptBn) errs.push("script");
  }
  return errs;
}

// ── media ───────────────────────────────────────────────────────────────────
export type MediaAction = { type: "image" | "document"; url: string; caption: string; kind: string; project_ref: string; floor?: string };

export function resolveMedia(out: ModelOut, c: SnapshotContent): { actions: MediaAction[]; missing: string[]; clarify: string | null } {
  const actions: MediaAction[] = []; const missing: string[] = []; let clarify: string | null = null;
  for (const m of out.media) {
    const p = c.projects.find((x) => x.id === m.project_ref);
    if (!p) { missing.push(m.type); continue; }
    const md = p.body.media || {}; const name = p.body.name;
    if (m.type === "photo") {
      if (md.photos?.length) md.photos.slice(0, 3).forEach((u: string) => actions.push({ type: "image", url: u, caption: name, kind: "photo", project_ref: p.id }));
      else missing.push("photo");
    } else if (m.type === "map") {
      if (md.map_image) actions.push({ type: "image", url: md.map_image, caption: `${name} location`, kind: "map", project_ref: p.id });
      else missing.push("map");
    } else if (m.type === "brochure") {
      if (md.brochure) actions.push({ type: "document", url: md.brochure, caption: `${name} brochure`, kind: "brochure", project_ref: p.id });
      else missing.push("brochure");
    } else {
      const plans: { url: string; label?: string }[] = md.floor_plans || [];
      if (!plans.length) { missing.push("floorplan"); continue; }
      const want = norm(m.floor || "");
      if (want === "all" || want === "sob" || want === "shob") {
        plans.slice(0, 10).forEach((f) => actions.push({ type: "image", url: f.url, caption: `${name} ${f.label || "floor plan"}`, kind: "floorplan", project_ref: p.id, floor: f.label }));
        continue;
      }
      const hit = want ? plans.find((f) => f.label && (norm(f.label) === want || norm(f.label).startsWith(want) || want.startsWith(norm(f.label)))) : undefined;
      if (hit) actions.push({ type: "image", url: hit.url, caption: `${name} ${hit.label}`, kind: "floorplan", project_ref: p.id, floor: hit.label });
      else clarify = `Which floor plan would you like for ${name}: ${plans.map((f) => f.label || "unlabelled").join(", ")}?`;
    }
  }
  return { actions, missing, clarify };
}

// ── turn ────────────────────────────────────────────────────────────────────
export type Ports = {
  callModel: (req: { model: string; max_tokens: number; system: string; messages: { role: "user" | "assistant"; content: string }[] }) =>
    Promise<{ ok: true; text: string; cost_usd: number } | { ok: false; error: string }>;
  // Live stock and price for a project's crm_property_id; null when unavailable.
  inventory?: (crmPropertyId: string) => Promise<Inventory | null>;
  // Vector retrieval (migration 0045 ai_match_chunks). Both or neither.
  embed?: (model: string, text: string) => Promise<number[]>;
  // Approved Markdown documents (migration 0047): the server embeds the query
  // with the configured embedding model and returns scoped chunks.
  searchDocs?: (a: { text: string; bot: Bot; projects: string[] }) => Promise<DocHit[]>;
  matchChunks?: (a: { chunkIds: string[]; model: string; query: number[]; bot: Bot; projects: string[]; k: number }) =>
    Promise<{ id: string; item_id: string; item_revision: number; chunk_no: number; chunk_text: string; score: number }[]>;
};
export type TurnResult = { reply: string; media: MediaAction[]; handoff: boolean; stateNext: ConvState; outcome: string; trace: Record<string, unknown> };

export const FALLBACK = {
  bn: "ধন্যবাদ। আমাদের একজন কনসালট্যান্ট শিগগিরই আপনার সাথে যোগাযোগ করবেন।",
  banglish: "Dhonnobad. Amader ekjon consultant khub shiggiri apnar sathe jogajog korben.",
  en: "Thank you. One of our consultants will get back to you shortly.",
};
const GREETING = [/^(hi|hello|hey|salam|assalamu ?alaikum|as-?salamu ?alaikum|good (morning|evening|afternoon)|kemon achen)[\s!.?]*$/i,
  /^(আসসালামু আলাইকুম|সালাম|হাই|হ্যালো|কেমন আছেন)[\s!.?।]*$/];
const WANTS_PERSON = [/(agent|manush|human|person|consultant).*(kotha|talk|speak)/i, /(kotha|talk|speak).*(agent|manush|human|person)/i,
  /(এজেন্ট|মানুষ).*কথা/];

export async function runTurn(a: {
  content: SnapshotContent; bot: Bot; text: string; history: Turn[]; state: ConvState;
  ad: { isAd: boolean; adText?: string }; returning: boolean; ports: Ports;
}): Promise<TurnResult> {
  const lang = detectLanguage(a.text);
  const sp = a.content.system_prompts?.[a.bot];
  const trace: Record<string, unknown> = { core_version: CORE_VERSION, language: lang,
    system_prompt: sp ? { id: sp.id, version_no: sp.version_no, sha256: sp.sha256 } : null };
  const base = { ...a.state, language: lang };
  const t = norm(a.text);
  if (GREETING.some((g) => g.test(t))) {
    trace.pre = "greeting";
    return { reply: "", media: [], handoff: false, stateNext: base, outcome: a.returning ? "skipped_greeting" : "skipped_greeting_new", trace };
  }
  if (WANTS_PERSON.some((g) => g.test(a.text))) {
    trace.pre = "wants_person";
    return { reply: FALLBACK[lang], media: [], handoff: true, stateNext: { ...base, paused: true }, outcome: "handoff_requested", trace };
  }
  const res = resolveProject(a.text, a.state, a.ad, a.content.projects);
  trace.project = res;
  const history = buildHistory(a.history);
  // Live stock and price only for a single resolved project linked to a CRM property.
  const linked = res.projects.length === 1 ? a.content.projects.find((p) => p.id === res.projects[0])?.body?.crm_property_id : undefined;
  const NO_LIVE = "Live inventory: unavailable. Do not state current availability or price; offer a consultant.";
  let live: string | undefined;
  if (linked) {
    live = NO_LIVE;
    trace.inventory = { property: linked, unavailable: true };
    try {
      const inv = a.ports.inventory ? await a.ports.inventory(linked) : null;
      if (inv) {
        live = inventoryEvidence(inv, { prices: livePricesAllowed(a.content, a.bot, res.projects) });
        trace.inventory = { property: inv.propertyId, as_of: inv.asOf, available: inv.counts.available, total: inv.counts.total };
      }
    } catch (e) {
      trace.inventory = { property: linked, error: e instanceof Error ? e.message : String(e) };
    }
  }
  const ctx = await retrieve(a.content, a.bot, a.text, res.projects, a.ports);
  // Approved document chunks for this turn; a failed search is traced and the
  // turn continues on the snapshot alone, never on invented text.
  let docHits: DocHit[] = [];
  if (a.ports.searchDocs) {
    try {
      docHits = await a.ports.searchDocs({ text: a.text, bot: a.bot, projects: res.projects });
      trace.documents = docHits.map((h) => ({ id: h.id, document_id: h.document_id, version: h.document_version, chunk_no: h.chunk_no, title: h.title, section: h.section, score: h.score }));
    } catch (e) { trace.documents = { error: e instanceof Error ? e.message : String(e) }; }
  }
  const prompt = buildPrompt(a.content, a.bot, history, a.text, a.state, res.projects, lang, live, ctx, docExcerpts(docHits));
  const scoped = [...ctx.items, ...ctx.examples];
  trace.items_in_scope = scoped.map((i) => `${i.id}@${i.revision}`);
  trace.retrieval = ctx.trace;
  // Snapshot content and this turn's live read only: a figure the customer typed is not evidence.
  const evidence = [...scoped.map((i) => JSON.stringify(i.body)), ...a.content.projects.filter((p) => res.projects.includes(p.id)).map((p) => JSON.stringify(p.body)),
    ...docHits.map((h) => h.chunk_text), live ?? ""].join("\n");
  const req = { model: a.content.model_config.reply_model, max_tokens: a.content.model_config.max_tokens, system: prompt.system, messages: prompt.messages };
  let cost = 0; let errors: string[] = []; let parsed: ModelOut | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const msgs = attempt === 0 ? req.messages : [...req.messages, { role: "user" as const, content: `Your previous answer was rejected (${errors.join(", ")}). Return corrected STRICT JSON only.` }];
    const r = await a.ports.callModel({ ...req, messages: msgs });
    if (!r.ok) { trace.model_error = r.error; trace.cost_usd = cost; return { reply: FALLBACK[lang], media: [], handoff: true, stateNext: { ...base, paused: true }, outcome: "fallback_model_error", trace }; }
    cost += r.cost_usd;
    parsed = parseModelOutput(r.text);
    errors = parsed ? guardReply(parsed, a.content, res.projects, evidence) : ["schema"];
    if (!errors.length) break;
  }
  trace.cost_usd = cost; trace.guard_errors = errors;
  if (!parsed || errors.length) {
    return { reply: FALLBACK[lang], media: [], handoff: true, stateNext: { ...base, paused: true }, outcome: "fallback_invalid_output", trace };
  }
  const media = resolveMedia(parsed, a.content);
  // The model's citations are kept only when they name something it was shown.
  const shown = new Set([...scoped.map((i) => i.id), ...res.projects]);
  trace.media_missing = media.missing; trace.used_item_ids = parsed.used_item_ids.filter((id) => shown.has(id)); trace.intent = parsed.intent;
  const text = brandSpelling(parsed.reply);
  const reply = media.clarify ? `${text}${text ? "\n" : ""}${media.clarify}` : text;
  const active = res.projects.length === 1 ? res.projects[0] : (parsed.project_ref && res.projects.includes(parsed.project_ref) ? parsed.project_ref : a.state.active_project);
  const stateNext: ConvState = {
    ...base, active_project: active, active_source: res.projects.length ? res.source : a.state.active_source,
    asked: [...new Set([...a.state.asked, ...parsed.asked])].slice(-20),
    first_price_at: parsed.intent === "price" && active && !a.state.first_price_at[active]
      ? { ...a.state.first_price_at, [active]: "now" } : a.state.first_price_at,
    paused: parsed.handoff ? true : a.state.paused,
  };
  return { reply, media: media.actions, handoff: parsed.handoff, stateNext, outcome: "ok", trace };
}

// ── tests and verdicts ──────────────────────────────────────────────────────
export type Check = { type: string; value?: unknown };
export type TestSpec = {
  title: string; setup: { isAd: boolean; adText?: string; returning: boolean; state?: Partial<ConvState> };
  conversation: Turn[]; target: string; checks: Check[]; ideal_reply: string; judge: "rubric" | "none";
  exact_required?: string; samples?: number;
};
const CHECK_TYPES = ["language_is", "no_reply", "project_resolved_is", "asks_clarification", "media_action", "no_media",
  "handoff", "must_contain_exact", "must_not_contain", "uses_item", "max_length"];

export function validateTestSpec(s: unknown): string[] {
  const e: string[] = [];
  const t = s as TestSpec;
  if (!t || typeof t !== "object") return ["spec must be an object"];
  if (!isStr(t.title) || !t.title.trim()) e.push("title is required");
  if (!isStr(t.target) || !t.target.trim()) e.push("target is required");
  if (!t.setup || typeof t.setup.isAd !== "boolean" || typeof t.setup.returning !== "boolean") e.push("setup.isAd and setup.returning are required");
  else if (t.setup.state !== undefined && (!t.setup.state || typeof t.setup.state !== "object" || Array.isArray(t.setup.state))) e.push("setup.state must be an object");
  if (!Array.isArray(t.conversation) || !t.conversation.every((x) => x && ["customer", "bot", "agent"].includes(x.role) && isStr(x.text))) e.push("conversation is invalid");
  if (!Array.isArray(t.checks)) e.push("checks must be a list");
  else for (const c of t.checks) {
    if (!CHECK_TYPES.includes(c?.type)) e.push(`unknown check: ${c?.type}`);
    if (c?.type === "must_contain_exact" && !(isStr(t.exact_required) && t.exact_required.trim())) e.push("must_contain_exact needs exact_required with a reason");
  }
  if (!["rubric", "none"].includes(t.judge)) e.push("judge must be rubric or none");
  if (t.judge === "rubric" && !(isStr(t.ideal_reply) && t.ideal_reply.trim())) e.push("ideal_reply is required for the judge");
  if (t.samples !== undefined && ![1, 3].includes(t.samples)) e.push("samples must be 1 or 3");
  return e;
}

export function runChecks(spec: TestSpec, r: TurnResult): { type: string; pass: boolean; detail?: string }[] {
  const out: { type: string; pass: boolean; detail?: string }[] = [];
  const lang = (r.trace.language as string) || detectLanguage(r.reply);
  out.push({ type: "mandatory:refusal", pass: !refusesAndStops(r.reply) });
  out.push({ type: "mandatory:claim", pass: !CLAIM.some((x) => x.test(r.reply)) });
  out.push({ type: "mandatory:outcome", pass: !["fallback_invalid_output"].includes(r.outcome), detail: r.outcome });
  const resolved = ((r.trace.project as any)?.projects as string[]) || [];
  for (const c of spec.checks) {
    const v = c.value as any;
    switch (c.type) {
      case "language_is": out.push({ type: c.type, pass: lang === v, detail: lang }); break;
      case "no_reply": out.push({ type: c.type, pass: !r.reply.trim() }); break;
      case "project_resolved_is": out.push({ type: c.type, pass: v === null ? resolved.length === 0 : resolved.length === 1 && resolved[0] === v, detail: resolved.join(",") }); break;
      case "asks_clarification": out.push({ type: c.type, pass: /\?|？|কি\b/.test(r.reply) }); break;
      case "media_action": out.push({ type: c.type, pass: r.media.filter((m) => m.kind === v.kind && (!v.project_ref || m.project_ref === v.project_ref) && (!v.floor || m.floor === v.floor)).length >= (v.count ?? 1) }); break;
      case "no_media": out.push({ type: c.type, pass: r.media.length === 0 }); break;
      case "handoff": out.push({ type: c.type, pass: r.handoff === v }); break;
      case "must_contain_exact": out.push({ type: c.type, pass: r.reply.includes(String(v)) }); break;
      case "must_not_contain": out.push({ type: c.type, pass: !norm(r.reply).includes(norm(String(v))) }); break;
      case "uses_item": out.push({ type: c.type, pass: ((r.trace.used_item_ids as string[]) || []).includes(String(v)) }); break;
      case "max_length": out.push({ type: c.type, pass: r.reply.length <= Number(v) }); break;
    }
  }
  return out;
}

export type JudgeAttempt = { verdict: "pass" | "fail" | "inconclusive"; rationale: string; error?: string };

export function judgeVerdict(attempts: JudgeAttempt[]): "pass" | "fail" | "inconclusive" {
  if (attempts.length === 1) return attempts[0].verdict === "pass" ? "pass" : "inconclusive";
  const n = (v: string) => attempts.filter((a) => a.verdict === v).length;
  if (n("pass") >= 2) return "pass";
  if (n("fail") >= 2) return "fail";
  return "inconclusive";
}

export function finalVerdict(checks: { pass: boolean }[], judge: "none" | "pass" | "fail" | "inconclusive" | "skipped"): "PASS" | "FAIL" | "INCONCLUSIVE" {
  if (checks.some((c) => !c.pass)) return "FAIL";
  if (judge === "none" || judge === "pass") return "PASS";
  if (judge === "fail") return "FAIL";
  return "INCONCLUSIVE";
}

export const RUBRIC_V1 = `Rubric sales-default v1. Score each 1-5:
answered: the reply answers the customer's actual question.
context: uses earlier turns; does not re-ask what is known.
correct: every statement is supported by the facts given; nothing invented.
tone: natural, short, friendly, in the customer's language.
sales: moves the sale forward (discovery question or meeting offer) when appropriate.
verdict "pass" only if no criterion is below 3 and "correct" is at least 4. "inconclusive" if you cannot tell.`;

export function buildJudgePrompt(spec: TestSpec, r: TurnResult, rubric: string) {
  return {
    system: `You grade one WhatsApp sales reply. ${rubric}\nReturn STRICT JSON only: {"verdict": "pass"|"fail"|"inconclusive", "criteria": {"answered": n, "context": n, "correct": n, "tone": n, "sales": n}, "rationale": string}`,
    messages: [{ role: "user" as const, content: JSON.stringify({
      conversation: spec.conversation, customer_message: spec.target, reply: r.reply,
      media_sent: r.media.map((m) => ({ kind: m.kind, floor: m.floor })), ideal_reply: spec.ideal_reply }) }],
  };
}

export function parseJudge(raw: string): JudgeAttempt {
  const t = String(raw || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  try {
    const o = JSON.parse(t.slice(s, e + 1));
    if (["pass", "fail", "inconclusive"].includes(o.verdict) && isStr(o.rationale)) return { verdict: o.verdict, rationale: o.rationale };
  } catch { /* fall through */ }
  return { verdict: "inconclusive", rationale: "", error: "invalid judge output" };
}

export function publishGate(a: {
  snapshot: { id: string; checksum: string };
  run: { snapshot_checksum: string; status: string; core_version: string; bot: string } | null;
  results: { test_id: string; test_revision: number; verdict: string }[];
  activeTests: { id: string; revision: number; bots: Bot[] }[]; bot: Bot; coreVersion: string;
}): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!a.run) return { ok: false, reasons: ["no test run for this snapshot"] };
  if (a.run.status !== "complete") reasons.push(`run is ${a.run.status}`);
  if (a.run.snapshot_checksum !== a.snapshot.checksum) reasons.push("run was for different content");
  if (a.run.bot !== a.bot) reasons.push("run was for the other bot");
  if (a.run.core_version !== a.coreVersion) reasons.push(`run used core ${a.run.core_version}, current is ${a.coreVersion}`);
  const mine = a.activeTests.filter((x) => x.bots.includes(a.bot));
  // A run over zero tests completes with 0/0/0; that certifies nothing.
  if (!mine.length) reasons.push(`no active tests for ${a.bot}: add at least one regression test, then run them`);
  for (const t of mine) {
    const r = a.results.find((x) => x.test_id === t.id && x.test_revision === t.revision);
    if (!r) reasons.push(`test ${t.id} rev ${t.revision} not run`);
    else if (r.verdict !== "PASS") reasons.push(`test ${t.id} is ${r.verdict}`);
  }
  return { ok: reasons.length === 0, reasons };
}

// ── redaction for real conversations ───────────────────────────────────────
const PHONE = /\+?\d[\d\s-]{6,}\d/g;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/g;
const URL_RE = /https?:\/\/\S+/g;

export function redactTurns(turns: Turn[], names: string[]): { turns: Turn[]; rejected: boolean } {
  const ns = names.filter((n) => n && n.trim().length >= 2).map((n) => n.trim());
  const out = buildHistory(turns, 6).map((t) => {
    let x = t.text.replace(EMAIL, "{email}").replace(URL_RE, "{link}").replace(PHONE, "{phone}");
    for (const n of ns) x = x.split(n).join("{customer}");
    return { ...t, text: x };
  });
  // A fresh, non-global pattern: .test() on the shared global EMAIL would
  // carry lastIndex from one turn to the next and skip matches.
  const rejected = out.some((t) => /\d{7,}/.test(t.text.replace(/\s|-/g, "")) || /[\w.+-]+@[\w-]+\.[\w.]+/.test(t.text));
  return { turns: out, rejected };
}
