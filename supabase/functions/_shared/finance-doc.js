// Finance documents: the ONE renderer and the statement templates it draws
// with. Every view of a statement uses it:
//   · the public share page of the `finance` Edge Function (?share=<token>)
//   · the app's statement view, the editor's live preview and Print / PDF,
//     which show this page in an iframe (src/components/finance/DocPreview.jsx)
// so the preview, the PDF printed in the app and the shared page are the same
// document. Change a layout here, never in a second copy.
//
// Templates: `default` is WEPRO's own statement. A vendor template (Meta,
// Supabase) lays the statement out the way that vendor prints its receipt;
// choosing that category in the statement editor picks it (templateForCategory).
// A statement built from a vendor template is our internal record of the
// charge, not the vendor's document: it is headed STATEMENT and its footer says
// WEPRO prepared it from the vendor's receipt. Sample receipts, the logo SVG
// sources and how to add a vendor: Invoice-templates/README.md.
//
// Plain JavaScript with relative imports only: Deno (bundled into the function
// on deploy), Node (the test harness) and Vite all load it as is. Every text
// value is escaped; the accent colour is checked against a hex pattern before
// it reaches the stylesheet.

import supabaseLogo from './logos/supabase.js';
import metaLogo from './logos/meta.js';

export const DEFAULT_ACCENT = '#1F6FEB';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const nl = (s) => esc(s).replace(/\n/g, '<br>');
// Rows arrive snake_case from the database (share page) and camelCase in the
// app; reading both here is what makes the two outputs identical.
const pick = (o, camel, snake) => (o ? (o[camel] ?? o[snake]) : undefined);
const validAccent = (a) => /^#[0-9a-f]{3,8}$/i.test(a || '');

// ── money and counts ──
// Spelled out instead of toLocaleString so every runtime prints the same
// characters: BDT with Indian grouping and at most two decimals (BDT 1,00,000),
// other currencies with Western grouping and two decimals ($1,234.50).
const SYMBOLS = { BDT: 'BDT ', USD: '$', EUR: '€', GBP: '£', AED: 'AED ' };
export const CURRENCIES = Object.keys(SYMBOLS);
const group3 = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const groupIndian = (int) => { const head = int.slice(0, -3), tail = int.slice(-3); return head ? `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${tail}` : tail; };
export function fmtMoney(n, currency = 'BDT') {
  const v = Math.round(num(n) * 100) / 100;
  const [int, dec] = Math.abs(v).toFixed(2).split('.');
  const sign = v < 0 ? '-' : '';
  if (currency === 'BDT') { const frac = dec.replace(/0+$/, ''); return `BDT ${sign}${groupIndian(int)}${frac ? '.' + frac : ''}`; }
  return `${sign}${SYMBOLS[currency] ?? `${currency} `}${group3(int)}.${dec}`;
}
export const money = (n) => fmtMoney(n, 'BDT');
export const fmtCount = (n) => (num(n) ? group3(String(Math.round(num(n)))) : '—');
// Impressions bought: 1,000 × total cost ÷ CPM (cost per 1,000 impressions).
// Used by the editor as you type and by the finance function on save, so a
// Meta statement's estimated impressions always follow its amounts and CPM.
export const impressionsFor = (amount, cpm) => (num(cpm) > 0 ? Math.round(1000 * num(amount) / num(cpm)) : 0);

// A Meta ad set's template columns (`extra`) for its amount at the statement
// CPM. Impressions typed from the vendor receipt stay as typed: est false, or
// (lines saved before est existed) a number with no est. Every other ad set
// gets 1,000 × amount ÷ CPM, marked est; with no CPM an estimate is dropped
// rather than left behind from an older CPM.
export const adSetExtra = (extra, amount, cpm) => {
  const x = { ...(extra || {}) };
  const typed = x.est === false || (x.est !== true && x.impressions != null && x.impressions !== '');
  if (typed) return x;
  if (num(cpm) > 0) return { ...x, cpm: num(cpm), impressions: impressionsFor(amount, cpm), est: true };
  if (x.est) { delete x.impressions; delete x.cpm; delete x.est; }
  return x;
};

// ── dates ──
const ymd = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m && +m[2] >= 1 && +m[2] <= 12 ? m : null; };
// 2026-10-14 → 14 Oct 2026. Anything else is shown as it was given.
export function docDate(iso) { const m = ymd(iso); return m ? `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : String(iso || ''); }
// 2026-10-14 → Oct 14, 2026 (how US vendors print it).
const usDate = (iso) => { const m = ymd(iso); return m ? `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}` : esc(iso || '—'); };
// 14:05 → 2:05 PM, 00:30 → 12:30 AM. Times are stored as HH:MM (24-hour) and
// shown on a 12-hour clock; anything else is shown as it was given.
export function time12(hm) { const m = /^(\d{2}):(\d{2})$/.exec(String(hm || '')); return m ? `${+m[1] % 12 || 12}:${m[2]} ${+m[1] < 12 ? 'AM' : 'PM'}` : String(hm || ''); }
// ── statement IDs ──
// A vendor statement's IDs are either copied from the vendor's receipt or, when
// the receipt has none, generated by WEPRO (layout.vendorRefGen /
// layout.paymentRefGen). A generated one always prints as a WEPRO internal
// reference, never under the vendor's own label.
export const INTERNAL_NOTE = 'References marked “WEPRO internal” were generated by WEPRO for its own records; the vendor did not issue them.';
// Random IDs shaped like Meta's: a 10-character Reference ID (ZJW859ASS4) and a
// Transaction ID of two 17-digit numbers. The editor shows them on a new Meta
// draft; the finance function checks each against every ID ever issued
// (finance_statement_ids, migration 0026) on the first save and locks them.
const randomWords = (n) => crypto.getRandomValues(new Uint32Array(n));
const REF_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const digits = (n) => Array.from(randomWords(n), (x, i) => (i ? x % 10 : 1 + (x % 9))).join(''); // no leading 0
export const newReferenceId = () => Array.from(randomWords(10), (x) => REF_CHARS[x % REF_CHARS.length]).join('');
export const newTransactionId = () => `${digits(17)}-${digits(17)}`;
// A generated Invoice no. carries WEPRO's prefix, never Meta's FBADS-…: it can't
// coincide with a real Meta invoice number or read as one Meta issued.
export const newInvoiceNo = () => `WEPRO-INV-${digits(9)}`;
export const REFERENCE_ID_RE = /^[A-Z0-9]{10}$/;
export const TRANSACTION_ID_RE = /^[1-9]\d{16}-[1-9]\d{16}$/;
export const INVOICE_NO_RE = /^WEPRO-INV-[1-9]\d{8}$/;
// End of a period `months` long starting on `from` (YYYY-MM-DD): the day before
// the same date `months` later, so 2026-10-12 + 12 → 2027-10-11.
export function periodEnd(from, months) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !months) return '';
  const [y, m, day] = from.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + Number(months) + 1, 0)).getUTCDate(); // clamp Jan 31 + 1 → Feb 28
  return new Date(Date.UTC(y, m - 1 + Number(months), Math.min(day, last) - 1)).toISOString().slice(0, 10);
}
// The service period ("Oct 12, 2026 – Oct 11, 2027"), or '' when unset.
const periodText = (L) => (L?.periodFrom || L?.periodTo ? `${L.periodFrom ? usDate(L.periodFrom) : '…'} – ${L.periodTo ? usDate(L.periodTo) : '…'}` : '');

// ── categories (statements and expenses) ──
// The stored value is plain text and is never rewritten by reading it: one of
// the fixed names, or any other text, shown as "Others · <text>". That keeps
// older values ("Salaries & fees", "Other") and custom names intact through
// filtering, editing and reopening a draft.
export const CATEGORIES = ['Meta', 'Supabase', 'Claude', 'CRM', 'Marketing', 'Events', 'Software', 'Travel', 'Office'];
export const OTHERS = 'Others';
const fixedCategory = (t) => CATEGORIES.find((c) => c.toLowerCase() === t.toLowerCase()) || null;

// stored text → { key: a fixed name | 'Others' | '' (uncategorised), name: the custom text, label }
export function categoryOf(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return { key: '', name: '', label: 'Uncategorised' };
  const fixed = fixedCategory(raw);
  if (fixed) return { key: fixed, name: '', label: fixed };
  if (raw.toLowerCase() === OTHERS.toLowerCase()) return { key: OTHERS, name: '', label: OTHERS };
  return { key: OTHERS, name: raw, label: `${OTHERS} · ${raw}` };
}

// What a category picker stores. Custom text that spells a fixed name ("meta")
// is stored as that name.
export function categoryValue(key, name) {
  if (key !== OTHERS) return key || '';
  const t = String(name || '').trim();
  return t ? fixedCategory(t) || t : OTHERS;
}

// ── statement templates ──
// Our billing block, as vendors print it under "Bill to".
const OUR_ORG = "weprolead's Org\nLk sunrise.\ndhaka, BD\nBangladesh\nmuthoai.business@gmail.com";

// columns: 'qty' (Quantity · Rate · Amount, the default) or 'impressions'
// (Impressions · CPM · Amount: an ad line whose impressions the editor works
// out from amount ÷ CPM × 1000).
export const TEMPLATES = {
  default: {
    id: 'default',
    name: 'WEPRO statement',
    layout: 'standard',
    currency: 'BDT',
  },
  supabase: {
    id: 'supabase',
    name: 'Supabase',
    layout: 'receipt',
    currency: 'USD',
    accent: '#3ECF8E',
    logo: supabaseLogo,
    wordmark: 'supabase',
    vendor: {
      name: 'Supabase Pte. Ltd.',
      address: ['65 Chulia Street', '#38-02/03 OCBC Centre', 'Singapore, 01 049513', 'Singapore'],
    },
    refLabel: 'Invoice number',
    defaults: {
      title: 'Supabase subscription',
      billTo: OUR_ORG,
      lines: [{ description: 'Pro Plan', qty: 1, unitPrice: 0 }],
      months: 12, // billing period: the editor fills From–To from the receipt date
    },
  },
  meta: {
    id: 'meta',
    name: 'Meta',
    layout: 'adSpend', // campaigns → ad sets, the way Meta's billing page lists them
    columns: 'impressions',
    currency: 'USD',
    accent: '#0866FF',
    logo: metaLogo,
    wordmark: '', // the logo already carries the word "Meta"
    logoHeight: 30,
    vendor: { // as printed on our Meta receipts (Invoice-templates/Meta.pdf)
      name: 'Meta Platforms Ireland Limited',
      address: ['Merrion Road', 'Dublin 4', 'D04 X2K5', 'Ireland'],
    },
    to: ['Bangladesh', 'BIN: 000414907-0503'], // the fixed lines opposite the vendor on Meta.pdf
    refLabel: 'Transaction ID',
    paymentMethods: ['Credit card', 'Prepaid balance', 'Agency'],
    defaults: {
      title: 'Meta ads',
      billTo: '', // client name: typed per statement
      lines: [{ description: '', qty: 1, unitPrice: 0, extra: { campaign: '', impressions: '' } }],
      months: 1,
      paymentMethod: 'Prepaid balance',
      productType: 'Meta ads',
      cpm: 0.73, // our average on Meta.pdf (135.37 ÷ 185,125 × 1,000); editable per statement
    },
  },
};
export const TEMPLATE_LIST = Object.values(TEMPLATES);
export const templateOf = (id) => TEMPLATES[id] || TEMPLATES.default;
// The statement category that picks a vendor template; any other category
// uses WEPRO's own statement.
const CATEGORY_TEMPLATES = { Meta: 'meta', Supabase: 'supabase' };
export const templateForCategory = (value) => CATEGORY_TEMPLATES[categoryOf(value).key] || 'default';

// ── payment, from the expenses a statement's lines link to ──
// Separate from the document status (Draft / Final): a draft can be paid.
// Lines without an expense carry no payment information and are not counted.
export const PAYMENT_LABEL = { PAID: 'Paid', PARTIAL: 'Partially paid', COMMITTED: 'Committed', NONE: 'Not linked' };
const linkedIds = (lines) => new Set((lines || []).map((l) => pick(l, 'expenseId', 'expense_id')).filter(Boolean));
export function paymentStatus(lines, expenses) {
  const ids = linkedIds(lines);
  const kinds = (expenses || []).filter((e) => ids.has(e.id)).map((e) => e.kind);
  if (!kinds.length) return 'NONE';
  const committed = kinds.filter((k) => k === 'COMMITTED').length;
  return committed === 0 ? 'PAID' : committed === kinds.length ? 'COMMITTED' : 'PARTIAL';
}

// Lines whose amount no longer matches the expense they link to (the expense
// was edited after the line was made, or the line was). A statement with any
// of these can't be finalized. Compared in whole paisa. Expenses are recorded
// in BDT, so only a BDT statement can be compared; a statement in another
// currency is not checked until expenses carry their original currency.
const paisa = (v) => Math.round(num(v) * 100);
export function staleLines(lines, expenses, currency = 'BDT') {
  if (currency !== 'BDT') return [];
  const byId = new Map((expenses || []).map((e) => [e.id, e]));
  const out = [];
  (lines || []).forEach((l, index) => {
    const e = byId.get(pick(l, 'expenseId', 'expense_id'));
    if (!e) return;
    const amount = num(l.qty ?? 1) * num(pick(l, 'unitPrice', 'unit_price'));
    if (paisa(amount) !== paisa(e.amount)) out.push({ index, expenseId: e.id, amount, expenseAmount: num(e.amount) });
  });
  return out;
}

// The statement as the renderer reads it: { invoice, lines, budget, expenses }
// rows in either case style → one plain object. `expenses` may hold more than
// the linked ones; only those the lines point at count.
export function statementDoc({ invoice, lines, budget, expenses } = {}) {
  const inv = invoice || {};
  const layout = inv.layout || {};
  const t = templateOf(layout.template);
  const currency = CURRENCIES.includes(layout.currency) ? layout.currency : t.currency;
  const rows = (lines || []).map((l) => {
    const qty = num(l.qty ?? 1), unitPrice = num(pick(l, 'unitPrice', 'unit_price'));
    return { description: String(l.description || ''), qty, unitPrice, amount: qty * unitPrice, extra: l.extra && typeof l.extra === 'object' ? l.extra : {} };
  });
  return {
    template: t.id,
    currency,
    title: String(inv.title || '') || 'Expense statement',
    number: String(inv.number || ''),
    final: inv.status === 'FINAL',
    issuedOn: String(pick(inv, 'issuedOn', 'issued_on') || ''),
    fromName: String(pick(inv, 'fromName', 'from_name') || ''),
    billTo: String(pick(inv, 'billTo', 'bill_to') || ''),
    notes: String(inv.notes || ''),
    preparedBy: String(pick(inv, 'createdByName', 'created_by_name') || ''),
    budgetTitle: String(budget?.title || ''),
    category: inv.category ? categoryOf(inv.category).label : '',
    payment: paymentStatus(lines, expenses),
    accent: validAccent(layout.accent) ? layout.accent : t.accent || DEFAULT_ACCENT,
    showQty: layout.showQty !== false,
    footer: String(layout.footer || ''),
    layout: { ...layout, template: t.id, currency }, // a vendor template's fields (reference, period, payment block)
    lines: rows,
    total: rows.reduce((s, r) => s + r.amount, 0),
  };
}

// ── A4 pages ──
// Every template lays its statement out on A4 pages, 210 × 297 mm with 14 mm
// margins, and prints them one sheet each (@page margin 0, the page box carries
// the margins). The renderer writes one page holding everything:
//   .pages[data-pages] > section.pg.sheet > .draft (watermark), .pg-body (the
//   blocks, top to bottom), .pg-foot (the document footer)
// and paginateDoc() then moves the blocks onto as many pages as they need,
// measuring each one in the page itself. Nothing is scaled, squeezed or cut to
// make it fit: a block that does not fit goes to the next page, and blocks
// marked as splittable continue there:
//   data-pg="rows"   a table, split between rows; its thead repeats on every
//                    page and its tfoot (the total) stays with the last row
//   data-pg="list"   split between its children (Meta's campaigns)
//   data-pg="group"  split between its children; the [data-pg-head] child
//                    repeats, marked .cont (Meta: "(continued)")
//   data-pg="keep"   a heading: never left alone at the bottom of a page
//   data-pg="tail"   totals under a table: never start a page without at
//                    least its last row
// The footer goes at the foot of the last page (or of one more page when it
// does not fit), and each page gets "Page i of n".
//
// The same pages are the preview, the print and the PDF: in the app,
// DocPreview runs paginateDoc on its frame (the frame itself runs no script)
// and prints that frame; the share page runs it from an inline script.
const PAGE_CSS = `
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body.embed{background:#e9ebee}
  .fit{margin:0 auto;overflow:hidden}
  .pages{width:210mm;margin:0 auto;display:flex;flex-direction:column;gap:16px}
  body.page .pages{margin-bottom:32px}
  .pg{position:relative;width:210mm;min-height:297mm;padding:14mm;background:#fff;display:flex;flex-direction:column;overflow:hidden}
  body.page .pg{box-shadow:0 8px 28px rgba(0,0,0,.08)}
  .pages[data-paged] .pg{height:297mm;min-height:0}
  .pages[data-paged] .pg[data-overflow]{height:auto;min-height:297mm}
  .pg-body,.pg-foot{display:flow-root}
  .pg-body>:first-child{margin-top:0}
  .pg-foot{margin-top:auto}
  .pg-no{position:absolute;left:14mm;right:14mm;bottom:6mm;display:flex;justify-content:space-between;gap:12px;font:9px/1.2 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#8d949e}
  @page{size:A4;margin:0}
  @media print{html,body,body.page,body.embed{background:#fff}.bar{display:none!important}.fit{width:auto!important;height:auto!important;overflow:visible}
    .pages{display:block;width:auto;margin:0;transform:none!important}.pg{box-shadow:none!important;break-after:page;page-break-after:always}.pg:last-child{break-after:auto;page-break-after:auto}}`;

// Spreads a rendered statement over A4 pages (see the comment above). `doc` is
// the statement's document: the app's preview frame, or the share page itself.
// Returns the page count, or 0 when the document isn't laid out yet (a frame
// that is hidden) so it can be called again once it is. Runs once per
// document. Self-contained (no outside names), because the share page embeds
// its source text.
export function paginateDoc(doc) {
  const root = doc.querySelector('[data-pages]');
  if (!root) return 0;
  if (root.hasAttribute('data-paged')) return root.querySelectorAll('.pg').length;
  const src = root.querySelector('.pg');
  if (!src || !src.getBoundingClientRect().height) return 0;
  const win = doc.defaultView;
  const srcBody = src.querySelector('.pg-body');
  const mark = src.querySelector('.draft');
  let foot = src.querySelector('.pg-foot');
  if (foot && !foot.children.length) foot = null;
  const blocks = Array.from(srcBody.children);
  root.setAttribute('data-paged', '');
  src.remove();

  let page = null, body = null;
  const open = () => {
    page = src.cloneNode(false);
    if (mark) page.appendChild(mark.cloneNode(true));
    body = srcBody.cloneNode(false);
    page.appendChild(body);
    root.appendChild(page);
  };
  const px = (el, prop) => parseFloat(win.getComputedStyle(el)[prop]) || 0;
  // Ends inside the page's content box (above the bottom margin)?
  const fits = (el) => el.getBoundingClientRect().bottom + px(el, 'marginBottom') <= page.getBoundingClientRect().bottom - px(page, 'paddingBottom') + 0.5;
  const kindOf = (el) => (el.getAttribute && el.getAttribute('data-pg')) || '';
  const splits = (el) => ['rows', 'list', 'group'].includes(kindOf(el));
  const boxOf = (el) => (kindOf(el) === 'rows' ? el.tBodies[0] : el);
  const itemsOf = (el) => Array.from(boxOf(el).children).filter((c) => !c.hasAttribute('data-pg-head'));
  // An empty copy of a splittable block: a table's thead, a group's head (as
  // "continued" when `cont`), and an empty place for the items.
  const shell = (el, cont) => {
    const s = el.cloneNode(false);
    if (kindOf(el) === 'rows') {
      if (el.tHead) s.appendChild(el.tHead.cloneNode(true));
      s.appendChild(el.tBodies[0].cloneNode(false));
    } else {
      const h = Array.from(el.children).find((c) => c.hasAttribute('data-pg-head'));
      if (h) { const hc = h.cloneNode(true); if (cont) hc.classList.add('cont'); s.appendChild(hc); }
    }
    return s;
  };
  // Keeps the part of `el` that fits on this page. Returns what is left for
  // the next page (a new element), `el` itself when none of it fits here, or
  // null when all of it does. `outer` is the top-level block, the one measured.
  const fill = (el, outer) => {
    if (fits(outer)) return null;
    if (!splits(el)) return el;
    const box = boxOf(el), items = itemsOf(el);
    const tail = kindOf(el) === 'rows' ? el.tFoot : null;
    items.forEach((x) => x.remove());
    if (tail) tail.remove();
    let i = 0, left = null;
    for (; i < items.length; i++) {
      const last = i === items.length - 1;
      box.appendChild(items[i]);
      if (last && tail) el.appendChild(tail);
      if (fits(outer)) continue;
      if (last && tail) tail.remove();
      // the total never starts a page alone: the last row goes with it
      left = last && tail ? items[i] : fill(items[i], outer);
      if (left === items[i]) items[i].remove();
      break;
    }
    if (i === items.length) return null;
    if (i === 0 && left === items[0]) { // none of it fits here: it moves on whole
      items.forEach((x) => box.appendChild(x));
      if (tail) el.appendChild(tail);
      return el;
    }
    const rest = shell(el, true), rbox = boxOf(rest);
    if (left) rbox.appendChild(left);
    items.slice(i + 1).forEach((x) => rbox.appendChild(x));
    if (tail) rest.appendChild(tail);
    return rest;
  };
  const place = (el, fresh) => {
    body.appendChild(el);
    const rest = fill(el, el);
    if (!rest) return;
    const moved = [];
    if (rest === el) {
      // taller than a whole page and not splittable: kept whole, the page
      // grows instead of cutting it (the field limits keep this from happening)
      if (fresh || body.children.length === 1) { page.setAttribute('data-overflow', ''); return; }
      el.remove();
      // a heading at the bottom of the page goes along with what follows it
      while (body.children.length > 1 && kindOf(body.lastElementChild) === 'keep') moved.unshift(body.lastElementChild);
      // totals take the last row of the table above them along
      const prev = body.lastElementChild;
      if (kindOf(el) === 'tail' && prev && kindOf(prev) === 'rows' && prev.tBodies[0].rows.length > 1) {
        const frag = shell(prev, true);
        frag.tBodies[0].appendChild(prev.tBodies[0].rows[prev.tBodies[0].rows.length - 1]);
        moved.push(frag);
      }
    }
    open();
    moved.forEach((m) => body.appendChild(m));
    place(rest, true);
  };

  open();
  blocks.forEach((b) => place(b, false));
  if (foot) {
    page.appendChild(foot);
    if (!fits(foot) && body.children.length) { foot.remove(); open(); page.appendChild(foot); }
  }
  const pages = Array.from(root.querySelectorAll('.pg'));
  const label = root.getAttribute('data-label') || '';
  pages.forEach((pg, i) => {
    const no = doc.createElement('div');
    no.className = 'pg-no';
    no.setAttribute('aria-hidden', 'true');
    const l = doc.createElement('span'), r = doc.createElement('span');
    l.textContent = label;
    r.textContent = `Page ${i + 1} of ${pages.length}`;
    no.append(l, r);
    pg.appendChild(no);
  });
  return pages.length;
}

// The share page paginates itself, then scales its pages down (a transform,
// so the pages themselves never change) when the screen is narrower than A4.
const SHARE_SCRIPT = `<script>(() => {
  const paginate = ${paginateDoc};
  const fit = () => {
    const box = document.querySelector('.fit'), pages = document.querySelector('.pages');
    if (!box || !pages) return;
    const w = pages.offsetWidth, s = Math.min(1, (document.documentElement.clientWidth - 16) / w);
    pages.style.transformOrigin = '0 0';
    pages.style.transform = s < 1 ? 'scale(' + s + ')' : '';
    box.style.width = s < 1 ? w * s + 'px' : '';
    box.style.height = s < 1 ? pages.offsetHeight * s + 'px' : '';
  };
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => { paginate(document); fit(); });
  addEventListener('resize', fit);
})();</script>`;

// The page around a template's blocks: the share page's bar (chrome) or the
// bare frame, one A4 page holding the blocks and the footer, and on the share
// page the script that paginates it.
function pageHtml(d, chrome, { css, bar, body, foot, label: own }) {
  const label = own ?? `${d.number ? `Statement ${d.number}` : 'Draft statement'} · ${d.title}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(d.number || 'Draft')} · ${esc(d.title)}</title>
<style>${PAGE_CSS}${css}</style></head><body class="${chrome ? 'page' : 'embed'}">
${chrome ? bar : ''}<div class="fit"><div class="pages" data-pages data-label="${esc(label)}"><section class="pg sheet">${d.final ? '' : '<div class="draft" aria-hidden="true">DRAFT</div>'}<div class="pg-body">${body}</div><div class="pg-foot">${foot}</div></section></div></div>${chrome ? SHARE_SCRIPT : ''}
</body></html>`;
}

// ── WEPRO's own statement (the default template) ──
// Title and logo, a key list beside the large total, the line table, then the
// From / To blocks and the footnote at the foot of the last page. `chrome:
// true` is the standalone share page (grey backdrop, a bar with the print
// button); false is the bare pages for the app's iframe. The pages and the
// print stylesheet are the same in both.
function standardPage(d, chrome) {
  const a = d.accent;
  const m = (n) => fmtMoney(n, d.currency);
  const status = d.final ? 'Final' : 'Draft';
  const cols = d.showQty ? 4 : 2;
  const head = `<tr><th>Description</th>${d.showQty ? '<th class="c">Qty</th><th class="r">Unit price</th>' : ''}<th class="r">Amount</th></tr>`;
  const rows = d.lines.length
    ? d.lines.map((l) => `<tr><td>${esc(l.description) || '—'}</td>${d.showQty ? `<td class="c">${l.qty}</td><td class="r">${m(l.unitPrice)}</td>` : ''}<td class="r">${m(l.amount)}</td></tr>`).join('')
    : `<tr><td class="empty" colspan="${cols}">No lines yet</td></tr>`;
  const count = `${d.lines.length} line${d.lines.length === 1 ? '' : 's'}`;
  const period = periodText(d.layout);
  const body = `
<header class="top"><div><h1>${esc(d.title)}</h1><p class="sub">${d.budgetTitle ? `Budget: ${esc(d.budgetTitle)}` : 'Internal expense statement'}</p></div><div class="logo">WEPRO</div></header>
<section class="summary">
<dl class="keys"><div><dt>Statement no.</dt><dd>${esc(d.number) || 'Assigned on save'}</dd></div><div><dt>Date</dt><dd>${esc(docDate(d.issuedOn)) || '—'}</dd></div>${period ? `<div><dt>Period</dt><dd>${period}</dd></div>` : ''}${d.category ? `<div><dt>Category</dt><dd>${esc(d.category)}</dd></div>` : ''}${d.payment && d.payment !== 'NONE' ? `<div><dt>Payment</dt><dd>${PAYMENT_LABEL[d.payment]}</dd></div>` : ''}<div><dt>Prepared by</dt><dd>${esc(d.preparedBy) || '—'}</dd></div></dl>
<div class="amount"><div class="state">${status}</div><div class="big">${m(d.total)}</div><div class="cap">Total of ${count}</div></div>
</section>
<h2 class="items-h" data-pg="keep">Expenses</h2>
<table data-pg="rows"><thead>${head}</thead><tbody>${rows}</tbody><tfoot><tr><td class="r" colspan="${cols - 1}">Total</td><td class="r">${m(d.total)}</td></tr></tfoot></table>
${d.notes ? `<p class="notes">${esc(d.notes)}</p>` : ''}`;
  const foot = `<footer class="foot">
<div class="parties"><div><b>From</b><span class="party">${esc(d.fromName) || '—'}</span></div><div class="to"><b>To</b><span class="party">${esc(d.billTo) || '—'}</span>${d.number ? `<span>Statement no. ${esc(d.number)}</span>` : ''}</div></div>
<p class="fine">${d.footer ? `${esc(d.footer)} · ` : ''}Internal expense statement, not a tax invoice.</p>
</footer>`;
  const bar = `<div class="bar"><span>${esc(d.number) || 'Draft'} · ${status} statement</span><button type="button" class="btn" onclick="window.print()">Print / Save as PDF</button></div>\n`;
  const css = `
:root{color-scheme:light}*{box-sizing:border-box}html,body{margin:0}
body{font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1c1e21;-webkit-text-size-adjust:100%}
body.page{background:#f0f2f5}
.bar{max-width:210mm;margin:20px auto 12px;padding:0 16px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;color:#606770}
.btn{border:0;border-radius:8px;padding:9px 16px;font:inherit;font-weight:600;color:#fff;background:${a};cursor:pointer}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding-bottom:14px;border-bottom:1px solid #dadde1}
h1{margin:0;font-size:22px;font-weight:400;letter-spacing:-.2px}.sub{margin:3px 0 0;font-size:12px;color:#606770}
.logo{font-size:20px;font-weight:700;letter-spacing:.5px;color:${a};white-space:nowrap}
.summary{display:flex;justify-content:space-between;gap:24px;padding:40px 0 36px;border-bottom:1px solid #dadde1}
.keys{margin:0}.keys div+div{margin-top:16px}.keys dt{font-size:12px;color:#606770}.keys dd{margin:2px 0 0;font-size:12px;font-weight:700}
.amount{text-align:right;align-self:center}.state{font-size:17px}.big{font-size:34px;font-weight:300;letter-spacing:-.5px;margin:6px 0 8px;white-space:nowrap}.cap{font-size:12px;color:#606770}
.items-h{margin:32px 0 10px;font-size:13px;font-weight:700}
table{width:100%;border-collapse:collapse}
th{font-size:11.5px;font-weight:500;color:#606770;text-align:left;padding:10px 0;border-top:1px solid #dadde1;border-bottom:1px dashed #dadde1}
td{font-size:12.5px;padding:13px 0;border-bottom:1px solid #e4e6eb;vertical-align:top}th+th,td+td{padding-left:12px}
.c{text-align:center}.r{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.empty{color:#8d949e;text-align:center}
tfoot td{border-bottom:0;font-size:13.5px;font-weight:700;padding-top:16px}tfoot td:last-child{color:${a}}
.notes{margin:20px 0 0;font-size:12px;color:#4b4f56;white-space:pre-line}
.foot{padding-top:56px}
.parties{display:flex;justify-content:space-between;gap:24px;padding-bottom:10px;border-bottom:1px solid #dadde1;font-size:11.5px;line-height:1.55;color:#8d949e}
.parties b{display:block;color:#606770;font-weight:600}.parties span{display:block}.parties .to{text-align:right}.party{white-space:pre-line}
.fine{margin:18px 0 0;font-size:11px;color:#8d949e}
.draft{position:absolute;top:42%;left:50%;transform:translate(-50%,-50%) rotate(-28deg);font-size:120px;font-weight:800;letter-spacing:.12em;color:rgba(245,158,11,.16);pointer-events:none;white-space:nowrap;user-select:none}`;
  return pageHtml(d, chrome, { css, bar, body, foot });
}

// ── vendor templates ──
// A line's description may carry a second line (a SKU, a note) under it; with
// none, `fallbackHtml` (the statement period, already escaped) goes there, the
// way vendors print it.
const descCell = (desc, fallbackHtml = '') => {
  const [head, ...rest] = String(desc || '—').split('\n');
  const sub = rest.length ? nl(rest.join('\n')) : fallbackHtml;
  return `<div class="d1">${esc(head)}</div>${sub ? `<div class="d2">${sub}</div>` : ''}`;
};

const VENDOR_CSS = `
  :root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#eef0f3;font:14px/1.5 -apple-system,"Segoe UI",Inter,Roboto,sans-serif;color:#1a1d23}
  .bar{max-width:210mm;margin:24px auto 12px;padding:0 16px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
  .btn{border:1px solid #cfd3d9;background:#fff;border-radius:8px;padding:8px 14px;font:inherit;font-weight:600;cursor:pointer}
  .draft{position:absolute;top:42%;left:50%;transform:translate(-50%,-50%) rotate(-28deg);font-size:120px;font-weight:800;letter-spacing:.12em;color:rgba(245,158,11,.16);pointer-events:none;white-space:nowrap;user-select:none}
  table{width:100%;border-collapse:collapse}.c{text-align:center}.r{text-align:right;white-space:nowrap}
  .d1{font-weight:500}.d2{font-size:12.5px;color:#4b5563;margin-top:2px}
`;

// A vendor receipt laid out the way the vendor prints it (Supabase): vendor
// block top left, bill-to and the reference keys side by side, the line
// table, then subtotal and amount paid.
function receipt(d, t) {
  const cur = d.currency, L = d.layout;
  const v = t.vendor || {};
  const period = periodText(L);
  const imp = t.columns === 'impressions';
  const head = imp
    ? '<th>Description</th><th class="q">Impressions</th><th class="r">CPM</th><th class="r">Amount</th>'
    : '<th>Description</th><th class="q">Quantity</th><th class="r">Rate</th><th class="r">Amount</th>';
  const rows = d.lines.map((l) => {
    const mid = imp
      ? `<td class="q">${fmtCount(l.extra.impressions)}</td><td class="r">${l.extra.cpm ? fmtMoney(l.extra.cpm, cur) : '—'}</td>`
      : `<td class="q">${l.qty}</td><td class="r">${fmtMoney(l.unitPrice, cur)}</td>`;
    return `<tr><td>${descCell(l.description, period)}</td>${mid}<td class="r">${fmtMoney(l.amount, cur)}</td></tr>`;
  }).join('');
  const totalImp = imp ? d.lines.reduce((s, l) => s + num(l.extra.impressions), 0) : 0;
  const ref = L.vendorRef, refGen = !!(ref && L.vendorRefGen);
  const css = `
    .hd{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:28px}
    .vname{font-size:26px;font-weight:700;letter-spacing:-.4px;display:flex;align-items:center;gap:10px}.vname i{width:12px;height:28px;border-radius:3px;background:${d.accent};display:inline-block}
    .vname.logo{font-size:34px;font-weight:600;letter-spacing:-.8px;gap:12px}.vname svg{width:auto;height:${t.logoHeight || 44}px;display:block}
    .kind{font-size:28px;font-weight:300;letter-spacing:.02em}
    .vaddr{font-size:13.5px;line-height:1.5;margin-bottom:26px}
    .mid{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:30px;font-size:13.5px}.mid b.l{display:block;font-weight:600}
    .keys{display:grid;grid-template-columns:auto 1fr;column-gap:40px;row-gap:8px;align-self:start}.keys span{color:#374151}.keys .em{font-weight:700}
    th{font-size:11.5px;font-weight:600;text-align:left;padding:0 8px 8px;border-bottom:1px solid #9ca3af}th.q,td.q{text-align:center}th.r{text-align:right}
    td{padding:16px 8px 10px;vertical-align:top;font-size:13.5px}
    .sums{display:grid;grid-template-columns:auto auto;justify-content:end;column-gap:44px;row-gap:10px;margin:26px 8px 0;font-size:13.5px}.sums .em{font-weight:700}
    .memo{margin-top:34px;font-size:13px;white-space:pre-line}
    .foot{margin-top:40px;padding-top:12px;border-top:1px solid #e6e8eb;font-size:11.5px;color:#6b7280}`;
  const body = `
<div class="hd">${t.logo ? `<div class="vname logo">${t.logo}${esc(t.wordmark ?? t.name)}</div>` : `<div class="vname"><i></i>${esc(t.name)}</div>`}<div class="kind">STATEMENT</div></div>
<div class="vaddr">${esc(v.name || d.fromName || '')}${(v.address || []).map((a) => '<br>' + esc(a)).join('')}</div>
<div class="mid">
  <div><b class="l">Bill to:</b>${nl(d.billTo) || '—'}</div>
  <div class="keys">
    <span>${esc(refGen ? 'WEPRO internal reference' : t.refLabel || 'Reference')}</span><span>${esc(ref || '—')}</span>
    <span>Statement no.</span><span>${esc(d.number) || 'Assigned on save'}</span>
    <span>Receipt date</span><span>${usDate(d.issuedOn)}</span>
    ${L.paidOn ? `<span>Payment date</span><span>${usDate(L.paidOn)}</span>` : ''}
    <span class="em">Amount paid</span><span class="em">${fmtMoney(d.total, cur)}</span>
  </div>
</div>
<table data-pg="rows"><thead><tr>${head}</tr></thead><tbody>${rows || `<tr><td colspan="4" class="c" style="color:#8d949e">No lines yet</td></tr>`}</tbody></table>
<div class="sums" data-pg="tail">${imp ? `<span>Impressions</span><span class="r">${fmtCount(totalImp)}</span>` : ''}<span>Subtotal</span><span class="r">${fmtMoney(d.total, cur)}</span><span class="em">Amount paid</span><span class="r em">${fmtMoney(d.total, cur)}</span></div>
${d.notes ? `<div class="memo">Memo:\n${esc(d.notes)}</div>` : ''}`;
  const foot = `<div class="foot">Prepared by WEPRO from ${esc(t.name)} receipt${ref && !refGen ? ' ' + esc(ref) : ''}${d.budgetTitle ? ' · Budget: ' + esc(d.budgetTitle) : ''}${d.footer ? ' · ' + esc(d.footer) : ''}${refGen ? '<br>' + esc(INTERNAL_NOTE) : ''}</div>`;
  return { css, body, foot };
}

// Ad spend, laid out like Meta's receipt (Invoice-templates/Meta.pdf): payment
// details beside a large "Paid" figure, then each campaign with its period and
// total over its ad sets (impressions, amount). Lines are ad sets; a line's
// extra.campaign groups it. Headed as our statement, footer names WEPRO.
function adSpend(d, t) {
  const L = d.layout, cur = d.currency;
  const v = t.vendor || {};
  const from = L.periodFrom ? docDate(L.periodFrom) : '';
  const range = L.periodFrom || L.periodTo ? `From ${esc(from) || '…'}, 00:00 to ${L.periodTo ? esc(docDate(L.periodTo)) : '…'}, ${esc(L.periodToTime || '23:59')}` : '';
  const groups = [];
  for (const l of d.lines) {
    const name = String(l.extra.campaign || '').trim() || 'Campaign';
    let g = groups.find((x) => x.name === name);
    if (!g) groups.push(g = { name, lines: [] });
    g.lines.push(l);
  }
  const paidOn = L.paidOn || d.issuedOn;
  // Generated IDs print under WEPRO's own label; the Reference number only prints under a payment method.
  const txnGen = !!(L.vendorRef && L.vendorRefGen), payGen = !!(L.paymentMethod && L.paymentRef && L.paymentRefGen);
  const client = String(d.billTo || '').split('\n')[0];
  const css = `
    .sheet{font-family:Helvetica,Arial,sans-serif;color:#1c1e21}
    .h{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding-bottom:10px;border-bottom:1px solid #ccd0d5}
    .h .t{font-size:19px;font-weight:400}.h .a{font-size:12px;margin-top:2px}.h svg{height:${t.logoHeight || 30}px;width:auto;display:block;margin-top:4px}
    .pay{display:flex;justify-content:space-between;gap:24px;padding:44px 0 50px;border-bottom:1px solid #ccd0d5;font-size:12.5px}
    .pay .k{margin-bottom:16px}.pay .k b{display:block;font-weight:700}.pay .k span{display:block}
    .paid{text-align:right;align-self:center}.paid .l{font-size:19px}.paid .v{font-size:40px;font-weight:300;margin:6px 0 10px}.paid .s{font-size:12px}
    h3{font-size:15px;font-weight:700;margin:44px 0 12px}
    .camps{border-bottom:1px solid #ccd0d5}.camp{border-top:1px solid #ccd0d5}
    .ch{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px dashed #ccd0d5;font-size:12.5px}
    .ch b{display:block;margin-bottom:6px}.ch .tot{font-weight:700}.ch.cont b::after{content:" (continued)";font-weight:400;color:#606770}
    .as{display:grid;grid-template-columns:1fr 1fr auto;padding:12px 0 12px 64px;font-size:12.5px}.as .i{padding-left:20px}
    .ft{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;margin-top:48px;padding-bottom:6px;border-bottom:1px solid #ccd0d5;font-size:12px;color:#8d949e;line-height:1.45}
    .ft .r{text-align:right}.note{margin-top:24px;font-size:12px;color:#8d949e}`;
  const body = `
<div class="h"><div><div class="t">Ad spend statement for ${esc(client || '—')}</div>${L.accountId ? `<div class="a">Account ID: ${esc(L.accountId)}</div>` : ''}</div>${t.logo || ''}</div>
<div class="pay">
  <div>
    <div class="k">Invoice/payment date<b>${paidOn ? esc(docDate(paidOn)) : '—'}${L.paidTime ? ', ' + esc(time12(L.paidTime)) : ''}</b></div>
    ${L.paymentMethod ? `<div class="k">Payment method<b>${esc(L.paymentMethod)}</b>${L.paymentRef ? `<span>${payGen ? 'WEPRO internal reference' : 'Reference number'}: ${esc(L.paymentRef)}</span>` : ''}</div>` : ''}
    ${L.vendorRef ? `<div class="k">${txnGen ? 'WEPRO internal transaction ref.' : 'Transaction ID'}<b>${esc(L.vendorRef)}</b></div>` : ''}
    ${L.productType ? `<div class="k">Product type<b>${esc(L.productType)}</b></div>` : ''}
  </div>
  <div class="paid"><div class="l">Paid</div><div class="v">${fmtMoney(d.total, cur)}</div>${from ? `<div class="s">Ads spend since ${esc(from)}.</div>` : ''}</div>
</div>
<h3 data-pg="keep">Campaigns</h3>
<div class="camps" data-pg="list">${groups.map((g) => `<div class="camp" data-pg="group"><div class="ch" data-pg-head><div><b>${esc(g.name)}</b>${range}</div><span class="tot">${fmtMoney(g.lines.reduce((s, l) => s + l.amount, 0), cur)}</span></div>
${g.lines.map((l) => `<div class="as"><span>${esc(String(l.description || '—').split('\n')[0])}</span><span class="i">${num(l.extra.impressions) ? fmtCount(l.extra.impressions) + ' Impressions' + (l.extra.est ? ' (est.)' : '') : ''}</span><span>${fmtMoney(l.amount, cur)}</span></div>`).join('')}</div>`).join('')}</div>
${d.notes ? `<div class="note" style="color:#1c1e21;white-space:pre-line">${esc(d.notes)}</div>` : ''}`;
  // From: the vendor, as on the receipt. To: the fixed lines from the receipt,
  // then the invoice number: Meta's when copied from the receipt, else WEPRO's
  // generated one under WEPRO's label (layout.invoiceNo / invoiceNoGen).
  const invGen = !!(L.invoiceNo && L.invoiceNoGen);
  const foot = `<div class="ft"><div>${esc(v.name || '')}${(v.address || []).map((a) => '<br>' + esc(a)).join('')}</div><div class="r">${(t.to || []).map(esc).join('<br>')}${L.invoiceNo ? `<br>${invGen ? 'WEPRO internal invoice no.' : 'Invoice no.'} ${esc(L.invoiceNo)}` : ''}</div></div>
<div class="note">Prepared by WEPRO from ${esc(t.name)} receipt.${d.footer ? ' ' + esc(d.footer) : ''}</div>`;
  return { css, body, foot, label: '' }; // no "Draft statement · …" at the page foot, only "Page i of n"
}

const VENDOR_RENDERERS = { receipt, adSpend };

// The page for a statement doc (from statementDoc). `chrome: true` is the
// share page: its bar with the print button and the script that paginates it;
// false is the bare pages for the app's iframe, paginated by DocPreview.
export function renderStatement(doc, { chrome = false } = {}) {
  const d = doc || statementDoc();
  const t = templateOf(d.template);
  const vendor = VENDOR_RENDERERS[t.layout];
  if (!vendor) return standardPage(d, chrome);
  const { css, body, foot, label } = vendor(d, t);
  const bar = `<div class="bar"><span>${esc(d.number) || 'Draft'} · ${d.final ? 'Final' : 'Draft'} statement</span><button type="button" class="btn" onclick="window.print()">Print / Save as PDF</button></div>`;
  return pageHtml(d, chrome, { css: VENDOR_CSS + css, bar, body, foot, label });
}
