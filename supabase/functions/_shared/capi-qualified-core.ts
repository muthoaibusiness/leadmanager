// Pure rules for the QualifiedLead event: a lead an agent marks Interested is
// reported to Meta's Conversions API for Business Messaging as `QualifiedLead`,
// once. Deno-free so the Node tests cover it; the I/O is in capi-qualified.ts.
//
// The same dataset, page, window and answer rules as LeadSubmitted (capi-core.ts):
// the lead's ctwa_clid ties the event to the ad click; Meta accepts it within 7
// days of the click; only HTTP 200 with events_received >= 1 counts as reported.

import { PAGE_ID, WINDOW_MS } from "./capi-core.ts";

export const QUALIFIED_EVENT = "QualifiedLead";
export const QUALIFIED_MARKER_ID = (leadId: string) => `capi-qualified-${leadId}`;

type Row = Record<string, any>;
export type Eligibility = "eligible" | "no_lead" | "not_interested" | "no_click_id" | "expired";

export function qualifiedEligibility(lead: Row | null | undefined, nowMs: number): Eligibility {
  if (!lead) return "no_lead";
  if (lead.status !== "INTERESTED") return "not_interested";
  if (!String(lead.ctwa_clid || "").trim()) return "no_click_id";
  if (!(nowMs - Date.parse(lead.created_at) < WINDOW_MS)) return "expired";
  return "eligible";
}

// event_id is the lead id, as for LeadSubmitted: Meta's dedupe key is event_id +
// event_name, and the two names differ, so one lead can carry both once each.
export function qualifiedBody(lead: Row, token: string, nowMs: number) {
  return {
    data: [{
      action_source: "business_messaging", event_name: QUALIFIED_EVENT, event_id: String(lead.id),
      event_time: Math.floor(nowMs / 1000), messaging_channel: "whatsapp",
      user_data: { ctwa_clid: lead.ctwa_clid, page_id: PAGE_ID },
    }],
    access_token: token,
  };
}

// What to do with the marker once Meta (or the network) has answered.
//   accepted     keep it, reported
//   unclear      keep it: Meta may have the event and does not deduplicate, so it is never resent
//   retry        remove it: Meta refused it, nothing was recorded, a later call may try again
export function afterAnswer(outcome: string): "accepted" | "unclear" | "retry" {
  if (outcome === "accepted") return "accepted";
  if (outcome === "rejected" || outcome === "rate_limited") return "retry";
  return "unclear"; // ambiguous, timeout, network
}
