// Statement templates — one entry per vendor whose receipts we file often.
//
// Picking a template in the statement editor pre-fills the form (vendor, bill-to,
// currency, lines) and decides the layout the statement renders with. The same
// renderStatement() draws the in-app preview, the printed PDF and the public
// share page (the finance Edge Function imports this file), so all three match.
//
// Adding a vendor (Meta, Google, …): drop its sample receipt PDF next to this
// file for reference, then add an entry to TEMPLATES. `layout: 'receipt'`
// reuses the vendor-receipt layout; a vendor that needs a different look gets
// its own renderer in RENDERERS. A logo goes in logos/ as an SVG string module
// (see logos/supabase.js). Plain JS with relative imports only: it runs in the
// browser and in Deno.
//
// A statement built from a template is our internal record of a vendor charge,
// not the vendor's own document: the heading says STATEMENT and the footer says
// WEPRO prepared it from the vendor's receipt.

import supabaseLogo from './logos/supabase.js';
import metaLogo from './logos/meta.js';

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

const SYMBOLS = { BDT: 'BDT ', USD: '$', EUR: '€', GBP: '£', AED: 'AED ' };
export const CURRENCIES = Object.keys(SYMBOLS);
export const fmtCount = (n) => (Number(n) ? Math.round(Number(n)).toLocaleString('en-US') : '—');
// Impressions bought: amount ÷ CPM (cost per 1,000 impressions) × 1,000.
export const impressionsFor = (amount, cpm) => (Number(cpm) > 0 ? Math.round(Number(amount) / Number(cpm) * 1000) : 0);

export function fmtMoney(n, currency = 'BDT') {
  const v = Number(n) || 0;
  const sym = SYMBOLS[currency] ?? `${currency} `;
  return sym + v.toLocaleString(currency === 'BDT' ? 'en-IN' : 'en-US', { minimumFractionDigits: currency === 'BDT' ? 0 : 2, maximumFractionDigits: 2 });
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const nl = (s) => esc(s).replace(/\n/g, '<br>');
const lineTotal = (l) => (Number(l.qty) || 0) * (Number(l.unitPrice) || 0);
const prettyDate = (d) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) return esc(d || '—');
  return new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};
// End of a period `months` long starting on `from` (YYYY-MM-DD): the day before
// the same date `months` later, so 2026-10-12 + 12 → 2027-10-11.
export function periodEnd(from, months) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !months) return '';
  const [y, m, day] = from.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + Number(months) + 1, 0)).getUTCDate(); // clamp Jan 31 + 1 → Feb 28
  const d = new Date(Date.UTC(y, m - 1 + Number(months), Math.min(day, last) - 1));
  return d.toISOString().slice(0, 10);
}

// The statement's service period ("Oct 12, 2026 – Oct 11, 2027"), or '' when unset.
export const periodText = (layout) => {
  const a = layout?.periodFrom, b = layout?.periodTo;
  if (!a && !b) return '';
  return `${a ? prettyDate(a) : '…'} – ${b ? prettyDate(b) : '…'}`;
};
// A line's description may carry a second line (a SKU, a note) under it; with
// none, `fallbackHtml` (the statement period, already escaped) goes there, the
// way vendors print it.
const descCell = (d, fallbackHtml = '') => {
  const [head, ...rest] = String(d || '—').split('\n');
  const sub = rest.length ? nl(rest.join('\n')) : fallbackHtml;
  return `<div class="d1">${esc(head)}</div>${sub ? `<div class="d2">${sub}</div>` : ''}`;
};
const safeAccent = (a, fallback) => (/^#[0-9a-f]{3,8}$/i.test(a || '') ? a : fallback);

const BASE_CSS = `
  :root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#eef0f3;font:14px/1.5 -apple-system,"Segoe UI",Inter,Roboto,sans-serif;color:#1a1d23}
  .wrap{max-width:780px;margin:24px auto;padding:0 16px}.bar{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:8px;flex-wrap:wrap}
  .btn{border:1px solid #cfd3d9;background:#fff;border-radius:8px;padding:8px 14px;font:inherit;font-weight:600;cursor:pointer}
  .sheet{background:#fff;border-radius:12px;padding:44px 48px;box-shadow:0 10px 30px rgba(0,0,0,.08);position:relative;overflow:hidden}
  .draft{position:absolute;right:-42px;top:30px;transform:rotate(35deg);background:#f59e0b;color:#111;font-weight:800;letter-spacing:.2em;padding:6px 60px;font-size:12px}
  table{width:100%;border-collapse:collapse}.c{text-align:center}.r{text-align:right;white-space:nowrap}
  .d1{font-weight:500}.d2{font-size:12.5px;color:#4b5563;margin-top:2px}
  body.embed{background:#fff}body.embed .wrap{margin:0;max-width:none;padding:0}body.embed .sheet{box-shadow:none;border-radius:0}
  @media print{body{background:#fff}.wrap{margin:0;padding:0;max-width:none}.bar{display:none}.sheet{box-shadow:none;border-radius:0;padding:0}}
  @media (max-width:560px){.sheet{padding:28px 22px}}
`;

// The in-house statement (no vendor).
function standard(doc, t) {
  const cur = doc.layout?.currency || t.currency;
  const accent = safeAccent(doc.layout?.accent, '#1F6FEB');
  const showQty = doc.layout?.showQty !== false;
  const total = doc.lines.reduce((s, l) => s + lineTotal(l), 0);
  const period = periodText(doc.layout);
  const rows = doc.lines.map((l) => `<tr><td>${descCell(l.description)}</td>${showQty ? `<td class="c">${esc(l.qty)}</td><td class="r">${fmtMoney(l.unitPrice, cur)}</td>` : ''}<td class="r">${fmtMoney(lineTotal(l), cur)}</td></tr>`).join('');
  const css = `
    .top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}h1{margin:0;font-size:26px;letter-spacing:-.3px}.logo{font-weight:900;font-size:20px;color:${accent}}
    .keys{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin:24px 0;padding:14px 0;border-top:1px solid #e6e8eb;border-bottom:1px solid #e6e8eb}.keys span{display:block;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.08em}.keys b{font-size:14px}
    .cols{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:22px;font-size:13.5px}.cols b{display:block;margin-bottom:4px}
    th{text-align:left;font-size:12px;font-weight:500;color:#6b7280;padding:0 0 10px;border-bottom:1px solid #e6e8eb}td{padding:12px 0;border-bottom:1px solid #eef0f2;vertical-align:top}
    .tot{display:flex;justify-content:flex-end;gap:40px;padding:16px 0;font-weight:800;font-size:17px}.tot b{color:${accent}}.notes{font-size:12.5px;color:#4b5563;white-space:pre-line}.foot{margin-top:28px;font-size:12px;color:#6b7280}`;
  const body = `
<div class="top"><div><h1>${esc(doc.title)}</h1><div style="color:#6b7280">Internal expense statement</div></div><div class="logo">WEPRO</div></div>
<div class="keys"><div><span>Number</span><b>${esc(doc.number)}</b></div><div><span>Date</span><b>${doc.issuedOn ? prettyDate(doc.issuedOn) : '—'}</b></div>${period ? `<div><span>Period</span><b>${period}</b></div>` : ''}<div><span>Budget</span><b>${esc(doc.budgetTitle || '—')}</b></div></div>
<div class="cols"><div><b>From</b>${nl(doc.fromName) || '—'}</div><div><b>To</b>${nl(doc.billTo) || '—'}</div></div>
<table><thead><tr><th>Description</th>${showQty ? '<th class="c">Qty</th><th class="r">Unit price</th>' : ''}<th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>
<div class="tot"><span>Total</span><b>${fmtMoney(total, cur)}</b></div>
${doc.notes ? `<div class="notes">${esc(doc.notes)}</div>` : ''}
<div class="foot">${doc.layout?.footer ? esc(doc.layout.footer) + ' · ' : ''}Prepared by ${esc(doc.createdByName || '—')} · This is an internal expense statement, not a tax invoice.</div>`;
  return { css, body };
}

// A vendor receipt laid out the way the vendor prints it: vendor block top
// left, bill-to and the reference keys side by side, the line table, then
// subtotal and amount paid.
function receipt(doc, t) {
  const cur = doc.layout?.currency || t.currency;
  const accent = safeAccent(doc.layout?.accent, t.accent || '#1a1d23');
  const total = doc.lines.reduce((s, l) => s + lineTotal(l), 0);
  const v = t.vendor || {};
  const period = periodText(doc.layout);
  const imp = t.columns === 'impressions';
  const head = imp
    ? '<th>Description</th><th class="q">Impressions</th><th class="r">CPM</th><th class="r">Amount</th>'
    : '<th>Description</th><th class="q">Quantity</th><th class="r">Rate</th><th class="r">Amount</th>';
  const rows = doc.lines.map((l) => {
    const mid = imp
      ? `<td class="q">${fmtCount(l.extra?.impressions)}</td><td class="r">${l.extra?.cpm ? fmtMoney(l.extra.cpm, cur) : '—'}</td>`
      : `<td class="q">${esc(l.qty)}</td><td class="r">${fmtMoney(l.unitPrice, cur)}</td>`;
    return `<tr><td>${descCell(l.description, period)}</td>${mid}<td class="r">${fmtMoney(lineTotal(l), cur)}</td></tr>`;
  }).join('');
  const totalImp = imp ? doc.lines.reduce((s, l) => s + (Number(l.extra?.impressions) || 0), 0) : 0;
  const ref = doc.layout?.vendorRef;
  const paid = doc.layout?.paidOn;
  const css = `
    .hd{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:28px}
    .vname{font-size:26px;font-weight:700;letter-spacing:-.4px;display:flex;align-items:center;gap:10px}.vname i{width:12px;height:28px;border-radius:3px;background:${accent};display:inline-block}
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
<div class="vaddr">${esc(v.name || doc.fromName || '')}${(v.address || []).map((a) => '<br>' + esc(a)).join('')}</div>
<div class="mid">
  <div><b class="l">Bill to:</b>${nl(doc.billTo) || '—'}</div>
  <div class="keys">
    <span>${esc(t.refLabel || 'Reference')}</span><span>${esc(ref || '—')}</span>
    <span>Statement no.</span><span>${esc(doc.number)}</span>
    <span>Receipt date</span><span>${prettyDate(doc.issuedOn)}</span>
    ${paid ? `<span>Payment date</span><span>${prettyDate(paid)}</span>` : ''}
    <span class="em">Amount paid</span><span class="em">${fmtMoney(total, cur)}</span>
  </div>
</div>
<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>
<div class="sums">${imp ? `<span>Impressions</span><span class="r">${fmtCount(totalImp)}</span>` : ''}<span>Subtotal</span><span class="r">${fmtMoney(total, cur)}</span><span class="em">Amount paid</span><span class="r em">${fmtMoney(total, cur)}</span></div>
${doc.notes ? `<div class="memo">Memo:\n${esc(doc.notes)}</div>` : ''}
<div class="foot">Prepared by WEPRO from ${esc(t.name)} receipt${ref ? ' ' + esc(ref) : ''}${doc.budgetTitle ? ' · Budget: ' + esc(doc.budgetTitle) : ''}${doc.layout?.footer ? ' · ' + esc(doc.layout.footer) : ''}</div>`;
  return { css, body };
}

// Ad spend, laid out like Meta's receipt (Invoice-templates/Meta.pdf): payment
// details beside a large "Paid" figure, then each campaign with its period and
// total over its ad sets (impressions, amount). Lines are ad sets; a line's
// extra.campaign groups it. Headed as our statement, footer names WEPRO.
function adSpend(doc, t) {
  const L = doc.layout || {};
  // Meta prints day first: 23 Sep 2026.
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const prettyDate = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || ''); return m ? `${+m[3]} ${MON[m[2] - 1]} ${m[1]}` : esc(d || '—'); };
  const cur = L.currency || t.currency;
  const total = doc.lines.reduce((s, l) => s + lineTotal(l), 0);
  const v = t.vendor || {};
  const from = L.periodFrom ? prettyDate(L.periodFrom) : '';
  const range = L.periodFrom || L.periodTo ? `From ${from || '…'}, 00:00 to ${L.periodTo ? prettyDate(L.periodTo) : '…'}, ${esc(L.periodToTime || '23:59')}` : '';
  const groups = [];
  for (const l of doc.lines) {
    const name = String(l.extra?.campaign || '').trim() || 'Campaign';
    let g = groups.find((x) => x.name === name);
    if (!g) groups.push(g = { name, lines: [] });
    g.lines.push(l);
  }
  const paidOn = L.paidOn || doc.issuedOn;
  // Impressions worked out from the CPM (not typed from Meta) carry a * and a note.
  const estLine = doc.lines.find((l) => l.extra?.est && Number(l.extra?.impressions));
  const estCpm = estLine ? Number(estLine.extra.cpm || L.cpm) || 0 : 0;
  const client = String(doc.billTo || '').split('\n')[0];
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
    .ft .r{text-align:right}.note{margin-top:24px;font-size:12px;color:#8d949e}`;
  const body = `
<div class="h"><div><div class="t">Ad spend statement for ${esc(client || '—')}</div>${L.accountId ? `<div class="a">Account ID: ${esc(L.accountId)}</div>` : ''}</div>${t.logo || ''}</div>
<div class="pay">
  <div>
    <div class="k">Invoice/payment date<b>${paidOn ? prettyDate(paidOn) : '—'}${L.paidTime ? ', ' + esc(L.paidTime) : ''}</b></div>
    ${L.paymentMethod ? `<div class="k">Payment method<b>${esc(L.paymentMethod)}</b>${L.paymentRef ? `<span>Reference number: ${esc(L.paymentRef)}</span>` : ''}</div>` : ''}
    ${L.vendorRef ? `<div class="k">Transaction ID<b>${esc(L.vendorRef)}</b></div>` : ''}
    ${L.productType ? `<div class="k">Product type<b>${esc(L.productType)}</b></div>` : ''}
  </div>
  <div class="paid"><div class="l">Paid</div><div class="v">${fmtMoney(total, cur)}</div>${from ? `<div class="s">Ads spend since ${from}.</div>` : ''}</div>
</div>
<h3>Campaigns</h3>
<div class="camps">${groups.map((g) => `<div class="camp"><div class="ch"><div><b>${esc(g.name)}</b>${range}</div><span class="tot">${fmtMoney(g.lines.reduce((s, l) => s + lineTotal(l), 0), cur)}</span></div>
${g.lines.map((l) => `<div class="as"><span>${esc(String(l.description || '—').split('\n')[0])}</span><span class="i">${Number(l.extra?.impressions) ? fmtCount(l.extra.impressions) + ' Impressions' + (l.extra.est ? '*' : '') : ''}</span><span>${fmtMoney(lineTotal(l), cur)}</span></div>`).join('')}</div>`).join('')}</div>
${doc.notes ? `<div class="note" style="color:#1c1e21;white-space:pre-line">${esc(doc.notes)}</div>` : ''}
<div class="ft"><div>${esc(v.name || '')}${(v.address || []).map((a) => '<br>' + esc(a)).join('')}</div><div class="r">${esc(doc.billTo ? String(doc.billTo).split('\n').slice(1).join(', ') || 'Bangladesh' : 'Bangladesh')}<br>Statement no. ${esc(doc.number)}${doc.budgetTitle ? '<br>Budget: ' + esc(doc.budgetTitle) : ''}</div></div>
${estCpm ? `<div class="note">* Estimated impressions: amount ÷ CPM ${fmtMoney(estCpm, cur)} × 1,000.</div>` : ''}
<div class="note">Prepared by WEPRO from ${esc(t.name)} receipt${L.vendorRef ? ' ' + esc(L.vendorRef) : ''}.${L.footer ? ' ' + esc(L.footer) : ''}</div>`;
  return { css, body };
}

const RENDERERS = { standard, receipt, adSpend };

// doc: { number, title, status, issuedOn, fromName, billTo, notes, createdByName,
//        budgetTitle, layout: { template, currency, accent, showQty, footer, vendorRef, paidOn, periodFrom, periodTo,
//                               paidTime, accountId, paymentMethod, paymentRef, productType },
//        lines: [{ description, qty, unitPrice, extra: { campaign, impressions, cpm } }] }
// opts.toolbar adds the Print button (the public page); opts.embed drops the page
// chrome for the in-app preview.
export function renderStatement(doc, opts = {}) {
  const t = templateOf(doc.layout?.template);
  const { css, body } = (RENDERERS[t.layout] || standard)({ ...doc, lines: doc.lines || [] }, t);
  const bar = opts.toolbar ? `<div class="bar"><span>${esc(doc.number)} · ${doc.status === 'FINAL' ? 'Final' : 'Draft'} statement</span><button class="btn" onclick="window.print()">Print / Save as PDF</button></div>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(doc.number)} · ${esc(doc.title)}</title><style>${BASE_CSS}${css}</style></head><body${opts.embed ? ' class="embed"' : ''}><div class="wrap">${bar}
<div class="sheet">${doc.status === 'FINAL' ? '' : '<div class="draft">DRAFT</div>'}${body}</div></div></body></html>`;
}

export const statementTotalOf = (lines) => (lines || []).reduce((s, l) => s + lineTotal(l), 0);
