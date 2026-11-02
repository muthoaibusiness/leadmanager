import { test } from "node:test";
import assert from "node:assert/strict";
import { dueQuery, hasDialableNumber, shouldTell, assignedText, EYAD_TAG, AFTER_MIN, WINDOW_MIN, BATCH } from "./forward-core.ts";

test("Eyad forwards to the Chattogram pool five minutes in", () => {
  assert.equal(EYAD_TAG, "/fctg");
  assert.equal(AFTER_MIN, 5);
});

test("the contacts due are the Eyad ones first heard from 5 to 30 minutes ago, never forwarded, no human on them", () => {
  const q = decodeURIComponent(dueQuery(Date.parse("2026-11-03T12:00:00Z")));
  assert.ok(q.startsWith("preleads?"));
  assert.ok(q.includes("WA=eq.Eyad"));
  assert.ok(q.includes("forwarded=not.is.true"));       // null counts as not forwarded
  assert.ok(q.includes("takeover=not.is.true"));
  assert.ok(q.includes("created_at=gte.2026-11-03T11:30:00.000Z"));   // WINDOW_MIN = 30: the back catalogue is never touched
  assert.ok(q.includes("created_at=lte.2026-11-03T11:55:00.000Z"));   // AFTER_MIN = 5
  assert.equal(WINDOW_MIN, 30);
  assert.ok(q.includes("or=(region.is.null,region.eq.Chattogram)")); // Dhaka and Cumilla keep their own pools
  assert.ok(q.includes("order=created_at.asc"));
  assert.ok(q.includes(`limit=${BATCH}`));
});

test("a hidden number is left to a human; a real one is forwarded", () => {
  assert.equal(hasDialableNumber("8801712345678", "8801712345678@s.whatsapp.net"), true);
  assert.equal(hasDialableNumber("8801712345678", null), true);                       // a Bangladeshi mobile, thread unknown
  assert.equal(hasDialableNumber("8801712345678", "123456789012345@lid"), true);      // the number is known even though the thread is a LID
  assert.equal(hasDialableNumber("184560001234567", "184560001234567@lid"), false);   // only a LID's digits
  assert.equal(hasDialableNumber("971562755330", "971562755330@s.whatsapp.net"), true); // a real number from abroad
  assert.equal(hasDialableNumber("184560001234567", null), false);
  assert.equal(hasDialableNumber("", "@s.whatsapp.net"), true);                       // (the phone is checked by the caller's query)
});

test("the customer is told only about a lead just made, only when both switches say so", () => {
  const made = { status: "created", notify: true };
  assert.equal(shouldTell(made, true), true);
  assert.equal(shouldTell(made, false), false);                                       // Eyad's "notify customer" switch is off
  assert.equal(shouldTell({ status: "created", notify: false }, true), false);         // this agent's row says not to
  assert.equal(shouldTell({ status: "exists", notify: true }, true), false);           // assigned long ago: no repeat
  assert.equal(shouldTell({ status: "no_agent_available" }, true), false);
  assert.equal(shouldTell(null, true), false);
});

test("the message names the expert and falls back to 'there'", () => {
  const t = assignedText("Rahim", "Karim Hossain", "8801711000000");
  assert.ok(t.startsWith("প্রিয় Rahim,"));
  assert.ok(t.includes("Karim Hossain") && t.includes("8801711000000"));
  assert.ok(assignedText("", "A", "1").startsWith("প্রিয় there,"));
});
