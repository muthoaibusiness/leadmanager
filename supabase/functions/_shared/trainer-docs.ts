// Markdown knowledge documents (migration 0047). Deno-free.
import { GENERIC } from "./trainer-words.ts";
// markdownChunks splits a document on its headings into chunks that each start
// with their heading path, so a retrieved chunk reads on its own and names its
// section. Lists and tables stay whole; a long section splits on paragraph or
// line boundaries, never inside a table row.

export const DOC_CHUNK = { maxChars: 1500 } as const;
export type DocChunk = { chunk_no: number; section: string; text: string };
export type DocHit = { id: string; document_id: string; document_version: number; chunk_no: number; section: string | null; title: string; chunk_text: string; score: number };

export function markdownChunks(md: string): DocChunk[] {
  const lines = String(md || "").replace(/\r\n/g, "\n").split("\n");
  const path: string[] = [];
  const sections: { section: string; body: string[] }[] = [];
  let cur: { section: string; body: string[] } | null = null;
  for (const line of lines) {
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      const level = h[1].length;
      path.length = Math.min(path.length, level - 1);
      path[level - 1] = h[2].trim();
      cur = { section: path.filter(Boolean).join(" > ").slice(0, 300), body: [] };
      sections.push(cur);
      continue;
    }
    if (!cur) { cur = { section: "", body: [] }; sections.push(cur); }
    cur.body.push(line);
  }
  const out: DocChunk[] = [];
  for (const s of sections) {
    const body = s.body.join("\n").trim();
    if (!body) continue;
    const head = s.section ? `${s.section}\n` : "";
    const room = DOC_CHUNK.maxChars - head.length;
    // Blocks: paragraphs, and table runs kept whole unless one is too long.
    const blocks = body.split(/\n{2,}/).flatMap((b) => (b.length <= room ? [b] : b.split("\n")));
    let buf = "";
    const flush = () => { if (buf.trim()) out.push({ chunk_no: out.length, section: s.section, text: `${head}${buf.trim()}` }); buf = ""; };
    for (const b of blocks) {
      const piece = b.length > room ? b.slice(0, room) : b;
      if (buf && buf.length + 1 + piece.length > room) flush();
      buf = buf ? `${buf}\n${piece}` : piece;
    }
    flush();
  }
  return out;
}

// What the model sees for each retrieved chunk: an id it can cite and the source.
export const docRef = (h: DocHit) => `doc:${h.document_id}#${h.chunk_no}`;
export function docExcerpts(hits: DocHit[]): string {
  if (!hits.length) return "";
  return ["Document excerpts (approved knowledge; cite the id in used_item_ids when you use one):",
    ...hits.map((h) => `- [${docRef(h)}] ${h.title}${h.section ? `, ${h.section}` : ""}\n  ${h.chunk_text.replace(/\n/g, "\n  ")}`)].join("\n");
}

// ── project association ─────────────────────────────────────────────────────
// A document whose title names a project must be tagged with that project, so
// retrieval can scope it. "mismatch": tagged with a different project (refused
// on save). "untagged": names a project but carries none (flagged, since an
// untagged document answers every project's questions).
export type ProjectName = { id: string; name: string; aliases: string[] };
export function docAssociation(title: string, projectRef: string | null, projects: ProjectName[]):
  { problem: null | "mismatch" | "untagged"; named?: string; suggested_project?: string } {
  const t = ` ${String(title || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")} `;
  const hits = projects.filter((p) => [p.name, ...p.aliases].some((a) => {
    const w = String(a || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    // Generic single words (wecon, summer, mall) do not name a project alone:
    // the same list the reply path uses (trainer-core GENERIC).
    return w.length > 1 && !GENERIC.has(w) && t.includes(` ${w} `);
  }));
  if (hits.length !== 1) return { problem: null };
  const p = hits[0];
  if (projectRef && projectRef !== p.id) return { problem: "mismatch", named: p.name };
  if (!projectRef) return { problem: "untagged", named: p.name, suggested_project: p.id };
  return { problem: null };
}
