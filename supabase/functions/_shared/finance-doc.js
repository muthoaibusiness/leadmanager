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

// ── WEPRO's own statement (the default template) ──
// Title and logo, a key list beside the large total, the line table, then the
// From / To blocks and the footnote at the foot of the page. `chrome: true` is
// the standalone share page (grey backdrop, a bar with the print button);
// false is the bare sheet for the app's iframe. The sheet markup and the print
// stylesheet are the same in both.
function standardPage(d, chrome) {
  const a = d.accent;
  const m = (n) => fmtMoney(n, d.currency);
  const status = d.final ? 'Final' : 'Draft';
  const cols = d.showQty ? 4 : 2;
  const head = `<tr><th>Description</th>${d.showQty ? '<th class="c">Qty</th><th class="r">Unit price</th>' : ''}<th class="r">Amount</th></tr>`;
  const body = d.lines.length
    ? d.lines.map((l) => `<tr><td>${esc(l.description) || '—'}</td>${d.showQty ? `<td class="c">${l.qty}</td><td class="r">${m(l.unitPrice)}</td>` : ''}<td class="r">${m(l.amount)}</td></tr>`).join('')
    : `<tr><td class="empty" colspan="${cols}">No lines yet</td></tr>`;
  const count = `${d.lines.length} line${d.lines.length === 1 ? '' : 's'}`;
  const period = periodText(d.layout);
  const sheet = `<main class="sheet">${d.final ? '' : '<div class="draft" aria-hidden="true">DRAFT</div>'}
<header class="top"><div><h1>${esc(d.title)}</h1><p class="sub">${d.budgetTitle ? `Budget: ${esc(d.budgetTitle)}` : 'Internal expense statement'}</p></div><div class="logo">WEPRO</div></header>
<section class="summary">
<dl class="keys"><div><dt>Statement no.</dt><dd>${esc(d.number) || 'Assigned on save'}</dd></div><div><dt>Date</dt><dd>${esc(docDate(d.issuedOn)) || '—'}</dd></div>${period ? `<div><dt>Period</dt><dd>${period}</dd></div>` : ''}${d.category ? `<div><dt>Category</dt><dd>${esc(d.category)}</dd></div>` : ''}${d.payment && d.payment !== 'NONE' ? `<div><dt>Payment</dt><dd>${PAYMENT_LABEL[d.payment]}</dd></div>` : ''}<div><dt>Prepared by</dt><dd>${esc(d.preparedBy) || '—'}</dd></div></dl>
<div class="amount"><div class="state">${status}</div><div class="big">${m(d.total)}</div><div class="cap">Total of ${count}</div></div>
</section>
<section class="items"><h2>Expenses</h2>
<table><thead>${head}</thead><tbody>${body}</tbody><tfoot><tr><td class="r" colspan="${cols - 1}">Total</td><td class="r">${m(d.total)}</td></tr></tfoot></table>
${d.notes ? `<p class="notes">${esc(d.notes)}</p>` : ''}</section>
<footer class="foot">
<div class="parties"><div><b>From</b><span class="party">${esc(d.fromName) || '—'}</span></div><div class="to"><b>To</b><span class="party">${esc(d.billTo) || '—'}</span>${d.number ? `<span>Statement no. ${esc(d.number)}</span>` : ''}</div></div>
<p class="fine">${d.footer ? `${esc(d.footer)} · ` : ''}Internal expense statement, not a tax invoice.</p>
</footer>
</main>`;
  const bar = chrome ? `<div class="bar"><span>${esc(d.number) || 'Draft'} · ${status} statement</span><button type="button" class="btn" onclick="window.print()">Print / Save as PDF</button></div>\n` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(d.number || 'Draft')} · ${esc(d.title)}</title>
<style>
:root{color-scheme:light}*{box-sizing:border-box}html,body{margin:0}
body{font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1c1e21;-webkit-text-size-adjust:100%}
body.page{background:#f0f2f5}body.embed{background:#fff}
.bar{max-width:794px;margin:20px auto 12px;padding:0 16px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;color:#606770}
.btn{border:0;border-radius:8px;padding:9px 16px;font:inherit;font-weight:600;color:#fff;background:${a};cursor:pointer}
.sheet{position:relative;overflow:hidden;background:#fff;display:flex;flex-direction:column}
body.page .sheet{max-width:794px;margin:0 auto 32px;padding:56px 60px;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.08)}
body.embed .sheet{padding:40px 44px}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding-bottom:14px;border-bottom:1px solid #dadde1}
h1{margin:0;font-size:22px;font-weight:400;letter-spacing:-.2px}.sub{margin:3px 0 0;font-size:12px;color:#606770}
.logo{font-size:20px;font-weight:700;letter-spacing:.5px;color:${a};white-space:nowrap}
.summary{display:flex;justify-content:space-between;gap:24px;padding:40px 0 36px;border-bottom:1px solid #dadde1}
.keys{margin:0}.keys div+div{margin-top:16px}.keys dt{font-size:12px;color:#606770}.keys dd{margin:2px 0 0;font-size:12px;font-weight:700}
.amount{text-align:right;align-self:center}.state{font-size:17px}.big{font-size:34px;font-weight:300;letter-spacing:-.5px;margin:6px 0 8px;white-space:nowrap}.cap{font-size:12px;color:#606770}
.items{padding-top:32px}h2{margin:0 0 10px;font-size:13px;font-weight:700}
table{width:100%;border-collapse:collapse}
th{font-size:11.5px;font-weight:500;color:#606770;text-align:left;padding:10px 0;border-top:1px solid #dadde1;border-bottom:1px dashed #dadde1}
td{font-size:12.5px;padding:13px 0;border-bottom:1px solid #e4e6eb;vertical-align:top}th+th,td+td{padding-left:12px}
.c{text-align:center}.r{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.empty{color:#8d949e;text-align:center}
tfoot td{border-bottom:0;font-size:13.5px;font-weight:700;padding-top:16px}tfoot td:last-child{color:${a}}
.notes{margin:20px 0 0;font-size:12px;color:#4b4f56;white-space:pre-line}
.foot{margin-top:auto;padding-top:56px}
.parties{display:flex;justify-content:space-between;gap:24px;padding-bottom:10px;border-bottom:1px solid #dadde1;font-size:11.5px;line-height:1.55;color:#8d949e}
.parties b{display:block;color:#606770;font-weight:600}.parties span{display:block}.parties .to{text-align:right}.party{white-space:pre-line}
.fine{margin:18px 0 0;font-size:11px;color:#8d949e}
.draft{position:absolute;top:42%;left:50%;transform:translate(-50%,-50%) rotate(-28deg);font-size:120px;font-weight:800;letter-spacing:.12em;color:rgba(245,158,11,.16);pointer-events:none;white-space:nowrap;user-select:none}
@media (max-width:560px){body.page .sheet,body.embed .sheet{padding:28px 20px}.summary{flex-direction:column;gap:20px;padding:28px 0}.amount{text-align:left;align-self:flex-start}.big{font-size:28px}.parties{flex-direction:column}.parties .to{text-align:left}.draft{font-size:72px}}
@page{size:A4;margin:14mm}
@media print{body.page,body.embed{background:#fff}.bar{display:none}body.page .sheet,body.embed .sheet{max-width:none;margin:0;padding:0;border-radius:0;box-shadow:none;min-height:262mm}}
</style></head><body class="${chrome ? 'page' : 'embed'}">
${bar}${sheet}
</body></html>`;
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
  .wrap{max-width:780px;margin:24px auto;padding:0 16px}.bar{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:8px;flex-wrap:wrap}
  .btn{border:1px solid #cfd3d9;background:#fff;border-radius:8px;padding:8px 14px;font:inherit;font-weight:600;cursor:pointer}
  .sheet{background:#fff;border-radius:12px;padding:44px 48px;box-shadow:0 10px 30px rgba(0,0,0,.08);position:relative;overflow:hidden}
  .draft{position:absolute;top:42%;left:50%;transform:translate(-50%,-50%) rotate(-28deg);font-size:120px;font-weight:800;letter-spacing:.12em;color:rgba(245,158,11,.16);pointer-events:none;white-space:nowrap;user-select:none}
  table{width:100%;border-collapse:collapse}.c{text-align:center}.r{text-align:right;white-space:nowrap}
  .d1{font-weight:500}.d2{font-size:12.5px;color:#4b5563;margin-top:2px}
  body.embed{background:#fff}body.embed .wrap{margin:0;max-width:none;padding:0}body.embed .sheet{box-shadow:none;border-radius:0}
  @page{size:A4;margin:14mm}
  @media print{body{background:#fff}.wrap{margin:0;padding:0;max-width:none}.bar{display:none}.sheet{box-shadow:none;border-radius:0;padding:0}}
  @media (max-width:560px){.sheet{padding:28px 22px}.draft{font-size:72px}}
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
  const ref = L.vendorRef;
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
    .foot{margin-top:40px;padding-top:12px;border-top:1px solid #e6e8eb;font-size:11.5px;color:#6b7280}
    @media (max-width:560px){.mid{grid-template-columns:1fr}.kind{font-size:20px}}`;
  const body = `
<div class="hd">${t.logo ? `<div class="vname logo">${t.logo}${esc(t.wordmark ?? t.name)}</div>` : `<div class="vname"><i></i>${esc(t.name)}</div>`}<div class="kind">STATEMENT</div></div>
<div class="vaddr">${esc(v.name || d.fromName || '')}${(v.address || []).map((a) => '<br>' + esc(a)).join('')}</div>
<div class="mid">
  <div><b class="l">Bill to:</b>${nl(d.billTo) || '—'}</div>
  <div class="keys">
    <span>${esc(t.refLabel || 'Reference')}</span><span>${esc(ref || '—')}</span>
    <span>Statement no.</span><span>${esc(d.number) || 'Assigned on save'}</span>
    <span>Receipt date</span><span>${usDate(d.issuedOn)}</span>
    ${L.paidOn ? `<span>Payment date</span><span>${usDate(L.paidOn)}</span>` : ''}
    <span class="em">Amount paid</span><span class="em">${fmtMoney(d.total, cur)}</span>
  </div>
</div>
<table><thead><tr>${head}</tr></thead><tbody>${rows || `<tr><td colspan="4" class="c" style="color:#8d949e">No lines yet</td></tr>`}</tbody></table>
<div class="sums">${imp ? `<span>Impressions</span><span class="r">${fmtCount(totalImp)}</span>` : ''}<span>Subtotal</span><span class="r">${fmtMoney(d.total, cur)}</span><span class="em">Amount paid</span><span class="r em">${fmtMoney(d.total, cur)}</span></div>
${d.notes ? `<div class="memo">Memo:\n${esc(d.notes)}</div>` : ''}
<div class="foot">Prepared by WEPRO from ${esc(t.name)} receipt${ref ? ' ' + esc(ref) : ''}${d.budgetTitle ? ' · Budget: ' + esc(d.budgetTitle) : ''}${d.footer ? ' · ' + esc(d.footer) : ''}</div>`;
  return { css, body };
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
  // Impressions worked out from the CPM (not typed from Meta) carry a * and a note.
  const estLine = d.lines.find((l) => l.extra.est && num(l.extra.impressions));
  const estCpm = estLine ? num(estLine.extra.cpm || L.cpm) : 0;
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
    .ch b{display:block;margin-bottom:6px}.ch .tot{font-weight:700}
    .as{display:grid;grid-template-columns:1fr 1fr auto;padding:12px 0 12px 64px;font-size:12.5px}.as .i{padding-left:20px}
    .ft{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;margin-top:120px;padding-bottom:6px;border-bottom:1px solid #ccd0d5;font-size:12px;color:#8d949e;line-height:1.45}
    .ft .r{text-align:right}.note{margin-top:24px;font-size:12px;color:#8d949e}
    @media (max-width:560px){.pay{flex-direction:column}.paid{text-align:left}.paid .v{font-size:30px}.as{padding-left:16px;grid-template-columns:1fr auto}.as .i{display:none}.ft{flex-direction:column;align-items:flex-start;margin-top:48px}.ft .r{text-align:left}}`;
  const body = `
<div class="h"><div><div class="t">Ad spend statement for ${esc(client || '—')}</div>${L.accountId ? `<div class="a">Account ID: ${esc(L.accountId)}</div>` : ''}</div>${t.logo || ''}</div>
<div class="pay">
  <div>
    <div class="k">Invoice/payment date<b>${paidOn ? esc(docDate(paidOn)) : '—'}${L.paidTime ? ', ' + esc(L.paidTime) : ''}</b></div>
    ${L.paymentMethod ? `<div class="k">Payment method<b>${esc(L.paymentMethod)}</b>${L.paymentRef ? `<span>Reference number: ${esc(L.paymentRef)}</span>` : ''}</div>` : ''}
    ${L.vendorRef ? `<div class="k">Transaction ID<b>${esc(L.vendorRef)}</b></div>` : ''}
    ${L.productType ? `<div class="k">Product type<b>${esc(L.productType)}</b></div>` : ''}
  </div>
  <div class="paid"><div class="l">Paid</div><div class="v">${fmtMoney(d.total, cur)}</div>${from ? `<div class="s">Ads spend since ${esc(from)}.</div>` : ''}</div>
</div>
<h3>Campaigns</h3>
<div class="camps">${groups.map((g) => `<div class="camp"><div class="ch"><div><b>${esc(g.name)}</b>${range}</div><span class="tot">${fmtMoney(g.lines.reduce((s, l) => s + l.amount, 0), cur)}</span></div>
${g.lines.map((l) => `<div class="as"><span>${esc(String(l.description || '—').split('\n')[0])}</span><span class="i">${num(l.extra.impressions) ? fmtCount(l.extra.impressions) + ' Impressions' + (l.extra.est ? '*' : '') : ''}</span><span>${fmtMoney(l.amount, cur)}</span></div>`).join('')}</div>`).join('')}</div>
${d.notes ? `<div class="note" style="color:#1c1e21;white-space:pre-line">${esc(d.notes)}</div>` : ''}
<div class="ft"><div>${esc(v.name || '')}${(v.address || []).map((a) => '<br>' + esc(a)).join('')}</div><div class="r">${esc(d.billTo ? String(d.billTo).split('\n').slice(1).join(', ') || 'Bangladesh' : 'Bangladesh')}<br>Statement no. ${esc(d.number) || 'Assigned on save'}${d.budgetTitle ? '<br>Budget: ' + esc(d.budgetTitle) : ''}</div></div>
${estCpm ? `<div class="note">* Estimated impressions = 1,000 × amount ÷ CPM (${fmtMoney(estCpm, cur)} per 1,000 impressions).</div>` : ''}
<div class="note">Prepared by WEPRO from ${esc(t.name)} receipt${L.vendorRef ? ' ' + esc(L.vendorRef) : ''}.${d.footer ? ' ' + esc(d.footer) : ''}</div>`;
  return { css, body };
}

const VENDOR_RENDERERS = { receipt, adSpend };

// The page for a statement doc (from statementDoc). `chrome: true` adds the
// share page's bar with the print button; false is the bare sheet for the
// app's iframe.
export function renderStatement(doc, { chrome = false } = {}) {
  const d = doc || statementDoc();
  const t = templateOf(d.template);
  const vendor = VENDOR_RENDERERS[t.layout];
  if (!vendor) return standardPage(d, chrome);
  const { css, body } = vendor(d, t);
  const bar = chrome ? `<div class="bar"><span>${esc(d.number) || 'Draft'} · ${d.final ? 'Final' : 'Draft'} statement</span><button type="button" class="btn" onclick="window.print()">Print / Save as PDF</button></div>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(d.number || 'Draft')} · ${esc(d.title)}</title><style>${VENDOR_CSS}${css}</style></head><body class="${chrome ? 'page' : 'embed'}"><div class="wrap">${bar}
<div class="sheet">${d.final ? '' : '<div class="draft" aria-hidden="true">DRAFT</div>'}${body}</div></div></body></html>`;
}
