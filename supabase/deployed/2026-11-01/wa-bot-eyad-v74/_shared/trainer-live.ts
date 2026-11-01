// AI Trainer on a real WhatsApp chat, for test numbers only. Deno-free: the
// bots pass in real ports (trainer-live-deno.ts), the Node tests pass fakes.
//
// A bot calls runTestTurn only when its wa_bot_settings.trainer_test_mode is
// on (migration 0038) and the chat's number is in that bot's test_numbers.
// The turn runs trainer-core.runTurn over the current drafts, the same content
// and code as the Playground, and is logged to ai_turns. The reply goes out
// only when the recipient is still an allow-listed test number at send time.
// The bot pointers are not read: test mode never touches real customers.
import { normPhone, samePhone } from "./phone.ts";
import { REPLY_LIMITS } from "./trainer-model.ts";
import { withSystemPrompt } from "./trainer-prompt.ts";
import { CORE_VERSION, emptyState, freezeContent, checksumOf, runTurn, type Bot, type ConvState, type ItemRow, type Ports, type Turn } from "./trainer-core.ts";

// Full-number match (normPhone), the same rule as getBotSettings in wa.ts.
export const phoneKey = normPhone;
export const isTestNumber = (testNumbers: unknown, phone: unknown) =>
  Array.isArray(testNumbers) && testNumbers.some((n) => samePhone(n, phone));

// wa_messages rows, oldest first, as trainer turns. IN is the customer; an OUT
// row written by a bot path (AI Agent / AI Trainer) is the bot; any other OUT
// row is a human agent typing on the phone, so its commands (/t, /n, /f…,
// /send…) are dropped here and by buildHistory.
export const BOT_SENDERS = ["AI Agent", "AI Trainer"];
export function historyFromMessages(rows: { direction: string; body?: string | null; caption?: string | null; type?: string | null; sender_name?: string | null }[]): Turn[] {
  return rows.map((r): Turn => ({
    role: r.direction === "IN" ? "customer" : BOT_SENDERS.includes(String(r.sender_name || "")) ? "bot" : "agent",
    text: String((r.type || "text") === "text" ? r.body || "" : r.caption || ""),
  })).filter((t) => t.text.trim() && !(t.role === "agent" && t.text.trim().startsWith("/")));
}

export type LivePorts = Ports & {
  select(path: string): Promise<any[]>;
  insert(table: string, row: object): Promise<any>;
  patch(table: string, filter: string, patch: object): Promise<boolean>;
  upsert(table: string, row: object): Promise<boolean>;
  // Delivers through Wasender and mirrors into wa_messages. Returns the
  // Wasender message id, or null when the send failed.
  send(to: string, msg: { type: "text" | "image" | "document"; text: string; mediaUrl?: string; fileName?: string }): Promise<string | null>;
  sleep(ms: number): Promise<void>;
};

export type LiveInput = {
  bot: Bot; convId: string; phone: string; to: string; text: string;
  ad: { isAd: boolean; adText?: string }; replyModel: string; allowMedia: boolean;
};
export type LiveResult = { outcome: string; turnId: string | null; sent: number; blocked?: string };

// One memory row per customer and bot. A WhatsApp thread id can be the phone
// JID or a LID, so keying memory by thread would split one customer in two.
export const memoryKey = (bot: Bot, phone: unknown) => `${bot}:${normPhone(phone)}`;

async function loadState(ports: LivePorts, key: string, convId: string): Promise<any> {
  const own = (await ports.select(`ai_conversation_state?conversation_id=eq.${encodeURIComponent(key)}&select=*`))[0];
  return own ?? (await ports.select(`ai_conversation_state?conversation_id=eq.${encodeURIComponent(convId)}&select=*`))[0];
}

// Paused by a trainer handoff, or taken over by an agent's /t (preleads.takeover).
async function isPaused(ports: LivePorts, key: string, convId: string, phone: string): Promise<boolean> {
  const st = await loadState(ports, key, convId);
  if (st?.paused === true || st?.state?.paused === true) return true;
  // preleads.phone has no fixed format, so match a suffix, then the full number.
  const tail = normPhone(phone).slice(-10);
  if (!tail) return false;
  const leads = await ports.select(`preleads?phone=like.*${encodeURIComponent(tail)}&select=phone,takeover`);
  return leads.some((l) => samePhone(l.phone, phone) && (l.takeover === true || l.takeover === "true"));
}

// The current wa_bot_settings row, read again just before each send so a
// number removed from the list (or test mode switched off) mid-turn is honoured.
async function stillAllowed(ports: LivePorts, bot: Bot, phone: string, to: string): Promise<boolean> {
  const row = (await ports.select(`wa_bot_settings?bot=eq.${bot}&select=trainer_test_mode,test_numbers`))[0];
  return !!row && row.trainer_test_mode === true && isTestNumber(row.test_numbers, phone) && samePhone(to, phone);
}

export async function runTestTurn(a: LiveInput, ports: LivePorts): Promise<LiveResult> {
  let turnId: string | null = null;
  const finish = async (outcome: string, trace: Record<string, unknown>, extra: object = {}) => {
    if (turnId) await ports.patch("ai_turns", `id=eq.${encodeURIComponent(turnId)}`, { outcome, trace, finished_at: new Date().toISOString(), ...extra });
  };
  try {
    // No turn row, no reply: an unlogged send would be invisible on the Test numbers tab.
    const turn = await ports.insert("ai_turns", { bot: a.bot, conversation_id: a.convId, core_version: CORE_VERSION, model: a.replyModel, outcome: "running" });
    turnId = turn?.id ?? null;
    if (!turnId) throw new Error("could not log the turn");
    if (!(await stillAllowed(ports, a.bot, a.phone, a.to))) {
      await finish("blocked_not_test_number", { phone_key: phoneKey(a.phone) });
      return { outcome: "blocked_not_test_number", turnId, sent: 0, blocked: "not a test number" };
    }
    const rows = (await ports.select("ai_trainer_items?status=eq.active&select=*")) as ItemRow[];
    const frozen = freezeContent(rows, { reply_model: a.replyModel, max_tokens: REPLY_LIMITS.max_tokens, rubric_version: 1 });
    const errors = frozen.errors;
    // The bot's published System Prompt only (migration 0046); a draft never
    // reaches a WhatsApp chat, even a test number's.
    const ptr = (await ports.select(`ai_system_prompt_pointers?bot=eq.${a.bot}&company_id=eq.c1&select=prompt_id`).catch(() => []))[0];
    const sp = ptr?.prompt_id ? (await ports.select(`ai_system_prompts?id=eq.${encodeURIComponent(ptr.prompt_id)}&status=eq.published&select=id,version_no,sha256,body`).catch(() => []))[0] : null;
    const content = withSystemPrompt(frozen.content, sp ? { [a.bot]: sp } : {});
    const checksum = await checksumOf(content);
    if (errors.length) {
      await finish("blocked_draft_errors", { errors }, { snapshot_checksum: checksum });
      return { outcome: "blocked_draft_errors", turnId, sent: 0, blocked: "drafts have errors" };
    }
    // History excludes the message being answered: wa-webhook may already have
    // mirrored it, and it reaches the model separately as the customer message.
    const msgs = await ports.select(`wa_messages?conversation_id=eq.${encodeURIComponent(a.convId)}&select=direction,body,caption,type,sender_name,wa_timestamp&order=wa_timestamp.desc&limit=21`);
    const hist = historyFromMessages(msgs.reverse());
    const last = hist.at(-1);
    if (last && last.role === "customer" && last.text.trim() === a.text.trim()) hist.pop();
    const key = memoryKey(a.bot, a.phone);
    if (await isPaused(ports, key, a.convId, a.phone)) {
      await finish("skipped_paused", { memory_key: key }, { snapshot_checksum: checksum });
      return { outcome: "skipped_paused", turnId, sent: 0, blocked: "conversation is paused" };
    }
    const st = await loadState(ports, key, a.convId);
    const state: ConvState = { ...emptyState(), ...(st?.state || {}) };
    let sent = 0; const waIds: string[] = []; const sendErrors: string[] = [];
    // Brochures go out inside the turn, through the checked path, under the
    // same allow-list and pause checks as every other send. With media off
    // there is no sender, so files are checked and the reply says "ready".
    const sendDocument = a.allowMedia ? async (m: { type: "document"; text: string; mediaUrl: string; fileName: string }) => {
      if (!(await stillAllowed(ports, a.bot, a.phone, a.to))) { sendErrors.push("recipient no longer allowed"); return null; }
      if (await isPaused(ports, key, a.convId, a.phone)) { sendErrors.push("paused during the turn"); return null; }
      if (sent) await ports.sleep(5500);
      const id = await ports.send(a.to, m);
      if (id) { sent++; waIds.push(id); } else sendErrors.push(`send ${sent + sendErrors.length + 1} failed`);
      return id;
    } : undefined;
    const r = await runTurn({ content, bot: a.bot, text: a.text, history: hist, state, ad: a.ad, returning: hist.length > 0 || !!st, ports: { ...ports, sendDocument } });
    // An unlisted recipient stops the turn: no reply goes out after a refused
    // document, and the conversation is not paused for a handoff nobody saw.
    const stopped = sendErrors.includes("recipient no longer allowed");
    const stateNext = stopped ? state : r.stateNext;
    await ports.upsert("ai_conversation_state", { conversation_id: key, bot: a.bot, state: stateNext, paused: stateNext.paused, updated_at: new Date().toISOString() });
    const out: { type: "text" | "image" | "document"; text: string; mediaUrl?: string; fileName?: string }[] = [];
    if (r.reply.trim() && !stopped) out.push({ type: "text", text: r.reply });
    // Brochures were already sent by the brochure path; only images remain here.
    if (a.allowMedia && !stopped) for (const m of r.media) if (m.kind !== "brochure") out.push({ type: m.type, text: m.caption, mediaUrl: m.url, fileName: m.type === "document" ? `${m.caption}.pdf` : undefined });
    for (let i = 0; i < out.length; i++) {
      if (!(await stillAllowed(ports, a.bot, a.phone, a.to))) { sendErrors.push("recipient no longer allowed"); break; }
      if (await isPaused(ports, key, a.convId, a.phone) && !r.handoff) { sendErrors.push("paused during the turn"); break; }
      // Wasender allows 1 message per 5s per session.
      if (sent) await ports.sleep(5500);
      const id = await ports.send(a.to, out[i]);
      if (id) { sent++; waIds.push(id); } else sendErrors.push(`send ${i + 1} failed`);
    }
    // The turn's outcome is what reached the customer; the brochure path's own
    // verdict (which files were checked and sent) is kept beside it.
    const outcome = sendErrors.length ? (sent ? "send_partial" : "send_failed") : r.outcome;
    const brochure = String(r.outcome).startsWith("brochure_") ? { brochure_outcome: r.outcome } : {};
    await finish(outcome, { ...r.trace, ...brochure, handoff: r.handoff, reply: r.reply, media: r.media.map((m) => ({ kind: m.kind, url: m.url, floor: m.floor })), wa_ids: waIds, send_errors: sendErrors },
      { snapshot_checksum: checksum });
    return { outcome, turnId, sent };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await finish("error", { error: msg }).catch(() => {});
    return { outcome: "error", turnId, sent: 0, blocked: msg };
  }
}
