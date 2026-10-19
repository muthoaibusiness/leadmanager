import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CORE_VERSION, canonicalJson, checksumOf, validateItem, validateScope, contentHash, itemApplies,
} from "./trainer-core.ts";
import { validateTestSpec, runChecks, judgeVerdict, finalVerdict, parseJudge, publishGate, redactTurns, type TestSpec, type TurnResult } from "./trainer-core.ts";
import { buildPrompt, parseModelOutput, guardReply, resolveMedia, runTurn, FALLBACK, type SnapshotContent } from "./trainer-core.ts";
import { freezeContent, detectLanguage, resolveProject, buildHistory, emptyState, type ItemRow } from "./trainer-core.ts";

test("canonicalJson sorts keys recursively and keeps array order", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [3, 1], c: null } }), '{"a":{"c":null,"d":[3,1]},"b":1}');
});

test("checksum is stable across key order", async () => {
  assert.equal(await checksumOf({ x: 1, y: [1, 2] }), await checksumOf({ y: [1, 2], x: 1 }));
  assert.match(await checksumOf({}), /^[0-9a-f]{64}$/);
});

test("CORE_VERSION is set", () => {
  assert.match(CORE_VERSION, /^\d+\.\d+\.\d+$/);
});

test("validateItem: fact needs topic and text", () => {
  assert.deepEqual(validateItem("fact", { topic: "Location", text: "Sector 16" }), []);
  assert.ok(validateItem("fact", { topic: "" }).length > 0);
  assert.ok(validateItem("fact", null).length > 0);
});

test("validateItem: project floor plans are {url,label}", () => {
  const ok = { name: "Wecon Nuznan", aliases: { bn: ["নুজনান"], banglish: ["nuznan"], en: ["nuznan"] },
    media: { photos: [], floor_plans: [{ url: "https://x/a.jpg", label: "Ground" }] } };
  assert.deepEqual(validateItem("project", ok), []);
  const bad = { ...ok, media: { photos: [], floor_plans: ["https://x/a.jpg"] } };
  assert.ok(validateItem("project", bad).length > 0);
});

test("validateItem: example needs conversation, ideal_reply, reason, source", () => {
  const ok = { conversation: [{ role: "customer", text: "dam koto?" }], ideal_reply: "Meeting?", reason: "no price", source: "handwritten" };
  assert.deepEqual(validateItem("example", ok), []);
  assert.ok(validateItem("example", { ...ok, source: "other" }).length > 0);
});

test("validateItem: unknown keys rejected", () => {
  assert.ok(validateItem("rule", { name: "x", when: "w", must: "m", extra: 1 }).length > 0);
});

test("validateScope", () => {
  const ids = new Set(["p1"]);
  assert.deepEqual(validateScope("fact", ["eyad"], "p1", ids), []);
  assert.deepEqual(validateScope("fact", ["eyad", "dubai"], null, ids), []);
  assert.ok(validateScope("fact", [], null, ids).length > 0);
  assert.ok(validateScope("fact", ["both"], null, ids).length > 0);
  assert.ok(validateScope("fact", ["eyad"], "p9", ids).length > 0);
  assert.ok(validateScope("behaviour", ["eyad"], "p1", ids).length > 0);
  assert.ok(validateScope("project", ["eyad"], "p1", ids).length > 0);
});

test("contentHash ignores key order", async () => {
  assert.equal(await contentHash("fact", { topic: "a", text: "b" }), await contentHash("fact", { text: "b", topic: "a" }));
});

test("itemApplies filters by bot and project", () => {
  assert.equal(itemApplies({ bots: ["eyad"], project_ref: null }, "eyad", []), true);
  assert.equal(itemApplies({ bots: ["eyad"], project_ref: null }, "dubai", []), false);
  assert.equal(itemApplies({ bots: ["eyad", "dubai"], project_ref: "p1" }, "dubai", ["p1"]), true);
  assert.equal(itemApplies({ bots: ["eyad", "dubai"], project_ref: "p1" }, "dubai", ["p2"]), false);
});


const P = (id: string, name: string, aliases: any, extra: any = {}): ItemRow => ({
  id, kind: "project", revision: 1, status: "active", bots: ["eyad", "dubai"], project_ref: null,
  body: { name, aliases, media: { photos: [], floor_plans: [] }, ...extra },
});
const NUZ = P("p-nuz", "Wecon Nuznan", { bn: ["নুজনান"], banglish: ["nuznan", "nunan"], en: ["nuznan"] }, { tags: ["jolshiri"] });
const OSM = P("p-osm", "Wecon Osman Bellevue", { bn: ["ওসমান"], banglish: ["osman", "bellevue"], en: ["osman bellevue"] }, { tags: ["jolshiri"] });
const SUM = P("p-sum", "Wecon Summer Breeze", { banglish: ["summer breeze"], en: ["summer breeze"] });

test("freezeContent keeps active items, sorts by id, rejects dangling project refs", () => {
  const fact = { id: "f1", kind: "fact", revision: 2, status: "active", bots: ["eyad"], project_ref: "p-nuz", body: { topic: "a", text: "b" } } as ItemRow;
  const dead = { ...fact, id: "f0", status: "retired" } as ItemRow;
  const { content, errors } = freezeContent([fact, NUZ, dead], { reply_model: "m", max_tokens: 600, rubric_version: 1 });
  assert.deepEqual(errors, []);
  assert.deepEqual(content.items.map((i) => i.id), ["f1"]);
  assert.deepEqual(content.projects.map((p) => p.id), ["p-nuz"]);
  const orphan = { ...fact, project_ref: "p-x" } as ItemRow;
  assert.ok(freezeContent([orphan], { reply_model: "m", max_tokens: 600, rubric_version: 1 }).errors.length > 0);
});

test("freezeContent rejects an alias shared by two projects", () => {
  const dup = P("p-2", "Other", { banglish: ["nuznan"] });
  assert.ok(freezeContent([NUZ, dup], { reply_model: "m", max_tokens: 600, rubric_version: 1 }).errors.some((e) => e.includes("alias")));
});

test("detectLanguage", () => {
  assert.equal(detectLanguage("দাম কত?"), "bn");
  assert.equal(detectLanguage("Nuznan er size কত?"), "bn");
  assert.equal(detectLanguage("nuznan er dam koto?"), "banglish");
  assert.equal(detectLanguage("What is the price of Nuznan?"), "en");
  assert.equal(detectLanguage("‌‍"), "en");
});

test("resolveProject: explicit alias wins, Bangla script works", () => {
  const r = resolveProject("ওসমান প্রজেক্টের লোকেশন?", emptyState(), { isAd: false }, [NUZ, OSM, SUM]);
  assert.deepEqual(r, { projects: ["p-osm"], source: "explicit", ambiguous: false });
  assert.deepEqual(resolveProject("nunan er brochure", emptyState(), { isAd: false }, [NUZ, OSM]).projects, ["p-nuz"]);
});

test("resolveProject: two named projects", () => {
  const r = resolveProject("Nuznan ar Osman duitar size?", emptyState(), { isAd: false }, [NUZ, OSM]);
  assert.deepEqual(r.projects.sort(), ["p-nuz", "p-osm"]);
});

test("resolveProject: generic word alone resolves nothing", () => {
  assert.deepEqual(resolveProject("summer", emptyState(), { isAd: false }, [SUM]).projects, []);
});

test("resolveProject: state then ad, ad only when unambiguous", () => {
  const st = { ...emptyState(), active_project: "p-nuz", active_source: "explicit" as const };
  assert.deepEqual(resolveProject("location?", st, { isAd: false }, [NUZ, OSM]), { projects: ["p-nuz"], source: "state", ambiguous: false });
  assert.deepEqual(resolveProject("info", emptyState(), { isAd: true, adText: "Wecon Osman Bellevue Jolshiri" }, [NUZ, OSM]).projects, ["p-osm"]);
  const amb = resolveProject("info", emptyState(), { isAd: true, adText: "Nuznan and Osman" }, [NUZ, OSM]);
  assert.deepEqual(amb, { projects: [], source: null, ambiguous: true });
  assert.deepEqual(resolveProject("price koto?", emptyState(), { isAd: false }, [NUZ, OSM]).projects, []);
});

test("buildHistory excludes every agent slash command and its trailing note (spec 10.5.1, CC-46)", () => {
  const rows = [
    { role: "customer", text: "nuznan er dam koto?" },
    { role: "agent", text: "/fdh this client is looking in the 1st floor with long payment" },
    { role: "agent", text: "  /n you are good that's lets meet in the office" },
    { role: "agent", text: "/t" }, { role: "agent", text: "/FMKT its a testing data" }, { role: "agent", text: "/sendnz" },
    { role: "customer", text: "/fdh" }, { role: "agent", text: "Assalamu alaikum, ami Rahim" },
  ] as any;
  assert.deepEqual(buildHistory(rows), [
    { role: "customer", text: "nuznan er dam koto?" },
    { role: "customer", text: "/fdh" },
    { role: "agent", text: "Assalamu alaikum, ami Rahim" },
  ]);
});

test("buildHistory drops commands, keeps agent label, caps length", () => {
  const rows = [
    { role: "customer", text: "hi" }, { role: "agent", text: "/fdh note about client" },
    { role: "agent", text: "Hello, I am Rahim" }, { role: "bot", text: "" },
  ] as any;
  assert.deepEqual(buildHistory(rows), [{ role: "customer", text: "hi" }, { role: "agent", text: "Hello, I am Rahim" }]);
  const many = Array.from({ length: 30 }, (_, i) => ({ role: "customer", text: String(i) })) as any;
  assert.equal(buildHistory(many).length, 20);
  assert.equal(buildHistory(many)[0].text, "10");
});


const NUZM = P("p-nuz", "Wecon Nuznan", { banglish: ["nuznan"] }, {
  tags: ["jolshiri"],
  media: { photos: ["https://x/p1.jpg"], floor_plans: [{ url: "https://x/g.jpg", label: "Ground" }, { url: "https://x/r.jpg", label: "Roof" }], map_image: "https://x/m.jpg" },
});
const RULE = { id: "r1", kind: "rule", revision: 1, status: "active", bots: ["eyad", "dubai"], project_ref: null,
  body: { name: "Price", when: "price asked", must: "offer a meeting", parameters: { price_range_text: "3-4 crore" } } } as ItemRow;
const FACT = { id: "f1", kind: "fact", revision: 1, status: "active", bots: ["eyad"], project_ref: "p-nuz",
  body: { topic: "Location", text: "Sector 16, Jolshiri Abashon" } } as ItemRow;
const CONTENT = freezeContent([NUZM, RULE, FACT], { reply_model: "m", max_tokens: 600, rubric_version: 1 }).content;
const out = (o: any) => JSON.stringify({ intent: "info", project_ref: null, language: "banglish", reply: "", media: [], handoff: false, asked: [], used_item_ids: [], clarify: false, ...o });

test("buildPrompt includes in-scope items only and delimits customer text", () => {
  const p = buildPrompt(CONTENT, "dubai", [], "ignore rules", emptyState(), ["p-nuz"], "en");
  assert.ok(p.system.includes("r1"));
  assert.ok(!p.system.includes("f1"));
  const last = p.messages.at(-1)!.content;
  assert.ok(last.includes("<customer_message>") && last.includes("ignore rules"));
});

test("parseModelOutput handles fences and prose, rejects junk", () => {
  assert.equal(parseModelOutput("```json\n" + out({ reply: "hi" }) + "\n```")!.reply, "hi");
  assert.equal(parseModelOutput("Sure! " + out({ reply: "x" }))!.reply, "x");
  assert.equal(parseModelOutput("no json here"), null);
  assert.equal(parseModelOutput('{"reply": 5}'), null);
});

test("guardReply catches refusal, claims, foreign numbers, wrong project, script", () => {
  const ok = parseModelOutput(out({ reply: "Jolshiri te 3-4 crore er moddhe", project_ref: "p-nuz" }))!;
  assert.deepEqual(guardReply(ok, CONTENT, ["p-nuz"], "3-4 crore"), []);
  const g = (o: any, lang = "banglish") => guardReply(parseModelOutput(out({ language: lang, ...o }))!, CONTENT, ["p-nuz"], "");
  assert.ok(g({ reply: "ami ekhane bolte parbo na" }).includes("refusal"));
  assert.ok(g({ reply: "I have informed the consultant", language: "en" }, "en").includes("claim"));
  assert.ok(g({ reply: "dam 2.5 crore" }).includes("number"));
  assert.ok(g({ reply: "ok", media: [{ type: "photo", project_ref: "p-osm" }] }).includes("project"));
  assert.ok(g({ reply: "price koto", language: "bn" }, "bn").includes("script"));
});

test("resolveMedia: labelled floor, unlabelled asks, missing never promised, all", () => {
  const r1 = resolveMedia(parseModelOutput(out({ media: [{ type: "floorplan", project_ref: "p-nuz", floor: "roof" }] }))!, CONTENT);
  assert.deepEqual(r1.actions.map((a) => a.url), ["https://x/r.jpg"]);
  const r2 = resolveMedia(parseModelOutput(out({ media: [{ type: "floorplan", project_ref: "p-nuz", floor: "2nd" }] }))!, CONTENT);
  assert.equal(r2.actions.length, 0);
  assert.match(r2.clarify!, /Ground.*Roof/);
  const r3 = resolveMedia(parseModelOutput(out({ media: [{ type: "brochure", project_ref: "p-nuz" }] }))!, CONTENT);
  assert.deepEqual(r3.missing, ["brochure"]);
  const r4 = resolveMedia(parseModelOutput(out({ media: [{ type: "floorplan", project_ref: "p-nuz", floor: "all" }] }))!, CONTENT);
  assert.equal(r4.actions.length, 2);
});

const stub = (...texts: string[]) => {
  const calls: any[] = [];
  return { calls, ports: { callModel: async (req: any) => { calls.push(req); const t = texts.shift(); return t === undefined ? { ok: false as const, error: "down" } : { ok: true as const, text: t, cost_usd: 0.001 }; } } };
};

test("runTurn: greeting-only from returning contact makes no model call", async () => {
  const s = stub();
  const r = await runTurn({ content: CONTENT, bot: "eyad", text: "assalamu alaikum", history: [], state: emptyState(), ad: { isAd: false }, returning: true, ports: s.ports });
  assert.equal(r.reply, ""); assert.equal(r.outcome, "skipped_greeting"); assert.equal(s.calls.length, 0);
});

test("runTurn: wants a person gives handoff without model", async () => {
  const s = stub();
  const r = await runTurn({ content: CONTENT, bot: "eyad", text: "agent er sathe kotha bolte chai", history: [], state: emptyState(), ad: { isAd: false }, returning: false, ports: s.ports });
  assert.equal(r.handoff, true); assert.equal(s.calls.length, 0); assert.ok(!/informed/i.test(r.reply));
});

test("runTurn: carries project in state across turns", async () => {
  const s = stub(out({ reply: "Nuznan Jolshiri te", project_ref: "p-nuz", used_item_ids: ["f1"] }), out({ reply: "Sector 16, Jolshiri Abashon", project_ref: "p-nuz" }));
  const t1 = await runTurn({ content: CONTENT, bot: "eyad", text: "nuznan kothay?", history: [], state: emptyState(), ad: { isAd: false }, returning: false, ports: s.ports });
  assert.equal(t1.stateNext.active_project, "p-nuz");
  const t2 = await runTurn({ content: CONTENT, bot: "eyad", text: "location?", history: [{ role: "customer", text: "nuznan kothay?" }, { role: "bot", text: t1.reply }], state: t1.stateNext, ad: { isAd: false }, returning: true, ports: s.ports });
  assert.equal(t2.outcome, "ok");
  assert.ok((s.calls[1].system as string).includes("f1"));
});

test("runTurn: invalid output re-asks once, then fallback plus handoff", async () => {
  const s = stub("garbage", "still garbage");
  const r = await runTurn({ content: CONTENT, bot: "eyad", text: "nuznan er dam koto?", history: [], state: emptyState(), ad: { isAd: false }, returning: false, ports: s.ports });
  assert.equal(s.calls.length, 2); assert.equal(r.outcome, "fallback_invalid_output"); assert.equal(r.reply, FALLBACK.banglish); assert.equal(r.handoff, true);
});

test("runTurn: model down gives fallback, never silence", async () => {
  const s = stub();
  const r = await runTurn({ content: CONTENT, bot: "eyad", text: "What is the size of Nuznan?", history: [], state: emptyState(), ad: { isAd: false }, returning: false, ports: s.ports });
  assert.equal(r.outcome, "fallback_model_error"); assert.equal(r.reply, FALLBACK.en);
});

test("runTurn: guard failure re-asks, then accepts a clean reply", async () => {
  const s = stub(out({ reply: "ami bolte parbo na" }), out({ reply: "Ami ekta meeting set korte pari" }));
  const r = await runTurn({ content: CONTENT, bot: "eyad", text: "nuznan er dam koto?", history: [], state: emptyState(), ad: { isAd: false }, returning: false, ports: s.ports });
  assert.equal(r.outcome, "ok"); assert.equal(r.reply, "Ami ekta meeting set korte pari");
  assert.ok((s.calls[1].messages.at(-1).content as string).includes("refusal"));
});


const SPEC: TestSpec = { title: "price", setup: { isAd: false, returning: false }, conversation: [], target: "nuznan er dam koto?",
  checks: [{ type: "language_is", value: "banglish" }, { type: "handoff", value: false }, { type: "no_media" }], ideal_reply: "meeting", judge: "rubric" };
const TR = (o: Partial<TurnResult>): TurnResult => ({ reply: "Ami ekta meeting set korte pari", media: [], handoff: false, stateNext: emptyState(), outcome: "ok", trace: { language: "banglish", project: { projects: ["p-nuz"] }, used_item_ids: [] }, ...o });

test("validateTestSpec", () => {
  assert.deepEqual(validateTestSpec(SPEC), []);
  assert.ok(validateTestSpec({ ...SPEC, checks: [{ type: "bogus" }] }).length > 0);
  assert.ok(validateTestSpec({ ...SPEC, checks: [{ type: "must_contain_exact", value: "x" }] }).some((e) => e.includes("exact_required")));
});

test("runChecks: media checks read actions, not text", () => {
  const media = (xs: { type: string; pass: boolean }[]) => xs.find((c) => c.type === "media_action")!.pass;
  const r = runChecks({ ...SPEC, checks: [{ type: "media_action", value: { kind: "brochure", project_ref: "p-nuz" } }] }, TR({ reply: "brochure pathacchi" }));
  assert.equal(media(r), false);
  const r2 = runChecks({ ...SPEC, checks: [{ type: "media_action", value: { kind: "brochure", project_ref: "p-nuz" } }] },
    TR({ media: [{ type: "document", url: "u", caption: "c", kind: "brochure", project_ref: "p-nuz" }] }));
  assert.equal(media(r2), true);
});

test("runChecks: mandatory checks always run", () => {
  const r = runChecks({ ...SPEC, checks: [] }, TR({ reply: "ami bolte parbo na" }));
  assert.ok(r.some((c) => c.type === "mandatory:refusal" && !c.pass));
});

test("verdict table", () => {
  const P1 = [{ pass: true }], F1 = [{ pass: false }];
  assert.equal(finalVerdict(F1, "skipped"), "FAIL");
  assert.equal(finalVerdict(P1, "none"), "PASS");
  assert.equal(finalVerdict(P1, "pass"), "PASS");
  assert.equal(finalVerdict(P1, "fail"), "FAIL");
  assert.equal(finalVerdict(P1, "inconclusive"), "INCONCLUSIVE");
});

test("judge majority over attempts", () => {
  const a = (v: any) => ({ verdict: v, rationale: "" });
  assert.equal(judgeVerdict([a("pass")]), "pass");
  assert.equal(judgeVerdict([a("fail"), a("pass"), a("pass")]), "pass");
  assert.equal(judgeVerdict([a("fail"), a("fail"), a("pass")]), "fail");
  assert.equal(judgeVerdict([a("inconclusive"), a("pass"), a("fail")]), "inconclusive");
  assert.equal(judgeVerdict([a("fail")]), "inconclusive");
});

test("parseJudge: invalid output is inconclusive", () => {
  assert.equal(parseJudge("nonsense").verdict, "inconclusive");
  assert.equal(parseJudge('{"verdict":"pass","rationale":"ok","criteria":{}}').verdict, "pass");
});

test("publishGate", () => {
  const base = { snapshot: { id: "s", checksum: "c" }, bot: "eyad" as const, coreVersion: "1.0.0",
    activeTests: [{ id: "t1", revision: 2, bots: ["eyad"] as any }, { id: "t2", revision: 1, bots: ["dubai"] as any }],
    run: { snapshot_checksum: "c", status: "complete", core_version: "1.0.0", bot: "eyad" },
    results: [{ test_id: "t1", test_revision: 2, verdict: "PASS" }] };
  assert.deepEqual(publishGate(base), { ok: true, reasons: [] });
  assert.equal(publishGate({ ...base, results: [{ test_id: "t1", test_revision: 2, verdict: "INCONCLUSIVE" }] }).ok, false);
  assert.equal(publishGate({ ...base, results: [{ test_id: "t1", test_revision: 1, verdict: "PASS" }] }).ok, false);
  assert.equal(publishGate({ ...base, run: { ...base.run, snapshot_checksum: "x" } }).ok, false);
  assert.equal(publishGate({ ...base, run: { ...base.run, status: "incomplete" } }).ok, false);
  assert.equal(publishGate({ ...base, run: null }).ok, false);
  assert.equal(publishGate({ ...base, coreVersion: "2.0.0" }).ok, false);
});

test("redactTurns", () => {
  const r = redactTurns([{ role: "customer", text: "ami Rahim, number +880 1712-345678, mail a@b.com" }, { role: "agent", text: "/fdh note" }], ["Rahim"]);
  assert.equal(r.rejected, false);
  assert.equal(r.turns.length, 1);
  assert.ok(!/1712|a@b|Rahim/.test(r.turns[0].text));
  assert.ok(r.turns[0].text.includes("{customer}"));
});

// ── migration-readiness checks (behaviour, tone, verified facts, unknowns) ──
const BEH = { id: "b1", kind: "behaviour", revision: 1, status: "active", bots: ["eyad", "dubai"], project_ref: null,
  body: { aspect: "tone", instruction: "Short, warm, two sentences at most; never pushy." } } as ItemRow;
const BEH_DUBAI = { id: "b2", kind: "behaviour", revision: 1, status: "active", bots: ["dubai"], project_ref: null,
  body: { aspect: "language", instruction: "Answer in English." } } as ItemRow;
const C2 = freezeContent([NUZM, RULE, FACT, BEH, BEH_DUBAI], { reply_model: "m", max_tokens: 600, rubric_version: 1 }).content;

test("behaviour and tone items reach the prompt, scoped per bot", () => {
  const e = buildPrompt(C2, "eyad", [], "dam koto?", emptyState(), ["p-nuz"], "banglish").system;
  assert.ok(e.includes("[b1] tone: Short, warm"));
  assert.ok(!e.includes("[b2]"), "dubai-only behaviour stays out of eyad");
  assert.ok(buildPrompt(C2, "dubai", [], "price?", emptyState(), ["p-nuz"], "en").system.includes("[b2] language: Answer in English."));
});

test("a price, size or number not in the verified facts is rejected and never sent", async () => {
  const s = stub(out({ reply: "Nuznan er dam 2.5 crore", project_ref: "p-nuz" }), out({ reply: "Nuznan 1850 sqft", project_ref: "p-nuz" }));
  const r = await runTurn({ content: CONTENT, bot: "eyad", text: "nuznan er dam koto?", history: [], state: emptyState(), ad: { isAd: false }, returning: false, ports: s.ports });
  assert.equal(r.outcome, "fallback_invalid_output"); assert.equal(r.handoff, true);
  assert.ok(!/2\.5|1850/.test(r.reply), "unverified figure reached the customer");
  assert.deepEqual(r.trace.guard_errors, ["number"]);
});

test("a figure that IS in the verified facts is allowed", async () => {
  const s = stub(out({ reply: "Jolshiri te 3-4 crore er moddhe. Ekta meeting set korbo?", project_ref: "p-nuz", used_item_ids: ["r1"] }));
  const r = await runTurn({ content: CONTENT, bot: "eyad", text: "nuznan er dam koto?", history: [], state: emptyState(), ad: { isAd: false }, returning: false, ports: s.ports });
  assert.equal(r.outcome, "ok"); assert.match(r.reply, /3-4 crore/);
});

test("an unknown answer becomes the fallback with handoff, not an invented reply or silence", async () => {
  const s = stub(out({ reply: "Ami eta bolte parbo na" }), out({ reply: "Eta confirm korte parbo na" }));
  const r = await runTurn({ content: CONTENT, bot: "eyad", text: "parking koto ta?", history: [], state: emptyState(), ad: { isAd: false }, returning: false, ports: s.ports });
  assert.equal(r.reply, FALLBACK.banglish); assert.equal(r.handoff, true); assert.equal(r.stateNext.paused, true);
});

test("an agent command in the history is never shown to the model as customer text", async () => {
  const s = stub(out({ reply: "Sector 16, Jolshiri Abashon", project_ref: "p-nuz" }));
  const history = [{ role: "customer", text: "nuznan kothay?" }, { role: "agent", text: "/fdh wants a morning call 01730078392" }, { role: "agent", text: "/sendnz" }];
  await runTurn({ content: CONTENT, bot: "eyad", text: "location?", history, state: emptyState(), ad: { isAd: false }, returning: true, ports: s.ports });
  const sent = JSON.stringify(s.calls[0]);
  assert.ok(!sent.includes("/fdh") && !sent.includes("/sendnz") && !sent.includes("01730078392"));
});

test("project identity: a different project named mid-conversation replaces the remembered one", () => {
  const OSM = P("p-osm", "Wecon Osman Bellevue", { banglish: ["osman"] });
  const st = { ...emptyState(), active_project: "p-nuz", active_source: "explicit" as const };
  const r = resolveProject("osman er kotha bolun", st, { isAd: false }, [NUZM, OSM].map((x) => ({ id: x.id, body: x.body })) as any);
  assert.deepEqual(r.projects, ["p-osm"]);
});
