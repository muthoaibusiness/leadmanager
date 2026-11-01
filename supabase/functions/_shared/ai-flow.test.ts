// node --test — the scripted WhatsApp flow helpers in _shared/ai.ts that run
// before (or instead of) the LLM: price questions, land offers, named-project
// matching, Jolshiri detection, consent and brochure captions. These were live
// in production (wa-bot-eyad v57-v59, wa-bot-dubai v53-v55) before they were in
// git; supabase/deployed/2026-10-19/ holds the exact deployed copies.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isPriceQuestion, isLandOffer, matchNamedProject, isJolshiriProject, isAffirmative, isProfileConsent, isNegative,
  brochureCaption, leadContext, SYSTEM_PROMPT, FLOW_ASK_PROFILE_TEXT, FLOW_PRICE_AGENT_TEXT, talkIntentReply, type ProjectRow,
} from "./ai.ts";

const P = (name: string, keywords: string[], address = ""): ProjectRow =>
  ({ name, keywords, address, region: "", nature: "", sft: "", photos: [], floor_plans: [], brochure_url: "", map_image_url: "" } as unknown as ProjectRow);
const CATALOG = [
  P("Wecon Osman Bellevue", ["osman", "bellevue"], "Plot -016, Road-406, Sector 16, Jolshiri Abashon, Dhaka"),
  P("Wecon Nuznan", ["nuznan"], "Plot No 001, Road 504C, Sector 16, Jolshiri Abashon, Dhaka"),
  P("Wecon Dakshinayan", ["dakshinayan", "dakhsinayan"], "Plot -017, Road-504, Sector 17, Jolshiri Abashon, Dhaka"),
  P("Wecon Summer Breeze", ["summer breeze", "summer"], "H-714, Mehedibag, 1st Lane, Chattogram."),
  P("Wecon Iqbal Orchid", ["orchid", "iqbal"], "ROAD NO #03, NASIRABAD PROPERTIES, SOUTH KHULSHI"),
  P("Wecon Chowdhury Arcade", ["chowdhury arcade", "arcade"], "467, Shaheed Khawaja Najim Uddin Road, Kandirpar, Cumilla"),
];

// ── price questions (production behaviour P1) ──────────────────────────────
test("price and payment questions in English, Banglish and Bangla offer an agent", () => {
  for (const t of ["what is the price?", "dam koto?", "payment plan ki?", "installment ache?", "দাম কত?", "মূল্য জানতে চাই", "কিস্তি সুবিধা আছে?"]) {
    assert.equal(isPriceQuestion(t), true, t);
  }
  assert.match(FLOW_PRICE_AGENT_TEXT, /dedicated agent/);
});

test("location, photos and greetings are not price questions", () => {
  for (const t of ["project kothay?", "photo dao", "assalamu alaikum", "Osman Bellevue er address"]) {
    assert.equal(isPriceQuestion(t), false, t);
  }
});

// ── land offers (P6/P7): a seller must never get the buyer script ───────────
test("land and plot offers are land offers, and never price questions", () => {
  for (const t of ["amar 5 katha jomi ache", "55 gonda at Dolfin mor, rate koto debe?", "joint venture e land dite chai", "জমি আছে, প্লট দিতে চাই", "Do you buy land in Cox's Bazar?"]) {
    assert.equal(isLandOffer(t), true, t);
    assert.equal(isPriceQuestion(t), false, `${t} must not trigger the price script`);
  }
});

// ── named projects (P2) ─────────────────────────────────────────────────────
test("a project named outright is found by full name, short name or a distinctive keyword", () => {
  assert.equal(matchNamedProject("Wecon Nuznan er details", CATALOG)?.name, "Wecon Nuznan");
  assert.equal(matchNamedProject("osman bellevue kothay", CATALOG)?.name, "Wecon Osman Bellevue");
  assert.equal(matchNamedProject("dakhsinayan er flat", CATALOG)?.name, "Wecon Dakshinayan");
  assert.equal(matchNamedProject("hello", CATALOG), null);
});

// ── Jolshiri detection (P3) ─────────────────────────────────────────────────
test("only the three Jolshiri projects start the Jolshiri flow, case-insensitively", () => {
  for (const n of ["Wecon Osman Bellevue", "wecon nuznan", "WECON DAKSHINAYAN"]) assert.equal(isJolshiriProject(n), true, n);
  for (const n of ["Wecon Summer Breeze", "", null, undefined]) assert.equal(isJolshiriProject(n), false, String(n));
});

// ── consent (P4) ────────────────────────────────────────────────────────────
test("short yes words and consent phrases count as consent; refusals do not", () => {
  for (const t of ["ji", "ok", "হ্যাঁ", "pathiye din", "ভালো হয়", "dile valo hoy"]) assert.equal(isAffirmative(t), true, t);
  for (const t of ["na", "lagbe na", "price koto?", "ami pore janabo, ekhon busy achi"]) assert.equal(isAffirmative(t), false, t);
});

test("a reply that quotes the profile question is consent unless it refuses", () => {
  assert.equal(isProfileConsent("ok thanks", FLOW_ASK_PROFILE_TEXT), true);
  assert.equal(isProfileConsent("na lagbe na", FLOW_ASK_PROFILE_TEXT), false);
  assert.equal(isProfileConsent("hmm", ""), true);
  assert.equal(isProfileConsent("kal call dien", ""), false);
  assert.equal(isNegative("dorkar nai"), true);
});

// ── brochure captions (v59/v55) ─────────────────────────────────────────────
test("brochure captions carry the sector, and Jolshiri Abashon when the address says so", () => {
  assert.equal(brochureCaption(CATALOG[0]), "Wecon Osman Bellevue (Sector 16, Jolshiri Abashon) — Brochure");
  assert.equal(brochureCaption(CATALOG[2]), "Wecon Dakshinayan (Sector 17, Jolshiri Abashon) — Brochure");
  assert.equal(brochureCaption(CATALOG[3]), "Wecon Summer Breeze — Brochure");
  assert.equal(brochureCaption({ name: "P2P Helthcare", address: null }), "P2P Helthcare — Brochure");
});

// ── edge cases found in the reconciliation review ───────────────────────────
// Each was observed by running the deployed v57-v59 helpers locally
// (docs/reports/legacy-bot-reconciliation.md, sections 5 and 12).

test("EDGE: size questions are not price questions", () => {
  // Deployed: "koto" and "sft" alone made these price questions, so a size
  // question got the agent offer instead of the size.
  for (const t of ["nuznan er flat koto boro?", "flat koto sft?", "koto sqft er flat ache?", "how many sft is the flat?", "কয়টা বেডরুম?"]) {
    assert.equal(isPriceQuestion(t), false, t);
  }
  // A price is still a price when it is asked about per square foot.
  for (const t of ["per sft koto?", "sft koto taka?", "rate koto per sqft?", "স্কয়ার ফিট কত টাকা?"]) {
    assert.equal(isPriceQuestion(t), true, t);
  }
});

test("EDGE: a buyer asking about the developer is not a land offer", () => {
  // Deployed: "developer" and "develop" alone matched LAND_RE, so a buyer
  // skipped the Jolshiri flow.
  for (const t of ["who is the developer of Nuznan?", "developer company ki?", "WECON ki bhalo developer?"]) {
    assert.equal(isLandOffer(t), false, t);
  }
  // A real development offer still counts.
  assert.equal(isLandOffer("amar jomi develop korte chai, joint venture"), true);
});

test("EDGE: a generic word never moves a lead to another project", () => {
  // Deployed: "summer", "orchid" and "arcade" alone reassigned property_interest.
  assert.equal(matchNamedProject("summer e ki offer ache", CATALOG), null);
  assert.equal(matchNamedProject("orchid er photo", CATALOG), null);
  assert.equal(matchNamedProject("arcade e dokan ache?", CATALOG), null);
  // The full or short project name still matches.
  assert.equal(matchNamedProject("Summer Breeze er photo", CATALOG)?.name, "Wecon Summer Breeze");
  assert.equal(matchNamedProject("Iqbal Orchid kothay", CATALOG)?.name, "Wecon Iqbal Orchid");
  assert.equal(matchNamedProject("chowdhury arcade er dokan", CATALOG)?.name, "Wecon Chowdhury Arcade");
});

test("EDGE: a merged legacy property_interest with a Jolshiri project is Jolshiri", () => {
  // Deployed: "A, B" strings (29 legacy preleads) never matched exactly.
  assert.equal(isJolshiriProject("Wecon Osman Bellevue, P2P Helthcare"), true);
  assert.equal(isJolshiriProject("P2P Helthcare, Wecon JM Heritage Mall"), false);
});

test("EDGE: thanks alone is not consent; thanks on a quoted question still is", () => {
  // Deployed: "thank you" and even "you" counted as yes and sent the bundle.
  for (const t of ["thank you", "thanks", "you", "ধন্যবাদ"]) assert.equal(isAffirmative(t), false, t);
  assert.equal(isProfileConsent("thank you", FLOW_ASK_PROFILE_TEXT), true);
  assert.equal(isProfileConsent("thank you", ""), false);
});

// ── lead context (production behaviour, wa-bot-eyad v61 / wa-bot-dubai v58) ──
// wa_upsert_prelead fills property_interest with wa_settings.default_project
// (Wecon Osman Bellevue) for every contact without an ad, so that value alone
// says nothing about what the customer wants.
const OSMAN = CATALOG[0];
test("a direct contact with only the defaulted project is not a Jolshiri lead and gets no ad project", () => {
  const c = leadContext({ named: null, isAd: false, status: {}, propertyInterest: "Wecon Osman Bellevue" });
  assert.deepEqual(c, { adLead: false, jolshiriLead: false, adProject: undefined });
});

test("an ad click (payload, ctwa_clid or wa_ad_id) on a Jolshiri project is a Jolshiri lead", () => {
  for (const s of [{ isAd: true, status: {} }, { isAd: false, status: { ctwa_clid: "x" } }, { isAd: false, status: { wa_ad_id: "y" } }]) {
    const c = leadContext({ named: null, ...s, propertyInterest: "Wecon Nuznan" });
    assert.deepEqual(c, { adLead: true, jolshiriLead: true, adProject: "Wecon Nuznan" }, JSON.stringify(s));
  }
});

test("a named project decides the flow, ad or not", () => {
  assert.deepEqual(leadContext({ named: OSMAN, isAd: false, status: {}, propertyInterest: "Wecon Osman Bellevue" }),
    { adLead: false, jolshiriLead: true, adProject: "Wecon Osman Bellevue" });
  assert.deepEqual(leadContext({ named: CATALOG[3], isAd: true, status: {}, propertyInterest: "Wecon Summer Breeze" }),
    { adLead: true, jolshiriLead: false, adProject: "Wecon Summer Breeze" });
});

test("with no project in context the FAQ prompt says so and carries the which-project rule", () => {
  const none = SYSTEM_PROMPT(CATALOG, undefined, [], []);
  assert.match(none, /No project is known for this customer yet/);
  assert.match(none, /When NO project is in context/);
  const ad = SYSTEM_PROMPT(CATALOG, "Wecon Nuznan", [], []);
  assert.match(ad, /came in through an ad for: Wecon Nuznan/);
  assert.doesNotMatch(ad, /No project is known/);
});

// Issue 3: "when/how can I talk" intents get a direct answer, not a generic
// contact/meeting offer. The matcher is narrow — a talk verb plus a when/how cue.
test("talkIntentReply answers কখন/কীভাবে কথা বলতে পারবো directly", () => {
  assert.ok(talkIntentReply("কখন কথা বলতে পারবো ?"));
  assert.ok(talkIntentReply("কখন ও কিভাবে কথা বলতে পারবো ?"));
  assert.ok(talkIntentReply("কীভাবে আমি কথা বলতে পারি?"));
  assert.ok(talkIntentReply("When can I talk?"));
  const r = talkIntentReply("কখন কথা বলতে পারবো ?");
  assert.match(r!.reply, /এখনই এই চ্যাটেই কথা বলতে পারবেন/);
  assert.doesNotMatch(r!.reply, /Don t|মিটিং সেট/);
});

test("talkIntentReply lets ordinary questions and non-talk intents pass through", () => {
  for (const t of ["লোহাগাড়া কোন জায়গায়", "প্রাইস কত", "ব্রোশিওর পাঠান", "আপনাদের অফিস কোথায়", "Hello", "এইটা কোন প্রজেক্ট?"]) {
    assert.equal(talkIntentReply(t), null, t);
  }
});
