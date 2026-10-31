import type { EvalCase } from "../trainer-eval.ts";

// Real WECON project facts from wa_projects (production, 2026-10-19): names,
// regions, project type, unit size where recorded, site and office address.
// No customer data and no prices (none are recorded there). One Markdown
// document per project, as an operator would write it.
const P = [
  ["nuznan", "Wecon Nuznan", "Dhaka", "Residential", "2850", "Plot No 001, Road 504C, Sector 16, Jolshiri Abashon, Dhaka", "House 5A, Road 25A, Dhaka 1212"],
  ["osman", "Wecon Osman Bellevue", "Dhaka", "Residential", "2850", "Plot -016, Road-406, Sector 16, Jolshiri Abashon, Dhaka", "House 5A, Road 25A, Dhaka 1212"],
  ["dakshinayan", "Wecon Dakshinayan", "Dhaka", "Residential", "2800", "Plot -017, Road-504, Sector 17, Jolshiri Abashon, Dhaka", "House 5A, Road 25A, Dhaka 1212"],
  ["orchid", "Wecon Iqbal Orchid", "Chattogram", "Residential", null, "Road No 03, Nasirabad Properties, South Khulshi", "687 Mehedibag, Chattogram 4203"],
  ["southdale", "Wecon South Dale", "Chattogram", "Residential", null, "Plot 32, Abdul Malek Sarak, Road 2, South Khulshi R/A, Chattogram", "687 Mehedibag, Chattogram 4203"],
  ["summer", "Wecon Summer Breeze", "Chattogram", "Residential", null, "H-714, Mehedibag, 1st Lane, Chattogram", "687 Mehedibag, Chattogram 4203"],
  ["sapphire", "Shafiq Sapphire", "Chattogram", "Residential", null, "House 15, Road 1, Block H, Halishahar H/E, Chattogram", "687 Mehedibag, Chattogram 4203"],
  ["momtaz", "Momtaz Manor", "Chattogram", "Residential", null, "OR Nizam Road R/A, Chattogram", "687 Mehedibag, Chattogram 4203"],
  ["heritage", "Wecon JM Heritage Mall", "Chattogram", "Commercial", null, "934, 935 Laldighi East, Kotwali, Chattogram", "687 Mehedibag, Chattogram 4203"],
  ["arcade", "Wecon Chowdhury Arcade", "Cumilla", "Commercial", null, "467, Shaheed Khawaja Najim Uddin Road, Badurtola, Kotwali, Kandirpar, Cumilla", null],
] as const;

export type WeconDoc = { key: string; title: string; markdown: string };
export const WECON_DOCS: WeconDoc[] = P.map(([key, name, region, nature, sft, address, office]) => ({
  key, title: `${name} fact sheet`,
  markdown: [
    `# ${name}`, "",
    `${nature} project in ${region}.`, "",
    "## Location", `- Site address: ${address}`, `- Region: ${region}`, "",
    ...(sft ? ["## Apartment size", `- Each apartment is ${sft} sqft.`, ""] : []),
    "## Sales office", office ? `- Visit our sales office at ${office}.` : "- Contact the WECON sales team for the nearest office.",
  ].join("\n"),
}));

// A case names the project (so retrieval is scoped to it, as the turn would be)
// and the section that answers it. Paraphrased, in all three languages, with
// little wording shared with the answering section.
const c = (language: EvalCase["language"], query: string, key: string, section: string): EvalCase =>
  ({ query, language, bot: "eyad", resolved: [key], relevant: [`${key}:${section}`] });

export const WECON_DOC_CASES: EvalCase[] = [
  c("en", "where exactly is the nuznan building", "nuznan", "Location"),
  c("en", "how many square feet is a flat at osman bellevue", "osman", "Apartment size"),
  c("en", "how large are the homes at dakshinayan", "dakshinayan", "Apartment size"),
  c("en", "which part of town is iqbal orchid in", "orchid", "Location"),
  c("en", "can I come and meet your team for summer breeze", "summer", "Sales office"),
  c("en", "is heritage mall for shops or apartments", "heritage", "Wecon JM Heritage Mall"),
  c("en", "what is the street address of south dale", "southdale", "Location"),
  c("banglish", "nuznan er flat koto boro", "nuznan", "Apartment size"),
  c("banglish", "osman bellevue ta kon jaygay", "osman", "Location"),
  c("banglish", "dakshinayan dekhte kothay ashbo apnader office e", "dakshinayan", "Sales office"),
  c("banglish", "sapphire er thikana din", "sapphire", "Location"),
  c("banglish", "momtaz manor e office kothay", "momtaz", "Sales office"),
  c("banglish", "chowdhury arcade ki dokan na flat", "arcade", "Wecon Chowdhury Arcade"),
  c("banglish", "summer breeze er location ta bolen", "summer", "Location"),
  c("bn", "নুজনান কোথায় অবস্থিত", "nuznan", "Location"),
  c("bn", "ওসমান বেলভিউ এর ফ্ল্যাট কত স্কয়ার ফিট", "osman", "Apartment size"),
  c("bn", "দক্ষিণায়ন এর ফ্ল্যাট কত বড়", "dakshinayan", "Apartment size"),
  c("bn", "ইকবাল অর্কিড এর ঠিকানা কি", "orchid", "Location"),
  c("bn", "সাউথ ডেল দেখতে আপনাদের অফিসে কোথায় যাব", "southdale", "Sales office"),
  c("bn", "হেরিটেজ মল কি বাণিজ্যিক প্রজেক্ট", "heritage", "Wecon JM Heritage Mall"),
  c("bn", "মমতাজ ম্যানর কোন এলাকায়", "momtaz", "Location"),
];

// Unknown questions: nothing in the documents answers them. The bar is that
// the top hit is weak, so the bot asks or hands off instead of answering.
export const WECON_UNKNOWN: { query: string; key: string; language: EvalCase["language"] }[] = [
  { query: "nuznan er price koto", key: "nuznan", language: "banglish" },
  { query: "does osman bellevue have a swimming pool", key: "osman", language: "en" },
  { query: "দক্ষিণায়ন এর হ্যান্ডওভার কবে", key: "dakshinayan", language: "bn" },
];
