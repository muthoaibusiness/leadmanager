import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, r0Gate, rankItems, type EvalCase } from "./trainer-eval.ts";
import { R0_CONTENT, R0_CASES } from "./fixtures/r0-synthetic.ts";

const c = (language: EvalCase["language"], relevant: string[]): EvalCase => ({ query: "q", language, bot: "eyad", resolved: [], relevant });
const ranks: Record<string, string[]> = { a: ["x", "r1", "y"], b: ["x", "y", "z"], d: ["r1", "r2", "x", "y", "z", "w"] };

test("metrics match hand-computed values", () => {
  // a: relevant r1 at rank 2 -> recall 1, mrr 0.5. b: miss -> 0, 0.
  // d: relevant r1,r2 at ranks 1,2, k=1 -> recall 0.5, mrr 1.
  const cases = [c("en", ["r1"]), c("en", ["nope"]), c("bn", ["r1", "r2"])];
  const rep = evaluate(cases, (x) => ranks[x.relevant[0] === "r1" && x.language === "en" ? "a" : x.relevant[0] === "nope" ? "b" : "d"], 1);
  assert.deepEqual(rep.byLanguage.en, { n: 2, recallAtK: 0, mrr: 0.25 }); // k=1: a misses r1 at rank 2
  assert.deepEqual(rep.byLanguage.bn, { n: 1, recallAtK: 0.5, mrr: 1 });
  assert.equal(rep.overall.n, 3);
  assert.ok(Math.abs(rep.overall.recallAtK - 1 / 6) < 1e-9);
  assert.ok(Math.abs(rep.overall.mrr - 0.5) < 1e-9);
  const k5 = evaluate(cases, (x) => ranks[x.relevant[0] === "r1" && x.language === "en" ? "a" : x.relevant[0] === "nope" ? "b" : "d"], 5);
  assert.ok(Math.abs(k5.overall.recallAtK - 2 / 3) < 1e-9);
});

const good = { n: 10, recallAtK: 0.95, mrr: 0.8 };
test("gate passes at the thresholds and fails below them", () => {
  assert.deepEqual(r0Gate({ overall: { n: 30, recallAtK: 0.9, mrr: 1 }, byLanguage: { bn: { n: 10, recallAtK: 0.85, mrr: 1 }, banglish: good, en: good } }), { ok: true, reasons: [] });
  const low = r0Gate({ overall: { n: 30, recallAtK: 0.89, mrr: 1 }, byLanguage: { bn: { n: 10, recallAtK: 0.8, mrr: 1 }, banglish: good, en: good } });
  assert.equal(low.ok, false); assert.equal(low.reasons.length, 2);
});

test("gate fails when a language is missing", () => {
  const r = r0Gate({ overall: good, byLanguage: { bn: good, en: good } });
  assert.equal(r.ok, false); assert.deepEqual(r.reasons, ["language banglish missing"]);
});

test("lexical ranker over the fixture reports n=10 per language, values in [0,1]", () => {
  const rep = evaluate(R0_CASES, (k) => rankItems(R0_CONTENT, k.bot, k.query, k.resolved));
  for (const l of ["bn", "banglish", "en"]) {
    assert.equal(rep.byLanguage[l].n, 10);
    for (const v of [rep.byLanguage[l].recallAtK, rep.byLanguage[l].mrr]) assert.ok(v >= 0 && v <= 1);
  }
  assert.equal(rep.overall.n, 30);
});
