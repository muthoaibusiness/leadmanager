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
  video_url?: string;
  google_map_url?: string;
}

export interface AgentReply {
  reply: string;
  send: { type: "photo" | "floorplan" | "brochure"; project: string } | null;
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
        p.floor_plans?.length && "floor plan available",
        p.brochure_url && "brochure available",
      ].filter(Boolean);
      return `- ${p.name} (${bits.join(" · ")})${media.length ? ` [${media.join(", ")}]` : ""}`;
    })
    .join("\n");
}

const SYSTEM_PROMPT = (projects: ProjectRow[]) => `You are a WECON Properties WhatsApp assistant. You answer customer
questions about WECON's own real-estate projects ONLY, using the catalog
below — never invent a project, price, or fact that isn't in it.

Projects:
${projectsBlock(projects)}

Reply style (match the brand's existing WhatsApp templates):
- Short. A few sentences at most — this is a chat, not an email.
- Friendly, direct. No emoji at all.
- Reply in the same language the customer used (Bengali or English).
- If the customer is just greeting / small talk with no real question,
  reply with an empty string — a separate welcome message already covers that.
- If the customer asks for or clearly wants a photo, floor plan, or
  brochure, say so briefly AND set "send" so it's attached — don't just
  describe the document in text.
- If a question isn't about a WECON project (or needs info not in the
  catalog, e.g. exact price, availability, booking), say briefly that a
  sales consultant will follow up with those details — never guess.

Respond with STRICT JSON only, no markdown fences, exactly this shape:
{"reply": "<short text, or \\"\\" for no reply needed>", "send": null | {"type": "photo"|"floorplan"|"brochure", "project": "<exact project name from the catalog>"}}`;

function extractJson(raw: string): AgentReply | null {
  const text = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    const parsed = JSON.parse(text);
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
): Promise<AgentReply> {
  const apiKey = Deno.env.get("OPENROUTER_API_KEY") ?? "";
  if (!apiKey) {
    console.error("askAgent: OPENROUTER_API_KEY not configured");
    return { reply: "", send: null };
  }

  const messages = [
    { role: "system", content: SYSTEM_PROMPT(projects) },
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
    return extractJson(content) ?? { reply: content.trim(), send: null };
  } catch (e) {
    console.error("askAgent: request failed", e);
    return { reply: "", send: null };
  }
}

// Resolve the model's chosen media type into an actual URL from the catalog.
export function resolveMedia(
  send: { type: "photo" | "floorplan" | "brochure"; project: string },
  projects: ProjectRow[],
): { type: "image" | "document"; url: string; fileName?: string } | null {
  const p = projects.find((x) => x.name.toLowerCase() === send.project.toLowerCase());
  if (!p) return null;
  if (send.type === "photo") {
    const url = p.photos?.[0];
    return url ? { type: "image", url } : null;
  }
  if (send.type === "floorplan") {
    const url = p.floor_plans?.[0];
    return url ? { type: "image", url } : null;
  }
  const url = p.brochure_url;
  return url ? { type: "document", url, fileName: `${p.name.replace(/\s+/g, "-")}-brochure.pdf` } : null;
}
