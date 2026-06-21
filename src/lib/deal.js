// ── Deal pricing (pure, no storage) — spec §4 ────────────────────────────────
// Data/persistence lives in projects.js; this file only computes deal numbers.

export function computeDeal(deal, variant, property) {
  const offerRate = deal.offerRate ?? variant.listRate;
  const offerValue = offerRate * variant.size;
  const discountPct = deal.fastClose ? (property.fastClosePct || 0) : 0;
  const discountedOffer = offerValue * (1 - discountPct / 100);
  const addOnsTotal = (property.addons || []).filter(a => deal.addons?.[a.id]).reduce((s, a) => s + (a.amount || 0), 0);
  const dealTotal = discountedOffer + addOnsTotal;
  const floorPrice = variant.floorRate * variant.size;
  const belowFloor = discountedOffer < floorPrice; // property price only (excludes add-ons)
  const customerTotal = deal.custRate != null ? deal.custRate * variant.size : null;
  const gap = customerTotal != null ? offerValue - customerTotal : null;
  const commission = dealTotal * 0.02; // TODO: confirm rate/base with stakeholders
  return { offerRate, offerValue, discountPct, discountedOffer, addOnsTotal, dealTotal, floorPrice, belowFloor, customerTotal, gap, commission };
}

export const emptyDeal = () => ({
  variantId: null, unitId: null, offerRate: null, custRate: null,
  fastClose: false, addons: {}, client: { name: '', phone: '' }, plan: null, stage: 'browse',
  holdAt: null, // ms timestamp when the unit was put on hold (drives the 48h timer)
});
