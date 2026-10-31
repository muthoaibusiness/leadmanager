import { test } from "node:test";
import assert from "node:assert/strict";

// getBotSettings decides, per inbound message, whether the AI replies and
// whether a chat is routed to the trainer. wa.ts reads Deno.env at import and
// PostgREST through fetch, so both are stubbed before the dynamic import.
(globalThis as any).Deno = { env: { get: (k: string) => (k === "SUPABASE_URL" ? "https://sb.test" : "") } };
let tables: Record<string, any[] | "fail"> = {};
globalThis.fetch = (async (url: string) => {
  const table = String(url).split("/rest/v1/")[1]?.split("?")[0] ?? "";
  const v = tables[table];
  return v === "fail" ? new Response("boom", { status: 500 }) : new Response(JSON.stringify(v ?? []), { status: 200 });
}) as any;
const { getBotSettings, aiStillOn } = await import("./wa.ts");

const ROW = { bot: "eyad", faq_agent_enabled: false, trainer_test_mode: true, test_numbers: ["8801711000001"] };

test("AI reply OFF on the bot's row stops the FAQ agent for a customer", async () => {
  tables = { wa_bot_settings: [ROW], wa_settings: [{ id: "default", faq_agent_enabled: true }] };
  const s = await getBotSettings("eyad", "8801999000002");
  assert.equal(s.faqAgentEnabled, false); assert.equal(s.trainerTest, false);
});

test("trainer routing needs test mode on and a listed number", async () => {
  tables = { wa_bot_settings: [ROW] };
  assert.equal((await getBotSettings("eyad", "01711000001")).trainerTest, true);
  assert.equal((await getBotSettings("eyad", "8801999000002")).trainerTest, false);
  tables = { wa_bot_settings: [{ ...ROW, trainer_test_mode: false }] };
  assert.equal((await getBotSettings("eyad", "8801711000001")).trainerTest, false);
});

test("a failed settings read leaves AI replies off (fail closed)",
  async () => {
    tables = { wa_bot_settings: "fail", wa_settings: "fail" };
    const s = await getBotSettings("eyad", "8801999000002");
    assert.equal(s.faqAgentEnabled, false); assert.equal(s.welcomeEnabled, false); assert.equal(s.trainerTest, false);
    assert.equal(s.takeoverEnabled, true); assert.equal(s.notesEnabled, true);
    tables = { wa_bot_settings: [], wa_settings: [{ id: "default", faq_agent_enabled: true }] }; // absent row keeps the fallback
    assert.equal((await getBotSettings("eyad", "8801999000002")).faqAgentEnabled, true);
  });

test("aiStillOn follows the live toggle", async () => {
  tables = { wa_bot_settings: [{ ...ROW, faq_agent_enabled: true }] };
  assert.equal(await aiStillOn("eyad", "8801999000002"), true);
  tables = { wa_bot_settings: [{ ...ROW, faq_agent_enabled: false }] };
  assert.equal(await aiStillOn("eyad", "8801999000002"), false);
});

test("a foreign number sharing the last 10 digits is not routed to the trainer",
  async () => {
    tables = { wa_bot_settings: [{ ...ROW, bot: "dubai", test_numbers: ["8801501234567"] }] };
    assert.equal((await getBotSettings("dubai", "971501234567")).trainerTest, false);
  });

// The Meta CAPI tab's per-bot switch (meta_capi_enabled, set through meta-capi
// bot.set). Off: the bot sends no LeadSubmitted when it creates a lead. A test
// number still reads every toggle ON (migration 0035), as for the others.
test("Meta CAPI switch: OFF on a bot's row stops its lead event; ON or absent keeps it", async () => {
  tables = { wa_bot_settings: [{ bot: "dubai", meta_capi_enabled: false }, { bot: "eyad", meta_capi_enabled: true }] };
  assert.equal((await getBotSettings("dubai", "8801999000002")).metaCapiEnabled, false);
  tables = { wa_bot_settings: [{ bot: "eyad", meta_capi_enabled: true }] };
  assert.equal((await getBotSettings("eyad", "8801999000002")).metaCapiEnabled, true);
  tables = { wa_bot_settings: [{ bot: "eyad" }] };
  assert.equal((await getBotSettings("eyad", "8801999000002")).metaCapiEnabled, true, "a missing column keeps today's behaviour");
  tables = { wa_bot_settings: "fail", wa_settings: "fail" };
  assert.equal((await getBotSettings("eyad", "8801999000002")).metaCapiEnabled, false, "a failed read sends nothing");
});

// Known gap, pinned so it cannot change silently: a bot's test number reads
// every toggle ON (migration 0035), including Meta CAPI. With the switch Off,
// a lead created from a test number is still reported to Meta.
test("Meta CAPI switch: a test number still reads ON when the bot is Off (documented gap)", async () => {
  tables = { wa_bot_settings: [{ bot: "eyad", meta_capi_enabled: false, test_numbers: ["8801711000001"] }] };
  assert.equal((await getBotSettings("eyad", "01711000001")).metaCapiEnabled, true);
  assert.equal((await getBotSettings("eyad", "8801999000002")).metaCapiEnabled, false);
});
