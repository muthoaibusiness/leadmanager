// Project photos, floor plans and maps for the AI Trainer. Deno-free.
//
// Images come from the project's own media URLs (the catalog), never from
// pictures inside a brochure PDF. Before an image is offered, its URL is
// checked: https, not a private address, and the first bytes are an image
// (JPEG, PNG, WebP or GIF). A Google Drive viewer link answers with an HTML
// page, so it fails the check instead of reaching the customer as a "map".
import type { MediaAction } from "./trainer-core.ts";
import { linkProblem, type ProbeResult } from "./trainer-brochure.ts";

export type ImageProbe = (url: string) => Promise<ProbeResult>;
export type ImageFailure = { kind: string; url: string; project_ref: string; status: "invalid_link" | "unreachable" | "not_image"; detail?: string };

// RIFF is also WAV and AVI: only a RIFF....WEBP header is an image.
const isImage = (magic: string) => magic.startsWith("\xff\xd8") || magic.startsWith("\x89PNG") || magic.startsWith("GIF8") || (magic.startsWith("RIFF") && magic.slice(8, 12) === "WEBP");

// At most 4 checks at a time: "all floor plans" can be 13 images, and each
// check holds a connection until its own timeout.
export async function verifyImages(actions: MediaAction[], probe: ImageProbe): Promise<{ ok: MediaAction[]; failed: ImageFailure[] }> {
  const checked: (MediaAction | ImageFailure)[] = [];
  for (let i = 0; i < actions.length; i += 4) checked.push(...await Promise.all(actions.slice(i, i + 4).map(async (a): Promise<MediaAction | ImageFailure> => {
    const fail = (status: ImageFailure["status"], detail?: string): ImageFailure => ({ kind: a.kind, url: a.url, project_ref: a.project_ref, status, ...(detail ? { detail } : {}) });
    if (a.type !== "image") return a;
    const bad = linkProblem(a.url);
    if (bad) return fail("invalid_link", bad);
    try {
      const r = await probe(a.url);
      if (!r.ok || (r.status !== 200 && r.status !== 206)) return fail("unreachable", `HTTP ${r.status}`);
      return isImage(r.magic) ? a : fail("not_image", r.contentType || "unknown content type");
    } catch (e) { return fail("unreachable", e instanceof Error ? e.message : String(e)); }
  })));
  return { ok: checked.filter((x): x is MediaAction => "type" in x), failed: checked.filter((x): x is ImageFailure => !("type" in x)) };
}

// The floor a plan shows, read from its file name when the catalog has no
// label ("Ground-Floor-Plan.png" is "Ground Floor"). Only names the file
// states outright; anything else is null, never a guess.
const ORD = (n: string) => `${n}${/1[123]$/.test(n) ? "th" : n.endsWith("1") ? "st" : n.endsWith("2") ? "nd" : n.endsWith("3") ? "rd" : "th"} Floor`;
export function floorLabel(url: string): string | null {
  let f: string;
  try { f = decodeURIComponent(new URL(url).pathname.split("/").pop() || ""); } catch { return null; }
  const n = f.toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[_\s]+/g, "-");
  // Each word must be its own part of the name: "playground" is not ground.
  const part = (re: string) => new RegExp(`(^|-)(${re})(-|$)`).test(n);
  if (!part("floor|plan|layout|layut|parking|semi-?bas[e]?t?ment|bas[e]?t?ment") && !/floor|layout|layut/.test(n)) return null;
  if (part("semi-?bas[e]?t?ment")) return "Semi-Basement";
  if (part("bas[e]?t?ment")) return "Basement";
  const num = /(^|-)(\d{1,2})(st|nd|rd|th|sr)?-(floor|layout|layut)/.exec(n);
  if (num) return ORD(num[2]);
  if (part("me+z+a+n+i+n+e")) return "Mezzanine Floor";
  if (part("ground")) return "Ground Floor";
  if (part("typical")) return "Typical Floor";
  if (part("roof|rooftop|roof-top")) return "Roof Top";
  return null;
}

// The model's reply was written as if every image would go. Sentences that
// announce a lost kind ("here is the map") are dropped; the rest stays.
// A sentence is dropped only when it names the lost kind AND announces
// sending it ("here is", "pathacchi", "attached"): "the apartment layout is
// 3 bedrooms" and "payment plan is 40/60" are facts, and stay.
const KIND_WORDS: Record<string, RegExp> = {
  photo: /\b(photos?|pictures?|pics?|images?|chobi|chhobi)\b|(ছবি|ফটো)/i,
  map: /\b(location map|maps?)\b|(ম্যাপ|মানচিত্র)/i,
  floorplan: /\b(floor ?plans?)\b|(ফ্লোর প্ল্যান)/i,
};
const ANNOUNCE = /\b(here (is|are)|here's|sending|sent|attached|attach\w*|sharing|i('ll| will) send|ei nin|eikhane|ekhane|pathacchi|pathalam|pathiye|patha dilam|diye dilam|dilam|dekhacchi)\b|(পাঠাচ্ছি|পাঠালাম|পাঠিয়ে|দিলাম|এই নিন|এখানে)/i;
export function withoutLostMedia(reply: string, lost: string[]): string {
  const res = lost.map((k) => KIND_WORDS[k]).filter(Boolean);
  if (!res.length) return reply;
  const parts = reply.split(/(?<=[.!?।])\s+/);
  return parts.filter((s) => !(ANNOUNCE.test(s) && res.some((r) => r.test(s)))).join(" ").trim();
}

// Some images of a kind went and some failed the check.
export function partialMediaText(lang: "bn" | "banglish" | "en", kinds: string[]): string {
  const what = [...new Set(kinds)].map((x) => (x === "floorplan" ? "floor plan" : x)).join(lang === "en" ? " and " : lang === "bn" ? " ও " : " ar ");
  if (lang === "bn") return `কিছু ${what} এখন পাঠানো গেল না; আমাদের একজন কনসালট্যান্ট বাকিগুলো পাঠিয়ে দেবেন।`;
  if (lang === "banglish") return `Kichu ${what} ekhon pathano gelo na; amader ekjon consultant bakigulo pathiye deben.`;
  return `Some ${what}s could not be sent right now; one of our consultants will send the rest.`;
}

// What the reply says when an image could not be sent. Short, in the
// customer's language, and never "here it is".
export function missingMediaText(lang: "bn" | "banglish" | "en", kinds: string[]): string {
  const k = [...new Set(kinds)].map((x) => (x === "floorplan" ? "floor plan" : x));
  const what = k.join(lang === "en" ? " and " : lang === "bn" ? " ও " : " ar ");
  if (lang === "bn") return `দুঃখিত, এই প্রজেক্টের ${what} এখন পাওয়া যাচ্ছে না। আমাদের একজন কনসালট্যান্ট আপনাকে পাঠিয়ে দেবেন।`;
  if (lang === "banglish") return `Dukkhito, ei project er ${what} ekhon pawa jachhe na. Amader ekjon consultant apnake pathiye deben.`;
  return `Sorry, the ${what} for this project is not available right now. One of our consultants will send it to you.`;
}
