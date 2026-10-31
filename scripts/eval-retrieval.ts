import { evaluate, r0Gate, rankItems } from "../supabase/functions/_shared/trainer-eval.ts";
import { R0_CONTENT, R0_CASES } from "../supabase/functions/_shared/fixtures/r0-synthetic.ts";
import { R0_PARAPHRASE } from "../supabase/functions/_shared/fixtures/r0-paraphrase.ts";
import { R0_HELDOUT } from "../supabase/functions/_shared/fixtures/r0-heldout.ts";

const f = (m: { n: number; recallAtK: number; mrr: number }) => `n=${m.n} recall@5=${m.recallAtK.toFixed(3)} mrr=${m.mrr.toFixed(3)}`;
for (const [title, cases] of [["shared wording", R0_CASES], ["paraphrase", R0_PARAPHRASE], ["held out", R0_HELDOUT]] as const) {
  const rep = evaluate(cases, (c) => rankItems(R0_CONTENT, c.bot, c.query, c.resolved));
  console.log(`\n${title}\noverall   ${f(rep.overall)}`);
  for (const [l, m] of Object.entries(rep.byLanguage)) console.log(`${l.padEnd(9)} ${f(m)}`);
  const g = r0Gate(rep);
  console.log(g.ok ? "gate: PASS" : `gate: FAIL\n- ${g.reasons.join("\n- ")}`);
}
