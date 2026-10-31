import type { EvalCase } from "../trainer-eval.ts";

// Held out: written after the intent vocabulary's first cut was fixed, with
// wording that appears in neither the vocabulary's examples nor the other
// fixtures. Same synthetic content (r0-synthetic.ts). Used to check that the
// vocabulary generalises rather than memorising the paraphrase set.
const c = (language: EvalCase["language"], query: string, project: string, relevant: string): EvalCase =>
  ({ query, language, bot: "eyad", resolved: [`p-${project}`], relevant: [relevant] });

export const R0_HELDOUT: EvalCase[] = [
  c("en", "what's the total cost for a unit at gamma residence", "gamma", "f-gamma-price"),
  c("en", "whereabouts is zeta park exactly", "zeta", "f-zeta-loc"),
  c("en", "how many square feet do epsilon villas offer", "epsilon", "f-epsilon-size"),
  c("en", "do alpha heights residents get a gym", "alpha", "f-alpha-amen"),
  c("en", "can you share some pictures of delta tower", "delta", "f-delta-media"),
  c("banglish", "epsilonvillas er budget koto rakhte hobe", "epsilon", "f-epsilon-price"),
  c("banglish", "zetapark ta thikana ki", "zeta", "f-zeta-loc"),
  c("banglish", "alphaheights er ghor gula koto sqft", "alpha", "f-alpha-size"),
  c("banglish", "gammaresidence e ekhono khali flat paowa jabe", "gamma", "f-gamma-avail"),
  c("banglish", "betagardens er kichu photo dekhan", "beta", "f-beta-media"),
  c("bn", "এপসিলন ভিলাসের খরচ কেমন পড়বে", "epsilon", "f-epsilon-price"),
  c("bn", "জেটা পার্কের ঠিকানা দিন", "zeta", "f-zeta-loc"),
  c("bn", "আলফা হাইটসের ফ্ল্যাট কত স্কয়ার ফিট", "alpha", "f-alpha-size"),
  c("bn", "গামা রেসিডেন্সে এখন খালি ফ্ল্যাট আছে", "gamma", "f-gamma-avail"),
  c("bn", "বেটা গার্ডেনসের কয়েকটা ছবি দেখান", "beta", "f-beta-media"),
];
