// npm run test:commands:deployed — checks the command spec against the bot
// source that is actually deployed, not the repo copy. Run
// scripts/command-compat/fetch-deployed.sh first (it downloads both bots with
// `supabase functions download`); without the download every test is skipped.
//
// The bots' own parser functions are lifted out of the deployed files and run
// as-is, so a parser change in production fails here even if the repo is
// stale. Dispatch order is pinned from the same files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { FORWARD, SEND, payload } from "./fixtures.ts";

const ROOT = process.env.DEPLOYED_DIR || "/tmp/deployed/supabase/functions";
const read = (f: string) => (existsSync(`${ROOT}/${f}`) ? readFileSync(`${ROOT}/${f}`, "utf8").replace(/\r/g, "") : null);
const EYAD = read("wa-bot-eyad/index.ts");
const DUBAI = read("wa-bot-dubai/index.ts");
const skip = !EYAD || !DUBAI ? "deployed source not downloaded (run fetch-deployed.sh)" : false;

// Lift one top-level function out of a deployed bot file and strip its types
// with Node's own stripper. The input is our own deployed source, read from a
// local download, never request data; running it is the point of the test.
function lift(src: string, name: string): (payload: any) => any {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} not found in deployed source`);
  let i = src.indexOf("{", src.indexOf(")", start)), depth = 0;
  for (; i < src.length; i++) { if (src[i] === "{") depth++; else if (src[i] === "}" && --depth === 0) break; }
  const js = stripTypeScriptTypes(src.slice(start, i + 1));
  return new Function(`return (${js});`)();
}

const parsers = skip ? {} as Record<string, (p: any) => any> : { eyad: lift(EYAD!, "parseEvent"), dubai: lift(DUBAI!, "parseWasenderEvent") };

for (const bot of ["eyad", "dubai"] as const) {
  test(`${bot} deployed: every /f<taq> parses as that exact command`, { skip }, () => {
    for (const [taq] of FORWARD) {
      const p = parsers[bot](payload({ fromMe: true, text: taq }));
      assert.equal(p.kind, "command", taq); assert.equal(p.command, taq);
    }
  });

  test(`${bot} deployed: /f<taq> with a note keeps the command token and the full text`, { skip }, () => {
    for (const [taq] of FORWARD) {
      const p = parsers[bot](payload({ fromMe: true, text: `${taq} wants a call at 10am, his number is 01730078392` }));
      assert.equal(p.command, taq); assert.ok(p.text.endsWith("01730078392"));
    }
  });

  test(`${bot} deployed: /t and /n parse as commands, upper case folds`, { skip }, () => {
    assert.equal(parsers[bot](payload({ fromMe: true, text: "/t" })).command, "/t");
    assert.equal(parsers[bot](payload({ fromMe: true, text: "/n wants 3 bed" })).command, "/n");
    assert.equal(parsers[bot](payload({ fromMe: true, text: "/FDH" })).command, "/fdh");
  });

  test(`${bot} deployed: a customer typing a command is a customer message, never a command`, { skip }, () => {
    for (const t of ["/fdh", "/t", "/n hi", "/sendca", "/frahat please"]) {
      const p = parsers[bot](payload({ fromMe: false, text: t }));
      assert.equal(p.kind, "inbound", t); assert.equal(p.command, "", t);
    }
  });

  test(`${bot} deployed: fromMe without a leading slash, a leading space-slash, or a group is ignored`, { skip }, () => {
    assert.equal(parsers[bot](payload({ fromMe: true, text: "fdh" })).kind, "ignore");
    assert.equal(parsers[bot](payload({ fromMe: true, text: "please /fdh" })).kind, "ignore");
    assert.equal(parsers[bot](payload({ fromMe: true, text: "/fdh", remote: "1203630@g.us" })).kind, "ignore");
  });

  test(`${bot} deployed: commands are dispatched before, and separately from, the AI reply path`, { skip }, () => {
    const src = bot === "eyad" ? EYAD! : DUBAI!;
    // The AI (legacy FAQ agent or trainer test turn) is reached only from the inbound branch.
    const ai = [...src.matchAll(/runFaqAgent\(|runTrainerTestTurn\(/g)].map((m) => m.index!);
    const inbound = bot === "eyad" ? src.indexOf("async function handleInbound(") : src.indexOf("async function handleInbound");
    const end = bot === "eyad" ? src.indexOf("async function handleTakeover(") : src.indexOf("async function handleCommand");
    assert.ok(inbound > 0 && end > inbound, "inbound handler bounds");
    const calls = ai.filter((i) => src.lastIndexOf("function ", i) !== src.indexOf("function runFaqAgent") || i > end);
    for (const i of calls) {
      if (src.slice(i - 30, i).includes("async function")) continue; // the definition itself
      assert.ok(i > inbound && i < end, `AI call at ${i} sits outside the inbound handler`);
    }
  });
}

test("eyad deployed: dispatch is /t, /n, /f, /send in that order, each behind its toggle", { skip }, () => {
  const order = ['p.command === "/t"', 'p.command === "/n"', 'p.command.startsWith("/f")', 'p.command.startsWith("/send")'].map((s) => EYAD!.indexOf(s));
  assert.ok(order.every((x) => x > 0), "all four branches exist");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "order unchanged");
  for (const g of ["cmdSettings.takeoverEnabled", "cmdSettings.notesEnabled", "cmdSettings.manualForwardEnabled", "cmdSettings.docsCommandEnabled"]) assert.ok(EYAD!.includes(g), g);
});

test("eyad deployed: /send<code> looks the project up by wa_projects.send_code, brochure plus at most 3 photos", { skip }, () => {
  assert.ok(EYAD!.includes("getProjectBySendCode(p.command)"));
  assert.ok(EYAD!.includes("(project.photos || []).slice(0, 3)"));
});

test("dubai deployed: /t, /n, /f exist; /send is NOT implemented (spec gap)", { skip }, () => {
  for (const s of ['evt.command === "/t"', 'evt.command === "/n"', 'evt.command.startsWith("/f")']) assert.ok(DUBAI!.includes(s), s);
  assert.ok(!/startsWith\("\/send"\)/.test(DUBAI!), "if this fails, Dubai gained /send: update the spec and this test");
});

test("both deployed: no bot reads ai_bot_pointers or ai_snapshots (published versions are not live)", { skip }, () => {
  for (const src of [EYAD!, DUBAI!]) assert.ok(!/ai_bot_pointers|ai_snapshots/.test(src));
});

test("send-code list in the spec matches the fixture", () => {
  assert.equal(SEND.length, 11);
  assert.equal(new Set(SEND.map(([c]) => c)).size, 11);
});
