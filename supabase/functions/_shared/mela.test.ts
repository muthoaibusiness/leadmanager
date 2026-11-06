import { test } from "node:test";
import assert from "node:assert/strict";
import { intlPhone, bnDigits, pickContact, melaInviteText, isCitizenLead, MELA_FALLBACK_LINE, MELA_INVITE_ID } from "./mela.ts";

const users = [
  { id: "a1", name: "Agent One", role: "AGENT", team_id: "t1", phone: "" },
  { id: "tl1", name: "Maruf Alam", role: "TEAM_LEAD", team_id: "t1", phone: "01709665125" },
  { id: "tl2", name: "Team DUBAI", role: "TEAM_LEAD", team_id: "t2", phone: "+971522457979" },
  { id: "a2", name: "Dubai Agent", role: "AGENT", team_id: "t2", phone: "971500000000" },
  { id: "tl3", name: "No Phone TL", role: "TEAM_LEAD", team_id: "t3", phone: "" },
  { id: "a3", name: "Agent Three", role: "AGENT", team_id: "t3", phone: "01811111111" },
  { id: "off", name: "Gone TL", role: "TEAM_LEAD", team_id: "t4", phone: "01900000000", is_active: false },
];

test("phone as digits with the country code", () => {
  assert.equal(intlPhone("01896100270"), "8801896100270");
  assert.equal(intlPhone("8801709665081"), "8801709665081");
  assert.equal(intlPhone("+880 1709-665125"), "8801709665125");
  assert.equal(intlPhone("1709665125"), "8801709665125");
  assert.equal(intlPhone("+971 52 245 7979"), "971522457979");
  assert.equal(intlPhone(""), "");
  assert.equal(bnDigits("2026"), "২০২৬");
});

test("the contact is the team lead of whoever holds the lead", () => {
  assert.deepEqual(pickContact({ team_id: "t1", assigned_to: "a1" }, users), { name: "Maruf Alam", phone: "8801709665125" });
  assert.deepEqual(pickContact({ team_id: null, assigned_to: "a2" }, users), { name: "Team DUBAI", phone: "971522457979" });
  // the lead's team has a lead with no phone: fall to the holder's own number
  assert.deepEqual(pickContact({ team_id: "t3", assigned_to: "a3" }, users), { name: "Agent Three", phone: "8801811111111" });
  // a holder who is the team lead themself
  assert.deepEqual(pickContact({ team_id: "t1", assigned_to: "tl1" }, users), { name: "Maruf Alam", phone: "8801709665125" });
  // inactive lead is skipped; nobody with a phone gives null
  assert.equal(pickContact({ team_id: "t4", assigned_to: "off" }, users), null);
  assert.equal(pickContact({ team_id: "t9", assigned_to: "nobody" }, users), null);
});

test("holder's team decides; a lead whose team_id is a user id still resolves; Marketing/Brand uses the agent", () => {
  const us = [
    { id: "maruf", name: "Maruf Alam", role: "TEAM_LEAD", team_id: "tM", phone: "01709665125" },
    { id: "afrina", name: "Afrina Rashid", role: "AGENT", team_id: "tM", phone: "" },
    { id: "brand", name: "Brand", role: "TEAM_LEAD", team_id: "tMk", phone: "" },
    { id: "rahat", name: "Ismail H. Rahat", role: "AGENT", team_id: "tMk", phone: "01712345678" },
    { id: "hasan", name: "Hasan", role: "AGENT", team_id: "tMk", phone: "" },
  ];
  const teams = [{ id: "tM", name: "Maruf Alam's Team" }, { id: "tMk", name: "Marketing" }];
  // the lead's team_id holds Maruf's USER id (real data): the holder's team still finds him
  assert.deepEqual(pickContact({ team_id: "maruf", assigned_to: "afrina" }, us, teams), { name: "Maruf Alam", phone: "8801709665125" });
  // Marketing: the agent's own name and number
  assert.deepEqual(pickContact({ team_id: "tMk", assigned_to: "rahat" }, us, teams), { name: "Ismail H. Rahat", phone: "8801712345678" });
  // Marketing agent with no number: Brand has none either, so nothing to name
  assert.equal(pickContact({ team_id: "tMk", assigned_to: "hasan" }, us, teams), null);
  // a lead whose own team_id is a user id and whose holder is unknown: that user is the contact
  assert.deepEqual(pickContact({ team_id: "maruf", assigned_to: "ghost" }, us, teams), { name: "Maruf Alam", phone: "8801709665125" });
});

test("invitation text names the agent (name, number, 'he is your agent'), or shows the company line without one", () => {
  const t = melaInviteText({ name: "Shabbir Newaz", phone: "8801896100270" });
  assert.ok(t.includes("👨‍💼 Shabbir Newaz\n📞 8801896100270\n\nতিনিই আপনার এজেন্ট। যেকোনো প্রয়োজনে তাঁর সাথে যোগাযোগ রাখুন।"));
  // the agent block sits after the venue and before the closing line
  assert.ok(t.indexOf("📍 সিটিজেন পার্ক") < t.indexOf("👨‍💼") && t.indexOf("তাঁর সাথে যোগাযোগ রাখুন") < t.indexOf("আপনার উপস্থিতি কামনা করছি।"));
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
