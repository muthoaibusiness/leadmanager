import { itemApplies, rankByScore, type Bot, type ItemRow, type SnapshotContent } from "./trainer-core.ts";

export type Lang = "bn" | "banglish" | "en";
export type EvalCase = { query: string; language: Lang; bot: Bot; resolved: string[]; relevant: string[] };
export type Metrics = { n: number; recallAtK: number; mrr: number };
export type Report = { overall: Metrics; byLanguage: Record<string, Metrics> };

const itemText = (r: ItemRow) => r.kind === "fact" ? `${r.body.topic} ${r.body.text}`
  : `${r.body?.conversation?.filter((t: { role: string }) => t.role === "customer").at(-1)?.text ?? ""} ${r.body?.ideal_reply ?? ""}`;

// Ranked ids of in-scope facts and examples, best first, using the shared lexical scorer.
export function rankItems(content: SnapshotContent, bot: Bot, query: string, resolved: string[]): string[] {
  const pool = content.items.filter((i) => (i.kind === "fact" || i.kind === "example") && itemApplies(i, bot, resolved));
  return rankByScore(pool, itemText, query, content.projects).map((x) => x.row.id);
}

export function evaluate(cases: EvalCase[], rank: (c: EvalCase) => string[], k = 5): Report {
  const agg = (cs: { r: number; m: number }[]): Metrics => ({
    n: cs.length, recallAtK: cs.length ? cs.reduce((s, x) => s + x.r, 0) / cs.length : 0, mrr: cs.length ? cs.reduce((s, x) => s + x.m, 0) / cs.length : 0,
  });
  const per = cases.map((c) => {
    const ranked = rank(c);
    const hits = c.relevant.filter((id) => ranked.slice(0, k).includes(id)).length;
    const first = ranked.findIndex((id) => c.relevant.includes(id));
    return { lang: c.language, r: c.relevant.length ? hits / c.relevant.length : 0, m: first === -1 ? 0 : 1 / (first + 1) };
  });
  const byLanguage: Record<string, Metrics> = {};
  for (const l of new Set(per.map((p) => p.lang))) byLanguage[l] = agg(per.filter((p) => p.lang === l));
  return { overall: agg(per), byLanguage };
}

// Spec 5.4 gate.
export function r0Gate(m: Report): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (m.overall.recallAtK < 0.9) reasons.push(`overall recall@5 ${m.overall.recallAtK.toFixed(3)} < 0.90`);
  for (const l of ["bn", "banglish", "en"]) {
    const x = m.byLanguage[l];
    if (!x || x.n === 0) reasons.push(`language ${l} missing`);
    else if (x.recallAtK < 0.85) reasons.push(`${l} recall@5 ${x.recallAtK.toFixed(3)} < 0.85`);
  }
  return { ok: reasons.length === 0, reasons };
}
