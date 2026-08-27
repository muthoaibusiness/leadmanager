// "Does this lead carry an offer?" — asked by the display layer, answered by
// the data layer.
//
// helpers.js renders the status badge for every lead in the app, and a lead
// with an offer must read "Offer Sent" rather than the stage it happened to be
// in when the offer went out. The fact itself lives in two places: leads.
// offer_sent_at (migration 0012) and, for rows written before it, the lead's
// OFFER activity — which only db.js can see. db.js already imports helpers.js,
// so helpers.js cannot import it back.
//
// This leaf module is the seam. db.js installs the lookup on load; anything
// that renders can ask without pulling the data layer into its imports. Before
// the resolver is installed (or in a context that never loads db.js) the answer
// is simply false, and leadDisplayStatus falls back to the lead row.
let resolve = null;

export function setOfferResolver(fn) { resolve = fn; }

export function leadHasOfferAct(leadId) {
  if (!resolve || !leadId) return false;
  try { return !!resolve(leadId); } catch { return false; }
}
