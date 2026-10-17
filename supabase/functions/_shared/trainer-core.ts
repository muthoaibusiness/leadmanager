// AI Trainer core. Every rule of the trainer's reply path lives here, with no
// Deno or browser dependency, so the Edge Function, the bots (at cutover) and
// the Node test runner all execute the same code. Design:
// docs/superpowers/specs/2026-10-18-wecon-ai-trainer-design.md
//
// Bump CORE_VERSION on any change that can alter a reply, a verdict or a
// checksum. Test runs and published snapshots are certified per version.

export const CORE_VERSION = "1.0.0";

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
    send_code: ["string", false], legacy_wa_project_id: ["number", false],
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
export type SnapshotContent = {
  schema: 1; projects: ItemRow[]; items: ItemRow[]; retrieval: { mode: "full" };
  model_config: { reply_model: string; max_tokens: number }; prompt_version: string;
  rubric: { key: string; version: number };
};
export const PROMPT_VERSION = "p1";

const norm = (s: string) => s.normalize("NFC").replace(/[​-‍﻿]/g, "").toLowerCase().trim();

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

export function buildPrompt(
  c: SnapshotContent, bot: Bot, history: Turn[], text: string, state: ConvState, resolved: string[], lang: string,
): { system: string; messages: { role: "user" | "assistant"; content: string }[] } {
  const scoped = c.items.filter((i) => itemApplies(i, bot, resolved));
  const of = (k: Kind) => scoped.filter((i) => i.kind === k);
  const resolvedProjects = c.projects.filter((p) => resolved.includes(p.id));
  const examples = of("example").slice(0, 6);
  const system = [
    "You are WECON Properties' WhatsApp sales consultant. Use ONLY the facts below. Never invent a project, price, size, availability or action.",
    "",
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

export function guardReply(out: ModelOut, c: SnapshotContent, resolved: string[], evidenceText: string): string[] {
  const errs: string[] = [];
  const r = out.reply;
  if (REFUSAL.some((x) => x.test(r))) errs.push("refusal");
  if (CLAIM.some((x) => x.test(r))) errs.push("claim");
  const nums = r.match(/\d+(?:[.,]\d+)?/g) || [];
  if (nums.some((n) => !evidenceText.includes(n))) errs.push("number");
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
  const trace: Record<string, unknown> = { core_version: CORE_VERSION, language: lang };
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
  const prompt = buildPrompt(a.content, a.bot, history, a.text, a.state, res.projects, lang);
  const scoped = a.content.items.filter((i) => itemApplies(i, a.bot, res.projects));
  trace.items_in_scope = scoped.map((i) => `${i.id}@${i.revision}`);
  const evidence = [...scoped.map((i) => JSON.stringify(i.body)), ...a.content.projects.filter((p) => res.projects.includes(p.id)).map((p) => JSON.stringify(p.body)), ...history.map((h) => h.text), a.text].join("\n");
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
  trace.media_missing = media.missing; trace.used_item_ids = parsed.used_item_ids; trace.intent = parsed.intent;
  const reply = media.clarify ? `${parsed.reply}${parsed.reply ? "\n" : ""}${media.clarify}` : parsed.reply;
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
