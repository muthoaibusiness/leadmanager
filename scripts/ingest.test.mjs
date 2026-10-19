// node --test scripts/ingest.test.mjs — document ingestion: file kind
// detection, DOCX text extraction from a real zip, sectioning into reviewable
// fact drafts, and explicit failure states. Synthetic documents only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { kindOf, docxText, sectionsOf, draftsFrom, INGEST_LIMITS } from '../src/lib/ingest.js';

// A minimal real .docx: a zip holding word/document.xml (deflated) plus a stored member.
function zip(files) {
  const parts = []; const central = []; let off = 0;
  for (const [name, data, method] of files) {
    const raw = Buffer.from(data, 'utf8'); const body = method === 8 ? deflateRawSync(raw) : raw;
    const nameB = Buffer.from(name);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(method, 8);
    h.writeUInt32LE(body.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(nameB.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 6); c.writeUInt16LE(method, 10);
    c.writeUInt32LE(body.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(nameB.length, 28); c.writeUInt32LE(off, 42);
    parts.push(h, nameB, body); central.push(c, nameB); off += 30 + nameB.length + body.length;
  }
  const cd = Buffer.concat(central);
  const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10);
  e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return new Uint8Array(Buffer.concat([...parts, cd, e]));
}
const DOC = `<?xml version="1.0"?><w:document xmlns:w="w"><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Location</w:t></w:r></w:p>
<w:p><w:r><w:t>Alpha Heights is in Sector 7, Uttara &amp; near the metro.</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Amenities</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">Rooftop garden, gym </w:t></w:r><w:r><w:t>and a prayer room.</w:t></w:r></w:p>
</w:body></w:document>`;

test('file kind comes from the extension and type, and anything else is refused', () => {
  assert.equal(kindOf({ name: 'Brochure.PDF', type: 'application/pdf' }), 'pdf');
  assert.equal(kindOf({ name: 'facts.docx', type: '' }), 'docx');
  assert.equal(kindOf({ name: 'notes.txt', type: 'text/plain' }), 'text');
  assert.equal(kindOf({ name: 'old.doc', type: 'application/msword' }), null);
  assert.equal(kindOf({ name: 'x.exe', type: '' }), null);
});

test('DOCX text: paragraphs in order, runs joined, entities decoded, headings marked', async () => {
  const bytes = zip([['[Content_Types].xml', '<Types/>', 0], ['word/document.xml', DOC, 8]]);
  const t = await docxText(bytes);
  assert.equal(t, '# Location\nAlpha Heights is in Sector 7, Uttara & near the metro.\n# Amenities\nRooftop garden, gym and a prayer room.');
});

test('a corrupt or non-Word zip is an explicit failure, never empty text', async () => {
  await assert.rejects(() => docxText(new Uint8Array([1, 2, 3, 4])), /not a valid \.docx/);
  await assert.rejects(() => docxText(zip([['a.txt', 'hi', 0]])), /word\/document\.xml/);
});

test('sections split on headings or blank lines; tiny fragments merge; long ones split', () => {
  const s = sectionsOf('# Location\nAlpha is in Uttara.\n\n# Price\nFrom 4.5 crore.\n\nok\n\n' + 'word '.repeat(400));
  assert.deepEqual(s.slice(0, 2), [{ heading: 'Location', text: 'Alpha is in Uttara.' }, { heading: 'Price', text: 'From 4.5 crore.\nok' }]);
  assert.ok(s.length >= 4, 'the 2,000-character block is split');
  assert.ok(s.every((x) => x.text.length <= INGEST_LIMITS.sectionChars));
});

test('drafts carry the source file and section, keep figures verbatim, and are never active', () => {
  const d = draftsFrom('Alpha Brochure.pdf', [{ heading: 'Price', text: 'From ৪.৫ crore (4.5 crore).', page: 3 }], ['eyad']);
  assert.equal(d.length, 1);
  assert.deepEqual(d[0], { kind: 'fact', bots: ['eyad'], project_ref: null, include: true,
    body: { topic: 'Price', text: 'From ৪.৫ crore (4.5 crore).', source: 'Alpha Brochure.pdf, page 3' } });
});

test('an empty extraction is an explicit failure state (likely a scanned PDF)', () => {
  assert.throws(() => draftsFrom('scan.pdf', sectionsOf('   \n\n  '), ['eyad']), /No text could be read.*scanned/);
});

// A real PDF built by hand: page 1 has text, page 2 has none (like a scan).
function pdf(pages) {
  const objs = []; const add = (s) => { objs.push(s); return objs.length; };
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids = [];
  const pagesId = objs.length + 1 + pages.length * 2;
  for (const lines of pages) {
    const ops = lines.map((l, i) => `BT /F1 12 Tf 72 ${720 - i * 20} Td (${l}) Tj ET`).join('\n');
    const content = add(`<< /Length ${ops.length} >>\nstream\n${ops}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  add(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`);
  const cat = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${cat} 0 R >>\nstartxref\n${x}\n%%EOF`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}
const loadPdf = () => import('pdfjs-dist/legacy/build/pdf.mjs');

test('PDF: text pages become sections with their page number; a page with no text adds nothing', async () => {
  const { pdfPages } = await import('../src/lib/ingest.js');
  const pages = await pdfPages(pdf([['Alpha Heights price starts from 4.5 crore.', 'Handover in 2027.'], []]), loadPdf);
  assert.equal(pages.length, 2);
  assert.match(pages[0], /4\.5 crore/); assert.equal(pages[1], '');
  const d = draftsFrom('Alpha.pdf', pages.flatMap((t, i) => sectionsOf(t, i + 1)), ['eyad']);
  assert.equal(d.length, 1); assert.equal(d[0].body.source, 'Alpha.pdf, page 1'); assert.match(d[0].body.text, /Handover in 2027/);
});

test('PDF: a document with no text layer at all fails explicitly', async () => {
  const { pdfPages } = await import('../src/lib/ingest.js');
  const pages = await pdfPages(pdf([[], []]), loadPdf);
  assert.throws(() => draftsFrom('scan.pdf', pages.flatMap((t, i) => sectionsOf(t, i + 1)), ['eyad']), /scanned PDF/);
});

test('readDocument: Markdown is kept verbatim; PDF text is marked for review and lists unreadable pages', async () => {
  const { readDocument } = await import('../src/lib/ingest.js');
  const md = { name: 'Nuznan.md', type: 'text/markdown', size: 40, arrayBuffer: async () => new TextEncoder().encode('# Nuznan\n- Sector 16\n| A | 1 |').buffer };
  assert.deepEqual(await readDocument(md, loadPdf), { format: 'markdown', title: 'Nuznan', body: '# Nuznan\n- Sector 16\n| A | 1 |', warnings: [] });
  const bytes = pdf([['Alpha price starts from 4.5 crore.'], []]);
  const p = await readDocument({ name: 'Alpha.pdf', type: 'application/pdf', size: bytes.length, arrayBuffer: async () => bytes.buffer }, loadPdf);
  assert.equal(p.format, 'pdf_text');
  assert.match(p.body, /^## Page 1\nAlpha price starts from 4\.5 crore\./);
  assert.ok(!p.body.includes('Page 2'), 'an empty page adds no invented text');
  assert.deepEqual(p.warnings, ['Page 2 has no text (scanned or image only) and was skipped.']);
  const blank = pdf([[], []]);
  await assert.rejects(() => readDocument({ name: 'scan.pdf', type: 'application/pdf', size: blank.length, arrayBuffer: async () => blank.buffer }, loadPdf), /no text/);
  await assert.rejects(() => readDocument({ name: 'x.exe', type: '', size: 1, arrayBuffer: async () => new ArrayBuffer(1) }, loadPdf), /Markdown/);
});
