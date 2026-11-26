// Document kit for the Booking page (migration 0071): the kit list, the company
// library (one uploaded file per kit item), the per-shop send log, and the
// documents made on the spot for a shop (quotation, unit sheet).
import { sbGet, sbUpsert, sbInsert, hasColumn, uploadProjectMedia } from './supabase.js';
import { taka } from './floorPlan.js';

// type: gen = made for this shop, tpl = a template the company approves,
// orig = an original record that has to be uploaded.
export const DOCS = [
  { k: 'quote', n: 'Price quotation', stage: 'pre', t: 'gen', d: "This shop at today's price, valid 7 days" },
  { k: 'unitsheet', n: 'Unit location sheet', stage: 'pre', t: 'gen', d: 'Floor, size, type and price of this shop' },
  { k: 'brochure', n: 'Project brochure', stage: 'pre', t: 'orig', d: 'The project brochure: a link or a PDF' },
  { k: 'floorplans', n: 'Floor plans', stage: 'pre', t: 'tpl', d: 'Floor plans only, one PDF (else the project plan images)' },
  { k: 'spec', n: 'Specification sheet', stage: 'pre', t: 'tpl', d: 'Structure, lifts, power, fire safety, finishes' },
  { k: 'approval', n: 'Building approval', stage: 'pre', t: 'orig', d: 'Scan of the approval letter and approved drawings' },
  { k: 'land', n: 'Land ownership papers', stage: 'pre', t: 'orig', d: 'Title deed, mutation, khatian, land tax receipt' },
  { k: 'appform', n: 'Application form', stage: 'book', t: 'tpl', d: 'Booking application the client fills in' },
  { k: 'terms', n: 'Terms and conditions', stage: 'book', t: 'tpl', d: 'Price lock, payments, delay, transfer, handover' },
  { k: 'refund', n: 'Refund policy', stage: 'book', t: 'tpl', d: 'What happens to money paid if a client cancels' },
  { k: 'bank', n: 'Bank account letter', stage: 'book', t: 'orig', d: 'Signed, on letterhead: the only accounts a client may pay into' },
  { k: 'kyc', n: 'KYC checklist', stage: 'book', t: 'tpl', d: 'ID, photos, TIN, nominee, proof of address' },
  { k: 'remit', n: 'Payment guide', stage: 'book', t: 'tpl', d: 'Bank transfer steps, payment reference, receipts' },
  { k: 'agreement', n: 'Sample agreement', stage: 'after', t: 'tpl', d: 'Outline of the sale agreement, to read early' },
  { k: 'poa', n: 'Power of attorney guide', stage: 'after', t: 'tpl', d: 'Appointing a family representative' },
];
export const DSTAGE = { pre: 'Before hold', book: 'At booking', after: 'After booking' };
export const MAX_BYTES = 25 * 1024 * 1024; // the bucket's own limit
export const OK_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
const NEED = 'Document kit is off. Apply supabase/migrations/0071_shop_docs.sql.';

// The brochure and the floor plans belong to a project, not to the company: their library rows are
// stored under "<key>@<project id>" so two projects never share one file.
export const PER_PROJECT = ['brochure', 'floorplans'];
export const docKey = (k, project) => (PER_PROJECT.includes(k) && project?.id ? `${k}@${project.id}` : k);
// A link kept as a path on this site ("/projects/…pdf") must be a full address before WhatsApp can fetch it.
export const absUrl = (u) => (!u || /^(https?:|data:|blob:)/i.test(u) ? u : new URL(u, window.location.origin).href);
export const libOf = (cid) => cid || 'company'; // storage paths start with the company id (migration 0055)

const rToLib = (r) => ({ key: r.doc_key, name: r.name || '', url: r.url || '', size: r.size_bytes || 0, mime: r.mime || '', approved: !!r.approved, by: r.uploaded_by_name || '', at: r.updated_at });
const rToLog = (r) => ({ id: r.id, kind: r.kind, client: r.client || '', contact: r.contact || '', channel: r.channel || '', docs: Array.isArray(r.docs) ? r.docs : [], note: r.note || '', by: r.by_name || '', at: r.created_at });

// Library as { key: entry } and this shop's log, newest first. `missing` = the
// migration is not applied yet.
export async function loadShopDocs(cid, propertyId, unitId) {
  if (!(await hasColumn('shop_docs', 'doc_key', NEED))) return { lib: {}, log: [], loaded: true, missing: true };
  const c = encodeURIComponent(libOf(cid));
  const [libRows, logRows] = await Promise.all([
    sbGet(`shop_docs?company_id=eq.${c}&select=*`),
    unitId ? sbGet(`shop_doc_log?company_id=eq.${c}&property_id=eq.${encodeURIComponent(propertyId)}&unit_id=eq.${encodeURIComponent(unitId)}&order=created_at.desc&limit=100&select=*`) : [],
  ]);
  const lib = {};
  (Array.isArray(libRows) ? libRows : []).forEach((r) => { lib[r.doc_key] = rToLib(r); });
  return { lib, log: (Array.isArray(logRows) ? logRows : []).map(rToLog), loaded: true, missing: false };
}

// Every document sent for a project, newest first: what went to which client (Booking › Documents).
export async function loadProjectDocLog(cid, propertyId) {
  if (!(await hasColumn('shop_docs', 'doc_key', NEED))) return { log: [], missing: true };
  const c = encodeURIComponent(libOf(cid));
  const rows = await sbGet(`shop_doc_log?company_id=eq.${c}&property_id=eq.${encodeURIComponent(propertyId)}&kind=eq.docs_sent&order=created_at.desc&limit=500&select=*`);
  return { log: (Array.isArray(rows) ? rows : []).map(r => ({ ...rToLog(r), unitId: r.unit_id })), missing: false };
}

// Upload a file for a kit item (a template counts as approved once a file is in).
export async function uploadKitFile(cid, key, file, user) {
  if (!OK_TYPES.includes(file.type)) return { ok: false, error: 'Use a PDF, PNG, JPG or WebP file.' };
  if (file.size > MAX_BYTES) return { ok: false, error: 'That file is over 25 MB.' };
  const ext = (file.name.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'pdf';
  const up = await uploadProjectMedia(file, `${libOf(cid)}/docs/${key}-${Date.now()}.${ext}`);
  if (!up.ok) return { ok: false, error: up.error };
  const res = await sbUpsert('shop_docs', [{
    company_id: libOf(cid), doc_key: key, name: file.name, url: up.url, size_bytes: file.size, mime: file.type,
    approved: true, uploaded_by: user.id, uploaded_by_name: user.name, updated_at: new Date().toISOString(),
  }]);
  return res.ok ? { ok: true } : { ok: false, error: 'The file uploaded but could not be saved to the library.' };
}

// Approve a template that has no file yet (the company vouches for the standard text).
export async function approveKit(cid, key, user, on = true) {
  const res = await sbUpsert('shop_docs', [{
    company_id: libOf(cid), doc_key: key, approved: on, uploaded_by: user.id, uploaded_by_name: user.name, updated_at: new Date().toISOString(),
  }]);
  return res.ok;
}

export async function addShopLog(cid, row, user) {
  const entry = {
    id: 'sd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    company_id: libOf(cid), property_id: row.propertyId, unit_id: row.unitId, kind: row.kind,
    client: row.client || null, contact: row.contact || null, channel: row.channel || null,
    docs: row.docs || [], note: row.note || null, by_id: user.id, by_name: user.name,
  };
  const res = await sbInsert('shop_doc_log', entry);
  return !!res.ok;
}

// ready = can be sent: made on the spot, uploaded, or an approved template
export const docReady = (d, lib) => d.t === 'gen' || !!(lib[d.k] && (lib[d.k].url || lib[d.k].approved));
// ready / draft / missing, for the dot beside each item
export function docState(d, lib) {
  const L = lib[d.k];
  if (d.t === 'gen' || (L && (L.url || L.approved))) return ['ok', 'Ready'];
  return d.t === 'tpl' ? ['warn', 'Draft, needs approval'] : ['miss', 'Upload needed'];
}

// Which stage the shop is at, so the right group is ticked first.
export const stageOf = (shop) => (shop.status === 'available' ? 'pre' : shop.status === 'hold' ? 'book' : 'after');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Quotation and unit sheet for one shop, as escaped HTML (preview and print).
export function genDoc(key, project, shop, floorName) {
  const head = `<h1>${esc(project.name)}</h1>`;
  const rows = (list) => `<table>${list.map(([a, b]) => `<tr><th>${esc(a)}</th><td>${esc(b)}</td></tr>`).join('')}</table>`;
  const base = [['Shop', shop.code], ['Floor', floorName], ['Type', shop.type || '—'], ['Size', shop.size ? `${shop.size} sq ft` : '—']];
  if (key === 'quote') {
    const until = new Date(Date.now() + 7 * 86400000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    return `${head}<h2>Price quotation</h2>${rows([...base, ['Rate', shop.rate ? `${taka(shop.rate)} / sq ft` : '—'], ['Price', shop.price ? taka(shop.price) : 'On request'], ['Valid until', until]])}<p class="n">The price is held for 7 days. Management confirms a booking in writing.</p>`;
  }
  return `${head}<h2>Unit location sheet</h2>${rows([...base, ['Ownership', shop.ownership || '—'], ['Category', shop.category || '—'], ['Status', shop.look?.label || shop.status]])}`;
}

// Plain text of a made-for-this-shop document, for a WhatsApp message.
export function genText(key, project, shop, floorName) {
  const base = [`Shop ${shop.code} · ${floorName}`, shop.type ? `Type: ${shop.type}` : '', shop.size ? `Size: ${shop.size} sq ft` : ''];
  if (key === 'quote') {
    const until = new Date(Date.now() + 7 * 86400000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    return ['Price quotation', ...base, shop.rate ? `Rate: ${taka(shop.rate)} / sq ft` : '', `Price: ${shop.price ? taka(shop.price) : 'on request'}`, `Valid until ${until}`].filter(Boolean).join('\n');
  }
  return ['Unit location sheet', ...base, shop.ownership ? `Ownership: ${shop.ownership}` : '', shop.category ? `Category: ${shop.category}` : ''].filter(Boolean).join('\n');
}

// Message type for a stored file.
export const fileKind = (mime) => (String(mime || '').startsWith('image/') ? 'image' : 'document');


// ── the standard documents, as shown in the viewer ───────────────────────────
const F = (t) => `<span class="f">[${esc(t)}]</span>`; // a gap the company fills in before approving
const tbl = (rows) => `<table>${rows.map(([a, b]) => `<tr><th>${esc(a)}</th><td>${b}</td></tr>`).join('')}</table>`;
const blanks = (list) => `<table>${list.map((x) => `<tr><td>${esc(x)}</td><td class="line"></td></tr>`).join('')}</table>`;
const ol = (list) => `<ol>${list.map((x) => `<li>${x}</li>`).join('')}</ol>`;

export function kitDoc(d, project, shop, floorName, approved) {
  const flag = d.t === 'orig' ? '<p class="draft">UPLOAD THE ORIGINAL</p>' : approved ? '' : '<p class="draft">DRAFT · NOT APPROVED</p>';
  const head = `${flag}<h1>${esc(d.n)}</h1><p class="n">${esc(project.name)} · Shop ${esc(shop.code)}</p>`;
  let b;
  switch (d.k) {
    case 'floorplans': b = `<p>Shop ${esc(shop.code)} is on ${esc(floorName)}.</p>` + ol((project.floorPlans || []).map((p) => esc(p.name))) + '<p class="n">Sales plans, not to scale. Final areas follow the approved drawings.</p>'; break;
    case 'spec': b = tbl([['Structure', F('frame and foundation')], ['Lifts', F('number, brand, capacity')], ['Escalators', F('number, brand')], ['Power', F('substation, generator kVA')], ['Air conditioning', F('central, VRF or common areas')], ['Fire safety', F('detection, sprinklers, stairs')], ['Façade', F('glass, ACP')], ['Handover condition', F('shell, tiled or fitted')], ['Parking', F('cars, motorcycles')], ['Security', F('CCTV, access control')]]); break;
    case 'approval': b = '<p>Upload a scan of the approval letter and approved drawings. The upload should show:</p>' + blanks(['Approving authority', 'Approval or memo number', 'Date of approval', 'Approved floors and use', 'Approved gross floor area', 'Plot and holding number', 'Validity or conditions']); break;
    case 'land': b = '<p>Upload the land documents. The bundle should show:</p>' + blanks(['Mouza and police station', 'Khatian numbers', 'Dag (plot) numbers', 'Land area', 'Title deed number and date', 'Mutation case number', 'Latest land tax receipt (year)', 'Ownership, and any joint venture']); break;
    case 'bank': b = '<p>Upload the signed letter on company letterhead. Always send this letter; never type account numbers into chats.</p>' + blanks(['Account name', 'Bank and branch', 'Account number', 'SWIFT / routing number', 'Signed by (name, title) and date']) + '<p><b>Warning for clients:</b> the company never asks you to pay into a personal account or to change these details by phone or WhatsApp.</p>'; break;
    case 'appform': b = '<h2>Shop</h2>' + tbl([['Shop', esc(shop.code) + ' · ' + esc(floorName)], ['Type', esc(shop.type || '—')], ['Size', shop.size ? shop.size + ' sq ft' : '—'], ['Price', shop.price ? esc(taka(shop.price)) : 'On request']]) + '<h2>Applicant</h2>' + blanks(['Full name', "Father's name", "Mother's name", 'Date of birth', 'ID / passport number', 'Present address', 'Permanent address', 'Occupation', 'Mobile / WhatsApp', 'Email']) + '<h2>Nominee</h2>' + blanks(['Name', 'Relationship', 'ID number', 'Mobile']) + '<h2>Declaration</h2><p>I apply for the shop above and have read the terms and the refund policy.</p>' + blanks(['Applicant signature and date', 'Received by and date']); break;
    case 'terms': b = ol(['<b>Booking.</b> A booking is accepted when the booking money reaches the official account and a money receipt is issued.', '<b>Price.</b> The price is the list price on the day booking money is received, if payments stay on schedule.', `<b>Payments.</b> Down payment within ${F('X')} days; installments on the dates in the schedule.`, `<b>Late payment.</b> After ${F('X')} days a delay charge of ${F('X%')} applies.`, `<b>Area.</b> Measured as ${F('carpet / saleable')}; a difference above ${F('X%')} adjusts the price at the same rate.`, `<b>Transfer.</b> Allowed with written consent and a fee of ${F('amount')}.`, `<b>Handover.</b> Expected ${F('date')}, after full payment.`, '<b>Costs.</b> Stamp duty, registration fees and taxes are paid by the buyer.', `<b>Law.</b> The laws of Bangladesh apply. Disputes go to ${F('arbitration / courts')}.`]); break;
    case 'refund': b = ol(['<b>Hold.</b> A hold is free and ends on its own.', `<b>Cooling-off.</b> The buyer may cancel within ${F('X')} days of paying and receive ${F('X%')} back.`, `<b>Later cancellation.</b> The company keeps ${F('X%')} or ${F('amount')}, whichever is lower.`, `<b>When.</b> Refunds are paid within ${F('X')} days.`, '<b>To whom.</b> Only to the buyer’s own bank account, never in cash or to a third party.', '<b>If the company cannot deliver.</b> The buyer receives all money paid.']); break;
    case 'kyc': b = '<p>Send clear scans or photos on WhatsApp to the official number.</p><table><tr><th>Document</th><th>Needed for</th></tr>' + [['Passport or national ID', 'Booking'], ['2 recent passport-size photos', 'Booking'], ['Proof of address', 'Booking'], ['Nominee: ID and 1 photo', 'Booking'], ['TIN certificate (if any)', 'Registration'], ['Power of attorney, if a representative signs', 'Registration'], ['Receipt for every payment', 'Each payment']].map(([a, c]) => `<tr><td>${a}</td><td>${c}</td></tr>`).join('') + '</table>'; break;
    case 'remit': b = '<h2>How to pay</h2>' + ol(['Use only the accounts in the official bank account letter.', 'Pay by bank transfer from your own account, or through a licensed exchange house.', 'Write the payment reference in the transfer details.', 'Keep the transfer receipt and send it on WhatsApp.', 'You receive a money receipt once the payment is confirmed.']) + '<p class="n">Never hand over cash or pay into a personal account.</p>'; break;
    case 'agreement': b = '<p>An outline of what the sale agreement covers, for the client to read early. The final deed is prepared by legal counsel.</p>' + ol(['Parties', `Schedule A: the land ${F('mouza, khatian, dag')}`, `Schedule B: shop ${esc(shop.code)}, ${esc(floorName)}${shop.size ? ', ' + shop.size + ' sq ft' : ''}`, 'Price and payment schedule', 'Construction and handover', 'Default, cancellation and refund', 'Registration and costs', 'Common areas and association', 'Dispute resolution and law', 'Signatures and witnesses']); break;
    case 'poa': b = '<p>A power of attorney lets a family member act for you: visit the site, sign papers and complete registration.</p>' + ol(['Choose your representative and get their ID copy.', "The company's lawyer prepares the text for this shop.", 'Sign it before the embassy or consulate in your country, which attests it.', 'Send the original to your representative.', 'Your representative has it authenticated as the law requires.', 'Give the company a copy.']) + `<p class="n">${F('legal to confirm the current procedure')}</p>`; break;
    case 'brochure': b = '<p>No brochure has been added for this project yet. Management can paste its link below, or upload the PDF.</p>'; break;
    default: b = `<p>${esc(d.d)}</p>`;
  }
  return head + b;
}

// A standalone page of a document, for Download.
export const docFile = (title, html) => `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font:14px/1.55 Arial,sans-serif;color:#111;max-width:760px;margin:32px auto;padding:0 18px}h1{font-size:21px;margin:6px 0 0}h2{font-size:15px;margin:20px 0 6px}table{width:100%;border-collapse:collapse;margin:12px 0}td,th{border-bottom:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top}th{width:36%;color:#555}td.line{border-bottom:1px solid #999;min-width:45%}.n{color:#555;font-size:12px}.draft{color:#b4442f;font-size:11.5px;font-weight:bold;border:1.5px solid #b4442f;padding:4px 8px;display:inline-block}.f{background:#fff1b8;padding:0 3px}li{margin:6px 0}</style></head><body>${html}</body></html>`;

// The project's brochure: a link saved on the project with the label "Brochure".
export const brochureLink = (project) => ((project?.media?.links || []).find((l) => /brochure/i.test(l.label || '')) || {}).url || '';
// A Google Drive file link as its embeddable preview page; any other link as it is.
export function previewUrl(url) {
  const m = /drive\.google\.com\/file\/d\/([\w-]+)/.exec(url || '');
  return m ? `https://drive.google.com/file/d/${m[1]}/preview` : url;
}

// The floor-plan pages of the brochure PDF, as a PDF of their own. A page counts
// as a floor plan when its text says "FLOOR PLAN" (Basement Parking Floor Plan,
// 1st Floor Plan…). Each page is drawn and re-saved as an image page, which keeps
// the file small enough for WhatsApp. `step(done, total)` reports progress.
export async function buildFloorPlanFile(brochureUrl, name, step = () => {}) {
  const res = await fetch(brochureUrl);
  if (!res.ok) throw new Error(`the brochure could not be read (HTTP ${res.status})`);
  const { openPdf, renderPdfPage } = await import('./floorPlan.js');
  const pdf = await openPdf(await res.blob());
  try {
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const t = await (await pdf.doc.getPage(n)).getTextContent();
      const head = t.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').slice(0, 120);
      if (/floor\s+(furniture\s+)?(layout\s+)?plan/i.test(head)) pages.push(n);
    }
    if (!pages.length) throw new Error('no floor-plan pages were found in the brochure');
    const { jsPDF } = await import('jspdf');
    let out = null;
    for (const [i, n] of pages.entries()) {
      step(i, pages.length);
      const c = await renderPdfPage(pdf.doc, n, 2000);
      const img = c.toDataURL('image/jpeg', 0.85);
      const fmt = [c.width, c.height];
      if (!out) out = new jsPDF({ unit: 'px', format: fmt, orientation: c.width >= c.height ? 'l' : 'p', compress: true, hotfixes: ['px_scaling'] });
      else out.addPage(fmt, c.width >= c.height ? 'l' : 'p');
      out.addImage(img, 'JPEG', 0, 0, c.width, c.height);
      c.width = c.height = 0;
    }
    step(pages.length, pages.length);
    return { file: new File([out.output('blob')], `${name}-Floor-Plans.pdf`, { type: 'application/pdf' }), pages };
  } finally {
    pdf.destroy();
  }
}
