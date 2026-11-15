import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { offerPdf } from '../src/lib/offerPdf.js';

const args = {
  project: { id: 'prop-citizen-0001', name: 'CITIZEN AVENUE MALL', area: 'Uttara', district: 'Dhaka', fastCloseDays: 5, addons: [{ id: 'ao-park', name: 'Car parking', amount: 800000 }] },
  variant: { name: 'Shop', size: 231 },
  deal: { unitId: 'SHOP-114', client: { name: 'Rahim Ahmed', phone: '8801712345678' }, addons: { 'ao-park': true } },
  calc: { offerValue: 9000000, discountedOffer: 8820000, discountPct: 2, addOnsTotal: 800000, dealTotal: 9620000, offerRate: 38961, belowFloor: false },
  agent: { name: 'Asad' },
};

test('offerPdf: one A4 page named by the offer number, carrying the sheet facts', async () => {
  const { doc, name } = offerPdf(args, Date.UTC(2026, 10, 5));
  assert.equal(name, 'WCN-0001-SHOP114.pdf');
  const pdf = await getDocument({ data: new Uint8Array(doc.output('arraybuffer')) }).promise;
  assert.equal(pdf.numPages, 1);
  const text = (await (await pdf.getPage(1)).getTextContent()).items.map(i => i.str).join(' ');
  for (const s of ['Offer', 'WCN-0001-SHOP114', 'Rahim Ahmed', 'Unit SHOP-114', 'Car parking', 'Fast-close incentive', 'Deal total', 'Prepared by Asad']) {
    assert.ok(text.includes(s), `missing "${s}"`);
  }
});
