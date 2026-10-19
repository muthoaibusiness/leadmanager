// A customer's past conversation, rebuilt from the CRM's own wa_messages.
// Read-only and Deno-free. The provider is not a source: Wasender's
// message-logs endpoint returns only messages sent through its API.
import { normPhone, samePhone } from "./phone.ts";
import { historyFromMessages } from "./trainer-live.ts";
import type { Bot, Turn } from "./trainer-core.ts";

export type Backfill = { status: "ok" | "none" | "unavailable"; turns: Turn[]; threads: string[]; duplicates: number; error?: string };

export async function backfillCustomer(
  db: { select(path: string): Promise<any[]> },
  a: { bot: Bot; phone: string; pageSize?: number; maxTurns?: number },
): Promise<Backfill> {
  const pageSize = a.pageSize ?? 200; const maxTurns = a.maxTurns ?? 200;
  const tail = normPhone(a.phone).slice(-10);
  if (!tail) return { status: "none", turns: [], threads: [], duplicates: 0 };
  try {
    // The thread list is matched on a suffix, then confirmed on the full number.
    const convs = (await db.select(`wa_conversations?account=eq.${a.bot}&phone=like.*${tail}&select=id,phone`))
      .filter((c) => samePhone(c.phone, a.phone));
    const threads = convs.map((c) => String(c.id));
    if (!threads.length) return { status: "none", turns: [], threads, duplicates: 0 };
    // Keyset paging on (wa_timestamp, id): a timestamp alone would skip rows that
    // share one across a page edge, or repeat them forever.
    const rows: any[] = []; let cur: { ts: string; id: string } | null = null;
    for (let pages = 0; pages < 1000; pages++) {
      // Values are double-quoted so a ":" "+" or "," inside one cannot break the filter.
      const q = (v: string) => `"${v.replace(/["\\]/g, "")}"`;
      const after = cur ? `&or=${encodeURIComponent(`(wa_timestamp.gt.${q(cur.ts)},and(wa_timestamp.eq.${q(cur.ts)},id.gt.${q(cur.id)}))`)}` : "";
      const page = await db.select(`wa_messages?conversation_id=in.(${threads.map((t) => encodeURIComponent(q(t))).join(",")})${after}` +
        `&select=id,direction,type,body,caption,wa_id,sender_name,wa_timestamp&order=wa_timestamp.asc,id.asc&limit=${pageSize}`);
      rows.push(...page);
      if (page.length < pageSize) break;
      cur = { ts: page.at(-1).wa_timestamp, id: String(page.at(-1).id) };
    }
    // A bot send and its fromMe echo share a wa_id; keep the first.
    const seen = new Set<string>(); let duplicates = 0;
    const unique = rows.filter((r) => { if (!r.wa_id) return true; if (seen.has(r.wa_id)) { duplicates++; return false; } seen.add(r.wa_id); return true; });
    const turns = historyFromMessages(unique).slice(-maxTurns);
    return { status: turns.length ? "ok" : "none", turns, threads, duplicates };
  } catch (e) {
    return { status: "unavailable", turns: [], threads: [], duplicates: 0, error: e instanceof Error ? e.message : String(e) };
  }
}
