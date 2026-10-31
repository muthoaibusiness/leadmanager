// node --test supabase/functions/_shared/wa-ad.test.ts — CTWA ad-referral
// extraction and real-number preference shared by the wa-webhook mirror.
import { test } from "node:test";
import assert from "node:assert/strict";

// wa.ts reads Deno.env at import; stub it before the dynamic import.
(globalThis as any).Deno = { env: { get: () => "" } };
const { extractAdReply, realPhoneFrom } = await import("./wa.ts");

test("extractAdReply reads the ad creative from externalAdReply", () => {
  const ad = extractAdReply(
    { extendedTextMessage: { contextInfo: { externalAdReply: { title: "WECON Nuznan", sourceUrl: "https://fb.me/x", conversionSource: "ad", greetingMessageBody: "hi" } } } },
    {}
  );
  assert.equal(ad?.title, "WECON Nuznan");
  assert.equal(ad?.conversionSource, "ad");
  assert.equal(ad?.sourceUrl, "https://fb.me/x");
  assert.equal(ad?.greetingMessageBody, "hi");
});

test("extractAdReply captures structured ad/campaign/adcreative/click ids", () => {
  const ctx = { adId: "ad1", campaignId: "cmp1", adcreativeId: "cr1", clickId: "click1" };
  const ad = extractAdReply({ contextInfo: { externalAdReply: ctx } }, {});
  assert.equal(ad?.adId, "ad1");
  assert.equal(ad?.campaignId, "cmp1");
  assert.equal(ad?.adcreativeId, "cr1");
  assert.equal(ad?.clickId, "click1");
});

test("extractAdReply falls back to the top-level referral object for ids", () => {
  const ad = extractAdReply(
    { contextInfo: { externalAdReply: { title: "t" } } },
    { referral: { ad_id: "A", campaign_id: "C", adcreative_id: "AC", click_id: "CL" } }
  );
  assert.equal(ad?.adId, "A");
  assert.equal(ad?.campaignId, "C");
  assert.equal(ad?.adcreativeId, "AC");
  assert.equal(ad?.clickId, "CL");
});

test("extractAdReply returns null when there is no ad payload", () => {
  assert.equal(extractAdReply({ conversation: "hi" }, {}), null);
});

test("realPhoneFrom returns the first dialable BD number, normalized to 880", () => {
  // LID digits are not a real number and are skipped; a real phone wins.
  assert.equal(realPhoneFrom(["52454603399292@lid", "8801711839479@lid"]), "8801711839479");
  assert.equal(realPhoneFrom(["01712345678"]), "8801712345678");
  assert.equal(realPhoneFrom(["12345678901"]), "");
  assert.equal(realPhoneFrom(["108005660090617@lid"]), "");
  assert.equal(realPhoneFrom([]), "");
});
