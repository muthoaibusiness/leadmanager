import { freezeContent, type ItemRow } from "../trainer-core.ts";
import type { EvalCase } from "../trainer-eval.ts";

// Fictional projects and figures only.
const P = [
  ["alpha", "Alpha Heights", "alphaheights", "আলফা হাইটস", "Uttara", "1,200 sqft", "gym and rooftop garden", "4.5 crore"],
  ["beta", "Beta Gardens", "betagardens", "বেটা গার্ডেনস", "Bashundhara", "1,500 sqft", "swimming pool and playground", "5.2 crore"],
  ["gamma", "Gamma Residence", "gammaresidence", "গামা রেসিডেন্স", "Gulshan", "2,100 sqft", "sauna and clubhouse", "9.8 crore"],
  ["delta", "Delta Tower", "deltatower", "ডেল্টা টাওয়ার", "Dhanmondi", "950 sqft", "parking and generator", "3.1 crore"],
  ["epsilon", "Epsilon Villas", "epsilonvillas", "এপসিলন ভিলাস", "Purbachal", "3,000 sqft", "private lawn and mosque", "7.5 crore"],
  ["zeta", "Zeta Park", "zetapark", "জেটা পার্ক", "Mirpur", "1,100 sqft", "park view and lift", "3.9 crore"],
] as const;

const row = (id: string, kind: ItemRow["kind"], project_ref: string | null, body: unknown): ItemRow =>
  ({ id, kind, revision: 1, status: "active", bots: ["eyad"], project_ref, body });

const rows: ItemRow[] = [];
for (const [k, name, ban, bn, area, size, amen, price] of P) {
  rows.push(row(`p-${k}`, "project", null, { name, aliases: { banglish: [ban], en: [ban], bn: [bn] }, media: {} }));
  rows.push(row(`f-${k}-price`, "fact", `p-${k}`, { topic: "price", text: `${name} price starts from ${price}. dam ${price} theke. দাম ${price} থেকে।` }));
  rows.push(row(`f-${k}-loc`, "fact", `p-${k}`, { topic: "location", text: `${name} is in ${area}. location ${area}. অবস্থান ${area}।` }));
  rows.push(row(`f-${k}-size`, "fact", `p-${k}`, { topic: "size", text: `${name} apartment size is ${size}. flat size ${size}. ফ্ল্যাটের সাইজ ${size}।` }));
  rows.push(row(`f-${k}-amen`, "fact", `p-${k}`, { topic: "amenities", text: `${name} has ${amen}. suvidha ${amen}. সুবিধা ${amen}।` }));
  rows.push(row(`f-${k}-avail`, "fact", `p-${k}`, { topic: "availability", text: `${name} units are available now. flat ache. ফ্ল্যাট পাওয়া যাচ্ছে।` }));
  rows.push(row(`f-${k}-media`, "fact", `p-${k}`, { topic: "media", text: `${name} photos and brochure can be sent. chobi pathabo. ছবি ও ব্রোশিওর পাঠানো যাবে।` }));
}
rows.push(row("f-land", "fact", null, { topic: "land offer", text: "We buy land and offer land owners a share. jomi dile share den. জমি দিলে শেয়ার দেওয়া হয়।" }));
rows.push(row("e-greet", "example", null, { conversation: [{ role: "customer", text: "hello apnara ki ki project ache" }], ideal_reply: "Hello, welcome. Which area are you looking in?", reason: "r", source: "handwritten" }));

export const R0_CONTENT = freezeContent(rows, { reply_model: "stub", max_tokens: 600, rubric_version: 1 }).content;

const T = ["price", "loc", "media", "size", "amen", "avail"] as const;
const Q = {
  en: { price: (n: string) => `what is the price of ${n}`, loc: (n: string) => `where is ${n} located`, media: (n: string) => `send photos of ${n}`,
    size: (n: string) => `what is the apartment size at ${n}`, amen: (n: string) => `what amenities does ${n} have`, avail: (n: string) => `is a unit available at ${n}` },
  banglish: { price: (n: string) => `${n} er dam koto`, loc: (n: string) => `${n} kothay`, media: (n: string) => `${n} er chobi pathan`,
    size: (n: string) => `${n} flat er size koto`, amen: (n: string) => `${n} te ki suvidha ache`, avail: (n: string) => `${n} te flat ache ki` },
  bn: { price: (n: string) => `${n} এর দাম কত`, loc: (n: string) => `${n} কোথায়`, media: (n: string) => `${n} এর ছবি পাঠান`,
    size: (n: string) => `${n} ফ্ল্যাটের সাইজ কত`, amen: (n: string) => `${n} এ কি সুবিধা আছে`, avail: (n: string) => `${n} এ ফ্ল্যাট আছে কি` },
} as const;

const cases: EvalCase[] = [];
for (const lang of ["bn", "banglish", "en"] as const) {
  for (let i = 0; i < 8; i++) {
    const [k, name, ban, bn] = P[i % 6]; const t = T[(i + (lang === "bn" ? 0 : lang === "banglish" ? 2 : 4)) % 6];
    const n = lang === "bn" ? bn : lang === "banglish" ? ban : name;
    cases.push({ query: Q[lang][t](n), language: lang, bot: "eyad", resolved: [`p-${k}`], relevant: [`f-${k}-${t}`] });
  }
  cases.push({ query: lang === "bn" ? "জমি দিলে কি অফার আছে" : lang === "banglish" ? "amar jomi ache, ki offer den" : "i own land, what offer do you have",
    language: lang, bot: "eyad", resolved: [], relevant: ["f-land"] });
  cases.push({ query: lang === "bn" ? "আসসালামু আলাইকুম আপনাদের কি কি প্রজেক্ট আছে" : lang === "banglish" ? "hello apnader ki ki project ache" : "hello what projects do you have",
    language: lang, bot: "eyad", resolved: [], relevant: ["e-greet"] });
}
export const R0_CASES = cases;
