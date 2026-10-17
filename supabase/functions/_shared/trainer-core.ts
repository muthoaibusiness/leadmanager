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
