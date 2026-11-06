import { test } from "node:test";
import assert from "node:assert/strict";
import { qualifiedEligibility, qualifiedBody, afterAnswer, QUALIFIED_MARKER_ID } from "./capi-qualified-core.ts";
import { PAGE_ID } from "./capi-core.ts";

const NOW = Date.parse("2026-11-02T08:00:00Z");
const lead = (o = {}) => ({ id: "L1", status: "INTERESTED", ctwa_clid: "clid-1", created_at: "2026-11-01T08:00:00Z", ...o });

test("only an Interested lead with a click id inside Meta's 7-day window is reported", () => {
  assert.equal(qualifiedEligibility(lead(), NOW), "eligible");
  assert.equal(qualifiedEligibility(null, NOW), "no_lead");
  assert.equal(qualifiedEligibility(lead({ status: "CONTACTED" }), NOW), "not_interested");
  assert.equal(qualifiedEligibility(lead({ status: "MEETING_SET" }), NOW), "not_interested");
  assert.equal(qualifiedEligibility(lead({ ctwa_clid: "" }), NOW), "no_click_id");
  assert.equal(qualifiedEligibility(lead({ ctwa_clid: null }), NOW), "no_click_id");
  assert.equal(qualifiedEligibility(lead({ created_at: "2026-10-20T00:00:00Z" }), NOW), "expired");
});

test("the event is QualifiedLead for business messaging on WhatsApp, keyed by the lead id", () => {
  const b = qualifiedBody(lead(), "tok", NOW);
  const ev = b.data[0];
  assert.equal(ev.event_name, "QualifiedLead");
  assert.equal(ev.event_id, "L1");
  assert.equal(ev.action_source, "business_messaging");
  assert.equal(ev.messaging_channel, "whatsapp");
  assert.equal(ev.event_time, Math.floor(NOW / 1000));
  assert.deepEqual(ev.user_data, { ctwa_clid: "clid-1", page_id: PAGE_ID });
  assert.equal(b.access_token, "tok");
  assert.equal(QUALIFIED_MARKER_ID("L1"), "capi-qualified-L1");
});

test("after Meta answers: accepted stays; a clear refusal can be retried; an unclear answer is never resent", () => {
  assert.equal(afterAnswer("accepted"), "accepted");
  assert.equal(afterAnswer("rejected"), "retry");
  assert.equal(afterAnswer("rate_limited"), "retry");
  for (const o of ["ambiguous", "timeout", "network"]) assert.equal(afterAnswer(o), "unclear", o);
});
