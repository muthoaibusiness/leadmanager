import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifySignature, leadgenChanges, mapAnswers, parseBudget, pickAssignee, summarizeAnswers, normKey, fieldMapOf, pickNext } from "./fb-leads-core.ts";

test("only a body signed with the app secret is accepted", async () => {
  const raw = '{"object":"page"}';
  const sig = "sha256=" + createHmac("sha256", "s3cret").update(raw).digest("hex");
  assert.equal(await verifySignature(raw, sig, "s3cret"), true);
  assert.equal(await verifySignature(raw + " ", sig, "s3cret"), false);      // body changed
  assert.equal(await verifySignature(raw, sig, "other"), false);              // wrong secret
  assert.equal(await verifySignature(raw, null, "s3cret"), false);
  assert.equal(await verifySignature(raw, "sha1=abc", "s3cret"), false);
  assert.equal(await verifySignature(raw, sig, ""), false);                   // no secret set: refuse everything
});

test("the webhook's leadgen changes are read out; other fields are ignored", () => {
  const body = { object: "page", entry: [
    { id: "104718884272119", changes: [
      { field: "leadgen", value: { leadgen_id: "444444444444", form_id: "555555555555", page_id: "104718884272119" } },
      { field: "feed", value: { x: 1 } },
      { field: "leadgen", value: { form_id: "9" } },                                  // no leadgen id
    ] },
    { id: "777", changes: [{ field: "leadgen", value: { leadgen_id: "1" } }] },       // page falls back to the entry id
  ] };
  assert.deepEqual(leadgenChanges(body), [
    { leadgen_id: "444444444444", form_id: "555555555555", page_id: "104718884272119" },
    { leadgen_id: "1", form_id: "", page_id: "777" },
  ]);
  assert.deepEqual(leadgenChanges({}), []);
});

test("answers land in the fields the form maps them to", () => {
  const fd = [
    { name: "full_name", values: ["Rahim Uddin"] }, { name: "phone_number", values: ["+880 1712-345678"] },
    { name: "email", values: ["r@x.com"] }, { name: "city", values: [""] },
    { name: "monthly_budget", values: ["৫০,০০০"] }, { name: "what_shop", values: ["Mobile", "Gents"] },
  ];
  const m = mapAnswers(fd, { name: ["name", "full_name"], phone: ["phone", "phone_number"], email: ["email"], city: ["city"], budget: ["monthly_budget"] });
  assert.equal(m.name, "Rahim Uddin");
  assert.equal(m.phone, "8801712345678");
  assert.equal(m.email, "r@x.com");
  assert.equal(m.city, "");
  assert.equal(m.budget, 50000);
  assert.deepEqual(m.answers.map(([k]) => k), ["full_name", "phone_number", "email", "monthly_budget", "what_shop"]);   // empty answers dropped
  assert.ok(summarizeAnswers(m.answers).includes("what shop: Mobile, Gents"));
  assert.equal(mapAnswers([], {}).name, "Facebook lead");
  // a number already in international form for another country is kept as digits
  assert.equal(mapAnswers([{ name: "p", values: ["+971 56 275 5330"] }], { phone: ["p"] }).phone, "971562755330");
  assert.equal(parseBudget("BDT 5,000,000"), 5000000);
  assert.equal(parseBudget("no idea"), 0);
});

test("a key typed as the label still matches Facebook's snake_case name, in any case, Bangla too", () => {
  const fd = [
    { name: "full_name", values: ["Karim"] }, { name: "phone_number", values: ["01711223344"] },
    { name: "আপনি_কোন_এলাকায়_থাকেন?", values: ["চট্টগ্রাম"] },
  ];
  const m = mapAnswers(fd, { name: ["Full name"], phone: ["Phone number"], city: ["আপনি কোন এলাকায় থাকেন?"] });
  assert.equal(m.name, "Karim");
  assert.equal(m.phone, "8801711223344");
  assert.equal(m.city, "চট্টগ্রাম");
  assert.equal(normKey("PHONE-NUMBER "), "phone_number");
  assert.equal(mapAnswers(fd, { phone: ["mobile"] }).phone, "");          // a key that is not there still finds nothing
});

test("a map saved without Facebook's standard key still finds it", () => {
  const fd = [{ name: "phone", values: ["+8801854843044"] }, { name: "full_name", values: ["hasan"] }];
  const m = mapAnswers(fd, fieldMapOf({ field_map: { phone: ["phone_number"], name: "Name" } }));
  assert.equal(m.phone, "8801854843044");
  assert.equal(m.name, "hasan");
  assert.deepEqual(fieldMapOf({}).phone.slice(0, 2), ["phone_number", "phone"]);
});

test("who gets it: one agent, a team lead, a round robin, or nobody", () => {
  const users = [
    { id: "a1", name: "A1", role: "AGENT", team_id: "t1" }, { id: "a2", name: "A2", role: "AGENT", team_id: "t1" },
    { id: "a3", name: "A3", role: "AGENT", team_id: "t1", is_active: false }, { id: "tl", name: "TL", role: "TEAM_LEAD", team_id: "t1" },
  ];
  assert.equal(pickAssignee({ assign_mode: "agent", assign_agent_id: "a1" }, users, 0).user?.id, "a1");
  assert.equal(pickAssignee({ assign_mode: "agent", assign_agent_id: "a3" }, users, 0).user, null);          // inactive
  assert.equal(pickAssignee({ assign_mode: "team", assign_team_id: "t1" }, users, 0).user?.id, "tl");
  assert.equal(pickAssignee({ assign_mode: "team", assign_team_id: "t9" }, users, 0).user, null);
  const rr = { assign_mode: "round_robin", assign_pool: ["a1", "a3", "a2"] };                                  // a3 is inactive: skipped
  assert.deepEqual([0, 1, 2, 3].map((n) => pickAssignee(rr, users, n).user?.id), ["a1", "a2", "a1", "a2"]);
  assert.equal(pickAssignee({ assign_mode: "none" }, users, 0).user, null);
  assert.equal(pickAssignee({ assign_mode: "round_robin", assign_pool: ["a3"] }, users, 0).user, null);
});

test("the drip takes the oldest lead that is not a CRM lead yet, and does not let a bad one hold the rest up", () => {
  const NOW = Date.parse("2026-11-03T12:00:00Z");
  const L = (id: string, t: string) => ({ id, form_id: "f", created: t });
  const all = [L("c", "2026-11-02T12:00:00+0000"), L("a", "2026-11-01T12:00:00+0000"), L("b", "2026-11-01T18:00:00+0000"), L("d", "2026-11-02T18:00:00+0000")];
  const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
  assert.equal(pickNext(all, [], NOW)?.id, "a");                                                    // nothing handled: the oldest
  assert.equal(pickNext(all, [{ leadgen_id: "a", status: "created" }, { leadgen_id: "b", status: "duplicate" }], NOW)?.id, "c");
  assert.equal(pickNext(all, [{ leadgen_id: "a", status: "failed", processed_at: ago(10) }], NOW)?.id, "b");   // failed 10 min ago: later
  assert.equal(pickNext(all, [{ leadgen_id: "a", status: "failed", processed_at: ago(90) }], NOW)?.id, "a");   // failed 90 min ago: again
  assert.equal(pickNext(all, [{ leadgen_id: "a", status: "received", received_at: ago(3) }], NOW)?.id, "b");  // being handled right now
  assert.equal(pickNext(all, all.map((l) => ({ leadgen_id: l.id, status: "created" })), NOW), null);
});
