import { test } from "node:test";
import assert from "node:assert/strict";

// canonicalConvJid is pure (no Deno/env reads), but wa.ts reads Deno.env at
// import, so stub it before the dynamic import.
(globalThis as any).Deno = { env: { get: () => "" } };
const { canonicalConvJid, isBotEcho } = await import("./wa.ts");

test("canonicalConvJid: phone JID stays as-is", () => {
  assert.equal(canonicalConvJid("8801604271958@s.whatsapp.net", "8801604271958"), "8801604271958@s.whatsapp.net");
});

test("canonicalConvJid: LID with a real Bangladeshi number becomes the phone JID", () => {
  assert.equal(canonicalConvJid("1234567@lid", "8801604271958"), "8801604271958@s.whatsapp.net");
  assert.equal(canonicalConvJid("1234567@lid", "01604271958"), "8801604271958@s.whatsapp.net");
});

test("canonicalConvJid: LID without a real number stays a LID", () => {
  assert.equal(canonicalConvJid("1234567@lid", ""), "1234567@lid");
  assert.equal(canonicalConvJid("1234567@lid", "999"), "1234567@lid");
});

test("canonicalConvJid: non-WhatsApp remote passes through", () => {
  assert.equal(canonicalConvJid("xyz", "8801604271958"), "xyz");
});

// Shapes from production on 2026-10-31: the AI Trainer row at 10:48:06, its echo at 10:48:10.
const BOT_ROW = { body: "Jee, parking ache.", sender_name: "AI Trainer", wa_timestamp: "2026-10-31T10:48:06.700Z" };

test("isBotEcho: the same text seconds after a bot-sent row is an echo", () => {
  assert.equal(isBotEcho([BOT_ROW], "Jee, parking ache.", "2026-10-31T10:48:10.995Z"), true);
});

test("isBotEcho: a human agent's own text, a different text, or an old row is not an echo", () => {
  assert.equal(isBotEcho([{ ...BOT_ROW, sender_name: "" }], "Jee, parking ache.", "2026-10-31T10:48:10.995Z"), false, "human-typed row");
  assert.equal(isBotEcho([BOT_ROW], "Different text", "2026-10-31T10:48:10.995Z"), false);
  assert.equal(isBotEcho([BOT_ROW], "Jee, parking ache.", "2026-10-31T10:58:10.995Z"), false, "10 minutes later");
  assert.equal(isBotEcho([], "Jee, parking ache.", "2026-10-31T10:48:10.995Z"), false);
  assert.equal(isBotEcho([BOT_ROW], "", "2026-10-31T10:48:10.995Z"), false);
});
