// The offer sheet as a downloadable A4 PDF (Project console, Deal cart). Same
// facts as ProjectInvoice's sheet (offerFacts), drawn with jsPDF like the Meta
// CAPI report: text and rules only, no screenshot of the page.
import { jsPDF } from 'jspdf';
import { fmtBDT } from './helpers.js';

// The offer's number, dates and line items, shared by the on-screen sheet
// (ProjectInvoice) and the downloaded PDF so the two never disagree.
export function offerFacts({ project, deal, calc }, now) {
  const fmtDay = (ms) => new Date(ms).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
  return {
    no: 'WCN-' + (project.id || '').slice(-4).toUpperCase() + '-' + String(deal.unitId || '').replace(/\W/g, ''),
    date: fmtDay(now),
    validUntil: fmtDay(now + (project.fastCloseDays || 7) * 86400000),
    discountAmt: calc.offerValue - calc.discountedOffer,
    addonItems: (project.addons || []).filter(a => deal.addons?.[a.id]),
  };
}

// BDT amounts in the PDF: jsPDF's built-in fonts have no "−", so a plain hyphen.
const money = (n) => fmtBDT(n);

export function offerPdf({ project, variant, deal, calc, agent }, now = Date.now()) {
  const f = offerFacts({ project, deal, calc }, now);
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth(), M = 48, R = W - M;
  let y = M + 10;
  const line = (yy, w = 0.6) => { doc.setLineWidth(w).setDrawColor(220, 222, 226).line(M, yy, R, yy); };

  doc.setFont('helvetica', 'bold').setFontSize(24).setTextColor(26, 29, 35).text('Offer', M, y);
  doc.setFontSize(16).setTextColor(31, 122, 77).text('WECON', R, y, { align: 'right' });
  y += 26;
  doc.setFont('helvetica', 'normal').setFontSize(10);
  [['Offer number', f.no], ['Date', f.date], ['Status', 'Draft offer']].forEach(([k, v]) => {
    doc.setTextColor(107, 114, 128).text(k, M, y);
    doc.setTextColor(26, 29, 35).text(v, M + 100, y);
    y += 15;
  });

  y += 12;
  const colB = M + (R - M) / 2;
  doc.setFont('helvetica', 'bold').setTextColor(26, 29, 35).text('WECON Properties', M, y).text('Bill to', colB, y);
  doc.setFont('helvetica', 'normal').setTextColor(75, 85, 99);
  const from = [project.name, project.address || [project.area, project.district].filter(Boolean).join(', '), 'sales@wecon.com'].filter(Boolean);
  const to = [deal.client?.name || '-', deal.client?.phone, 'Bangladesh'].filter(Boolean);
  for (let i = 0; i < Math.max(from.length, to.length); i++) {
    y += 14;
    if (from[i]) doc.text(String(from[i]), M, y);
    if (to[i]) doc.text(String(to[i]), colB, y);
  }

  y += 30;
  doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(26, 29, 35).text(`${money(calc.dealTotal)} offer`, M, y);
  y += 16;
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(107, 114, 128)
    .text(`This is a price offer, not a tax invoice. Figures exclude registration & statutory charges unless stated. Valid until ${f.validUntil}.`, M, y, { maxWidth: R - M });

  y += 34;
  const cQty = R - 210, cPrice = R - 100;
  doc.setFontSize(9).text('Description', M, y).text('Qty', cQty, y, { align: 'center' }).text('Unit price', cPrice, y, { align: 'right' }).text('Amount', R, y, { align: 'right' });
  y += 6; line(y);
  const row = (title, sub, qty, price, amount) => {
    y += 16;
    doc.setFontSize(10).setTextColor(26, 29, 35).text(title, M, y).text(qty, cQty, y, { align: 'center' }).text(price, cPrice, y, { align: 'right' }).text(amount, R, y, { align: 'right' });
    if (sub) { y += 12; doc.setFontSize(8.5).setTextColor(107, 114, 128).text(sub, M, y); }
    y += 8; line(y, 0.4);
  };
  row(`Unit ${deal.unitId} · ${variant.name}`, `${variant.size} sqft @ ${money(calc.offerRate)}/sqft`, '1', money(calc.offerValue), money(calc.offerValue));
  if (f.discountAmt > 0) row('Fast-close incentive', `-${calc.discountPct}% if signed within ${project.fastCloseDays} days`, '1', '-', `-${money(f.discountAmt)}`);
  f.addonItems.forEach(a => row(a.name, '', '1', money(a.amount), money(a.amount)));

  y += 18;
  const sumL = R - 220;
  const sum = (k, v, bold) => { doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(bold ? 11 : 10).setTextColor(bold ? 26 : 75, bold ? 29 : 85, bold ? 35 : 99).text(k, sumL, y).setTextColor(26, 29, 35).text(v, R, y, { align: 'right' }); y += 16; };
  sum('Subtotal', money(calc.offerValue));
  if (f.discountAmt > 0) sum('Fast-close discount', `-${money(f.discountAmt)}`);
  if (calc.addOnsTotal > 0) sum('Add-ons', `+${money(calc.addOnsTotal)}`);
  doc.setLineWidth(1.2).setDrawColor(220, 222, 226).line(sumL, y - 10, R, y - 10); y += 4;
  sum('Deal total', money(calc.dealTotal), true);

  if (calc.belowFloor) { y += 10; doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(180, 69, 31).text('Below floor price - subject to manager approval.', M, y); }

  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(107, 114, 128).text(`Prepared by ${agent?.name || '-'} · WECON Properties`, M, doc.internal.pageSize.getHeight() - M);
  return { doc, name: `${f.no}.pdf` };
}

// Saves the PDF in the browser (the file name is the offer number).
export function downloadOfferPdf(args) {
  const { doc, name } = offerPdf(args);
  doc.save(name);
}
