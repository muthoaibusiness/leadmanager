// Meta CAPI report export (browser side). Ranges are defined in Asia/Dhaka
// (UTC+6, no DST): the period is [start-of-day of the first included day,
// now]. Counts are computed by paging the meta-capi `list` action over the
// period (its from/to filters apply to leads.created_at), so a report never
// mixes lifetime totals with period counts. The PDF is built with jsPDF:
// compact, table-only, no prose.
import { jsPDF } from 'jspdf';

export const DATASET_ID = '869790160551668';
export const REPORT_BRAND = 'Wepro CRM';
// [key, label, inclusive start offset in days from today]
export const RANGES = [
  ['today', 'Today', 0],
  ['3d', 'Last 3 days', 2],
  ['7d', 'Last 7 days', 6],
  ['30d', 'Last 30 days', 29],
];
export const DEFAULT_RANGE = '7d';

const DHAKA_OFFSET_MS = 6 * 3600 * 1000;

// UTC instant -> start of that Dhaka day as a UTC instant (Dhaka midnight).
export function dhakaDayStart(iso) {
  const utc = Date.parse(iso);
  const dhaka = utc + DHAKA_OFFSET_MS;
  const dayStartDhaka = Math.floor(dhaka / 86400000) * 86400000;
  return new Date(dayStartDhaka - DHAKA_OFFSET_MS);
}

export function rangeKeyToPeriod(rangeKey, nowMs = Date.now()) {
  const r = RANGES.find(([k]) => k === rangeKey) ?? RANGES.find(([k]) => k === DEFAULT_RANGE);
  const now = new Date(nowMs);
  const start = new Date(dhakaDayStart(now.toISOString()).getTime() - r[2] * 86400000);
  return { start, end: now, label: r[1] };
}

// Compact display form, always Asia/Dhaka.
export function fmtDhaka(iso) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

// Page the list API over a period and tally rows by status. `status` is the
// per-lead view status (success/failed/pending/expired/ineligible). Attempts
// are the sum of per-lead attempt counts.
export async function fetchPeriodSummary(api, { start, end }) {
  const fromIso = start.toISOString();
  const toIso = end.toISOString();
  const pageSize = 200; // server max (MAX_PAGE)
  let offset = 0;
  let total = 1;
  const counts = { total: 0, success: 0, failed: 0, pending: 0, expired: 0, ineligible: 0, attempts: 0 };
  while (offset < total) {
    const { rows, total: t } = await api('list', { status: 'all', search: '', from: fromIso, to: toIso, sort: 'created_desc', limit: pageSize, offset });
    total = t;
    if (!Array.isArray(rows)) break;
    for (const r of rows) {
      counts.total += 1;
      if (counts[r.status] != null) counts[r.status] += 1;
      counts.attempts += Number(r.attempts) || 0;
    }
    offset += rows.length;
    if (!rows.length) break;
  }
  return counts;
}

// Report data object: the PDF is a pure projection of this.
export function buildReportData({ range, counts, generatedAtMs }) {
  const period = rangeKeyToPeriod(range, generatedAtMs);
  return {
    brand: REPORT_BRAND,
    datasetId: DATASET_ID,
    range: period.label,
    rangeKey: range,
    periodStart: period.start,
    periodEnd: period.end,
    generatedAt: new Date(generatedAtMs),
    counts,
  };
}

// What the report shows, in order. The preview and the PDF both read these,
// so what is previewed is what is saved and printed.
export const reportMeta = (r) => [
  ['Dataset ID', r.datasetId],
  ['Period', `${fmtDhaka(r.periodStart)} — ${fmtDhaka(r.periodEnd)} (Asia/Dhaka)`],
  ['Range', r.range],
  ['Generated', `${fmtDhaka(r.generatedAt)} (Asia/Dhaka)`],
];
export const reportRows = (c) => [
  ['Total ad leads', c.total], ['Success', c.success], ['Failed', c.failed], ['Pending', c.pending],
  ['Expired', c.expired], ['Ineligible', c.ineligible], ['Attempts', c.attempts],
].map(([k, v]) => [k, String(v ?? 0)]);
// Dated by the Dhaka day it was generated, not the UTC one.
export const reportFileName = (r) => `wepro-meta-capi-${r.rangeKey}-${new Date(r.generatedAt.getTime() + DHAKA_OFFSET_MS).toISOString().slice(0, 10)}.pdf`;

// Table-only PDF. Columns: Metric | Count. No prose.
export function renderPdf(report, { fontSize = 10 } = {}) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 36;
  doc.setFont('helvetica', 'bold').setFontSize(14);
  doc.text(report.brand, M, M + 6);
  doc.setFont('helvetica', 'normal').setFontSize(fontSize);
  reportMeta(report).forEach(([k, v], i) => doc.text(`${k}: ${v}`, M, M + 24 + i * 15));

  const rows = reportRows(report.counts);
  const tableTop = M + 86;
  const rowH = 18;
  const colW = W - M * 2;
  // header row
  doc.setFillColor(240, 240, 240);
  doc.rect(M, tableTop, colW, rowH, 'F');
  doc.setFont('helvetica', 'bold');
  doc.text('Metric', M + 10, tableTop + rowH - 6);
  doc.text('Count', M + colW - 10, tableTop + rowH - 6, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  let y = tableTop + rowH;
  for (const [name, val] of rows) {
    doc.rect(M, y, colW, rowH, 'S');
    doc.text(name, M + 10, y + rowH - 6);
    doc.text(val, M + colW - 10, y + rowH - 6, { align: 'right' });
    y += rowH;
  }
  return doc.output('arraybuffer');
}
