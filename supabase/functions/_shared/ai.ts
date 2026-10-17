// OpenRouter-backed FAQ agent for the WhatsApp bots. Answers general
// questions about WECON's projects (short text, matching the existing
// template messages' tone — see welcomeText/assignedText in each bot) and can
// ask the bot to follow up with a photo, floor plan, or brochure.
//
// Deploy: npx supabase secrets set OPENROUTER_API_KEY=...
//
// Kept deliberately separate from wa.ts: this file is "what the model says",
// wa.ts is "how a message physically gets delivered and mirrored".

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
// Cheap, fast, good at following a strict-JSON instruction. Swap here if a
// different quality/cost balance is wanted — nothing else needs to change.
const MODEL = "anthropic/claude-haiku-5.5";

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
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://wepro.app",
        "X-Title": "WEPRO WhatsApp Agent",
      },
      body: JSON.stringify({
        model: MODEL,
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
}

function projectsBlock(projects: ProjectRow[]): string {
  return projects
    .map((p) => {
      const bits = [
        p.region && `region: ${p.region}`,
        p.nature && `type: ${p.nature}`,
        p.sft && `size: ${p.sft} sft`,
        p.address && `address: ${p.address}`,
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
- For anything not covered by the catalog or the rules below, say briefly
  that a sales consultant will follow up with those details — never guess.
${knowledgeBlock(knowledge)}${correctionsBlock(corrections)}
Never deflect with a bare refusal and stop there — things like "ami ekhane
bolte parbo na", "seta ami confirm korte parbo na", "I can't tell you that
here", "I can't discuss this": every one of those gaps always ends in one of
the scripted replies above — never a plain no with nothing after it.

Respond with STRICT JSON only, no markdown fences, exactly this shape:
{"reply": "<short text, or \\"\\" for no reply needed>", "send": null | {"type": "photo"|"floorplan"|"brochure"|"map", "project": "<exact project name from the catalog>", "floor": "<exact label from floor_plan_labels, only for type floorplan on a project that has labels>"}}`;

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
      return { reply: parsed.reply, send: parsed.send ?? null };
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
    return { reply: "", send: null };
  }

  const messages = [
    { role: "system", content: SYSTEM_PROMPT(projects, adProject, knowledge, corrections) },
    ...history.map((h) => ({ role: h.role, content: h.text })),
    { role: "user", content: userText },
  ];

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://wepro.app",
        "X-Title": "WEPRO WhatsApp Agent",
      },
      body: JSON.stringify({ model: MODEL, messages, temperature: 0.4 }),
    });
    if (!res.ok) {
      console.error("askAgent: OpenRouter error", res.status, await res.text());
      return { reply: "", send: null };
    }
    const body = await res.json();
    const content = String(body?.choices?.[0]?.message?.content ?? "");
    const parsed = extractJson(content);
    if (!parsed) {
      // The prompt insists on strict JSON — a parse failure means the model
      // went off-script. Log it, but never forward unparsed content (it may
      // be raw JSON or a stray preamble, not something to show a customer).
      console.error("askAgent: could not extract JSON from model output", content.slice(0, 500));
      return { reply: "", send: null };
    }
    return parsed;
  } catch (e) {
    console.error("askAgent: request failed", e);
    return { reply: "", send: null };
  }
}

export interface ResolvedMedia {
  type: "image" | "document";
  url: string;
  fileName?: string;
  caption: string;
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
