// Project brochures (the "profile" PDFs) for the AI Trainer. Deno-free.
//
// A brochure request never goes to the model. Code decides which projects were
// asked for (one project, one city, or every project), checks that each file
// is really a PDF at a reachable https URL, and only then offers it. A file
// that is missing, is not a PDF, or fails to send is reported as such, and the
// turn hands off to a consultant. The reply text is built from what actually
// happened, so it can never claim a brochure that was not delivered.
//
// The catalog is the active project items (body.media.brochure), the same
// rows a snapshot freezes. There is one file per project: WECON's "profile"
// and "brochure" are the same PDF.
import type { ConvState, ItemRow, MediaAction } from "./trainer-core.ts";
import { isBlockedAddress } from "./trainer-model.ts";

export type Lang = "bn" | "banglish" | "en";
export type ProbeResult = { ok: boolean; status: number; contentType: string; magic: string; bytes: number };
// Reads the first bytes of a URL. Injected: the Deno port does the network call.
export type Probe = (url: string) => Promise<ProbeResult>;
export type Status = "listed" | "missing" | "conflict" | "verified" | "not_pdf" | "unreachable" | "invalid_link"
  | "unverified" | "unknown_project" | "send_failed";
export type CatalogRow = {
  project_ref: string; project: string; city: string; url: string | null; storage: string;
  file_type: "pdf" | "unknown" | null; status: Status; detail?: string; wa_id?: string; bytes?: number;
};
export type DocMessage = { type: "document"; text: string; mediaUrl: string; fileName: string };
// "sent" means the WhatsApp provider accepted the document and returned a
// message id. Handset delivery arrives later as a receipt on wa_messages.
export type Delivery = {
  sent: CatalogRow[]; ready: CatalogRow[]; failed: CatalogRow[];
  outcome: "brochure_sent" | "brochure_ready_not_sent" | "brochure_partial" | "brochure_unavailable";
  handoff: boolean; reply: string; actions: MediaAction[];
};

const norm = (s: string) => String(s || "").normalize("NFC").toLowerCase();

// ── what was asked ──────────────────────────────────────────────────────────
const BROCHURE = [/\b(brochures?|broch?[iu]re?s?|brosh?[iu]+re?s?|brosiur)\b/, /(ব্রো?শি?[উও]?র|ব্রোশার)/];
// "profile" and "pdf" are common words ("my profile", "the payment pdf"), so
// they count only beside a project or company word, or as nearly the whole ask.
const LOOSE = [/\b(profiles?|pdfs?)\b/, /(প্রোফাইল|পিডিএফ)/];
const CONTEXT = [/\b(projects?|company|companies|wecon|properties|property|apartments?)\b/, /(প্রজেক্ট|প্রকল্প|কোম্পানি)/];
const NOT_ASK = /\b(my|amar)\s+(profile|pdf)|\bprofile\s*(picture|pic|photo|image)|\b(payment|agreement|invoice|receipt|deed)\s+pdf|\bpdf\s+of\s+the\s+(agreement|payment|invoice|deed)/;
export const isBrochureAsk = (text: string, o: { match?: (s: string) => string[] } = {}) => {
  const t = norm(text);
  if (NOT_ASK.test(t)) return false;
  if (BROCHURE.some((r) => r.test(t))) return true;
  if (!LOOSE.some((r) => r.test(t))) return false;
  return CONTEXT.some((r) => r.test(t)) || cityOf(t).length > 0 || !!o.match?.(text).length || t.split(/\s+/).filter(Boolean).length <= 3;
};

export const CITIES = ["Dhaka", "Chattogram", "Cumilla"] as const;
const CITY_RE: Record<string, RegExp[]> = {
  Dhaka: [/\bdhaka\b/, /ঢাকা/],
  Chattogram: [/\b(chattogram|chittagong|chottogram|chatogram|ctg)\b/, /চট্টগ্রাম/],
  Cumilla: [/\b(cumilla|comilla|kumilla)\b/, /কুমিল্লা/],
};
export const cityOf = (text: string): string[] => { const t = norm(text); return CITIES.filter((c) => CITY_RE[c].some((r) => r.test(t))); };

const NO = /^(no|nope|nah|na|not now|later|thanks|thank you|thx|ty|lagbe na|dorkar nai|dorkar nei|pore)\b|(লাগবে না|দরকার নেই|না\b|পরে|ধন্যবাদ)|^না$/;
const ALL_WORDS = /\b(all|every|both|three|sob|shob|sobgula|shobgula)\b|(সব|সবগুলো|সকল|তিনটি|তিনটা)/;
const YES = /^(yes|yeah|yep|ok|okay|sure|please|pls|plz|ha|haa|hya|ji|jee|hmm|send|share|den|dao|din|pathan)\b|^(হ্যাঁ|হ্যা|জি|ঠিক আছে|দিন|পাঠান)/;
// A short follow-up that asks something else ("ok, price koto?") is not a yes.
const OTHER = /\?|\b(price|dam|daam|koto|cost|taka|where|kothay|size|sqft|photo|photos|chobi|video|map|floor)\b|(দাম|টাকা|কত|কোথায়|ছবি|ভিডিও)/;

export type Request =
  | { kind: "projects"; projects: string[]; scope: "named" | "state"; cities?: undefined }
  | { kind: "projects"; projects: string[]; scope: "city" | "all"; cities: string[] }
  | { kind: "clarify"; cities: string[]; question: string };

const byName = (projects: ItemRow[]) => (a: string, b: string) => {
  const n = (id: string) => String(projects.find((p) => p.id === id)?.body?.name ?? id);
  return n(a).localeCompare(n(b));
};
const regionOf = (p: ItemRow) => cityOf(String(p.body?.region ?? ""))[0] ?? String(p.body?.region ?? "");

// null when the message is not about brochures, so the normal reply path runs.
// match finds the projects a text names (trainer-core's alias matcher).
export function brochureRequest(text: string, state: ConvState, projects: ItemRow[],
  o: { match: (s: string) => string[]; lastBot?: string; lang?: Lang }): Request | null {
  const t = norm(text).trim();
  const words = t.split(/\s+/).filter(Boolean);
  const botAsked = !!o.lastBot && isBrochureAsk(o.lastBot) && /\?/.test(o.lastBot);
  const followUp = botAsked && words.length <= 5 && !OTHER.test(t) && !NO.test(t);
  if (!isBrochureAsk(text, { match: o.match }) && !followUp) return null;
  const sort = byName(projects);
  const inCity = (cities: string[]) => projects.filter((p) => cities.includes(regionOf(p))).map((p) => p.id).sort(sort);
  const known = CITIES.filter((c) => projects.some((p) => regionOf(p) === c));
  const clarify = (): Request => ({ kind: "clarify", cities: [...known], question: clarifyText(o.lang ?? "en", [...known]) });
  const named = o.match(text);
  if (named.length) return { kind: "projects", projects: [...new Set(named)].sort(sort), scope: "named" };
  const cities = cityOf(text);
  // A city with no active project is asked about, never answered with silence.
  if (cities.length) return inCity(cities).length ? { kind: "projects", projects: inCity(cities), scope: "city", cities } : clarify();
  const fromBot = o.lastBot ? o.match(o.lastBot) : [];
  if (ALL_WORDS.test(t)) {
    // "all three" right after the bot listed three projects means those three.
    if (fromBot.length > 1) return { kind: "projects", projects: [...new Set(fromBot)].sort(sort), scope: "named" };
    const botCities = o.lastBot ? cityOf(o.lastBot) : [];
    if (botCities.length && botCities.length < known.length && inCity(botCities).length) return { kind: "projects", projects: inCity(botCities), scope: "city", cities: botCities };
    return projects.length ? { kind: "projects", projects: projects.map((p) => p.id).sort(sort), scope: "all", cities: [...known] } : clarify();
  }
  // "yes" to "Shall I send the Chowdhury Arcade brochure?"
  if (followUp && YES.test(t) && fromBot.length === 1) return { kind: "projects", projects: fromBot, scope: "named" };
  if (state.active_project && projects.some((p) => p.id === state.active_project)) {
    return { kind: "projects", projects: [state.active_project], scope: "state" };
  }
  return clarify();
}

const list = (xs: string[], lang: Lang) => {
  const and = lang === "en" ? " and " : lang === "bn" ? " ও " : " ar ";
  return xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")}${and}${xs.at(-1)}`;
};

export function clarifyText(lang: Lang, cities: string[]): string {
  const c = list(cities, lang);
  if (lang === "bn") return `কোন প্রজেক্টের ব্রোশিওর চান? আমাদের প্রজেক্ট আছে ${c}-এ। চাইলে সবগুলোর ব্রোশিওরও দিতে পারি।`;
  if (lang === "banglish") return `Kon project er brochure chan? Amader project ache ${c} e. Chaile shobgulor brochure o dite pari.`;
  return `Which project's brochure would you like? We have projects in ${c}. I can also share all of them.`;
}

// ── catalog and verification ────────────────────────────────────────────────
const hostOf = (u: string) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ""; } };
const pathOf = (u: string) => { try { return new URL(u).pathname; } catch { return ""; } };

export function brochureCatalog(projects: ItemRow[]): CatalogRow[] {
  const rows = projects.filter((p) => p.kind === "project" && p.status === "active").map((p): CatalogRow => {
    const raw = p.body?.media?.brochure;
    const url = typeof raw === "string" && raw.trim() ? raw.trim() : null;
    return { project_ref: p.id, project: String(p.body?.name ?? p.id), city: regionOf(p), url, storage: url ? hostOf(url) : "",
      file_type: url ? (/\.pdf$/i.test(pathOf(url)) ? "pdf" : "unknown") : null, status: url ? "listed" : "missing" };
  });
  // One file listed on two projects means one of them points at the wrong
  // project's brochure; neither is sent until an operator fixes the catalog.
  const uses = new Map<string, number>();
  for (const r of rows) if (r.url) uses.set(r.url, (uses.get(r.url) ?? 0) + 1);
  return rows.map((r) => (r.url && uses.get(r.url)! > 1 ? { ...r, status: "conflict", detail: "the same file is listed on another project" } : r));
}

const LOCAL_HOST = /(^|\.)(localhost|local|internal|localdomain|home\.arpa)$/;
export function linkProblem(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return "not a URL"; }
  if (u.protocol !== "https:") return "not https";
  const host = u.hostname.toLowerCase().replace(/\.+$/, "");
  if (u.username || u.password || LOCAL_HOST.test(host) || isBlockedAddress(host)) return "local or private address";
  return null;
}

export async function verifyBrochure(row: CatalogRow, probe: Probe | null): Promise<CatalogRow> {
  if (row.status !== "listed" || !row.url) return row;
  const bad = linkProblem(row.url);
  if (bad) return { ...row, status: "invalid_link", detail: bad };
  if (!probe) return { ...row, status: "unverified", detail: "no file check available" };
  let r: ProbeResult;
  try { r = await probe(row.url); } catch (e) { return { ...row, status: "unreachable", detail: e instanceof Error ? e.message : String(e) }; }
  if (!r.ok || (r.status !== 200 && r.status !== 206)) return { ...row, status: "unreachable", detail: `HTTP ${r.status}` };
  // A Google Drive viewer link answers 200 with an HTML page, not the file.
  if (!r.magic.startsWith("%PDF")) return { ...row, status: "not_pdf", detail: r.contentType || "unknown content type" };
  return { ...row, status: "verified", file_type: "pdf", ...(r.bytes > 0 ? { bytes: r.bytes } : {}) };
}

// ── delivery ────────────────────────────────────────────────────────────────
// send is null in the Playground and in test runs: files are checked, nothing
// is sent, and the reply says they are ready, not sent. A send returns the
// WhatsApp message id, or null when the provider refused it.
export async function deliverBrochures(ids: string[], projects: ItemRow[],
  io: { probe: Probe | null; send: ((m: DocMessage) => Promise<string | null>) | null }, lang: Lang = "en"): Promise<Delivery> {
  const catalog = brochureCatalog(projects);
  const sent: CatalogRow[] = []; const ready: CatalogRow[] = []; const failed: CatalogRow[] = [];
  // Every file is checked at once (each check has its own timeout), then the
  // verified ones are sent in order; only the sends need spacing.
  const unique = [...new Set(ids)];
  const checked = await Promise.all(unique.map((id) => {
    const row = catalog.find((r) => r.project_ref === id);
    return row ? verifyBrochure(row, io.probe)
      : Promise.resolve<CatalogRow>({ project_ref: id, project: "", city: "", url: null, storage: "", file_type: null, status: "unknown_project" });
  }));
  for (const v of checked) {
    if (v.status !== "verified") { failed.push(v); continue; }
    if (!io.send) { ready.push(v); continue; }
    try {
      const waId = await io.send({ type: "document", mediaUrl: v.url!, fileName: `${v.project} Brochure.pdf`, text: `${v.project} — Brochure` });
      if (waId === null) failed.push({ ...v, status: "send_failed", detail: "the WhatsApp provider did not accept the document" });
      else sent.push({ ...v, wa_id: waId });
    } catch (e) {
      failed.push({ ...v, status: "send_failed", detail: e instanceof Error ? e.message : String(e) });
    }
  }
  const okRows = io.send ? sent : ready;
  if (!unique.length) failed.push({ project_ref: "", project: "", city: "", url: null, storage: "", file_type: null, status: "unknown_project", detail: "no project matched the request" });
  const outcome = !failed.length ? (io.send ? "brochure_sent" : "brochure_ready_not_sent") : okRows.length ? "brochure_partial" : "brochure_unavailable";
  const actions: MediaAction[] = okRows.map((r) => ({ type: "document", url: r.url!, caption: `${r.project} — Brochure`, kind: "brochure", project_ref: r.project_ref }));
  return { sent, ready, failed, outcome, handoff: failed.length > 0, actions,
    reply: deliveryText(lang, sent.map((r) => r.project), ready.map((r) => r.project), failed.map((r) => r.project)) };
}

function deliveryText(lang: Lang, sentNames: string[], ready: string[], failed: string[]): string {
  const named = failed.filter(Boolean);
  const many = (xs: string[]) => xs.length > 1;
  const T = {
    en: {
      sent: (n: string) => many(sentNames) ? `Here are the brochures for ${n}.` : `Here is the brochure for ${n}.`,
      ready: (n: string) => many(ready) ? `The brochures for ${n} are checked and ready to share.` : `The brochure for ${n} is checked and ready to share.`,
      failed: (n: string) => `${n ? `I could not get the brochure for ${n} right now. ` : "Some brochures are not available right now. "}One of our consultants will get back to you shortly.`,
    },
    banglish: {
      sent: (n: string) => `${n} er brochure eikhane.`,
      ready: (n: string) => `${n} er brochure check kora hoyeche, share korar jonno ready.`,
      failed: (n: string) => `${n ? `${n} er brochure ekhon pawa jachhe na. ` : "Kichu brochure ekhon pawa jachhe na. "}Amader ekjon consultant khub shiggiri apnar sathe jogajog korben.`,
    },
    bn: {
      sent: (n: string) => `${n}-এর ব্রোশিওর এখানে।`,
      ready: (n: string) => `${n}-এর ব্রোশিওর যাচাই করা হয়েছে, শেয়ার করার জন্য প্রস্তুত।`,
      failed: (n: string) => `${n ? `${n}-এর ব্রোশিওর এই মুহূর্তে পাওয়া যাচ্ছে না। ` : "কিছু ব্রোশিওর এই মুহূর্তে পাওয়া যাচ্ছে না। "}আমাদের একজন কনসালট্যান্ট শিগগিরই আপনার সাথে যোগাযোগ করবেন।`,
    },
  }[lang];
  return [sentNames.length && T.sent(list(sentNames, lang)), ready.length && T.ready(list(ready, lang)), failed.length && T.failed(list(named, lang))]
    .filter(Boolean).join(" ");
}

// ── the real file check ─────────────────────────────────────────────────────
// Range request for the first 1 KB, redirects followed by hand (at most 4) so
// every hop is checked: https only, and a host whose DNS answer is a private
// address is refused before it is fetched. Throws on any refusal or timeout.
// Residual risk, as in chatCompletion: fetch resolves the name again, so a
// host that changes its DNS answer in between (rebinding) can still reach a
// private address. Only the first 5 bytes are read and never returned, which
// bounds what such a request can learn; an egress proxy would close it.
type ProbeFetch = (url: string, init: { method: "GET"; headers: Record<string, string>; redirect: "manual"; signal: AbortSignal }) =>
  Promise<{ ok: boolean; status: number; headers: { get(k: string): string | null }; arrayBuffer(): Promise<ArrayBuffer> }>;
export function httpProbe(io: { fetch: ProbeFetch; resolve: (host: string) => Promise<string[]>; timeoutMs?: number }): Probe {
  return async (start) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), io.timeoutMs ?? 15_000);
    try {
      let url = start;
      for (let hop = 0; hop <= 4; hop++) {
        const bad = linkProblem(url);
        if (bad) throw new Error(`refused: ${bad === "local or private address" ? "private address" : bad}`);
        const addrs = await io.resolve(new URL(url).hostname);
        if (!addrs.length) throw new Error("the host has no address records");
        if (addrs.some(isBlockedAddress)) throw new Error("refused: the host resolves to a private address");
        const r = await io.fetch(url, { method: "GET", headers: { Range: "bytes=0-1023", "User-Agent": "WEPRO-brochure-check" }, redirect: "manual", signal: ctl.signal });
        const loc = r.headers.get("location");
        if (r.status >= 300 && r.status < 400 && loc) { url = new URL(loc, url).toString(); continue; }
        const head = new Uint8Array(await r.arrayBuffer()).slice(0, 8);
        const total = Number(/\/(\d+)$/.exec(r.headers.get("content-range") || "")?.[1] ?? r.headers.get("content-length") ?? 0);
        return { ok: r.ok, status: r.status, contentType: r.headers.get("content-type") || "", magic: new TextDecoder().decode(head.slice(0, 5)), bytes: total };
      }
      throw new Error("too many redirects");
    } catch (e) {
      if (ctl.signal.aborted) throw new Error("timeout");
      throw e;
    } finally {
      clearTimeout(timer);
    }
  };
}
