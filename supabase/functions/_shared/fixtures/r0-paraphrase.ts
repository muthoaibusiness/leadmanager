import type { EvalCase } from "../trainer-eval.ts";

// Harder cases over the same synthetic content: the query shares little or no
// wording with the fact it needs. They measure how far lexical ranking falls
// short, so a future embedding model has a real bar to beat.
const c = (language: EvalCase["language"], query: string, project: string, relevant: string): EvalCase =>
  ({ query, language, bot: "eyad", resolved: [`p-${project}`], relevant: [relevant] });

export const R0_PARAPHRASE: EvalCase[] = [
  c("en", "how much would I need to pay for alpha heights", "alpha", "f-alpha-price"),
  c("en", "which neighbourhood is beta gardens in", "beta", "f-beta-loc"),
  c("en", "how big are the flats in gamma residence", "gamma", "f-gamma-size"),
  c("en", "can my kids swim at beta gardens", "beta", "f-beta-amen"),
  c("en", "anything left to buy in delta tower", "delta", "f-delta-avail"),
  c("banglish", "alphaheights e koto taka lagbe", "alpha", "f-alpha-price"),
  c("banglish", "betagardens jayga ta kon dike", "beta", "f-beta-loc"),
  c("banglish", "gammaresidence koto boro", "gamma", "f-gamma-size"),
  c("banglish", "deltatower e gari rakhar jayga ache", "delta", "f-delta-amen"),
  c("banglish", "zetapark e kichu baki ache kinte", "zeta", "f-zeta-avail"),
  c("bn", "আলফা হাইটস কিনতে কত টাকা লাগবে", "alpha", "f-alpha-price"),
  c("bn", "বেটা গার্ডেনস কোন এলাকায়", "beta", "f-beta-loc"),
  c("bn", "গামা রেসিডেন্স কত বড়", "gamma", "f-gamma-size"),
  c("bn", "ডেল্টা টাওয়ারে গাড়ি রাখা যাবে", "delta", "f-delta-amen"),
  c("bn", "জেটা পার্কে কেনার মতো কিছু বাকি আছে", "zeta", "f-zeta-avail"),
];
