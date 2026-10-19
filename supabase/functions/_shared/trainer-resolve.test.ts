import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { freezeContent, resolveProject, emptyState } from "./trainer-core.ts";
import { WECON_PROJECTS } from "./fixtures/wecon-projects.ts";

// Project resolution over the real 11 projects and their reviewed aliases.
const { content, errors } = freezeContent(WECON_PROJECTS, { reply_model: "m", max_tokens: 2000, rubric_version: 1 });
const R = (text: string) => resolveProject(text, emptyState(), { isAd: false }, content.projects);
const name = (id: string) => content.projects.find((p) => p.id === id)!.body.name;
const one = (text: string, expected: string) => {
  const r = R(text);
  assert.deepEqual(r.projects.map(name), [expected], `"${text}" resolved to ${JSON.stringify(r.projects.map(name))}`);
};

test("the reviewed aliases freeze cleanly: no alias is claimed by two projects", () => {
  assert.deepEqual(errors, []);
});

test("the fixture aliases are exactly what the ops alias script would add", () => {
  const sql = readFileSync(new URL("../../ops/project_aliases_and_crm_links.sql", import.meta.url), "utf8");
  const arr = (s: string) => s.replace(/^\{|\}$/g, "").split(",").filter(Boolean);
  for (const m of sql.matchAll(/\('[0-9a-f-]+', (\d+),\s+(?:'[a-z0-9]+'|null),\s+'(\{[^']*\})',\s+'(\{[^']*\})'\)/g)) {
    const p = WECON_PROJECTS.find((x) => x.id === `p${m[1]}`)!;
    assert.deepEqual(p.body.aliases.bn, arr(m[2]), `bn for ${p.body.name}`);
    for (const a of arr(m[3])) assert.ok(p.body.aliases.banglish.includes(a), `${a} missing from ${p.body.name}`);
  }
});

test("Bengali script names resolve", () => {
  one("নুজনান এর দাম কত?", "Wecon Nuznan");
  one("দক্ষিণায়ন প্রজেক্ট কোথায়", "Wecon Dakshinayan");
  one("শফিক স্যাফায়ার এ ফ্ল্যাট আছে?", "Shafiq Sapphire");
  one("ওসমান বেলভিউ এর ঠিকানা", "Wecon Osman Bellevue");
  one("সাউথ ডেল এর ছবি পাঠান", "Wecon South Dale");
  one("মমতাজ ম্যানর কত বড়", "Momtaz Manor");
});

test("Bengali names resolve with a case ending attached (নুজনানের, ওসমানে)", () => {
  one("নুজনানের দাম কত", "Wecon Nuznan");
  one("দক্ষিণায়নে ফ্ল্যাট আছে", "Wecon Dakshinayan");
});

test("Banglish and English transliterations resolve", () => {
  one("nujnan er dam koto", "Wecon Nuznan");
  one("dokkhinayon kothay", "Wecon Dakshinayan");
  one("Mumtaz Manor price?", "Momtaz Manor");
  one("Iqbal Orchid location please", "Wecon Iqbal Orchid");
  one("jm heritage e dokan ache?", "Wecon JM Heritage Mall");
});

test("common misspellings resolve", () => {
  one("shafik saphire er dam", "Shafiq Sapphire");
  one("belleview kothay", "Wecon Osman Bellevue");
  one("nuzhnan e flat ache", "Wecon Nuznan");
  one("southdale photos", "Wecon South Dale");
});

test("generic words alone never resolve a project", () => {
  for (const t of ["summer e ki offer", "mall e dokan ache?", "kono arcade ache", "heritage building", "manor house", "wecon er project"]) {
    assert.deepEqual(R(t).projects, [], t);
  }
});

test("two projects named in one message both resolve, so the bot asks which one", () => {
  const r = R("Nuznan na Osman Bellevue, kon ta better?");
  assert.deepEqual(r.projects.map(name).sort(), ["Wecon Nuznan", "Wecon Osman Bellevue"]);
});

test("a short alias inside another word does not resolve", () => {
  assert.deepEqual(R("osmani hospital er pashe").projects, []);
  assert.deepEqual(R("sapphires are blue").projects, []);
});
