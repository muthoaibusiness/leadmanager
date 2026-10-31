// Decision tools the reply model may propose. Deno-free. The model never acts:
// it names a tool, this module validates it, and only a sink that passes an
// executor runs it, once per (turn, tool). Playground and test runs pass none.
import type { Bot } from "./trainer-core.ts";

export type ToolCall =
  | { tool: "qualify_lead"; args: { budget_band?: string; area?: string; size_sqft?: number; purpose?: string } }
  | { tool: "add_note"; args: { text: string } }
  | { tool: "forward_to_agent"; args: { command: string; reason: string } }
  | { tool: "handover"; args: { reason: string } };
export type ToolCtx = { bot: Bot; paused: boolean; turnId: string; phone: string };
export type ToolResult = { tool: string; status: "done" | "duplicate" | "refused" | "proposed" | "failed"; errors?: string[]; error?: string };
export type ToolExecutor = { claim(key: string): Promise<boolean>; run(c: ToolCall, ctx: ToolCtx): Promise<{ ok: boolean }> };

// The agent forward commands (wa_create_lead resolves the agent). Kept in step
// with scripts/command-compat/fixtures.ts by a test.
export const FORWARD_COMMANDS = new Set(["/fdh", "/faz", "/fmj", "/fk", "/fl", "/fctg", "/fm", "/fs", "/fmr", "/fh",
  "/fsn", "/fcml", "/fdp", "/fkl", "/fdu", "/fmkt", "/frahat"]);
const TOOLS = new Set(["qualify_lead", "add_note", "forward_to_agent", "handover"]);
const QUALIFY = new Set(["budget_band", "area", "size_sqft", "purpose"]);
const shortText = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max;

export function validateToolCall(c: ToolCall, ctx: ToolCtx): string[] {
  const e: string[] = [];
  const args: any = c?.args && typeof c.args === "object" ? c.args : null;
  if (!c || !TOOLS.has(c.tool)) return ["unknown tool"];
  if (!args) return ["args must be an object"];
  if (ctx.paused && c.tool !== "handover") return ["conversation is paused"];
  switch (c.tool) {
    case "qualify_lead":
      for (const k of Object.keys(args)) if (!QUALIFY.has(k)) e.push(`unknown field ${k}`);
      for (const k of ["budget_band", "area", "purpose"]) if (k in args && !shortText(args[k], 80)) e.push(`${k} must be 1-80 characters`);
      if ("size_sqft" in args && !(Number.isFinite(args.size_sqft) && args.size_sqft > 0 && args.size_sqft < 100000)) e.push("size_sqft out of range");
      if (!Object.keys(args).length) e.push("no fields");
      break;
    case "add_note": if (!shortText(args.text, 500)) e.push("text must be 1-500 characters"); break;
    case "forward_to_agent":
      if (!FORWARD_COMMANDS.has(args.command)) e.push("unknown forward command");
      if (!shortText(args.reason, 200)) e.push("reason must be 1-200 characters");
      break;
    case "handover": if (!shortText(args.reason, 200)) e.push("reason must be 1-200 characters"); break;
  }
  return e;
}

export async function runToolCalls(calls: ToolCall[], ctx: ToolCtx, exec: ToolExecutor | null): Promise<ToolResult[]> {
  const out: ToolResult[] = [];
  for (const c of calls) {
    const errors = validateToolCall(c, ctx);
    if (errors.length) { out.push({ tool: String(c?.tool), status: "refused", errors }); continue; }
    if (!exec) { out.push({ tool: c.tool, status: "proposed" }); continue; }
    try {
      if (!(await exec.claim(`${ctx.turnId}:${c.tool}`))) { out.push({ tool: c.tool, status: "duplicate" }); continue; }
      const r = await exec.run(c, ctx);
      out.push({ tool: c.tool, status: r.ok ? "done" : "failed" });
    } catch (e) {
      out.push({ tool: c.tool, status: "failed", error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}
