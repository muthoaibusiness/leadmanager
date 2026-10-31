// The operator's System Prompt (migration 0046), one per bot. Deno-free.
// It is carried in the frozen content so a snapshot pins it, and buildPrompt
// places it after the platform's safety lines and before rules, knowledge,
// live stock and conversation state; the output contract comes last.
import type { Bot, SnapshotContent } from "./trainer-core.ts";

export type SystemPrompt = { id: string; version_no: number; sha256: string; body: string };

export const promptLimits = { maxChars: 12000 } as const;

// Characters and a rough token count (about 4 characters per token for Latin
// text, about 2 for Bangla), for the editor only; nothing is cut by it.
export function promptStats(body: string): { chars: number; tokens: number } {
  const s = String(body || "");
  if (!s) return { chars: 0, tokens: 0 };
  const bangla = [...s].filter((c) => /[ঀ-৿]/.test(c)).length;
  return { chars: [...s].length, tokens: Math.ceil((s.length - bangla) / 4 + bangla / 2) };
}

export function withSystemPrompt(c: SnapshotContent, prompts: Partial<Record<Bot, SystemPrompt>>): SnapshotContent {
  const clean = Object.fromEntries(Object.entries(prompts).filter(([, p]) => p && p.body?.trim())) as Partial<Record<Bot, SystemPrompt>>;
  return Object.keys(clean).length ? { ...c, system_prompts: clean } : c;
}

export const promptRef = (p: SystemPrompt | undefined) => (p ? { id: p.id, version_no: p.version_no, sha256: p.sha256 } : null);
