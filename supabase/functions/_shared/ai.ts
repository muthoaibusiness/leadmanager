// OpenRouter-backed FAQ agent for the WhatsApp bots. Answers general
// questions about WECON's projects (short text, matching the existing
// template messages' tone — see welcomeText/assignedText in each bot) and can
// ask the bot to follow up with a photo, floor plan, or brochure.
//
// Deploy: npx supabase secrets set OPENROUTER_API_KEY=...
// Optional: npx supabase secrets set OPENROUTER_MODEL=anthropic/claude-sonnet-5.5
//   (switches the model without a redeploy; unset = Haiku default below)
//
// Kept deliberately separate from wa.ts: this file is "what the model says",
// wa.ts is "how a message physically gets delivered and mirrored".

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
// Cheap, fast, good at following a strict-JSON instruction. Override with the
// OPENROUTER_MODEL secret for a different quality/cost balance — read per
// request, so a secret change takes effect without redeploying.
const DEFAULT_MODEL = "anthropic/claude-haiku-5.5";
const model = () => Deno.env.get("OPENROUTER_MODEL")?.trim() || DEFAULT_MODEL;

// Cleans up an agent's /n note or a /f* forward note before it lands in the
// CRM activity log — grammar/spelling only, never a rewrite. Falls back to
// the original text verbatim on any failure (an uncorrected note beats a
// lost one).
export async function fixGrammar(text: string): Promise<string> {
  const raw = text.trim();
  if (!raw) return raw;
  const apiKey = Deno.env.get("OPENROUTER_API_KEY") ?? "";
  if (!apiKey) return raw;
  try {
    const res = await fetch(OPENROUTER_URL, {
      signal: AbortSignal.timeout(30_000),
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://wepro.app",
        "X-Title": "WEPRO WhatsApp Agent",
      },
      body: JSON.stringify({
        model: model(),
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "Fix only grammar and spelling mistakes in the text the user sends. " +
              "Keep the same language (Bengali, English, or Banglish/transliterated Bengali — never translate between them), " +
              "the same meaning, and the same tone. Output ONLY the corrected text — no quotes, no explanation, no extra commentary.",
          },
          { role: "user", content: raw },
        ],
      }),
    });
    if (!res.ok) {
      console.error("fixGrammar: OpenRouter error", res.status, await res.text());
      return raw;
    }
    const body = await res.json();
    const fixed = String(body?.choices?.[0]?.message?.content ?? "").trim();
    return fixed || raw;
  } catch (e) {
    console.error("fixGrammar: request failed", e);
    return raw;
  }
}

export interface ProjectRow {
  name: string;
  keywords?: string[];
  region?: string;
  nature?: string;
  sft?: string;
  address?: string;
  office_address?: string;
  brochure_url?: string;
  photos?: string[];
  floor_plans?: string[];
  floor_plan_labels?: string[];
  video_url?: string;
  google_map_url?: string;
  map_image_url?: string;
}

export interface AgentReply {
  reply: string;
  send: { type: "photo" | "floorplan" | "brochure" | "map"; project: string; floor?: string } | null;
  // false = the model could not ground the answer in the catalog/rules.
  // Callers treat that as "say nothing" — silence beats a wrong answer.
  confident: boolean;
}

function projectsBlock(projects: ProjectRow[]): string {
  return projects
    .map((p) => {
      const bits = [
        p.region && `region: ${p.region}`,
        p.nature && `type: ${p.nature}`,
        p.sft && `size: ${p.sft} sft`,
        p.address && `address: ${p.address}`,
        p.office_address && `WECON office for this project: ${p.office_address}`,
        p.keywords?.length && `keywords: ${p.keywords.join(", ")}`,
      ].filter(Boolean);
      const media = [
        p.photos?.length && "photo available",
        p.floor_plan_labels?.length ? `floor plans available: ${p.floor_plan_labels.join(", ")}` : p.floor_plans?.length && "floor plan available",
        p.brochure_url && "brochure available",
      ].filter(Boolean);
      return `- ${p.name} (${bits.join(" · ")})${media.length ? ` [${media.join(", ")}]` : ""}`;
    })
    .join("\n");
}

function knowledgeBlock(knowledge: { title: string; body: string }[]): string {
  if (!knowledge.length) return "";
  return `\nAdditional knowledge & rules (admin-managed — follow these exactly,
they override any general instinct you'd otherwise have):
${knowledge.map((k) => `- ${k.title}: ${k.body}`).join("\n")}\n`;
}

function correctionsBlock(corrections: { customer_message: string; corrected_reply: string }[]): string {
  if (!corrections.length) return "";
  return `\nPast mistakes an admin corrected — match this pattern whenever a
similar question comes up again, instead of repeating the original mistake:
${corrections.map((c) => `- Customer asked: "${c.customer_message}" → correct reply: "${c.corrected_reply}"`).join("\n")}\n`;
}

const SYSTEM_PROMPT = (
  projects: ProjectRow[],
  adProject: string | undefined,
  knowledge: { title: string; body: string }[],
  corrections: { customer_message: string; corrected_reply: string }[],
) => `You are a WECON Properties WhatsApp assistant. You answer customer
questions about WECON's own real-estate projects ONLY, using the catalog
below — never invent a project, price, or fact that isn't in it.

Projects:
${projectsBlock(projects)}
${adProject ? `\nThis customer came in through an ad for: ${adProject}. Every answer stays about THIS project — don't bring up, compare to, or suggest another one on your own. Only discuss a different project if the customer names it themselves; after that, treat the one they just named as "their" project instead. Whenever they say "this project" or don't name one, it means ${adProject} (or whichever project they most recently named).\n` : ""}
Reply style (match the brand's existing WhatsApp templates):
- Short. A few sentences at most — this is a chat, not an email.
- Friendly, direct. No emoji at all.
- Reply in the same language the customer used (Bengali or English).
- If the customer is just greeting / small talk with no real question,
  reply with an empty string — a separate welcome message already covers that.
- If the customer asks for or clearly wants a photo, floor plan, or
  brochure, say so briefly AND set "send" so it's attached — don't just
  describe the document in text.
- A project with "floor plans available: <list>" has a separate image per
  floor. If the customer names a floor (ground, mezzanine, typical, roof —
  or the Bengali/transliterated equivalent), set "floor" to that exact label
  from the list. If they ask for all of them / every floor (e.g. "shob
  floor plan dao"), set "floor" to "all" — every image is sent. If they ask
  for "the floor plan" without naming one and without asking for all, ask
  briefly which floor they want instead of guessing (don't set "send" yet).
${knowledgeBlock(knowledge)}${correctionsBlock(corrections)}
HARD LIMITS — these matter more than being helpful:
- Answer ONLY what the catalog above or the admin rules state outright. If
  the answer is not literally there (price per sft, payment plan, discounts,
  availability, handover date, loan terms, legal/land questions, anything
  else), set "confident": false and "reply": "". Do NOT guess, estimate,
  generalise, or say a consultant will follow up — SAY NOTHING. A human
  reads every silent thread and answers; a wrong number from you cannot be
  taken back.
- Never announce or promise an action: no "setting up a meeting", "assigning
  an agent", "someone will call you", "I'll arrange", "I've noted". You
  cannot do any of those. If the customer asks for a call, meeting, visit
  or an agent, "confident": false, "reply": "".
- Never repeat yourself unprompted: don't re-send a document already in
  the history, and don't restate something the customer didn't ask about
  again. But if the customer asks the same question again, answer it again
  — briefly — a repeated question is a request, not a repeat by you.
- "confident": true ONLY when every statement in "reply" can be pointed to
  a line in the catalog or the admin rules. An admin rule that tells you
  what to say for a question (e.g. a price range to give once) IS grounded
  knowledge — follow it and set "confident": true; the silence rule above
  is for questions no catalog line and no admin rule covers.

Respond with STRICT JSON only, no markdown fences, exactly this shape:
{"confident": true|false, "reply": "<short text, or \\"\\" for no reply>", "send": null | {"type": "photo"|"floorplan"|"brochure"|"map", "project": "<exact project name from the catalog>", "floor": "<exact label from floor_plan_labels, only for type floorplan on a project that has labels>"}}`;

function extractJson(raw: string): AgentReply | null {
  const text = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  // The model sometimes wraps the JSON in a stray sentence or repeats itself
  // — parsing the whole string fails even though a valid object is in there.
  // Pull out the outermost {...} span and parse just that.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    if (typeof parsed?.reply === "string") {
      // A missing "confident" counts as not confident — the gate fails closed.
      return { reply: parsed.reply, send: parsed.send ?? null, confident: parsed.confident === true };
    }
  } catch { /* fall through */ }
  return null;
}

export async function askAgent(
  history: { role: "user" | "assistant"; text: string }[],
  userText: string,
  projects: ProjectRow[],
  adProject?: string,
  knowledge: { title: string; body: string }[] = [],
  corrections: { customer_message: string; corrected_reply: string }[] = [],
): Promise<AgentReply> {
  const apiKey = Deno.env.get("OPENROUTER_API_KEY") ?? "";
  if (!apiKey) {
    console.error("askAgent: OPENROUTER_API_KEY not configured");
    return { reply: "", send: null, confident: false };
  }

  const messages = [
    { role: "system", content: SYSTEM_PROMPT(projects, adProject, knowledge, corrections) },
    ...history.map((h) => ({ role: h.role, content: h.text })),
    { role: "user", content: userText },
  ];

  try {
    const res = await fetch(OPENROUTER_URL, {
      signal: AbortSignal.timeout(30_000),
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://wepro.app",
        "X-Title": "WEPRO WhatsApp Agent",
      },
      body: JSON.stringify({ model: model(), messages, temperature: 0.2 }),
    });
    if (!res.ok) {
      console.error("askAgent: OpenRouter error", res.status, await res.text());
      return { reply: "", send: null, confident: false };
    }
    const body = await res.json();
    const content = String(body?.choices?.[0]?.message?.content ?? "");
    const parsed = extractJson(content);
    if (!parsed) {
      // The prompt insists on strict JSON — a parse failure means the model
      // went off-script. Log it, but never forward unparsed content (it may
      // be raw JSON or a stray preamble, not something to show a customer).
      console.error("askAgent: could not extract JSON from model output", content.slice(0, 500));
      return { reply: "", send: null, confident: false };
    }
    // One line per decision so a silent thread can be audited from the logs.
    console.log("askAgent", { confident: parsed.confident, reply: parsed.reply.slice(0, 120), send: parsed.send });
    return parsed;
  } catch (e) {
    console.error("askAgent: request failed", e);
    return { reply: "", send: null, confident: false };
  }
}

export interface ResolvedMedia {
  type: "image" | "document";
  url: string;
  fileName?: string;
  caption: string;
}

// These three Jolshiri projects are commonly asked about interchangeably, so
// a customer naming any one of them gets all three brochures bundled with a
// single explanatory line, instead of the model picking just the one it
// matched. Deliberately code, not a wa_knowledge rule — it needs to send
// three documents in one turn, which AgentReply.send (one project at a time)
// can't express.
const JOLSHIRI_BUNDLE_NAMES = ["Wecon Osman Bellevue", "Wecon Nuznan", "Wecon Dakshinayan"];
const JOLSHIRI_BUNDLE_MESSAGE =
  "জলসিঁড়িতে আমাদের ৩টি প্রজেক্ট আছে। আপনার সুবিধার্থে আমি ৩টি প্রজেক্টের ব্রোশিওর শেয়ার করলাম।";

// wa-followup stage copy (see FLOW.md-equivalent summary in that function's
// header comment). Exported so both bots' inbound handler (stage 3's "yes"
// path) and the follow-up cron job (stages 2a/2b/4) use identical wording.
export const FLOW_ASK_PROFILE_TEXT =
  "জলসিঁড়িতে আমাদের ৩টি প্রজেক্ট আছে। আপনার সুবিধার্থে আমি ৩টি প্রজেক্টের ব্রোশিওর শেয়ার করে রাখবো?";
export const FLOW_AUTO_PROFILE_TEXT =
  "জলসিঁড়িতে আমাদের ৩টি প্রজেক্ট আছে। আপনার সুবিধার্থে আমি ৩টি প্রজেক্টের ব্রোশিওর শেয়ার করে রাখলাম।";
export const FLOW_ASK_AGENT_TEXT =
  "আপনার জন্য কি একজন ডেডিকেটেড এজেন্ট নিয়োগ করে দিব, যিনি সরাসরি কল করে আপনাকে সহায়তা করবেন?";
// "yes" to the agent question: acknowledge and hand the thread to a human —
// no lead/forward is created automatically (user's rule).
export const FLOW_AGENT_YES_TEXT = "জি, বলুন কিভাবে হেল্প করতে পারি।";
// A direct knock with no ad behind it: nothing is known about what they
// want, so no Jolshiri line and no Jolshiri follow-up flow — just this.
export const GENERIC_WELCOME_TEXT = "Assalamu Alaikum.\nI'm Eyad from Wecon Properties. How can I help you today?";

// Loose yes/no detector for the stage-3 "do you want the profile?" reply —
// Bangla, Banglish and English all show up in real chats.
// A "yes" is a SHORT message made of yes-words — "পেমেন্ট প্ল্যান জানতে চাই"
// contains চাই but is a question, not consent, and once got the agent ack
// by mistake. So: strip punctuation, cap at 4 words, and every word must be
// on the list. Two lists because `\b` is ASCII-only in JS and never matches
// at the edge of a Bangla word.
const YES_WORDS = new Set([
  "hae", "ha", "haan", "ji", "jee", "jii", "hmm", "hm", "ok", "okay", "oky", "sure", "yes", "yeah", "yep", "please", "pls", "plz",
  "dao", "den", "dibo", "din", "accha", "acha", "thik", "ache",
  "জি", "জ্বি", "জ্বী", "হ্যাঁ", "হ্যা", "হুম", "আচ্ছা", "ঠিক", "আছে", "দিন", "দেন", "দাও", "পাঠান", "পাঠাও", "প্লিজ", "প্লীজ", "ওকে",
]);
export const isAffirmative = (text: string): boolean => {
  // \p{M} keeps Bangla vowel signs / virama ("জি" is জ + ি) — without it the
  // word collapses to "জ" and never matches.
  const words = text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 4) return false;
  return words.every((w) => YES_WORDS.has(w));
};

export interface JolshiriBundle {
  message: string;
  brochures: { project: ProjectRow; url: string }[];
}

function jolshiriBundleProjects(projects: ProjectRow[]): ProjectRow[] | null {
  const bundleProjects = JOLSHIRI_BUNDLE_NAMES
    .map((n) => projects.find((p) => p.name.toLowerCase() === n.toLowerCase()))
    .filter((p): p is ProjectRow => !!p);
  return bundleProjects.length === JOLSHIRI_BUNDLE_NAMES.length ? bundleProjects : null;
}

// Returns the bundle (message + brochure URLs) when the customer's text
// names one of the three projects, or null when none matched / the catalog
// doesn't have all three seeded yet (fail safe — falls through to the
// normal single-project flow).
export function matchJolshiriBundle(text: string, projects: ProjectRow[]): JolshiriBundle | null {
  const bundleProjects = jolshiriBundleProjects(projects);
  if (!bundleProjects) return null;

  const lower = text.toLowerCase();
  const hit = bundleProjects.some(
    (p) => lower.includes(p.name.toLowerCase()) || (p.keywords || []).some((k) => lower.includes(k.toLowerCase())),
  );
  if (!hit) return null;

  const brochures = bundleProjects.filter((p) => p.brochure_url).map((p) => ({ project: p, url: p.brochure_url! }));
  return brochures.length ? { message: JOLSHIRI_BUNDLE_MESSAGE, brochures } : null;
}

// Unconditional variant for the post-greeting follow-up flow (wa-followup):
// no text to match against, just "give me the bundle with this message" —
// used for the stage 2b auto-send and the stage 3 "yes" confirmation, each
// with their own wording.
export function buildJolshiriBundle(projects: ProjectRow[], message: string): JolshiriBundle | null {
  const bundleProjects = jolshiriBundleProjects(projects);
  if (!bundleProjects) return null;
  const brochures = bundleProjects.filter((p) => p.brochure_url).map((p) => ({ project: p, url: p.brochure_url! }));
  return brochures.length ? { message, brochures } : null;
}

// Resolve the model's chosen media into one or more actual catalog URLs.
// floor:"all" (or no floor named when the customer asked for "all floors")
// returns every floor plan image for that project instead of just one.
export function resolveMedia(
  send: { type: "photo" | "floorplan" | "brochure" | "map"; project: string; floor?: string },
  projects: ProjectRow[],
): ResolvedMedia[] {
  // The model (or the customer's own shorthand it echoed back, e.g. "Nuznan"
  // for catalog name "Wecon Nuznan") doesn't always return the exact catalog
  // string — match loosely in both directions, plus keywords, before giving up.
  const want = send.project.toLowerCase().trim();
  const p =
    projects.find((x) => x.name.toLowerCase() === want) ??
    projects.find((x) => x.name.toLowerCase().includes(want) || want.includes(x.name.toLowerCase())) ??
    projects.find((x) => (x.keywords || []).some((k) => want.includes(k.toLowerCase()) || k.toLowerCase().includes(want)));
  if (!p) return [];

  if (send.type === "photo") {
    const url = p.photos?.[0];
    return url ? [{ type: "image", url, caption: p.name }] : [];
  }

  if (send.type === "map") {
    const url = p.map_image_url;
    return url ? [{ type: "image", url, caption: `${p.name} — Location Map` }] : [];
  }

  if (send.type === "floorplan") {
    const plans = p.floor_plans || [];
    const labels = p.floor_plan_labels || [];
    const wantAll = /^(all|every|sob|shob|shb)$/i.test((send.floor || "").trim());
    if (wantAll) {
      return plans
        .map((url, i) => ({ type: "image" as const, url, caption: `${p.name} — ${labels[i] || `Floor Plan ${i + 1}`} Plan` }))
        .filter((m) => m.url);
    }
    let idx = 0;
    let label = labels[0] ?? "";
    if (send.floor && labels.length) {
      const wantFloor = send.floor.toLowerCase().trim();
      const found = labels.findIndex(
        (l) => l.toLowerCase() === wantFloor || l.toLowerCase().includes(wantFloor) || wantFloor.includes(l.toLowerCase()),
      );
      if (found !== -1) { idx = found; label = labels[found]; }
    }
    const url = plans[idx];
    const caption = label ? `${p.name} — ${label} Plan` : `${p.name} — Floor Plan`;
    return url ? [{ type: "image", url, caption }] : [];
  }

  const url = p.brochure_url;
  return url ? [{ type: "document", url, fileName: `${p.name.replace(/\s+/g, "-")}-brochure.pdf`, caption: `${p.name} — Brochure` }] : [];
}
