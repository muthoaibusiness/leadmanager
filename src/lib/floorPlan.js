// ── Floor plan helpers (Projects → Available Units) ──────────────────────────
// Pure geometry, the editor's undo history, validation, and turning an
// uploaded image or PDF page into the image a plan stores. No React, no store.
// pdf.js is imported on demand, only when someone picks a PDF.

import { findUnit } from './projects.js';

// ── geometry ─────────────────────────────────────────────────────────────────
// The canvas works in the image's pixels; a stored box is fractions of them.
export const toPx = (b, W, H) => ({ x: b.x * W, y: b.y * H, w: b.w * W, h: b.h * H });
export const toFrac = (r, W, H) => ({ x: r.x / W, y: r.y / H, w: r.w / W, h: r.h / H });

// The rectangle spanned by two corners, kept inside the image.
export function rectFrom(a, b, W, H) {
  const x0 = Math.max(0, Math.min(a.x, b.x)), y0 = Math.max(0, Math.min(a.y, b.y));
  const x1 = Math.min(W, Math.max(a.x, b.x)), y1 = Math.min(H, Math.max(a.y, b.y));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

// Moved so it stays wholly inside the image.
export function clampMove(r, W, H) {
  return { ...r, x: Math.min(Math.max(0, r.x), Math.max(0, W - r.w)), y: Math.min(Math.max(0, r.y), Math.max(0, H - r.h)) };
}

// Resized by dragging handle `hd` ('n', 'ne', 'e', … 'nw') by (dx, dy): the
// opposite side stays put, and the box keeps at least `min` on each side.
export function resizeRect(r, hd, dx, dy, W, H, min) {
  let x0 = r.x, y0 = r.y, x1 = r.x + r.w, y1 = r.y + r.h;
  if (hd.includes('w')) x0 = Math.min(Math.max(0, x0 + dx), x1 - min);
  if (hd.includes('e')) x1 = Math.max(Math.min(W, x1 + dx), x0 + min);
  if (hd.includes('n')) y0 = Math.min(Math.max(0, y0 + dy), y1 - min);
  if (hd.includes('s')) y1 = Math.max(Math.min(H, y1 + dy), y0 + min);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
export function handlePoint(r, hd) {
  const x = hd.includes('w') ? r.x : hd.includes('e') ? r.x + r.w : r.x + r.w / 2;
  const y = hd.includes('n') ? r.y : hd.includes('s') ? r.y + r.h : r.y + r.h / 2;
  return { x, y };
}

// ── display ──────────────────────────────────────────────────────────────────
export const STATUS = {
  available: { label: 'Available', short: 'Open' },
  hold: { label: 'On hold', short: 'Held' },
  sold: { label: 'Sold', short: 'Sold' },
  unlinked: { label: 'Not linked', short: '—' },
};
export const taka = (n) => '৳' + Math.round(n || 0).toLocaleString('en-IN');

// ── unit codes ───────────────────────────────────────────────────────────────
export const normCode = (s) => String(s || '').trim().replace(/\s+/g, '-').toUpperCase();

// The code a unit is saved under: an untouched existing code exactly as it is
// stored (the catalog allows any case), anything typed normalized and trimmed
// of stray dashes.
export const saveCode = (u) => (u.orig && u.code === u.orig.code ? u.code : normCode(u.code).replace(/^-+|-+$/g, ''));

// The code after this one: SHOP-07 → SHOP-08, A9 → A10, LOBBY → LOBBY-2.
export function nextCode(code) {
  const m = /^(.*?)(\d+)$/.exec(code || '');
  if (!m) return code ? `${code}-2` : 'UNIT-01';
  const n = String(Number(m[2]) + 1).padStart(m[2].length, '0');
  return m[1] + n;
}

// SHOP-2 before SHOP-10.
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
export const byCode = (a, b) => collator.compare(a, b);

// ── undo / redo ──────────────────────────────────────────────────────────────
// A history is { past: [], present, future: [], tag, at }. A step with the same
// tag as the last one, within `ms`, replaces it instead of stacking — arrow-key
// nudges of one box become one undo step.
export const HISTORY_LIMIT = 100;
export const historyOf = (present) => ({ past: [], present, future: [], tag: null, at: 0 });
export function record(h, next, tag = null, ms = 700) {
  const now = Date.now();
  if (tag && h.tag === tag && now - h.at < ms) return { ...h, present: next, future: [], at: now };
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [], tag, at: now };
}
export function undo(h) {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future], tag: null, at: 0 };
}
export function redo(h) {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1), tag: null, at: 0 };
}

// ── validation ───────────────────────────────────────────────────────────────
// What stops a save, as plain sentences. `draft` is the editor state
// ({ plan, units, image, pending }); `project` is the stored project (for
// codes of units that are not part of this plan, and boxes on other plans).
export function planProblems(draft, project) {
  const out = [];
  const { plan, units } = draft;
  if (!(plan.name || '').trim()) out.push('Give the plan a name.');
  if (!draft.image && !draft.pending) out.push('Upload a floor plan image.');
  const unlinked = plan.boxes.filter(b => !b.unitKey || !units[b.unitKey]).length;
  if (unlinked) out.push(`${unlinked} box${unlinked > 1 ? 'es are' : ' is'} not linked to a unit.`);
  const keys = plan.boxes.map(b => b.unitKey).filter(Boolean);
  const twice = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))];
  twice.forEach(k => out.push(`${units[k]?.code || 'A unit'} has more than one box.`));
  const used = [...new Set(keys)].map(k => units[k]).filter(Boolean);
  // Checked as the codes will be saved (see saveCode), so "-" or "SHOP-1-"
  // are judged the way the save will see them.
  if (used.some(u => !saveCode(u))) out.push('Every unit needs a name.');
  const codes = used.map(saveCode).filter(Boolean);
  [...new Set(codes.filter((c, i) => codes.indexOf(c) !== i))].forEach(c => out.push(`${c} is used by more than one unit.`));
  // A code already taken by a unit this plan does not manage.
  const mine = new Set(used.map(u => u.orig?.code).filter(Boolean));
  used.forEach(u => {
    const c = saveCode(u);
    if (!c || c === u.orig?.code) return;
    if (findUnit(project, c) && !mine.has(c)) out.push(`${c} is already used by another unit in this project.`);
  });
  // A price is per unit, so it needs a size to turn into a rate for deals.
  const typeSize = (vid) => (project?.variants || []).find(v => v.id === vid)?.size || 0;
  used.forEach(u => {
    if (parseFloat(u.price) > 0 && !(parseFloat(u.size) > 0) && !typeSize(u.variantId)) out.push(`${saveCode(u) || 'A unit'} has a price but no size.`);
  });
  const elsewhere = new Set((project?.floorPlans || []).filter(fp => fp.id !== plan.id).flatMap(fp => (fp.boxes || []).map(b => b.unitId)));
  used.forEach(u => { if (u.orig && elsewhere.has(u.orig.code)) out.push(`${u.orig.code} is already on another floor plan.`); });
  return [...new Set(out)];
}

// ── turning an upload into the stored image ──────────────────────────────────
export const MAX_SIDE = 3000;          // long side of the stored image, px
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const MAX_PDF_BYTES = 25 * 1024 * 1024;
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

// A white-backed canvas to a WebP blob, or JPEG where the browser cannot
// encode WebP (it hands back PNG instead).
function canvasBlob(canvas) {
  const as = (type, q) => new Promise(res => canvas.toBlob(res, type, q));
  return as('image/webp', 0.85).then(b => (b && b.type === 'image/webp' ? b : as('image/jpeg', 0.88)))
    .then(b => { if (!b) throw new Error('This browser could not encode the image.'); return b; });
}

function whiteCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  return { c, ctx };
}

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fall back to <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally { URL.revokeObjectURL(url); }
}

// An image file scaled so its long side is at most MAX_SIDE.
// → { blob, width, height }
export async function prepareImage(file) {
  const src = await decode(file);
  const sw = src.width || src.naturalWidth, sh = src.height || src.naturalHeight;
  if (!sw || !sh) throw new Error('That image could not be read.');
  const k = Math.min(1, MAX_SIDE / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
  const { c, ctx } = whiteCanvas(w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  if (typeof src.close === 'function') src.close();
  return { blob: await canvasBlob(c), width: w, height: h };
}

let pdfjsP = null;
function loadPdfjs() {
  pdfjsP ||= Promise.all([
    import('pdfjs-dist/legacy/build/pdf.min.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ]).then(([lib, worker]) => {
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib;
  }).catch(e => { pdfjsP = null; throw e; });
  return pdfjsP;
}

// Opens a PDF for page picking. Call destroy() when done with it.
export async function openPdf(file) {
  const lib = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const task = lib.getDocument({ data });
  const doc = await task.promise;
  // pdf.js tears a document down through its loading task.
  return { numPages: doc.numPages, doc, destroy: () => { task.destroy().catch(() => { /* already gone */ }); } };
}

// One page drawn so its long side is `side` px. → canvas
export async function renderPdfPage(doc, pageNo, side) {
  const page = await doc.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: side / Math.max(base.width, base.height) });
  const { c } = whiteCanvas(Math.round(viewport.width), Math.round(viewport.height));
  await page.render({ canvas: c, viewport }).promise;
  page.cleanup();
  return c;
}

// The chosen page as the stored image. → { blob, width, height }
export async function pdfPageImage(doc, pageNo) {
  const c = await renderPdfPage(doc, pageNo, MAX_SIDE);
  const blob = await canvasBlob(c);
  const out = { blob, width: c.width, height: c.height };
  c.width = c.height = 0; // let the big bitmap go now, not at the next GC
  return out;
}
