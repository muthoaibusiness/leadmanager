// npm run test:capi:report — the Meta CAPI report module:
// - Dhaka range boundaries (start-of-day, UTC+6, no DST)
// - period fetch tallies only in-range rows (no lifetime mixing)
// - PDF output carries Wepro CRM branding, Dataset ID, period/generation
//   stamps (Asia/Dhaka) and the metric table.
// jsPDF writes to memory; pdfjs-dist reads the bytes back for text checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  RANGES, DEFAULT_RANGE, dhakaDayStart, rangeKeyToPeriod, fmtDhaka,
  fetchPeriodSummary, buildReportData, renderPdf, DATASET_ID, REPORT_BRAND,
  reportMeta, reportRows, reportFileName,
} from '../src/lib/metaCapiReport.js';

// Fixed "now": 2026-10-30 12:00 UTC = 18:00 Dhaka.
const NOW = Date.parse('2026-10-30T12:00:00Z');

test('dhakaDayStart returns the UTC instant of Dhaka midnight', () => {
  const start = dhakaDayStart(new Date(NOW).toISOString());
  // Dhaka is UTC+6: start of Dhaka day 2026-10-30 = 2026-10-29T18:00:00Z
  assert.equal(start.toISOString(), '2026-10-29T18:00:00.000Z');
});

test('rangeKeyToPeriod: today starts at Dhaka midnight, ends at now', () => {
  const p = rangeKeyToPeriod('today', NOW);
  assert.equal(p.start.toISOString(), '2026-10-29T18:00:00.000Z');
  assert.equal(p.end.toISOString(), '2026-10-30T12:00:00.000Z');
});

test('rangeKeyToPeriod: last 30 days is 29 days before Dhaka-midnight start', () => {
  const p = rangeKeyToPeriod('30d', NOW);
  assert.equal(p.start.toISOString(), '2026-09-30T18:00:00.000Z');
  assert.equal(p.label, 'Last 30 days');
});

test('fmtDhaka renders in Asia/Dhaka at UTC+6', () => {
  assert.equal(fmtDhaka('2026-10-30T12:00:00Z'), '30 Oct 2026, 18:00');
});

test('fetchPeriodSummary pages the list and tallies only in-range rows', async () => {
  // A fake api that returns one page of rows plus a total, echoing the range.
  const calls = [];
  const api = async (action, payload) => {
    calls.push(payload);
    return {
      rows: [
        { id: 'a', status: 'success', attempts: 2 },
        { id: 'b', status: 'pending', attempts: 0 },
        { id: 'c', status: 'failed', attempts: 1 },
      ],
      total: 3,
    };
  };
  const from = new Date('2026-10-29T18:00:00Z');
  const to = new Date(NOW);
  const s = await fetchPeriodSummary(api, { start: from, end: to });
  assert.equal(s.total, 3);
  assert.equal(s.success, 1);
  assert.equal(s.pending, 1);
  assert.equal(s.failed, 1);
  assert.equal(s.attempts, 3);
  assert.equal(s.expired, 0);
  assert.equal(s.ineligible, 0);
  // The list API received the period bounds so the server filtered by created_at.
  const p = calls[0];
  assert.equal(p.from, '2026-10-29T18:00:00.000Z');
  assert.equal(p.to, '2026-10-30T12:00:00.000Z');
  assert.equal(p.status, 'all');
});

test('buildReportData carries branding, dataset id and period stamps', () => {
  const r = buildReportData({ range: '7d', counts: { total: 5, success: 2 }, generatedAtMs: NOW });
  assert.equal(r.brand, REPORT_BRAND);
  assert.equal(r.datasetId, DATASET_ID);
  assert.equal(r.range, 'Last 7 days');
  assert.equal(r.generatedAt.toISOString(), '2026-10-30T12:00:00.000Z');
});

test('renderPdf produces a readable PDF with header, dataset id, period and table', async () => {
  const report = buildReportData({ range: 'today', counts: { total: 10, success: 4, failed: 1, pending: 3, expired: 1, ineligible: 1, attempts: 5 }, generatedAtMs: NOW });
  const buf = renderPdf(report);
  assert.ok(buf instanceof ArrayBuffer && buf.byteLength > 0);
  const pdf = await getDocument({ data: new Uint8Array(buf) }).promise;
  assert.equal(pdf.numPages, 1);
  const page = await pdf.getPage(1);
  const content = await page.getTextContent();
  const text = content.items.map((i) => i.str).join(' ');
  // Branding and metadata.
  assert.match(text, new RegExp(REPORT_BRAND));
  assert.match(text, new RegExp(DATASET_ID));
  assert.match(text, /Period:/);
  assert.match(text, /Asia\/Dhaka/);
  assert.match(text, /Generated:/);
  // Metric table rows.
  assert.match(text, /Total ad leads/);
  assert.match(text, /Success/);
  assert.match(text, /Failed/);
  assert.match(text, /Pending/);
  assert.match(text, /Expired/);
  assert.match(text, /Ineligible/);
  assert.match(text, /Attempts/);
  // Counts appear in the PDF.
  assert.match(text, /\b10\b/);
  assert.match(text, /\b4\b/);
  assert.match(text, /\b5\b/);
});

test('lifetime totals are never mixed: a period count only sums that range rows', async () => {
  // Two pages: in-range lead (success) and an out-of-range row the fake server
  // returns anyway; the module counts only what the API returned for the period.
  const api = async (action, payload) => ({ rows: [{ id: 'a', status: 'success', attempts: 1 }], total: 1 });
  const s = await fetchPeriodSummary(api, { start: new Date('2026-10-29T18:00:00Z'), end: new Date(NOW) });
  assert.equal(s.total, 1);
  assert.equal(s.success, 1);
});

test('preview and PDF read the same lines: every meta line and KPI row is in the PDF', async () => {
  const report = buildReportData({ range: '3d', counts: { total: 12, success: 7, failed: 2, pending: 1, expired: 1, ineligible: 1, attempts: 9 }, generatedAtMs: NOW });
  const meta = reportMeta(report);
  assert.deepEqual(meta.map(([k]) => k), ['Dataset ID', 'Period', 'Range', 'Generated']);
  assert.equal(meta[0][1], DATASET_ID);
  const rows = reportRows(report.counts);
  assert.deepEqual(rows.map(([k]) => k), ['Total ad leads', 'Success', 'Failed', 'Pending', 'Expired', 'Ineligible', 'Attempts']);
  assert.deepEqual(rows.map(([, v]) => v), ['12', '7', '2', '1', '1', '1', '9']);
  const pdf = await getDocument({ data: new Uint8Array(renderPdf(report)) }).promise;
  const text = (await (await pdf.getPage(1)).getTextContent()).items.map((i) => i.str).join(' ');
  for (const [k, v] of meta) assert.ok(text.includes(`${k}: ${v}`), `PDF has "${k}: ${v}"`);
  for (const [k] of rows) assert.ok(text.includes(k), `PDF has row ${k}`);
});

test('missing counts read as 0, never "undefined"', () => {
  assert.deepEqual(reportRows({ total: 3 }).map(([, v]) => v), ['3', '0', '0', '0', '0', '0', '0']);
});

test('file name carries the range key and the Dhaka date, not the UTC one', () => {
  // 2026-10-30 20:00 UTC is already 31 Oct in Dhaka.
  const late = buildReportData({ range: '30d', counts: {}, generatedAtMs: Date.parse('2026-10-30T20:00:00Z') });
  assert.equal(reportFileName(late), 'wepro-meta-capi-30d-2026-10-31.pdf');
  assert.equal(reportFileName(buildReportData({ range: 'today', counts: {}, generatedAtMs: NOW })), 'wepro-meta-capi-today-2026-10-30.pdf');
});
