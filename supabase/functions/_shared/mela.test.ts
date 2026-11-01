import { test } from "node:test";
import assert from "node:assert/strict";
import { displayPhone, bnDigits, pickContact, melaInviteText, isCitizenLead, MELA_FALLBACK_LINE, MELA_INVITE_ID } from "./mela.ts";

const users = [
  { id: "a1", name: "Agent One", role: "AGENT", team_id: "t1", phone: "" },
  { id: "tl1", name: "Maruf Alam", role: "TEAM_LEAD", team_id: "t1", phone: "01709665125" },
  { id: "tl2", name: "Team DUBAI", role: "TEAM_LEAD", team_id: "t2", phone: "+971522457979" },
  { id: "a2", name: "Dubai Agent", role: "AGENT", team_id: "t2", phone: "971500000000" },
  { id: "tl3", name: "No Phone TL", role: "TEAM_LEAD", team_id: "t3", phone: "" },
  { id: "a3", name: "Agent Three", role: "AGENT", team_id: "t3", phone: "01811111111" },
  { id: "off", name: "Gone TL", role: "TEAM_LEAD", team_id: "t4", phone: "01900000000", is_active: false },
];

test("phone display: BD as 01…, others with +", () => {
  assert.equal(displayPhone("8801709665081"), "01709665081");
  assert.equal(displayPhone("01709665125"), "01709665125");
  assert.equal(displayPhone("+971 52 245 7979"), "+971522457979");
  assert.equal(displayPhone("1709665125"), "01709665125");
  assert.equal(displayPhone(""), "");
  assert.equal(bnDigits("01709 665125"), "০১৭০৯ ৬৬৫১২৫");
});

test("the contact is the team lead of whoever holds the lead", () => {
  assert.deepEqual(pickContact({ team_id: "t1", assigned_to: "a1" }, users), { name: "Maruf Alam", phone: "01709665125" });
  assert.deepEqual(pickContact({ team_id: null, assigned_to: "a2" }, users), { name: "Team DUBAI", phone: "+971522457979" });
  // the lead's team has a lead with no phone: fall to the holder's own number
  assert.deepEqual(pickContact({ team_id: "t3", assigned_to: "a3" }, users), { name: "Agent Three", phone: "01811111111" });
  // a holder who is the team lead themself
  assert.deepEqual(pickContact({ team_id: "t1", assigned_to: "tl1" }, users), { name: "Maruf Alam", phone: "01709665125" });
  // inactive lead is skipped; nobody with a phone gives null
  assert.equal(pickContact({ team_id: "t4", assigned_to: "off" }, users), null);
  assert.equal(pickContact({ team_id: "t9", assigned_to: "nobody" }, users), null);
});

test("invitation text carries the Bangla-digit contact line, or the company line without one", () => {
  const t = melaInviteText({ name: "Maruf Alam", phone: "01709665125" });
  assert.ok(t.includes("📞 Maruf Alam: ০১৭০৯৬৬৫১২৫"));
  assert.ok(t.startsWith("সম্মানিত শুভাকাঙ্ক্ষী,"));
  assert.ok(t.includes("৪–৮ নভেম্বর ২০২৬") && t.endsWith("আপনার উপস্থিতি কামনা করছি।"));
  assert.ok(melaInviteText(null).includes(MELA_FALLBACK_LINE));
  assert.ok(!t.includes("০৯৬ ৬৬৭ ৯৩২৬৬"));
});

test("citizen lead check and marker id", () => {
  assert.equal(isCitizenLead({ property_interest: "Wecon Citizen Avenue" }), true);
  assert.equal(isCitizenLead({ property_interest: "WECON CITIZEN AVENUE" }), true);
  assert.equal(isCitizenLead({ property_interest: "Wecon Osman Bellevue" }), false);
  assert.equal(isCitizenLead(null), false);
  assert.equal(MELA_INVITE_ID("L1"), "mela-invite-L1");
});
