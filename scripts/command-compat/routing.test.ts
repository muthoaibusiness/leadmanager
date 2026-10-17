import { test } from "node:test";
import assert from "node:assert/strict";
import { FORWARD, SEND, ALL_ON, payload } from "./fixtures.ts";
import { parseEyad, parseDubai, routeCommand, extractTrailingNote, splitPhoneFromNote } from "./routing.ts";

const created = { status: "created", notify: true, ctwa_clid: "" };

for (const bot of ["eyad", "dubai"] as const) {
  const parse = bot === "eyad" ? parseEyad : parseDubai;

  for (const [taq] of FORWARD) {
    test(`${bot} CC-01..17 ${taq} routes to lead creation, no AI`, () => {
      const p = parse(payload({ fromMe: true, text: taq }));
      assert.equal(p.kind, "command"); assert.equal(p.command, taq);
      const e = routeCommand(bot, p, { settings: ALL_ON, leadResult: created });
      assert.deepEqual(e.createLead, { p_phone: "8801700000000", p_cmd: taq });
      assert.equal(e.ai, undefined);
    });
  }

  test(`${bot} CC-18 upper-case token`, () => {
    assert.equal(parse(payload({ fromMe: true, text: "/FDH" })).command, "/fdh");
  });

  test(`${bot} CC-19 trailing note`, () => {
    const e = routeCommand(bot, parse(payload({ fromMe: true, text: "/fdh this client wants a morning call" })), { settings: ALL_ON, leadResult: created });
    assert.equal(e.note, "this client wants a morning call");
  });

  test(`${bot} CC-21 /fl notify false sends nothing to customer`, () => {
    const e = routeCommand(bot, parse(payload({ fromMe: true, text: "/fl" })), { settings: ALL_ON, leadResult: { status: "created", notify: false } });
    assert.equal(e.send.length, 0);
  });

  test(`${bot} CC-22 exists sends already-assigned`, () => {
    const e = routeCommand(bot, parse(payload({ fromMe: true, text: "/fdh" })), { settings: ALL_ON, leadResult: { status: "exists" } });
    assert.equal(e.send[0].template, "already_assigned");
  });

  test(`${bot} CC-23 unknown_command / no_agent_available send nothing`, () => {
    for (const status of ["unknown_command", "no_agent_available", "error"]) {
      assert.equal(routeCommand(bot, parse(payload({ fromMe: true, text: "/fzz" })), { settings: ALL_ON, leadResult: { status } }).send.length, 0);
    }
  });

  test(`${bot} CC-24 /t sets takeover and sends handover`, () => {
    const e = routeCommand(bot, parse(payload({ fromMe: true, text: "/t" })), { settings: ALL_ON });
    assert.equal(e.takeover, true); assert.equal(e.send[0].template, "handover"); assert.equal(e.ai, undefined);
  });

  test(`${bot} CC-26/27 /n`, () => {
    assert.equal(routeCommand(bot, parse(payload({ fromMe: true, text: "/n wants 3 bed" })), { settings: ALL_ON, leadForNote: true }).note, "wants 3 bed");
    assert.equal(routeCommand(bot, parse(payload({ fromMe: true, text: "/n" })), { settings: ALL_ON, leadForNote: true }).note, undefined);
    assert.equal(routeCommand(bot, parse(payload({ fromMe: true, text: "/n x" })), { settings: ALL_ON, leadForNote: false }).note, undefined);
  });

  test(`${bot} CC-42 customer typing /fdh is inbound, not a command`, () => {
    const p = parse(payload({ fromMe: false, text: "/fdh" }));
    assert.equal(p.kind, "inbound");
  });

  test(`${bot} CC-43 fromMe without slash is ignored`, () => {
    assert.equal(parse(payload({ fromMe: true, text: "fdh" })).kind, "ignore");
  });

  test(`${bot} CC-44 group chat is ignored`, () => {
    assert.equal(parse(payload({ fromMe: true, text: "/fdh", remote: "1203630@g.us" })).kind, "ignore");
  });

  test(`${bot} CC-45 toggles off`, () => {
    const off = (k: string) => ({ ...ALL_ON, [k]: false });
    const p = (t: string) => parse(payload({ fromMe: true, text: t }));
    assert.equal(routeCommand(bot, p("/fdh"), { settings: off("manualForwardEnabled"), leadResult: created }).createLead, undefined);
    assert.equal(routeCommand(bot, p("/t"), { settings: off("takeoverEnabled") }).takeover, undefined);
    assert.equal(routeCommand(bot, p("/n x"), { settings: off("notesEnabled"), leadForNote: true }).note, undefined);
    assert.equal(routeCommand(bot, p("/fdh"), { settings: off("customerNotifyEnabled"), leadResult: created }).send.length, 0);
    assert.equal(routeCommand(bot, p("/fdh"), { settings: off("metaCapiEnabled"), leadResult: { ...created, ctwa_clid: "c" } }).capi, undefined);
  });
}

test("CC-20 phone in trailing note is split out", () => {
  const r = splitPhoneFromNote(extractTrailingNote("/fdh his number is 01712345678 call after 5"));
  assert.equal(r.phone, "8801712345678");
  assert.ok(!r.text.includes("01712345678"));
  assert.equal(splitPhoneFromNote("no number here").phone, null);
});

for (const [code, name] of SEND) {
  test(`eyad CC-28..38 ${code} pushes brochure then up to 3 photos`, () => {
    const project = { name, brochure_url: "https://x/b.pdf", photos: ["https://x/1.jpg", "https://x/2.jpg", "https://x/3.jpg", "https://x/4.jpg"] };
    const e = routeCommand("eyad", parseEyad(payload({ fromMe: true, text: code })), { settings: ALL_ON, project });
    assert.deepEqual(e.send.map((s) => s.kind), ["document", "image", "image", "image"]);
    assert.equal(e.send[0].caption, `${name} — Brochure`);
    assert.equal(e.ai, undefined);
  });
}

test("eyad CC-39 missing brochure or photos", () => {
  const p = (c: string) => parseEyad(payload({ fromMe: true, text: c }));
  assert.deepEqual(routeCommand("eyad", p("/sendmm"), { settings: ALL_ON, project: { name: "Momtaz Manor", photos: ["https://x/1.jpg"] } }).send.map((s) => s.kind), ["image"]);
  assert.deepEqual(routeCommand("eyad", p("/sendss"), { settings: ALL_ON, project: { name: "Shafiq Sapphire", brochure_url: "https://x/b.pdf", photos: [] } }).send.map((s) => s.kind), ["document"]);
});

test("eyad CC-40 unknown code sends nothing", () => {
  assert.equal(routeCommand("eyad", parseEyad(payload({ fromMe: true, text: "/sendxx" })), { settings: ALL_ON, project: null }).send.length, 0);
});

test("eyad: hidden-number customer is sent to the @lid JID", () => {
  const p = parseEyad(payload({ fromMe: true, text: "/sendnz", remote: "123456@lid", pn: null }));
  const e = routeCommand("eyad", p, { settings: ALL_ON, project: { name: "Wecon Nuznan", brochure_url: "https://x/b.pdf" } });
  assert.equal(e.send[0].to, "123456@lid");
});

test("dubai CC-41 /send codes are not handled (current behaviour)", () => {
  const e = routeCommand("dubai", parseDubai(payload({ fromMe: true, text: "/sendnz" })), { settings: ALL_ON, project: { name: "Wecon Nuznan", brochure_url: "https://x/b.pdf" } });
  assert.equal(e.send.length, 0);
});

for (const bot of ["eyad", "dubai"] as const) {
  test(`${bot}: wa_create_lead returning nothing throws (webhook answers 500)`, () => {
    const parse = bot === "eyad" ? parseEyad : parseDubai;
    assert.throws(() => routeCommand(bot, parse(payload({ fromMe: true, text: "/fdh" })), { settings: ALL_ON, leadResult: null }), /wa_create_lead failed/);
  });
}

test("dubai: hidden-number sender is addressed as <digits>@lid", () => {
  const p = parseDubai(payload({ fromMe: true, text: "/t", remote: "123456@lid", pn: null }));
  assert.equal(p.target, "123456@lid");
  assert.equal(routeCommand("dubai", p, { settings: ALL_ON }).send[0].to, "123456@lid");
});

// The copy above is only proof while it matches the bots. These pin the exact
// guard and routing lines in the committed bot source, so editing a bot's
// command handling without updating this contract fails the suite.
import { readFileSync } from "node:fs";
const EYAD = readFileSync(new URL("../../supabase/functions/wa-bot-eyad/index.ts", import.meta.url), "utf8");
const DUBAI = readFileSync(new URL("../../supabase/functions/wa-bot-dubai/index.ts", import.meta.url), "utf8");
const pins: [string, string, string][] = [
  ["eyad", EYAD, `} else if (fromMe && text.startsWith("/")) {`],
  ["eyad", EYAD, `if (!phone || remote.endsWith("@g.us")) {`],
  ["eyad", EYAD, `command: kind === "command" ? text.toLowerCase().split(/\\s+/)[0] : "",`],
  ["eyad", EYAD, `if (cmdSettings.takeoverEnabled) await handleTakeover(p);`],
  ["eyad", EYAD, `if (cmdSettings.notesEnabled) await handleNote(p);`],
  ["eyad", EYAD, `if (cmdSettings.manualForwardEnabled) await handleCreateLead(p, cmdSettings);`],
  ["eyad", EYAD, `if (cmdSettings.docsCommandEnabled) await handleSendDocs(p);`],
  ["eyad", EYAD, `for (const url of (project.photos || []).slice(0, 3)) items.push({ type: "image", url, caption: project.name });`],
  ["eyad", EYAD, "if (project.brochure_url) items.push({ type: \"document\", url: project.brochure_url, fileName: `${project.name} Brochure.pdf`, caption: `${project.name} — Brochure` });"],
  ["dubai", DUBAI, `} else if (fromMe && text.startsWith("/")) {`],
  ["dubai", DUBAI, `if (!phone || remote.endsWith("@g.us")) {`],
  ["dubai", DUBAI, `if (evt.command === "/t") {`],
  ["dubai", DUBAI, `if (evt.command.startsWith("/f")) {`],
  ["dubai", DUBAI, `// No rule for any other "/..." command — silently dropped, as in the source.`],
];
for (const [bot, src, line] of pins) {
  test(`${bot} source still contains: ${line.slice(0, 60)}`, () => assert.ok(src.includes(line)));
}
test("dubai has no /send handler", () => assert.ok(!/startsWith\("\/send"\)/.test(DUBAI)));
