import { test } from "node:test";
import assert from "node:assert/strict";
import {
  brochureRequest, brochureCatalog, verifyBrochure, deliverBrochures, cityOf, isBrochureAsk, httpProbe, type Probe,
} from "./trainer-brochure.ts";
import { freezeContent, runTurn, emptyState, namedProjects, type ItemRow } from "./trainer-core.ts";

// Projects shaped like the production catalog (ai_trainer_items kind=project):
// one Dhaka, two Chattogram (one with no brochure), one Cumilla.
const P = (id: string, name: string, region: string, banglish: string[], brochure?: string): ItemRow => ({
  id, kind: "project", revision: 1, status: "active", bots: ["eyad", "dubai"], project_ref: null,
  body: { name, region, aliases: { banglish }, media: brochure === undefined ? {} : { brochure } },
});
const NUZ = P("p-nuz", "Wecon Nuznan", "Dhaka", ["nuznan"], "https://wecon.test/Wecon-Nuznan-Profile.pdf");
const OSM = P("p-osm", "Wecon Osman Bellevue", "Dhaka", ["osman"], "https://drive.test/osman.pdf");
const IQB = P("p-iqb", "Wecon Iqbal Orchid", "Chattogram", ["iqbal"], "https://wecon.test/WECON-IQBAL-ORCHID.pdf");
const MOM = P("p-mom", "Momtaz Manor", "Chattogram", ["momtaz"]);
const P2P = P("p-p2p", "P2P Helthcare", "Chattogram", ["p2p"], "https://drive.google.test/file/d/abc");
const CHY = P("p-chy", "Wecon Chowdhury Arcade", "Cumilla", ["chowdhury"], "https://wecon.test/Wecon-Chy-Arcade-Brochure.pdf");
const ALL = [NUZ, OSM, IQB, MOM, P2P, CHY];
const CONTENT = freezeContent(ALL, { reply_model: "m", max_tokens: 600, rubric_version: 1 }).content;
const match = (s: string) => namedProjects(s, CONTENT.projects);
const req = (text: string, state = emptyState(), lastBot?: string) => brochureRequest(text, state, CONTENT.projects, { match, lastBot });

// A probe that answers like the real hosts did on 2026-10-19: a PDF for the
// wecon/drive download links, the Drive viewer page (HTML) for P2P.
const PDF = { ok: true, status: 206, contentType: "application/pdf", magic: "%PDF-", bytes: 6122611 };
const probeOf = (over: Record<string, Partial<Awaited<ReturnType<Probe>>> | Error> = {}): Probe & { calls: string[] } => {
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(url);
    const o = over[url];
    if (o instanceof Error) throw o;
    if (url.includes("drive.google.test/file")) return { ok: true, status: 200, contentType: "text/html; charset=utf-8", magic: "<!DOC", bytes: 0, ...o };
    return { ...PDF, ...o };
  }) as Probe & { calls: string[] };
  f.calls = calls;
  return f;
};

// ── request parsing ─────────────────────────────────────────────────────────

test("isBrochureAsk: brochure and profile asks in English, Banglish and Bangla; not a price or photo ask", () => {
  for (const t of ["Yes share brochure", "Please share with me the projects and profiles you have.", "nuznan er brochure pathan",
    "brosiur den", "প্রোফাইল দিন", "ব্রোশিওর পাঠান", "send the pdf", "company profile please"]) assert.equal(isBrochureAsk(t), true, t);
  for (const t of ["nuznan er price koto?", "send photos", "where is osman", "profile picture?"]) assert.equal(isBrochureAsk(t), false, t);
});

test("cityOf: Dhaka, Chattogram and Cumilla in every spelling; none otherwise", () => {
  assert.deepEqual(cityOf("dhaka projects brochure"), ["Dhaka"]);
  assert.deepEqual(cityOf("Chittagong er brochure"), ["Chattogram"]);
  assert.deepEqual(cityOf("ctg profile"), ["Chattogram"]);
  assert.deepEqual(cityOf("চট্টগ্রামের প্রজেক্ট"), ["Chattogram"]);
  assert.deepEqual(cityOf("comilla"), ["Cumilla"]);
  assert.deepEqual(cityOf("কুমিল্লা"), ["Cumilla"]);
  assert.deepEqual(cityOf("dhaka and cumilla"), ["Dhaka", "Cumilla"]);
  assert.deepEqual(cityOf("send brochure"), []);
});

test("brochureRequest: a named project is one project", () => {
  const r = req("nuznan er brochure pathan");
  assert.deepEqual(r, { kind: "projects", projects: ["p-nuz"], scope: "named", intent: "send" });
});

test("brochureRequest: a city asks for every active project in that city, sorted by name", () => {
  const r = req("Chittagong er shob project er brochure");
  assert.deepEqual(r, { kind: "projects", projects: ["p-mom", "p-p2p", "p-iqb"], scope: "city", cities: ["Chattogram"], intent: "send" });
});

test("brochureRequest: all projects / all three cities covers Dhaka, Chattogram and Cumilla", () => {
  for (const t of ["send all project brochures", "shob project er profile", "Share all three", "সব প্রজেক্টের ব্রোশিওর"]) {
    const r = req(t, emptyState(), "Which project would you like the brochure for? I have brochures for Cumilla, Dhaka, and Chattogram projects.");
    assert.equal(r?.kind, "projects", t);
    assert.equal((r as any).scope, "all", t);
    assert.deepEqual((r as any).projects.length, 6, t);
  }
});

test("brochureRequest: 'all three' after a bot list of three projects means those three, not every project", () => {
  const r = req("Share all three", emptyState(), "We have Wecon Nuznan, Wecon Osman Bellevue and Momtaz Manor. Which brochure would you like?");
  assert.deepEqual(r, { kind: "projects", projects: ["p-mom", "p-nuz", "p-osm"], scope: "named", intent: "send" });
});

test("brochureRequest: no project, no city, nothing in state asks a short clarification", () => {
  const r = req("Yes share brochure");
  assert.equal(r?.kind, "clarify");
  assert.match((r as any).question, /Dhaka.*Chattogram.*Cumilla/);
  assert.ok((r as any).question.length < 200);
});

test("brochureRequest: an active project in state is used when the ask names nothing", () => {
  const r = req("brochure ta den", { ...emptyState(), active_project: "p-osm" });
  assert.deepEqual(r, { kind: "projects", projects: ["p-osm"], scope: "state", intent: "send" });
});

test("brochureRequest: a named project wins over the city and over state", () => {
  const r = req("dhaka r nuznan er brochure", { ...emptyState(), active_project: "p-osm" });
  assert.deepEqual((r as any).projects, ["p-nuz"]);
});

test("brochureRequest: not a brochure ask is null, so the normal model path runs", () => {
  assert.equal(req("nuznan er price koto?"), null);
  assert.equal(req("ok what is the price?", emptyState(), "Would you like the brochure?"), null, "an affirmation with a new question is not a brochure ask");
});

test("brochureRequest: a short follow-up to the bot's brochure question is a brochure ask", () => {
  const ask = "Which project's brochure would you like?";
  assert.deepEqual((req("Dhaka", emptyState(), ask) as any)?.cities, ["Dhaka"]);
  assert.deepEqual((req("nuznan", emptyState(), ask) as any)?.projects, ["p-nuz"]);
  assert.equal(req("yes please", { ...emptyState(), active_project: "p-chy" }, "Shall I send the Chowdhury Arcade brochure?")?.kind, "projects");
  assert.equal(req("nuznan", emptyState(), "Wecon Nuznan is in Dhaka."), null, "no brochure question before it");
});

// ── catalog and verification ────────────────────────────────────────────────

test("brochureCatalog: one row per active project with city, file type and storage host; missing marked missing", () => {
  const c = brochureCatalog(CONTENT.projects);
  assert.equal(c.length, 6);
  const nuz = c.find((r) => r.project_ref === "p-nuz")!;
  assert.deepEqual({ ...nuz }, { project_ref: "p-nuz", project: "Wecon Nuznan", city: "Dhaka", url: "https://wecon.test/Wecon-Nuznan-Profile.pdf",
    storage: "wecon.test", file_type: "pdf", status: "listed" });
  assert.equal(c.find((r) => r.project_ref === "p-mom")!.status, "missing");
  assert.equal(c.find((r) => r.project_ref === "p-mom")!.url, null);
});

test("verifyBrochure: a PDF answer is verified; an HTML viewer page, an error status or a timeout is not", async () => {
  const probe = probeOf({ "https://wecon.test/WECON-IQBAL-ORCHID.pdf": { ok: false, status: 404, contentType: "text/html", magic: "<html" },
    "https://drive.test/osman.pdf": new Error("timeout") });
  const cat = brochureCatalog(CONTENT.projects);
  const v = async (id: string) => verifyBrochure(cat.find((r) => r.project_ref === id)!, probe);
  assert.equal((await v("p-nuz")).status, "verified");
  assert.deepEqual(await v("p-p2p"), { ...cat.find((r) => r.project_ref === "p-p2p")!, status: "not_pdf", detail: "text/html; charset=utf-8" });
  assert.equal((await v("p-iqb")).status, "unreachable");
  assert.equal((await v("p-iqb")).detail, "HTTP 404");
  assert.equal((await v("p-osm")).status, "unreachable");
  assert.equal((await v("p-mom")).status, "missing");
  assert.ok(!probe.calls.includes(undefined as any));
});

test("verifyBrochure: a non-https or private URL is refused without a request", async () => {
  const probe = probeOf();
  for (const url of ["http://wecon.test/a.pdf", "https://127.0.0.1/a.pdf", "https://localhost/a.pdf", "javascript:alert(1)"]) {
    const r = await verifyBrochure({ project_ref: "p", project: "X", city: "Dhaka", url, storage: "", file_type: "pdf", status: "listed" }, probe);
    assert.equal(r.status, "invalid_link", url);
  }
  assert.deepEqual(probe.calls, []);
});

// ── delivery ────────────────────────────────────────────────────────────────

const sender = (fail: string[] = []) => {
  const sent: any[] = [];
  return { sent, send: async (m: any) => { sent.push(m); return fail.includes(m.mediaUrl) ? null : `wa${sent.length}`; } };
};

test("deliverBrochures: sends each verified PDF as a document with its own project's name; nothing else", async () => {
  const s = sender();
  const r = await deliverBrochures(["p-nuz", "p-osm"], CONTENT.projects, { probe: probeOf(), send: s.send });
  assert.deepEqual(s.sent.map((m) => [m.type, m.mediaUrl, m.fileName]), [
    ["document", "https://wecon.test/Wecon-Nuznan-Profile.pdf", "Wecon Nuznan Brochure.pdf"],
    ["document", "https://drive.test/osman.pdf", "Wecon Osman Bellevue Brochure.pdf"],
  ]);
  assert.deepEqual(r.sent.map((d) => d.project_ref), ["p-nuz", "p-osm"]);
  assert.deepEqual(r.failed, []);
  assert.equal(r.outcome, "brochure_sent");
});

test("deliverBrochures: wrong-project isolation, every document carries the URL and name of the project it was asked for", async () => {
  const s = sender();
  await deliverBrochures(["p-chy", "p-iqb", "p-nuz"], CONTENT.projects, { probe: probeOf(), send: s.send });
  for (const m of s.sent) {
    const p = ALL.find((x) => x.body.media.brochure === m.mediaUrl)!;
    assert.ok(m.fileName.startsWith(p.body.name) && m.text.startsWith(p.body.name), JSON.stringify(m));
  }
  assert.equal(new Set(s.sent.map((m) => m.mediaUrl)).size, s.sent.length, "no file sent twice");
});

test("deliverBrochures: an unknown project id is refused, never matched to another project's file", async () => {
  const s = sender();
  const r = await deliverBrochures(["p-ghost"], CONTENT.projects, { probe: probeOf(), send: s.send });
  assert.equal(s.sent.length, 0);
  assert.deepEqual(r.failed.map((f) => [f.project_ref, f.status]), [["p-ghost", "unknown_project"]]);
});

test("deliverBrochures: missing file and invalid link are reported, never sent, and the turn hands off", async () => {
  const s = sender();
  const r = await deliverBrochures(["p-mom", "p-p2p"], CONTENT.projects, { probe: probeOf(), send: s.send });
  assert.equal(s.sent.length, 0);
  assert.deepEqual(r.failed.map((f) => [f.project, f.status]), [["Momtaz Manor", "missing"], ["P2P Helthcare", "not_pdf"]]);
  assert.equal(r.outcome, "brochure_unavailable");
  assert.equal(r.handoff, true);
});

test("deliverBrochures: a send that fails is a failure, not a delivery", async () => {
  const s = sender(["https://drive.test/osman.pdf"]);
  const r = await deliverBrochures(["p-nuz", "p-osm"], CONTENT.projects, { probe: probeOf(), send: s.send });
  assert.deepEqual(r.sent.map((d) => d.project_ref), ["p-nuz"]);
  assert.deepEqual(r.failed.map((f) => [f.project_ref, f.status]), [["p-osm", "send_failed"]]);
  assert.equal(r.outcome, "brochure_partial");
  assert.equal(r.handoff, true);
});

test("deliverBrochures: a send that throws is a failure, and the rest still go", async () => {
  const sent: string[] = [];
  const r = await deliverBrochures(["p-nuz", "p-chy"], CONTENT.projects, { probe: probeOf(), send: async (m) => {
    if (m.mediaUrl.includes("Nuznan")) throw new Error("socket hang up");
    sent.push(m.mediaUrl); return "wa1";
  } });
  assert.deepEqual(sent, ["https://wecon.test/Wecon-Chy-Arcade-Brochure.pdf"]);
  assert.deepEqual(r.failed.map((f) => [f.project_ref, f.status, f.detail]), [["p-nuz", "send_failed", "socket hang up"]]);
});

test("deliverBrochures: no sender (Playground, test runs) verifies only and claims nothing was sent", async () => {
  const r = await deliverBrochures(["p-nuz", "p-mom"], CONTENT.projects, { probe: probeOf(), send: null });
  assert.deepEqual(r.sent, []);
  assert.deepEqual(r.ready.map((d) => d.project_ref), ["p-nuz"]);
  assert.equal(r.outcome, "brochure_partial");
  const only = await deliverBrochures(["p-nuz"], CONTENT.projects, { probe: probeOf(), send: null });
  assert.equal(only.outcome, "brochure_ready_not_sent");
});

test("deliverBrochures: the reply states only what really happened", async () => {
  const s = sender(["https://drive.test/osman.pdf"]);
  const r = await deliverBrochures(["p-nuz", "p-osm", "p-mom"], CONTENT.projects, { probe: probeOf(), send: s.send }, "en");
  assert.match(r.reply, /Wecon Nuznan/);
  assert.match(r.reply, /Wecon Osman Bellevue/);
  assert.match(r.reply, /Momtaz Manor/);
  assert.match(r.reply, /consultant/i);
  const none = await deliverBrochures(["p-nuz"], CONTENT.projects, { probe: probeOf(), send: null }, "en");
  assert.doesNotMatch(none.reply, /\bsent\b|attached|here is/i);
});

// ── through runTurn ────────────────────────────────────────────────────────

const noModel = { callModel: async () => { throw new Error("the model must not be called for a brochure request"); } };

test("runTurn: a brochure request never reaches the model and returns verified document actions only", async () => {
  const r = await runTurn({ content: CONTENT, bot: "eyad", text: "dhaka r shob project er brochure", history: [], state: emptyState(),
    ad: { isAd: false }, returning: true, ports: { ...noModel, probeDocument: probeOf() } });
  assert.deepEqual(r.media.map((m) => [m.kind, m.project_ref, m.url]), [
    ["brochure", "p-nuz", "https://wecon.test/Wecon-Nuznan-Profile.pdf"],
    ["brochure", "p-osm", "https://drive.test/osman.pdf"],
  ]);
  assert.equal(r.outcome, "brochure_ready_not_sent");
  assert.deepEqual((r.trace.brochure as any).request.cities, ["Dhaka"]);
  assert.doesNotMatch(r.reply, /attached|have sent|\bsent\b/i);
});

test("runTurn: an ambiguous brochure ask returns the clarification, no media, no model call", async () => {
  const r = await runTurn({ content: CONTENT, bot: "eyad", text: "Yes share brochure", history: [], state: emptyState(),
    ad: { isAd: false }, returning: true, ports: { ...noModel, probeDocument: probeOf() } });
  assert.equal(r.outcome, "brochure_clarify");
  assert.deepEqual(r.media, []);
  assert.match(r.reply, /\?/);
});

test("runTurn: without a probe port a brochure is never offered as verified", async () => {
  const r = await runTurn({ content: CONTENT, bot: "eyad", text: "nuznan er brochure", history: [], state: emptyState(),
    ad: { isAd: false }, returning: true, ports: noModel as any });
  assert.deepEqual(r.media, []);
  assert.equal(r.outcome, "brochure_unavailable");
  assert.equal(r.handoff, true);
});

test("runTurn: the model's own brochure media is dropped; only the brochure path may attach one", async () => {
  const out = JSON.stringify({ intent: "info", project_ref: "p-nuz", language: "en", reply: "Wecon Nuznan is in Dhaka.",
    media: [{ type: "brochure", project_ref: "p-nuz" }], handoff: false, asked: [], used_item_ids: [], clarify: false });
  const r = await runTurn({ content: CONTENT, bot: "eyad", text: "where is nuznan", history: [], state: emptyState(),
    ad: { isAd: false }, returning: true, ports: { callModel: async () => ({ ok: true as const, text: out, cost_usd: 0 }), probeDocument: probeOf() } });
  assert.equal(r.outcome, "ok");
  assert.deepEqual(r.media.filter((m) => m.kind === "brochure"), []);
});

test("deliverBrochures: one file listed on two projects is a conflict; neither project gets it", async () => {
  const twin = P("p-twin", "Wecon Twin", "Dhaka", ["twin"], NUZ.body.media.brochure);
  const projects = freezeContent([NUZ, twin, OSM], { reply_model: "m", max_tokens: 600, rubric_version: 1 }).content.projects;
  const s = sender();
  const r = await deliverBrochures(["p-nuz", "p-twin", "p-osm"], projects, { probe: probeOf(), send: s.send });
  assert.deepEqual(s.sent.map((m) => m.mediaUrl), ["https://drive.test/osman.pdf"]);
  assert.deepEqual(r.failed.map((f) => [f.project_ref, f.status]), [["p-nuz", "conflict"], ["p-twin", "conflict"]]);
});

// ── the HTTP probe the Deno port uses ───────────────────────────────────────

const resp = (status: number, o: { type?: string; location?: string; body?: string } = {}) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: (k: string) => (k === "content-type" ? o.type ?? null : k === "location" ? o.location ?? null : k === "content-range" ? "bytes 0-1023/6910581" : null) },
  arrayBuffer: async () => new TextEncoder().encode(o.body ?? "").buffer,
});

test("httpProbe: follows a Drive download redirect and reads the first bytes only", async () => {
  const seen: { url: string; range: string; redirect: string }[] = [];
  const probe = httpProbe({ resolve: async () => ["142.250.1.1"], fetch: async (url, init) => {
    seen.push({ url, range: init.headers.Range, redirect: init.redirect });
    return url.includes("/uc?") ? resp(302, { location: "/download?id=1" }) : resp(206, { type: "application/octet-stream", body: "%PDF-1.7 rest" });
  } });
  const r = await probe("https://drive.usercontent.test/u/0/uc?id=1&export=download");
  assert.deepEqual({ ...r, magic: r.magic.slice(0, 5) }, { ok: true, status: 206, contentType: "application/octet-stream", magic: "%PDF-", bytes: 6910581 });
  assert.ok(r.magic.length <= 12, "only the first 12 bytes are kept");
  assert.deepEqual(seen.map((s) => s.url), ["https://drive.usercontent.test/u/0/uc?id=1&export=download", "https://drive.usercontent.test/download?id=1"]);
  assert.ok(seen.every((s) => s.range === "bytes=0-1023" && s.redirect === "manual"));
});

test("httpProbe: a redirect or a DNS answer that lands on a private address is refused before it is fetched", async () => {
  const fetched: string[] = [];
  const toMeta = httpProbe({ resolve: async () => ["93.184.216.34"], fetch: async (url) => { fetched.push(url); return resp(302, { location: "https://169.254.169.254/latest" }); } });
  await assert.rejects(toMeta("https://files.test/a.pdf"), /private/);
  assert.deepEqual(fetched, ["https://files.test/a.pdf"]);
  const rebinding = httpProbe({ resolve: async () => ["10.0.0.5"], fetch: async (url) => { fetched.push(url); return resp(206, { body: "%PDF-" }); } });
  await assert.rejects(rebinding("https://evil.test/a.pdf"), /private/);
  assert.equal(fetched.length, 1);
});

test("httpProbe: gives up after 4 redirects", async () => {
  const probe = httpProbe({ resolve: async () => ["93.184.216.34"], fetch: async (url) => resp(302, { location: `${url}x` }) });
  await assert.rejects(probe("https://loop.test/a"), /redirects/);
});

test("runTurn: a reply that says a brochure is attached, with nothing attached, is rejected and falls back", async () => {
  const say = (reply: string) => JSON.stringify({ intent: "info", project_ref: "p-nuz", language: "en", reply,
    media: [], handoff: false, asked: [], used_item_ids: [], clarify: false });
  // The 2026-10-19 E2E reply (C1), word for word, on a question that is not a brochure ask.
  const texts = [say("Great choice! Wecon Nuznan is a residential project in Dhaka. I am attaching the brochure for you."),
    say("Wecon Nuznan is in Dhaka. I'm sending you the profile now.")];
  const r = await runTurn({ content: CONTENT, bot: "eyad", text: "/f note: interested in Nuznan", history: [], state: emptyState(),
    ad: { isAd: false }, returning: true, ports: { callModel: async () => ({ ok: true as const, text: texts.shift()!, cost_usd: 0 }), probeDocument: probeOf() } });
  assert.equal(r.outcome, "fallback_invalid_output");
  assert.deepEqual(r.trace.guard_errors, ["claim"]);
  assert.equal(r.handoff, true);
});

test("runTurn: a bot brochure question several turns back does not turn a later one-word reply into a brochure ask", async () => {
  const out = JSON.stringify({ intent: "info", project_ref: "p-nuz", language: "en", reply: "Wecon Nuznan is in Dhaka.",
    media: [], handoff: false, asked: [], used_item_ids: [], clarify: false });
  const r = await runTurn({ content: CONTENT, bot: "eyad", text: "nuznan", state: emptyState(), ad: { isAd: false }, returning: true,
    history: [{ role: "bot", text: "Which project's brochure would you like?" }, { role: "customer", text: "later" }],
    ports: { callModel: async () => ({ ok: true as const, text: out, cost_usd: 0 }), probeDocument: probeOf() } });
  assert.equal(r.outcome, "ok");
  assert.deepEqual(r.media, []);
});

// ── review findings (2026-10-19) ────────────────────────────────────────────

test("review: 'no', 'later' or 'thanks' to the bot's brochure question is not a brochure ask", () => {
  const ask = "Shall I send the Chowdhury Arcade brochure?";
  for (const t of ["no thanks", "later", "thanks", "na", "lagbe na", "না", "not now"]) {
    assert.equal(req(t, { ...emptyState(), active_project: "p-chy" }, ask), null, t);
  }
});

test("review: 'profile' and 'pdf' count only next to a brochure or project word, or as the whole ask", () => {
  for (const t of ["my profile is on LinkedIn", "can you send the payment pdf", "update my profile", "pdf of the agreement"]) {
    assert.equal(isBrochureAsk(t), false, t);
  }
  for (const t of ["Please share with me the projects and profiles you have.", "company profile please", "send the pdf",
    "nuznan profile", "project profile den", "profile", "pdf pathan", "dhaka r project er pdf"]) assert.equal(isBrochureAsk(t), true, t);
});

test("review: a city or 'all' that matches no project clarifies instead of going silent", async () => {
  const projects = freezeContent([NUZ], { reply_model: "m", max_tokens: 600, rubric_version: 1 }).content.projects;
  const r = brochureRequest("Cumilla brochure", emptyState(), projects, { match: (s) => namedProjects(s, projects) });
  assert.equal(r?.kind, "clarify");
  const d = await deliverBrochures([], projects, { probe: probeOf(), send: null });
  assert.equal(d.outcome, "brochure_unavailable");
  assert.ok(d.reply.trim().length > 0);
  assert.equal(d.handoff, true);
});

test("review: one malformed brochure URL is that row's invalid_link, never a crash of the catalog", async () => {
  const bad = P("p-bad", "Wecon Bad", "Dhaka", ["badone"], "https://exa mple.com/a.pdf");
  const projects = freezeContent([NUZ, bad], { reply_model: "m", max_tokens: 600, rubric_version: 1 }).content.projects;
  const cat = brochureCatalog(projects);
  assert.equal(cat.length, 2);
  const s = sender();
  const r = await deliverBrochures(["p-bad", "p-nuz"], projects, { probe: probeOf(), send: s.send });
  assert.deepEqual(r.failed.map((f) => [f.project_ref, f.status]), [["p-bad", "invalid_link"]]);
  assert.deepEqual(s.sent.map((m) => m.mediaUrl), ["https://wecon.test/Wecon-Nuznan-Profile.pdf"]);
});

test("review: files are checked in parallel before the first send, so slow hosts do not add up", async () => {
  const order: string[] = [];
  let open = 0, maxOpen = 0;
  const probe: Probe = async (u) => { open++; maxOpen = Math.max(maxOpen, open); order.push(`probe ${u}`); await new Promise((r) => setTimeout(r, 5)); open--; return PDF; };
  await deliverBrochures(["p-nuz", "p-osm", "p-chy"], CONTENT.projects, { probe, send: async (m) => { order.push(`send ${m.mediaUrl}`); return "wa"; } });
  assert.equal(maxOpen, 3);
  assert.ok(order.slice(0, 3).every((x) => x.startsWith("probe")), order.join("\n"));
});

test("review: a city ask that lands on one project records it as resolved by city, not as the customer's explicit pick", async () => {
  const r = await runTurn({ content: CONTENT, bot: "eyad", text: "Cumilla brochure", history: [], state: emptyState(),
    ad: { isAd: false }, returning: true, ports: { ...noModel, probeDocument: probeOf() } });
  assert.equal(r.stateNext.active_project, "p-chy");
  assert.notEqual(r.stateNext.active_source, "explicit");
});

// ── P0: brochure intent routing (send / content question / both / ambiguous) ─
import { brochureIntent, projectWords } from "./trainer-brochure.ts";
const WORDS = projectWords(CONTENT.projects);
const intent = (t: string) => brochureIntent(t, { words: WORDS });

test("brochureIntent: explicit send or open requests are 'send'", () => {
  for (const t of ["Brochure ta pathao", "PDF ta open koren", "nuznan er brochure pathan", "send me the brochure", "brochure den",
    "ব্রোশিওর পাঠান", "পিডিএফ টা দিন", "osman er brochure ta open hocche na, abar pathan", "share the profile please", "attach the brochure"]) {
    assert.equal(intent(t), "send", t);
  }
});

test("brochureIntent: questions about what a brochure says are 'question', never 'send'", () => {
  for (const t of ["nuznan brochure e ki ki amenities ache?", "How many floors does Summer Breeze have according to the brochure?",
    "what does the brochure say about parking", "brochure e koto ta floor?", "ব্রোশিওরে কি কি সুবিধা আছে?",
    "According to the profile, how big is each flat", "brochure ta te handover kobe lekha ache"]) {
    assert.equal(intent(t), "question", t);
  }
});

test("brochureIntent: send plus a question is 'both'", () => {
  for (const t of ["Send the brochure and tell me the amenities", "brochure ta pathan ar bolen koto floor",
    "ব্রোশিওর পাঠান আর বলুন কি কি সুবিধা আছে", "share the pdf, also how many units are there?"]) {
    assert.equal(intent(t), "both", t);
  }
});

test("brochureIntent: a bare mention is a send request (chat shorthand); leftover words with no verb or question are 'ambiguous'", () => {
  for (const t of ["brochure", "nuznan brochure", "osman brochur", "the profile", "dhaka r shob project er brochure", "company profile please", "সব প্রজেক্টের ব্রোশিওর"]) {
    assert.equal(intent(t), "send", t);
  }
  for (const t of ["nuznan er brochure niye ekta kotha chilo", "about the summer breeze brochure for my family"]) assert.equal(intent(t), "ambiguous", t);
});

test("brochureIntent: polite send requests with a '?' are still 'send'; desire verbs lose to a content question", () => {
  for (const t of ["Can you send me the brochure?", "brochure pathaben ki?", "brochure chai", "I need the nuznan brochure"]) assert.equal(intent(t), "send", t);
  for (const t of ["brochure e ki ache jante chai", "brochure onujayi koto din e handover?"]) assert.equal(intent(t), "question", t);
});

test("brochureIntent: unrelated text, thanks and 'got it' are null, so the normal reply path runs", () => {
  for (const t of ["nuznan er price koto?", "where is osman", "my profile is on LinkedIn", "thanks, got the brochure", "brochure peyechi, dhonnobad"]) {
    assert.equal(intent(t), null, t);
  }
});

const say = (o: object) => JSON.stringify({ intent: "info", project_ref: null, language: "en", reply: "", media: [], handoff: false, asked: [], used_item_ids: [], clarify: false, ...o });
const modelSaying = (...replies: string[]) => { const calls: any[] = []; return { calls, callModel: async (req: any) => { calls.push(req); return { ok: true as const, text: replies.shift() ?? say({ reply: "x" }), cost_usd: 0 }; } }; };

test("runTurn: a brochure content question goes to the grounded answer path, with no brochure action", async () => {
  const m = modelSaying(say({ project_ref: "p-nuz", reply: "The brochure lists a rooftop garden and a gym.", used_item_ids: ["doc:d1#0"] }));
  const hits = [{ id: "c1", document_id: "d1", document_version: 1, chunk_no: 0, section: "Amenities", title: "Wecon Nuznan brochure", chunk_text: "Amenities: rooftop garden, gym", score: 0.7 }];
  const searched: any[] = [];
  const r = await runTurn({ content: CONTENT, bot: "eyad", text: "nuznan brochure e ki ki amenities ache?", history: [], state: emptyState(), ad: { isAd: false }, returning: true,
    ports: { callModel: m.callModel, probeDocument: probeOf(), searchDocs: async (q) => { searched.push(q); return hits; } } });
  assert.equal(m.calls.length, 1, "the model answered");
  assert.deepEqual(searched.map((q) => q.projects), [["p-nuz"]], "retrieval scoped to the named project");
  assert.equal(r.outcome, "ok");
  assert.deepEqual(r.media, []);
  assert.equal((r.trace.brochure_intent as any), "question");
});

test("runTurn: a content question with no evidence stays unanswered, honestly", async () => {
  const m = modelSaying(say({ project_ref: "p-iqb", reply: "The brochure does not say. A consultant can confirm.", handoff: true }));
  const r = await runTurn({ content: CONTENT, bot: "eyad", text: "How many floors does Iqbal Orchid have according to the brochure?", history: [], state: emptyState(),
    ad: { isAd: false }, returning: true, ports: { callModel: m.callModel, probeDocument: probeOf(), searchDocs: async () => [] } });
  assert.equal(m.calls.length, 1);
  assert.deepEqual(r.media, []);
  assert.doesNotMatch(r.reply, /\d/, "no figure without evidence");
});

test("runTurn: send plus a question answers from evidence and sends only the verified PDF that was asked for", async () => {
  const m = modelSaying(say({ project_ref: "p-nuz", reply: "It has a rooftop garden and a gym.", used_item_ids: ["doc:d1#0"] }));
  const hits = [{ id: "c1", document_id: "d1", document_version: 1, chunk_no: 0, section: "Amenities", title: "Wecon Nuznan brochure", chunk_text: "Amenities: rooftop garden, gym", score: 0.7 }];
  const s = sender();
  const r = await runTurn({ content: CONTENT, bot: "eyad", text: "Send the nuznan brochure and tell me the amenities", history: [], state: emptyState(), ad: { isAd: false }, returning: true,
    ports: { callModel: m.callModel, probeDocument: probeOf(), searchDocs: async () => hits, sendDocument: s.send } });
  assert.equal(m.calls.length, 1);
  assert.deepEqual(s.sent.map((x) => x.mediaUrl), ["https://wecon.test/Wecon-Nuznan-Profile.pdf"]);
  assert.match(r.reply, /rooftop garden/);
  assert.match(r.reply, /Here is the brochure for Wecon Nuznan/);
  assert.equal(r.outcome, "brochure_sent");
});

test("runTurn: send plus a question with a failed send answers the question and reports the failure, never 'sent'", async () => {
  const m = modelSaying(say({ project_ref: "p-nuz", reply: "It has a rooftop garden.", used_item_ids: ["doc:d1#0"] }));
  const hits = [{ id: "c1", document_id: "d1", document_version: 1, chunk_no: 0, section: "Amenities", title: "Wecon Nuznan brochure", chunk_text: "Amenities: rooftop garden", score: 0.7 }];
  const s = sender(["https://wecon.test/Wecon-Nuznan-Profile.pdf"]);
  const r = await runTurn({ content: CONTENT, bot: "eyad", text: "brochure ta pathan ar bolen nuznan e ki ki amenities", history: [], state: emptyState(), ad: { isAd: false }, returning: true,
    ports: { callModel: m.callModel, probeDocument: probeOf(), searchDocs: async () => hits, sendDocument: s.send } });
  assert.match(r.reply, /rooftop garden/);
  assert.doesNotMatch(r.reply, /eikhane|here is/i);
  assert.match(r.reply, /consultant/i);
  assert.equal(r.outcome, "brochure_unavailable");
  assert.equal(r.handoff, true);
});

test("runTurn: send plus a question for a project with no PDF answers and reports the missing file", async () => {
  const m = modelSaying(say({ project_ref: "p-mom", reply: "Momtaz Manor is in Chattogram." }));
  const r = await runTurn({ content: CONTENT, bot: "eyad", text: "send the momtaz brochure and tell me where it is", history: [], state: emptyState(), ad: { isAd: false }, returning: true,
    ports: { callModel: m.callModel, probeDocument: probeOf(), searchDocs: async () => [] } });
  assert.match(r.reply, /Chattogram/);
  assert.match(r.reply, /Momtaz Manor/);
  assert.deepEqual(r.media, []);
  assert.equal(r.outcome, "brochure_unavailable");
});

test("runTurn: an ambiguous bare mention asks a short question and calls neither the model nor the sender", async () => {
  const s = sender();
  const r = await runTurn({ content: CONTENT, bot: "eyad", text: "nuznan er brochure niye ekta kotha chilo", history: [], state: emptyState(), ad: { isAd: false }, returning: true,
    ports: { ...noModel, probeDocument: probeOf(), sendDocument: s.send } });
  assert.equal(r.outcome, "brochure_clarify");
  assert.match(r.reply, /Wecon Nuznan/);
  assert.equal(s.sent.length, 0);
  assert.match(r.reply, /\?/);
  assert.ok(r.reply.length < 160);
});

test("runTurn: 'yes' to the bot's 'send it or answer a question?' sends the brochure for the project in play", async () => {
  const first = await runTurn({ content: CONTENT, bot: "eyad", text: "nuznan er brochure niye ekta kotha chilo", history: [], state: emptyState(), ad: { isAd: false }, returning: true,
    ports: { ...noModel, probeDocument: probeOf() } });
  const s = sender();
  const r = await runTurn({ content: CONTENT, bot: "eyad", text: "send it", history: [{ role: "customer", text: "nuznan brochure" }, { role: "bot", text: first.reply }],
    state: first.stateNext, ad: { isAd: false }, returning: true, ports: { ...noModel, probeDocument: probeOf(), sendDocument: s.send } });
  assert.equal(first.stateNext.active_project, "p-nuz", "the clarification keeps the project in play");
  assert.deepEqual(s.sent.map((x) => x.mediaUrl), ["https://wecon.test/Wecon-Nuznan-Profile.pdf"]);
  assert.equal(r.outcome, "brochure_sent");
});

test("runTurn: an unrelated message never touches the brochure path", async () => {
  const m = modelSaying(say({ project_ref: "p-nuz", reply: "Wecon Nuznan is in Dhaka." }));
  const s = sender();
  const r = await runTurn({ content: CONTENT, bot: "eyad", text: "where is nuznan", history: [], state: emptyState(), ad: { isAd: false }, returning: true,
    ports: { callModel: m.callModel, probeDocument: probeOf(), sendDocument: s.send } });
  assert.equal(s.sent.length, 0);
  assert.equal(r.trace.brochure, undefined);
  assert.equal(r.outcome, "ok");
});

test("review: 'koto din' (how many days) and 'abar' (again) inside a question are not send requests", () => {
  for (const t of ["brochure onujayi handover e koto din lagbe", "brochure e abar ki ki ache?", "brochure e kon din handover lekha"]) assert.equal(intent(t), "question", t);
  assert.equal(intent("brochure ta din"), "send");
  assert.equal(intent("osman er brochure ta open hocche na, abar pathan"), "send");
});

test("review: 'both' keeps the answer's outcome visible and the sent project in state", async () => {
  const m = modelSaying(say({ project_ref: "p-nuz", reply: "It has a rooftop garden.", used_item_ids: ["doc:d1#0"] }));
  const hits = [{ id: "c1", document_id: "d1", document_version: 1, chunk_no: 0, section: "Amenities", title: "Wecon Nuznan brochure", chunk_text: "Amenities: rooftop garden", score: 0.7 }];
  const r = await runTurn({ content: CONTENT, bot: "eyad", text: "Send the nuznan brochure and tell me the amenities", history: [], state: { ...emptyState(), active_project: "p-osm" }, ad: { isAd: false }, returning: true,
    ports: { callModel: m.callModel, probeDocument: probeOf(), searchDocs: async () => hits, sendDocument: sender().send } });
  assert.equal(r.trace.answer_outcome, "ok");
  assert.equal(r.stateNext.active_project, "p-nuz");
});

// Reproduced on the production catalog (2026-10-20). None of these sent a
// wrong PDF before (they fell to a clarification), but each one asked a
// question the customer had already answered.
test("intent: a Bengali project name with a case ending is still a bare 'send' request", () => {
  const NUZBN = P("p-nuzbn", "Wecon Nuznan", "Dhaka", ["nuznan"], "https://wecon.test/nuz.pdf");
  NUZBN.body.aliases.bn = ["নুজনান"];
  const words = projectWords(freezeContent([NUZBN], { reply_model: "m", max_tokens: 600, rubric_version: 1 }).content.projects);
  assert.equal(brochureIntent("নুজনানের ব্রোশিওর", { words }), "send");
  assert.equal(brochureIntent("নুজনানে ব্রোশিওর", { words }), "send");
});

test("intent: 'I saw it' and 'later I'll call' after a brochure are not requests; 'I can't understand it' is a question", () => {
  for (const t of ["brochure dekhlam, valo", "ami brochure dekhe call dibo", "brochure dekhechi", "ব্রোশিওর দেখলাম"]) assert.equal(intent(t), null, t);
  for (const t of ["brochure ta bujhte parchi na", "profile e ki ache", "eta ki apnader company profile?"]) assert.equal(intent(t), "question", t);
});

// ── review 2 (2026-10-20) ───────────────────────────────────────────────────
import { intentQuestion } from "./trainer-brochure.ts";

test("review2: a question in reply to 'the PDF, or a question about it?' is answered, never sent as a PDF", () => {
  const ask = intentQuestion("en", "Wecon Nuznan");
  for (const t of ["what about parking", "question ache", "how big are the flats", "handover kobe", "ekta proshno chilo"]) {
    const r = req(t, { ...emptyState(), active_project: "p-nuz" }, ask);
    assert.notEqual((r as any)?.intent, "send", t);
  }
  assert.equal((req("send it", { ...emptyState(), active_project: "p-nuz" }, ask) as any)?.intent, "send");
  assert.equal(req("no thanks", { ...emptyState(), active_project: "p-nuz" }, ask), null);
});

test("review2: a brochure question with no project in play goes to the answer path, not a project picker", async () => {
  const m = modelSaying(say({ reply: "Which project are you asking about?", clarify: true }));
  const r = await runTurn({ content: CONTENT, bot: "eyad", text: "what does the brochure say about handover?", history: [], state: emptyState(), ad: { isAd: false }, returning: true,
    ports: { callModel: m.callModel, probeDocument: probeOf(), searchDocs: async () => [] } });
  assert.equal(m.calls.length, 1);
  assert.notEqual(r.outcome, "brochure_clarify");
  assert.deepEqual(r.media, []);
});

test("review2: the Deno probe port reads one chunk and cancels, even when the server ignores Range", async () => {
  const src = (await import("node:fs")).readFileSync(new URL("./trainer-deno.ts", import.meta.url), "utf8");
  const port = /export const probe = httpProbe\(\{[\s\S]*?\n\}\);/.exec(src)?.[0] || "";
  assert.match(port, /getReader\(\)/, "reads through a stream reader");
  assert.match(port, /\.read\(\)/, "takes one chunk");
  assert.match(port, /cancel\(\)/, "cancels the rest of the body");
  assert.doesNotMatch(port, /await r\.arrayBuffer\(\)|await r\.blob\(\)|await r\.text\(\)/, "never reads the whole body");
});

import { afterBrochure } from "./trainer-brochure.ts";
test("review3: after a brochure, 'abar' needs a send verb or nothing else; a project plus 'ta' needs 'no' or nothing else", () => {
  const o = { match, words: WORDS };
  for (const t of ["abar pathan", "send it again", "আবার পাঠান", "resend please", "abar", "again please"]) assert.equal(afterBrochure(t, o)?.kind, "resend", t);
  for (const t of ["abar jiggesh korbo", "abar call dibo", "nuznan ta sundor", "osman ta onek boro"]) assert.equal(afterBrochure(t, o), null, t);
  assert.deepEqual(afterBrochure("na, nuznan er ta", o), { kind: "correct", projects: ["p-nuz"] });
  assert.deepEqual(afterBrochure("nuznan er ta", o), { kind: "correct", projects: ["p-nuz"] });
});

test("review3: 'both' over several projects keeps the answer's project when it is one of those sent", async () => {
  const m = modelSaying(say({ project_ref: "p-osm", reply: "Both are in Dhaka." }));
  const r = await runTurn({ content: CONTENT, bot: "eyad", text: "send the nuznan and osman brochures and tell me where they are", history: [], state: emptyState(), ad: { isAd: false }, returning: true,
    ports: { callModel: m.callModel, probeDocument: probeOf(), searchDocs: async () => [] } });
  assert.equal(r.stateNext.active_project, "p-osm");
  assert.deepEqual([...(r.stateNext.last_brochure || [])].sort(), ["p-nuz", "p-osm"]);
});

test("review3: the Deno probe keeps reading until it has 12 bytes (a WebP header), not just one chunk", async () => {
  const src = (await import("node:fs")).readFileSync(new URL("./trainer-deno.ts", import.meta.url), "utf8");
  const port = /export const probe = httpProbe\(\{[\s\S]*?\n\}\);/.exec(src)?.[0] || "";
  assert.match(port, /while\s*\(/, "loops over chunks");
  assert.match(port, /12/, "until 12 bytes");
});

test("review3: the generic project words live in a leaf module (no trainer-core <-> trainer-docs cycle)", async () => {
  const docs = (await import("node:fs")).readFileSync(new URL("./trainer-docs.ts", import.meta.url), "utf8");
  assert.doesNotMatch(docs, /from "\.\/trainer-core\.ts"/);
});
