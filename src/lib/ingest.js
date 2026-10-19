// Document ingestion for the AI Trainer: read a PDF, DOCX or text file in the
// browser, split it into sections, and turn each section into a fact draft
// the operator reviews. Nothing is saved until the operator chooses which
// drafts to keep; each kept draft goes through the normal items.create path
// (server validation, Management check, audit), and a scanned PDF with no
// text layer is an explicit failure, never an empty success.
//
// No new dependency: PDFs use the pdfjs-dist already used for floor plans;
// DOCX is a zip read with the platform's DecompressionStream.

export const INGEST_LIMITS = { maxBytes: 15 * 1024 * 1024, sectionChars: 1200, minSection: 40, maxDrafts: 80 };

export function kindOf(file) {
  const n = String(file?.name || '').toLowerCase();
  const t = String(file?.type || '').toLowerCase();
  if (n.endsWith('.pdf') || t === 'application/pdf') return 'pdf';
  if (n.endsWith('.docx') || t === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (n.endsWith('.txt') || n.endsWith('.md') || t === 'text/plain' || t === 'text/markdown') return 'text';
  return null;
}

// ── DOCX ────────────────────────────────────────────────────────────────────
async function inflateRaw(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

// Reads one member of a zip through its central directory (sizes there are
// reliable even when the local header defers them to a data descriptor).
async function zipMember(bytes, wanted) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This file is not a valid .docx (no zip directory).');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('This file is not a valid .docx (bad zip entry).');
    const method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true);
    const nlen = v.getUint16(p + 28, true), xlen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true), local = v.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
    if (name === wanted) {
      const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
      const data = bytes.subarray(start, start + csize);
      if (method === 0) return data;
      if (method === 8) return inflateRaw(data);
      throw new Error(`Unsupported compression in .docx (method ${method}).`);
    }
    p += 46 + nlen + xlen + clen;
  }
  return null;
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodeXml = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e] ?? m);

export async function docxText(bytes) {
  let xmlBytes;
  try { xmlBytes = await zipMember(bytes, 'word/document.xml'); }
  catch (e) { throw new Error(e.message.startsWith('This file') ? e.message : 'This file is not a valid .docx.', { cause: e }); }
  if (!xmlBytes) throw new Error('This .docx has no word/document.xml, so it is not a Word document.');
  const xml = new TextDecoder().decode(xmlBytes);
  const paras = [];
  for (const m of xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) {
    const p = m[0];
    const text = decodeXml([...p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((x) => x[1]).join('')).trim();
    if (!text) continue;
    paras.push(/<w:pStyle w:val="(?:Heading|Title)\d*"/i.test(p) ? `# ${text}` : text);
  }
  return paras.join('\n');
}

// ── PDF ─────────────────────────────────────────────────────────────────────
// Text per page from pdf.js; a scanned page has none.
export async function pdfPages(bytes, loadLib) {
  const lib = await loadLib();
  const task = lib.getDocument({ data: bytes });
  const doc = await task.promise;
  try {
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const c = await page.getTextContent();
      let line = '', out = '';
      for (const it of c.items) { line += it.str; if (it.hasEOL) { out += line.trimEnd() + '\n'; line = ''; } else if (it.str && !it.str.endsWith(' ')) line += ' '; }
      pages.push((out + line).replace(/[ \t]+\n/g, '\n').trim());
      page.cleanup();
    }
    return pages;
  } finally { task.destroy().catch(() => {}); }
}

// ── sections and drafts ─────────────────────────────────────────────────────
export function sectionsOf(text, page = undefined) {
  const out = [];
  let heading = '', buf = [];
  const flush = () => {
    const body = buf.join('\n').trim(); buf = [];
    if (!body) return;
    const prev = out.at(-1);
    if (body.length < INGEST_LIMITS.minSection && prev && prev.heading === heading) { prev.text = `${prev.text}\n${body}`; return; }
    for (let i = 0; i < body.length; i += INGEST_LIMITS.sectionChars) {
      const slice = body.slice(i, i + INGEST_LIMITS.sectionChars);
      const cut = i + INGEST_LIMITS.sectionChars < body.length ? Math.max(slice.lastIndexOf(' '), Math.floor(slice.length * 0.6)) : slice.length;
      out.push({ heading, text: slice.slice(0, cut).trim(), ...(page ? { page } : {}) });
      if (cut < slice.length) i -= slice.length - cut;
    }
  };
  for (const raw of String(text || '').split('\n')) {
    const l = raw.trim();
    if (/^#{1,6}\s+/.test(l)) { flush(); heading = l.replace(/^#+\s+/, '').slice(0, 80); continue; }
    if (!l) { flush(); continue; }
    buf.push(l);
  }
  flush();
  return out.filter((s) => s.text);
}

export function draftsFrom(fileName, sections, bots) {
  const kept = sections.filter((s) => s.text.trim());
  if (!kept.length) throw new Error('No text could be read from this file. If it is a scanned PDF (pictures of pages), it has no text layer; type the facts in instead.');
  return kept.slice(0, INGEST_LIMITS.maxDrafts).map((s, i) => ({
    kind: 'fact', bots: [...bots], project_ref: null, include: true,
    body: { topic: (s.heading || `Section ${i + 1}`).slice(0, 80), text: s.text, source: `${fileName}${s.page ? `, page ${s.page}` : ''}`.slice(0, 200) },
  }));
}

// File to drafts; every failure is thrown with a message the operator can act on.
export async function ingestFile(file, bots, loadPdf) {
  const kind = kindOf(file);
  if (!kind) throw new Error('Only PDF, DOCX and plain text files are supported. Save .doc files as .docx first.');
  if (file.size > INGEST_LIMITS.maxBytes) throw new Error('This file is larger than 15 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (kind === 'text') return draftsFrom(file.name, sectionsOf(new TextDecoder().decode(bytes)), bots);
  if (kind === 'docx') return draftsFrom(file.name, sectionsOf(await docxText(bytes)), bots);
  const pages = await pdfPages(bytes, loadPdf);
  return draftsFrom(file.name, pages.flatMap((t, i) => sectionsOf(t, i + 1)), bots);
}

// A whole file as one knowledge document (migration 0047). Markdown and text
// are kept exactly as written. PDF text becomes format 'pdf_text', one
// "## Page N" section per page that has text, and must be reviewed before it
// is indexed; pages with no text are listed, never filled in.
export async function readDocument(file, loadPdf) {
  const n = String(file?.name || '');
  const lower = n.toLowerCase();
  const isMd = lower.endsWith('.md') || lower.endsWith('.markdown') || file?.type === 'text/markdown';
  const kind = isMd ? 'markdown' : kindOf(file);
  if (!kind || kind === 'docx') throw new Error('Use Markdown (.md) or plain text. PDF is also accepted, but its text must be reviewed before indexing.');
  if (file.size > INGEST_LIMITS.maxBytes) throw new Error('This file is larger than 15 MB. Upload a compressed copy (for example, saved with reduced image quality); the text is the same.');
  const title = n.replace(/\.[^.]+$/, '').slice(0, 200) || 'Untitled';
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (kind === 'markdown' || kind === 'text') {
    const body = new TextDecoder().decode(bytes).replace(/\r\n/g, '\n').trim();
    if (!body) throw new Error('This file is empty.');
    return { format: kind === 'markdown' ? 'markdown' : 'text', title, body, warnings: [] };
  }
  const pages = await pdfPages(bytes, loadPdf);
  const real = pageHasText;
  const warnings = pages.map((t, i) => (real(t) ? null : `Page ${i + 1} has no text (scanned or image only) and was skipped.`)).filter(Boolean);
  const body = pages.map((t, i) => (real(t) ? `## Page ${i + 1}\n${t.trim()}` : null)).filter(Boolean).join('\n\n');
  // Measured on the page text itself; the "## Page N" headings are ours.
  const stats = { pages: pages.length, text_pages: pages.filter(real).length, chars: pages.filter(real).reduce((n, t) => n + t.trim().length, 0) };
  const verdict = pdfVerdict(stats);
  if (!body || verdict === 'ocr_needed') throw new Error('This PDF has no text layer that can be used: its pages are images (scanned or exported as pictures), so it has no text to index. It needs OCR, or type the facts into a Markdown document instead.');
  const skipped = stats.pages - stats.text_pages;
  return { format: 'pdf_text', title, body, warnings, stats, verdict, source_name: `${n} (${stats.pages} pages${skipped ? `, ${skipped} without text` : ''})`.slice(0, 200) };
}

// A page whose only text is its page number ("1", "2 2", "১") has no content.
// Bangla vowel signs are combining marks (\p{M}), so a word is letters and marks.
// A table of figures ("40 60 1,250") is content too; a lone page number is not.
export const pageHasText = (t) => { const s = String(t || ''); return /\p{L}[\p{L}\p{M}]+/u.test(s) || (s.match(/\p{N}+/gu) || []).length >= 3; };

// How much of a PDF can answer questions. "ocr_needed": no text, or under 10
// characters a page on average (a cover line on an image export). "partial":
// half the pages or fewer carry text, so many facts are only in pictures.
// Measured on the WECON brochures (2026-10-20): the image-only exports give
// 64 and 80 characters over 24 and 30 pages; usable ones give 140 or more.
export function pdfVerdict({ pages, text_pages, chars }) {
  if (!text_pages || chars / Math.max(pages, 1) < 10) return 'ocr_needed';
  return text_pages / Math.max(pages, 1) <= 0.5 ? 'partial' : 'usable';
}
