import { test } from "node:test";
import assert from "node:assert/strict";
import { freezeContent, runTurn, emptyState, resolveMedia, type ItemRow } from "./trainer-core.ts";
import { verifyImages, floorLabel, type ImageProbe } from "./trainer-media.ts";

// Image requests are answered from the project's own photo, floor-plan and
// map URLs, never from pictures inside a PDF. Every URL is checked before it
// is offered, and an image that fails the check is reported, not sent.
const P = (id: string, name: string, alias: string, media: object): ItemRow => ({
  id, kind: "project", revision: 1, status: "active", bots: ["eyad", "dubai"], project_ref: null, body: { name, region: "Dhaka", aliases: { banglish: [alias] }, media },
});
const NUZ = P("p-nuz", "Wecon Nuznan", "nuznan", { photos: ["https://img.test/n1.jpg", "https://img.test/n2.jpg", "https://img.test/n3.jpg", "https://img.test/n4.jpg"],
  floor_plans: [{ url: "https://img.test/nuz-ground.jpg", label: "Ground Floor" }, { url: "https://img.test/nuz-roof.jpg", label: "Roof Top" }], map_image: "https://img.test/nuz-map.png" });
// Unlabelled plans whose file names say the floor, as Dakshinayan's do.
const DAK = P("p-dak", "Wecon Dakshinayan", "dakshinayan", { photos: ["https://img.test/d1.jpg"],
  floor_plans: [{ url: "https://img.test/2026/03/Typical-Floor-Plan-1.png" }, { url: "https://img.test/2026/03/Ground-Floor-Plan.png" },
    { url: "https://img.test/2026/03/Meezzanine-Floor-Plan.png" }, { url: "https://img.test/2026/03/Roof-Top-Floor-Plan.png" }] });
// South Dale lists the 7th floor twice; Shafiq Sapphire's map is a web page.
const SDL = P("p-sdl", "Wecon South Dale", "south dale", { photos: ["https://img.test/s1.webp"],
  floor_plans: [{ url: "https://img.test/7th-Floor-Layout-Plan.png" }, { url: "https://img.test/7th-Floor-Layout-Plan.png" }, { url: "https://img.test/8th-Floor-Layout-Plan.png" }] });
const SAP = P("p-sap", "Shafiq Sapphire", "sapphire", { photos: [], map_image: "https://drive.google.test/file/d/x/view" });
const CONTENT = freezeContent([NUZ, DAK, SDL, SAP], { reply_model: "m", max_tokens: 600, rubric_version: 1 }).content;

const IMG = { ok: true, status: 200, contentType: "image/jpeg", magic: "\xff\xd8\xff", bytes: 1000 };
const probeOf = (bad: Record<string, object> = {}): ImageProbe & { calls: string[] } => {
  const calls: string[] = [];
  const f = (async (u: string) => { calls.push(u); if (u.includes("drive.google.test")) return { ok: true, status: 200, contentType: "text/html", magic: "<!DOC", bytes: 0 }; return { ...IMG, ...(bad[u] || {}) }; }) as ImageProbe & { calls: string[] };
  f.calls = calls; return f;
};
const out = (o: object) => JSON.stringify({ intent: "media", project_ref: null, language: "en", reply: "Here you go.", media: [], handoff: false, asked: [], used_item_ids: [], clarify: false, ...o });
const turn = (text: string, model: string, ports: object = {}) => runTurn({ content: CONTENT, bot: "eyad", text, history: [], state: emptyState(), ad: { isAd: false }, returning: true,
  ports: { callModel: async () => ({ ok: true as const, text: model, cost_usd: 0 }), ...ports } });

test("floorLabel: a floor name is read from the file name when the catalog has no label; nothing is invented otherwise", () => {
  assert.equal(floorLabel("https://img.test/2026/03/Ground-Floor-Plan.png"), "Ground Floor");
  assert.equal(floorLabel("https://img.test/Meezzanine-Floor-Plan.png"), "Mezzanine Floor");
  assert.equal(floorLabel("https://img.test/Roof-Top-Floor-Plan.png"), "Roof Top");
  assert.equal(floorLabel("https://img.test/Typical-Floor-Plan-1.png"), "Typical Floor");
  assert.equal(floorLabel("https://img.test/1sr-Floor.jpg"), "1st Floor");
  assert.equal(floorLabel("https://img.test/3rd-Floor-Layut-Plan.jpg"), "3rd Floor");
  assert.equal(floorLabel("https://img.test/Bastment-Parking-Floor-Plan.jpg"), "Basement");
  assert.equal(floorLabel("https://img.test/Semi-Basement-Parking.jpg"), "Semi-Basement");
  // Citizen Avenue names its basement plans without a "floor" or "plan" word.
  assert.equal(floorLabel("https://img.test/2026/06/Semi_Basement_Citizen_Mall-scaled.png"), "Semi-Basement");
  assert.equal(floorLabel("https://img.test/2026/06/Basement_Floor_-Citizen_Mall-scaled.png"), "Basement");
  assert.equal(floorLabel("https://img.test/10th-Floor-Layout-PlanRoof.png"), "10th Floor");
  assert.equal(floorLabel("https://img.test/Osman-2D.pdf.15.12.25_page-0001.jpg"), null);
  assert.equal(floorLabel("https://img.test/IMG_2041.jpg"), null);
});

test("resolveMedia: an unlabelled plan is matched by the floor its file name states, and the question lists real floor names", () => {
  const r = resolveMedia({ ...JSON.parse(out({ media: [{ type: "floorplan", project_ref: "p-dak", floor: "ground" }] })) }, CONTENT);
  assert.deepEqual(r.actions.map((a) => [a.url, a.floor]), [["https://img.test/2026/03/Ground-Floor-Plan.png", "Ground Floor"]]);
  const q = resolveMedia({ ...JSON.parse(out({ media: [{ type: "floorplan", project_ref: "p-dak" }] })) }, CONTENT);
  assert.equal(q.actions.length, 0);
  assert.equal(q.clarify, "Which floor plan would you like for Wecon Dakshinayan: Typical Floor, Ground Floor, Mezzanine Floor, Roof Top?");
});

test("resolveMedia: a URL listed twice is offered once", () => {
  const r = resolveMedia({ ...JSON.parse(out({ media: [{ type: "floorplan", project_ref: "p-sdl", floor: "all" }] })) }, CONTENT);
  assert.deepEqual(r.actions.map((a) => a.url), ["https://img.test/7th-Floor-Layout-Plan.png", "https://img.test/8th-Floor-Layout-Plan.png"]);
});

test("runTurn: a photo request sends the project's own photos (up to 3), each checked, never another project's", async () => {
  const probe = probeOf();
  const r = await turn("nuznan er chobi dekhan", out({ project_ref: "p-nuz", media: [{ type: "photo", project_ref: "p-nuz" }] }), { probeImage: probe });
  assert.deepEqual(r.media.map((m) => m.url), ["https://img.test/n1.jpg", "https://img.test/n2.jpg", "https://img.test/n3.jpg"]);
  assert.deepEqual(probe.calls.sort(), ["https://img.test/n1.jpg", "https://img.test/n2.jpg", "https://img.test/n3.jpg"]);
  assert.ok(r.media.every((m) => m.project_ref === "p-nuz"));
});

test("runTurn: media for a project the customer did not name is refused (guard), so photos never cross projects", async () => {
  const r = await turn("nuznan er chobi dekhan", out({ project_ref: "p-nuz", media: [{ type: "photo", project_ref: "p-dak" }] }), { probeImage: probeOf() });
  assert.equal(r.outcome, "fallback_invalid_output");
  assert.deepEqual(r.media, []);
});

test("runTurn: an HTML page listed as a map is not sent, and the reply does not claim a map", async () => {
  const r = await turn("sapphire er map", out({ project_ref: "p-sap", reply: "Here is the map of Shafiq Sapphire.", media: [{ type: "map", project_ref: "p-sap" }] }), { probeImage: probeOf() });
  assert.deepEqual(r.media, []);
  assert.deepEqual((r.trace.media_failed as any[]).map((f) => [f.kind, f.status]), [["map", "not_image"]]);
  assert.doesNotMatch(r.reply, /Here is the map/);
  assert.match(r.reply, /map/i);
  assert.match(r.reply, /not available|consultant/i);
});

test("runTurn: a broken or private image URL is dropped and reported; the good ones still go", async () => {
  const probe = probeOf({ "https://img.test/n2.jpg": { ok: false, status: 404, contentType: "text/html", magic: "<html" } });
  const r = await turn("nuznan er chobi", out({ project_ref: "p-nuz", media: [{ type: "photo", project_ref: "p-nuz" }] }), { probeImage: probe });
  assert.deepEqual(r.media.map((m) => m.url), ["https://img.test/n1.jpg", "https://img.test/n3.jpg"]);
  assert.deepEqual((r.trace.media_failed as any[]).map((f) => [f.url, f.status]), [["https://img.test/n2.jpg", "unreachable"]]);
  assert.match(r.reply, /^Here you go\. /, "some photos went out, so the reply stands");
  assert.match(r.reply, /Kichu photo ekhon pathano gelo na/, "and it says one did not");
});

test("runTurn: a project with no photos says so honestly instead of promising one", async () => {
  const r = await turn("sapphire er chobi", out({ project_ref: "p-sap", reply: "Here are the photos.", media: [{ type: "photo", project_ref: "p-sap" }] }), { probeImage: probeOf() });
  assert.deepEqual(r.media, []);
  assert.deepEqual(r.trace.media_missing, ["photo"]);
  assert.doesNotMatch(r.reply, /Here are the photos/);
  assert.match(r.reply, /photo/i);
});

test("verifyImages: https and image bytes only; private hosts and non-https refused without a request", async () => {
  const probe = probeOf();
  const acts = [{ type: "image" as const, url: "http://img.test/a.jpg", caption: "c", kind: "photo", project_ref: "p" },
    { type: "image" as const, url: "https://127.0.0.1/a.jpg", caption: "c", kind: "photo", project_ref: "p" },
    { type: "image" as const, url: "https://img.test/ok.webp", caption: "c", kind: "photo", project_ref: "p" }];
  const v = await verifyImages(acts, probeOf({ "https://img.test/ok.webp": { contentType: "image/webp", magic: "RIFF\x24\0\0\0WEBP" } }));
  assert.deepEqual(v.ok.map((a) => a.url), ["https://img.test/ok.webp"]);
  assert.deepEqual(v.failed.map((f) => f.status), ["invalid_link", "invalid_link"]);
  assert.deepEqual(probe.calls, []);
});

test("runTurn: without an image probe nothing is checked and media goes out as before (Playground shows it, never sends)", async () => {
  const r = await turn("nuznan er chobi", out({ project_ref: "p-nuz", media: [{ type: "photo", project_ref: "p-nuz" }] }));
  assert.equal(r.media.length, 3);
  assert.equal(r.trace.media_failed, undefined);
});

// Production run 2026-10-20: the probe decoded the first bytes as UTF-8, so
// JPEG (FF D8) and PNG (89 50) became U+FFFD and every photo failed as
// "not_image". The probe must keep raw bytes, and the check must read them.
import { httpProbe } from "./trainer-brochure.ts";
test("httpProbe + verifyImages: real JPEG, PNG, WebP, GIF and PDF bytes are told apart", async () => {
  const files: Record<string, number[]> = {
    "https://img.test/a.jpg": [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], "https://img.test/b.png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a],
    "https://img.test/c.webp": [0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0, 0, 0x57, 0x45, 0x42, 0x50], "https://img.test/d.gif": [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
    "https://img.test/e.pdf": [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31], "https://img.test/f.html": [0x3c, 0x21, 0x44, 0x4f, 0x43, 0x54],
  };
  const probe = httpProbe({ resolve: async () => ["93.184.216.34"], fetch: async (url) => ({ ok: true, status: 200,
    headers: { get: (k: string) => (k === "content-type" ? "application/octet-stream" : null) }, arrayBuffer: async () => new Uint8Array(files[url]).buffer }) });
  const acts = Object.keys(files).map((url) => ({ type: "image" as const, url, caption: "c", kind: "photo", project_ref: "p" }));
  const v = await verifyImages(acts, probe);
  assert.deepEqual(v.ok.map((a) => a.url.split("/").pop()), ["a.jpg", "b.png", "c.webp", "d.gif"]);
  assert.deepEqual(v.failed.map((f) => [f.url.split("/").pop(), f.status]), [["e.pdf", "not_image"], ["f.html", "not_image"]]);
  assert.ok((await probe("https://img.test/e.pdf")).magic.startsWith("%PDF-"), "the PDF check still reads %PDF");
});

test("review: a lost image adds a short note; the model's answer and the images that did go out are kept", async () => {
  const probe = probeOf({ "https://img.test/nuz-map.png": { ok: false, status: 404, contentType: "text/html", magic: "<html" } });
  const r = await turn("nuznan er chobi ar map", out({ project_ref: "p-nuz", reply: "Wecon Nuznan is in Dhaka. Here are the photos and the map.",
    media: [{ type: "photo", project_ref: "p-nuz" }, { type: "map", project_ref: "p-nuz" }] }), { probeImage: probe });
  assert.equal(r.media.filter((m) => m.kind === "photo").length, 3);
  assert.equal(r.media.filter((m) => m.kind === "map").length, 0);
  assert.match(r.reply, /Wecon Nuznan is in Dhaka\./, "the substantive answer stays");
  assert.match(r.reply, /map ekhon pawa jachhe na/, "the note is in the customer's language (Banglish)");
  assert.doesNotMatch(r.reply, /and the map\./, "the sentence that promised the lost map is not kept");
});

test("review: RIFF audio or video is not an image; only RIFF....WEBP is", async () => {
  const wav = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45], webp = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
  const probe = httpProbe({ resolve: async () => ["93.184.216.34"], fetch: async (url) => ({ ok: true, status: 200, headers: { get: () => null },
    arrayBuffer: async () => new Uint8Array(url.endsWith("wav") ? wav : webp).buffer }) });
  const v = await verifyImages(["https://img.test/a.wav", "https://img.test/b.webp"].map((url) => ({ type: "image" as const, url, caption: "c", kind: "floorplan", project_ref: "p" })), probe);
  assert.deepEqual(v.ok.map((a) => a.url), ["https://img.test/b.webp"]);
});

test("review: image checks run at most 4 at a time", async () => {
  let open = 0, max = 0;
  const probe: ImageProbe = async () => { open++; max = Math.max(max, open); await new Promise((r) => setTimeout(r, 3)); open--; return IMG; };
  const acts = Array.from({ length: 13 }, (_, i) => ({ type: "image" as const, url: `https://img.test/${i}.jpg`, caption: "c", kind: "floorplan", project_ref: "p" }));
  const v = await verifyImages(acts, probe);
  assert.equal(v.ok.length, 13);
  assert.ok(max <= 4, `max in flight ${max}`);
});

import { withoutLostMedia } from "./trainer-media.ts";
test("review2: only a sentence that announces the lost image is dropped; 'layout' or 'payment plan' facts stay", () => {
  assert.equal(withoutLostMedia("The apartment layout is 3 bedrooms. Here is the floor plan.", ["floorplan"]), "The apartment layout is 3 bedrooms.");
  assert.equal(withoutLostMedia("Payment plan is 40/60. I am sending the ground floor plan.", ["floorplan"]), "Payment plan is 40/60.");
  assert.equal(withoutLostMedia("The map shows it near the lake.", ["map"]), "The map shows it near the lake.");
  assert.equal(withoutLostMedia("Ei nin chobi.", ["photo"]), "");
  assert.equal(withoutLostMedia("নুজনানের ছবি পাঠাচ্ছি।", ["photo"]), "");
});

// ai-trainer v10, 2026-10-20: "osman er chobi dekhan" returned 4 photos for a
// project with 2, because the model listed the photo request twice.
test("runTurn: the same image is never offered twice, even when the model asks twice", async () => {
  const r = await turn("nuznan er chobi", out({ project_ref: "p-nuz", media: [{ type: "photo", project_ref: "p-nuz" }, { type: "photo", project_ref: "p-nuz" }, { type: "map", project_ref: "p-nuz" }, { type: "map", project_ref: "p-nuz" }] }), { probeImage: probeOf() });
  assert.deepEqual(r.media.map((m) => m.url), ["https://img.test/n1.jpg", "https://img.test/n2.jpg", "https://img.test/n3.jpg", "https://img.test/nuz-map.png"]);
});

test("review3: a floor word must be its own part of the file name ('playground' is not the ground floor)", () => {
  assert.equal(floorLabel("https://img.test/Playground-Layout.png"), null);
  assert.equal(floorLabel("https://img.test/background-floor.png"), null);
  assert.equal(floorLabel("https://img.test/Roofing-Detail.png"), null);
  assert.equal(floorLabel("https://img.test/Ground-Floor-Plan.png"), "Ground Floor");
  assert.equal(floorLabel("https://img.test/Typical-3rd-Floor.png"), "3rd Floor", "a stated floor number wins over 'typical'");
});

test("review3: when some images of a kind go and some fail, the reply says some could not be sent", async () => {
  const probe = probeOf({ "https://img.test/n2.jpg": { ok: false, status: 404, contentType: "text/html", magic: "<html" } });
  const r = await turn("nuznan er sob chobi", out({ project_ref: "p-nuz", language: "en", reply: "Here are all the photos.", media: [{ type: "photo", project_ref: "p-nuz" }] }), { probeImage: probe });
  assert.equal(r.media.length, 2);
  assert.match(r.reply, /Kichu photo ekhon pathano gelo na/, "the note is in the customer's language (Banglish)");
});
