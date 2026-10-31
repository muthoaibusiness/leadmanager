import type { ItemRow } from "../trainer-core.ts";

// The 11 live project items as of 2026-10-19 (ai_trainer_items, read-only),
// with the reviewed aliases from supabase/ops/project_aliases_and_crm_links.sql.
// Only names, regions and aliases: no customer data.
const P = (legacy: number, name: string, region: string, banglish: string[], bn: string[], en: string[] = []): ItemRow => ({
  id: `p${legacy}`, kind: "project", revision: 1, status: "active", bots: ["eyad", "dubai"], project_ref: null,
  body: { name, region, aliases: { en: [name.toLowerCase(), ...en], banglish, bn }, media: {} },
});

export const WECON_PROJECTS: ItemRow[] = [
  P(1, "Wecon Dakshinayan", "Dhaka", ["dakshinayan", "dakhsinayan", "dakkhinayan", "dokkhinayon", "dakshinayon"], ["দক্ষিণায়ন", "দক্ষিনায়ন"]),
  P(2, "Wecon JM Heritage Mall", "Chattogram", ["heritage", "molla", "jm heritage", "heritage mall", "jm mall"], ["হেরিটেজ", "জেএম হেরিটেজ", "হেরিটেজ মল"]),
  P(3, "Wecon Iqbal Orchid", "Chattogram", ["orchid", "iqbal", "iqbal orchid", "ikbal orchid", "orkid"], ["ইকবাল অর্কিড", "অর্কিড"]),
  P(4, "Momtaz Manor", "Chattogram", ["momtaz", "momtaz manor", "mumtaz manor", "momtaj"], ["মমতাজ", "মমতাজ ম্যানর"]),
  P(5, "Wecon Summer Breeze", "Chattogram", ["summer breeze", "summer", "somar breeze", "summerbreeze"], ["সামার ব্রিজ"]),
  P(6, "Wecon Chowdhury Arcade", "Cumilla", ["chowdhury arcade", "arcade", "dokan bikroy", "bikroy utsob", "chowdhury market", "chowdhuri arcade"], ["চৌধুরী আর্কেড"]),
  P(7, "Wecon South Dale", "Chattogram", ["south dale", "southdale", "south del", "saudhdale"], ["সাউথ ডেল", "সাউথডেল"]),
  P(8, "Shafiq Sapphire", "Chattogram", ["shafiq", "sapphire", "shafik", "safiq sapphire", "saphire", "shafiq saphire"], ["শফিক স্যাফায়ার", "স্যাফায়ার", "শফিক"]),
  P(9, "Wecon Osman Bellevue", "Dhaka", ["osman", "bellevue", "osman belle", "belleview", "usman bellevue"], ["ওসমান বেলভিউ", "ওসমান"]),
  P(10, "P2P Helthcare", "Chattogram", ["p2p", "healthcare", "helthcare", "p2p healthcare"], ["পিটুপি", "হেলথকেয়ার"]),
  P(11, "Wecon Nuznan", "Dhaka", ["nuznan", "nujnan", "nuzhnan", "nuznun", "nusnan"], ["নুজনান", "নুযনান"]),
];
