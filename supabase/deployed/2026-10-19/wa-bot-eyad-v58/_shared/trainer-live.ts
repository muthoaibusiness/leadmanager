// AI Trainer on a real WhatsApp chat, for test numbers only. Deno-free: the
// bots pass in real ports (trainer-live-deno.ts), the Node tests pass fakes.
//
// A bot calls runTestTurn only when its wa_bot_settings.trainer_test_mode is
// on (migration 0038) and the chat's number is in that bot's test_numbers.
// The turn runs trainer-core.runTurn over the current drafts, the same content
// and code as the Playground, and is logged to ai_turns. The reply goes out
// only when the recipient is still an allow-listed test number at send time.
// The bot pointers are not read: test mode never touches real customers.
import { CORE_VERSION, emptyState, freezeContent, checksumOf, runTurn, type Bot, type ConvState, type ItemRow, type Ports, type Turn } from "./trainer-core.ts";

// Last 10 digits: 8801XXXXXXXXX, 01XXXXXXXXX and +880 1XXX… all agree
// (the same rule as getBotSettings in wa.ts).
export const phoneKey = (v: unknown) => String(v ?? "").replace(/\D/g, "").slice(-10);
export const isTestNumber = (testNumbers: unknown, phone: unknown) => {
  const k = phoneKey(phone);
  return k.length === 10 && Array.isArray(testNumbers) && testNumbers.some((n) => phoneKey(n) === k);
};

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

// The current wa_bot_settings row, read again just before each send so a
// number removed from the list (or test mode switched off) mid-turn is honoured.
async function stillAllowed(ports: LivePorts, bot: Bot, phone: string, to: string): Promise<boolean> {
  const row = (await ports.select(`wa_bot_settings?bot=eq.${bot}&select=trainer_test_mode,test_numbers`))[0];
  return !!row && row.trainer_test_mode === true && isTestNumber(row.test_numbers, phone) && phoneKey(to) === phoneKey(phone);
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
    const { content, errors } = freezeContent(rows, { reply_model: a.replyModel, max_tokens: 600, rubric_version: 1 });
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
    const st = (await ports.select(`ai_conversation_state?conversation_id=eq.${encodeURIComponent(a.convId)}&select=*`))[0];
    const state: ConvState = { ...emptyState(), ...(st?.state || {}) };
    const r = await runTurn({ content, bot: a.bot, text: a.text, history: hist, state, ad: a.ad, returning: hist.length > 0, ports });
    await ports.upsert("ai_conversation_state", { conversation_id: a.convId, bot: a.bot, state: r.stateNext, paused: r.stateNext.paused, updated_at: new Date().toISOString() });
    let sent = 0; const waIds: string[] = []; const sendErrors: string[] = [];
    const out: { type: "text" | "image" | "document"; text: string; mediaUrl?: string; fileName?: string }[] = [];
    if (r.reply.trim()) out.push({ type: "text", text: r.reply });
    if (a.allowMedia) for (const m of r.media) out.push({ type: m.type, text: m.caption, mediaUrl: m.url, fileName: m.type === "document" ? `${m.caption}.pdf` : undefined });
    for (let i = 0; i < out.length; i++) {
      if (!(await stillAllowed(ports, a.bot, a.phone, a.to))) { sendErrors.push("recipient no longer allowed"); break; }
      const id = await ports.send(a.to, out[i]);
      if (id) { sent++; waIds.push(id); } else sendErrors.push(`send ${i + 1} failed`);
      // Wasender allows 1 message per 5s per session.
      if (i < out.length - 1) await ports.sleep(5500);
    }
    const outcome = sendErrors.length && !sent ? "send_failed" : r.outcome;
    await finish(outcome, { ...r.trace, handoff: r.handoff, reply: r.reply, media: r.media.map((m) => ({ kind: m.kind, url: m.url, floor: m.floor })), wa_ids: waIds, send_errors: sendErrors },
      { snapshot_checksum: checksum });
    return { outcome, turnId, sent };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await finish("error", { error: msg }).catch(() => {});
    return { outcome: "error", turnId, sent: 0, blocked: msg };
  }
}
