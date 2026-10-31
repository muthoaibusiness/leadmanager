# WECON AI Trainer MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the smallest working AI Trainer: Management edits draft knowledge and behaviour, tests it in a multi-turn Playground, saves corrections as examples and regression tests, runs the regression set, and publishes a snapshot that is refused while any test fails or is inconclusive. Both bots stay in legacy mode; no customer is affected.

**Architecture:** One Deno-free module, `supabase/functions/_shared/trainer-core.ts`, holds every rule of the reply path (checksum, schemas, scope, context, project resolution, prompt, output guards, media, verdicts, publish gate). A new Edge Function `ai-trainer` is a thin HTTP shell around it, backed by migration `0037_ai_trainer.sql` (all tables RLS-on, no anon policy). A new CRM page `AI Trainer` talks only to `ai-trainer`. The bots are not changed in this plan.

**Tech Stack:** React 19 + Vite (existing), Supabase Postgres + Edge Functions (Deno), OpenRouter chat completions, Node 24 built-in test runner (runs `.ts` natively, verified), PGlite (dev dependency) for migration tests.

**Spec:** `docs/superpowers/specs/2026-10-18-wecon-ai-trainer-design.md`

## Global Constraints

- No production change without the owner's explicit approval at that time: applying 0037, setting Edge secrets, deploying `ai-trainer`, deploying the Netlify site.
- Do not change `wa-bot-eyad`, `wa-bot-dubai`, `wa-webhook`, `wa-send`, or `_shared/ai.ts` / `_shared/wa.ts` behaviour. Importing helpers from `_shared/wa.ts` into `ai-trainer` is allowed.
- Do not deploy `wa-bot-eyad` or `wa-bot-dubai` from this repository. Production Eyad v38 has direct `/send` delivery that is in no git branch (spec §10.5.4); Task C0 records it first.
- Existing commands (`/f<taq>` ×17, `/t`, `/n`, `/send<code>` ×11), their mappings and the self-chat guard are preserved unchanged (spec §10.5).
- Do not enable pgvector, do not create migration 0038, do not build embeddings. Retrieval mode is `full` only (spec §5.1).
- Every new table: `alter table … enable row level security;` and no policy, plus `revoke all … from anon, authenticated;`.
- Secrets: `AI_TRAINER_KEY` (≥32 random bytes), `AI_TRAINER_DAILY_BUDGET_USD`, existing `OPENROUTER_API_KEY`. Never with a `VITE_` prefix, never in the bundle, never printed.
- Trainer requests carry header `X-Trainer-Key`; checked with constant-time compare before every action except `auth.check`.
- Audit rows store `actor_claimed`, `auth_method = 'trainer_key'`, `verified_user_id = null`. UI shows "claimed by".
- `bots` is a non-empty subset of `['eyad','dubai']`. `project_ref` is null or an active `project` item id; must be null for `project` and `behaviour` kinds.
- Final test verdict table (spec §7.4): any deterministic fail → FAIL (judge not called); all pass + `judge: none` → PASS; judge pass → PASS; judge fail → FAIL; judge inconclusive/invalid/error → INCONCLUSIVE.
- Publish requires a `complete` run with `snapshot_checksum = snapshot.checksum`, matching `core_version`, covering every active test for the bot at its current revision, every result PASS.
- No model call without a successful `ai_budget_reserve`.
- No text may say a consultant or team "has been informed".
- Lint must stay at the current baseline: 1 error and 2 warnings, all in files this plan does not touch.
- Code comments match the codebase: explanatory prose above blocks, English.
- Commits: one per task, message ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push. Do not commit until the open `dev` merge on `asad-dev` is concluded by the owner (Task 0).

## Review Focus

1. **Duplicate save clicks / two browser tabs editing one item** — a stale `revision` must get 409, never silently overwrite. Test in Task 6 (`items.update` with an old revision).
2. **Bangla-script and mixed-script customer text** — alias matching and language detection must not crash or mis-resolve on Bangla Unicode and zero-width joiners. Tests in Task 3 (`resolveProject` with `ওসমান`, `detectLanguage` on mixed text).
3. **Model returns prose or fenced JSON instead of the schema** — must re-ask once, then fall back, never surface raw JSON. Test in Task 4 (`parseModelOutput` on fenced and prose output).
4. **Judge provider down during a test run** — results must be INCONCLUSIVE and publish blocked, never PASS. Test in Task 5 (`finalVerdict` with judge error) and Task 7 (run with failing judge stub).
5. **Concurrent budget reservations** — parallel Playground calls must not exceed the daily limit. Test in Task 2 (20 parallel `ai_budget_reserve` calls on PGlite).

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0037_ai_trainer.sql` | All MVP tables, triggers, constraints, `ai_budget_*` functions, pointer seed |
| `supabase/ops/0037_preflight.sql`, `0037_verify.sql`, `0037_rollback.sql` | Read-only checks, post-apply verification, drop-only rollback |
| `scripts/test-0037.mjs` | PGlite tests for 0037 |
| `supabase/functions/_shared/trainer-core.ts` | Pure logic: `CORE_VERSION`, `canonicalJson`, `sha256Hex`, `checksumOf`, item schemas + `validateItem`, `contentHash`, scope (`itemApplies`, `validateScope`), `freezeContent`, `detectLanguage`, `resolveProject`, `buildContext`, `buildPrompt`, `parseModelOutput`, `guardReply`, `resolveMedia`, `runTurn`, `runChecks`, `finalVerdict`, `publishGate`, `redactConversation` |
| `supabase/functions/_shared/trainer-core.test.ts` | Node tests for trainer-core |
| `supabase/functions/_shared/trainer-handler.ts` | Deno-free request handler: auth, routing, DB access through an injected `db` port, OpenRouter through an injected `llm` port |
| `supabase/functions/_shared/trainer-handler.test.ts` | Node tests for the handler with in-memory `db` and stub `llm` |
| `supabase/functions/ai-trainer/index.ts` | Deno shell: builds real `db` (PostgREST, service role) and `llm` (OpenRouter) ports, calls the handler |
| `src/lib/aiTrainer.js` | Browser client: key in sessionStorage, `trainerCall(action, payload)` |
| `src/components/views/AiTrainerView.jsx` | Page shell, key gate, tabs |
| `src/components/aitrainer/KnowledgeTab.jsx` | Items of kind project, fact, rule; legacy import |
| `src/components/aitrainer/BehaviourTab.jsx` | Items of kind behaviour, example |
| `src/components/aitrainer/PlaygroundTab.jsx` | Multi-turn chat, trace, mark wrong → example/test |
| `src/components/aitrainer/QualityTab.jsx` | Bot pointers, freeze, run, results, publish, rollback |
| `src/components/aitrainer/ItemEditor.jsx` | One modal editor for every item kind |
| `src/components/aitrainer/ItemList.jsx`, `useItems.js` | Shared item list component and its data hook |
| `src/components/aitrainer/aitrainer.css` | Page styles |
| Modify `src/App.jsx`, `src/lib/constants.js`, `src/lib/navMeta.js`, `src/lib/navHistory.js`, `src/components/Sidebar.jsx`, `index.html` | Page registration and icons |
| Modify `package.json` | `"test:trainer"` script, `@electric-sql/pglite` dev dependency |

Deferred (not in this plan): Training tab review list of real WhatsApp replies and Conversations "Train this reply" (spec §8 source 2), compare mode, bot cutover (§10.4), `ai_turns` / `ai_conversation_state` / lease / pause / handoff runtime (§6.3), embeddings (§5), `CORE_VERSION` health endpoint on bots (§6.5). The tables for turns, state and handoffs are created now so the cutover plan needs no schema change.

---

### Task 0: Preconditions (owner, no code)

- [ ] **Step 1:** Owner concludes the open merge on `asad-dev` (`git commit` to keep `origin/dev`, or `git merge --abort`). Run `git status` and confirm no `MERGE_HEAD`:

Run: `test -f .git/MERGE_HEAD && echo OPEN || echo CLEAR`
Expected: `CLEAR`

- [ ] **Step 2:** Owner removes `VITE_SUPABASE_SERVICE_ROLE` from `.env` (spec §9 and Phase 0 report). Check by name only:

Run: `grep -c '^VITE_SUPABASE_SERVICE_ROLE=' .env`
Expected: `0`

- [ ] **Step 3:** Create a work branch:

```bash
git switch -c feat/ai-trainer-mvp
```

---

### Task 1: trainer-core foundations — canonical JSON, checksum, schemas, scope

**Files:**
- Create: `supabase/functions/_shared/trainer-core.ts`
- Create: `supabase/functions/_shared/trainer-core.test.ts`
- Modify: `package.json` (scripts)

**Interfaces:**
- Produces:
  - `CORE_VERSION: string`
  - `canonicalJson(v: unknown): string`
  - `sha256Hex(s: string): Promise<string>`
  - `checksumOf(content: unknown): Promise<string>`
  - `type Kind = 'project'|'fact'|'rule'|'behaviour'|'example'`
  - `type Bot = 'eyad'|'dubai'`
  - `validateItem(kind: Kind, body: unknown): string[]` (empty = valid)
  - `validateScope(kind: Kind, bots: unknown, projectRef: unknown, activeProjectIds: Set<string>): string[]`
  - `contentHash(kind: Kind, body: unknown): Promise<string>`
  - `itemApplies(item: {bots: Bot[], project_ref: string|null}, bot: Bot, resolved: string[]): boolean`

- [ ] **Step 1: Add the test script**

In `package.json` `"scripts"`, add after `"preview"`:

```json
    "test:trainer": "node --test supabase/functions/_shared/trainer-core.test.ts supabase/functions/_shared/trainer-handler.test.ts"
```

- [ ] **Step 2: Write the failing tests**

Create `supabase/functions/_shared/trainer-core.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CORE_VERSION, canonicalJson, checksumOf, validateItem, validateScope, contentHash, itemApplies,
} from "./trainer-core.ts";

test("canonicalJson sorts keys recursively and keeps array order", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [3, 1], c: null } }), '{"a":{"c":null,"d":[3,1]},"b":1}');
});

test("checksum is stable across key order", async () => {
  assert.equal(await checksumOf({ x: 1, y: [1, 2] }), await checksumOf({ y: [1, 2], x: 1 }));
  assert.match(await checksumOf({}), /^[0-9a-f]{64}$/);
});

test("CORE_VERSION is set", () => {
  assert.match(CORE_VERSION, /^\d+\.\d+\.\d+$/);
});

test("validateItem: fact needs topic and text", () => {
  assert.deepEqual(validateItem("fact", { topic: "Location", text: "Sector 16" }), []);
  assert.ok(validateItem("fact", { topic: "" }).length > 0);
  assert.ok(validateItem("fact", null).length > 0);
});

test("validateItem: project floor plans are {url,label}", () => {
  const ok = { name: "Wecon Nuznan", aliases: { bn: ["নুজনান"], banglish: ["nuznan"], en: ["nuznan"] },
    media: { photos: [], floor_plans: [{ url: "https://x/a.jpg", label: "Ground" }] } };
  assert.deepEqual(validateItem("project", ok), []);
  const bad = { ...ok, media: { photos: [], floor_plans: ["https://x/a.jpg"] } };
  assert.ok(validateItem("project", bad).length > 0);
});

test("validateItem: example needs conversation, ideal_reply, reason, source", () => {
  const ok = { conversation: [{ role: "customer", text: "dam koto?" }], ideal_reply: "Meeting?", reason: "no price", source: "handwritten" };
  assert.deepEqual(validateItem("example", ok), []);
  assert.ok(validateItem("example", { ...ok, source: "other" }).length > 0);
});

test("validateItem: unknown keys rejected", () => {
  assert.ok(validateItem("rule", { name: "x", when: "w", must: "m", extra: 1 }).length > 0);
});

test("validateScope", () => {
  const ids = new Set(["p1"]);
  assert.deepEqual(validateScope("fact", ["eyad"], "p1", ids), []);
  assert.deepEqual(validateScope("fact", ["eyad", "dubai"], null, ids), []);
  assert.ok(validateScope("fact", [], null, ids).length > 0);
  assert.ok(validateScope("fact", ["both"], null, ids).length > 0);
  assert.ok(validateScope("fact", ["eyad"], "p9", ids).length > 0);
  assert.ok(validateScope("behaviour", ["eyad"], "p1", ids).length > 0);
  assert.ok(validateScope("project", ["eyad"], "p1", ids).length > 0);
});

test("contentHash ignores key order", async () => {
  assert.equal(await contentHash("fact", { topic: "a", text: "b" }), await contentHash("fact", { text: "b", topic: "a" }));
});

test("itemApplies filters by bot and project", () => {
  assert.equal(itemApplies({ bots: ["eyad"], project_ref: null }, "eyad", []), true);
  assert.equal(itemApplies({ bots: ["eyad"], project_ref: null }, "dubai", []), false);
  assert.equal(itemApplies({ bots: ["eyad", "dubai"], project_ref: "p1" }, "dubai", ["p1"]), true);
  assert.equal(itemApplies({ bots: ["eyad", "dubai"], project_ref: "p1" }, "dubai", ["p2"]), false);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test supabase/functions/_shared/trainer-core.test.ts`
Expected: FAIL with `Cannot find module` for `./trainer-core.ts`

- [ ] **Step 4: Write the implementation**

Create `supabase/functions/_shared/trainer-core.ts`:

```ts
// AI Trainer core. Every rule of the trainer's reply path lives here, with no
// Deno or browser dependency, so the Edge Function, the bots (at cutover) and
// the Node test runner all execute the same code. Design:
// docs/superpowers/specs/2026-10-18-wecon-ai-trainer-design.md
//
// Bump CORE_VERSION on any change that can alter a reply, a verdict or a
// checksum. Test runs and published snapshots are certified per version.

export const CORE_VERSION = "1.0.0";

export type Kind = "project" | "fact" | "rule" | "behaviour" | "example";
export type Bot = "eyad" | "dubai";
export const KINDS: Kind[] = ["project", "fact", "rule", "behaviour", "example"];
export const BOTS: Bot[] = ["eyad", "dubai"];

// ── canonical JSON and checksums ────────────────────────────────────────────
// Keys sorted recursively, array order kept, no whitespace. The checksum of a
// snapshot is sha256 over this string, so two runtimes agree byte for byte.
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const checksumOf = (content: unknown) => sha256Hex(canonicalJson(content));
export const contentHash = (kind: Kind, body: unknown) => sha256Hex(`${kind}|${canonicalJson(body)}`);

// ── item schemas ────────────────────────────────────────────────────────────
// A small hand-rolled validator: each field is [type, required]. Unknown keys
// are errors, so a typo in the editor cannot silently drop content.
type FieldType = "string" | "string[]" | "number" | "object" | "turns" | "aliases" | "media" | "params";
type Shape = Record<string, [FieldType, boolean]>;

const SHAPES: Record<Kind, Shape> = {
  project: {
    name: ["string", true], aliases: ["aliases", true], region: ["string", false], type: ["string", false],
    address: ["string", false], size_text: ["string", false], tags: ["string[]", false], media: ["media", true],
    send_code: ["string", false], legacy_wa_project_id: ["number", false],
  },
  fact: { topic: ["string", true], text: ["string", true], source: ["string", false], languages: ["string[]", false] },
  rule: {
    name: ["string", true], when: ["string", true], must: ["string", true], must_not: ["string", false],
    parameters: ["params", false], priority: ["number", false],
  },
  behaviour: { aspect: ["string", true], instruction: ["string", true], do: ["string[]", false], dont: ["string[]", false] },
  example: {
    conversation: ["turns", true], original_reply: ["string", false], ideal_reply: ["string", true],
    reason: ["string", true], source: ["string", true], source_ref: ["string", false], language: ["string", false],
  },
};

const ASPECTS = ["tone", "language", "greeting", "discovery", "pricing", "objection", "meeting", "handoff"];
const SOURCES = ["playground", "real", "handwritten"];
const isStr = (x: unknown) => typeof x === "string";
const isStrArr = (x: unknown) => Array.isArray(x) && x.every(isStr);

function checkField(t: FieldType, v: unknown): boolean {
  switch (t) {
    case "string": return isStr(v);
    case "string[]": return isStrArr(v);
    case "number": return typeof v === "number" && Number.isFinite(v);
    case "object": return !!v && typeof v === "object" && !Array.isArray(v);
    case "params": return !!v && typeof v === "object" && !Array.isArray(v) &&
      Object.values(v as object).every((x) => isStr(x) || typeof x === "number");
    case "turns": return Array.isArray(v) && v.length > 0 && v.every((t) =>
      t && typeof t === "object" && ["customer", "bot", "agent"].includes((t as any).role) && isStr((t as any).text));
    case "aliases": return !!v && typeof v === "object" &&
      ["bn", "banglish", "en"].every((k) => (v as any)[k] === undefined || isStrArr((v as any)[k]));
    case "media": {
      if (!v || typeof v !== "object") return false;
      const m = v as any;
      const urlOk = (u: unknown) => u === undefined || u === "" || (isStr(u) && /^https?:\/\//.test(u as string));
      return (m.photos === undefined || (isStrArr(m.photos) && m.photos.every(urlOk))) &&
        (m.floor_plans === undefined || (Array.isArray(m.floor_plans) && m.floor_plans.every((p: any) =>
          p && typeof p === "object" && urlOk(p.url) && isStr(p.url) && (p.label === undefined || isStr(p.label))))) &&
        urlOk(m.brochure) && urlOk(m.map_image) && urlOk(m.video);
    }
  }
}

export function validateItem(kind: Kind, body: unknown): string[] {
  const shape = SHAPES[kind];
  if (!shape) return [`unknown kind: ${kind}`];
  if (!body || typeof body !== "object" || Array.isArray(body)) return ["body must be an object"];
  const b = body as Record<string, unknown>;
  const errs: string[] = [];
  for (const k of Object.keys(b)) if (!shape[k]) errs.push(`unknown field: ${k}`);
  for (const [k, [t, req]] of Object.entries(shape)) {
    const v = b[k];
    if (v === undefined || v === null) { if (req) errs.push(`${k} is required`); continue; }
    if (!checkField(t, v)) errs.push(`${k} has the wrong type`);
    else if (t === "string" && req && !(v as string).trim()) errs.push(`${k} is required`);
  }
  if (kind === "behaviour" && isStr(b.aspect) && !ASPECTS.includes(b.aspect as string)) errs.push("aspect is not allowed");
  if (kind === "example" && isStr(b.source) && !SOURCES.includes(b.source as string)) errs.push("source is not allowed");
  return errs;
}

// ── scope ───────────────────────────────────────────────────────────────────
export function validateScope(kind: Kind, bots: unknown, projectRef: unknown, activeProjectIds: Set<string>): string[] {
  const errs: string[] = [];
  if (!Array.isArray(bots) || bots.length === 0 || !bots.every((b) => BOTS.includes(b as Bot)) ||
      new Set(bots).size !== bots.length) {
    errs.push("bots must be a non-empty subset of eyad, dubai");
  }
  if (projectRef !== null && projectRef !== undefined) {
    if (kind === "project" || kind === "behaviour") errs.push(`${kind} items cannot be project-scoped`);
    else if (!isStr(projectRef) || !activeProjectIds.has(projectRef as string)) errs.push("project_ref is not an active project");
  }
  return errs;
}

export function itemApplies(item: { bots: Bot[]; project_ref: string | null }, bot: Bot, resolved: string[]): boolean {
  if (!item.bots.includes(bot)) return false;
  return item.project_ref === null || resolved.includes(item.project_ref);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test supabase/functions/_shared/trainer-core.test.ts`
Expected: PASS, `fail 0`

- [ ] **Step 6: Commit**

```bash
git add package.json supabase/functions/_shared/trainer-core.ts supabase/functions/_shared/trainer-core.test.ts
git commit -m "feat(ai-trainer): core checksum, item schemas and scope

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Migration 0037 with PGlite tests

**Files:**
- Create: `supabase/migrations/0037_ai_trainer.sql`
- Create: `supabase/ops/0037_preflight.sql`, `supabase/ops/0037_verify.sql`, `supabase/ops/0037_rollback.sql`
- Create: `scripts/test-0037.mjs`
- Modify: `package.json` (devDependency, script)

**Interfaces:**
- Produces tables: `ai_trainer_items`, `ai_trainer_item_revisions`, `ai_trainer_audit`, `ai_tests`, `ai_test_revisions`, `ai_snapshots`, `ai_bot_pointers`, `ai_test_runs`, `ai_test_results`, `ai_trainer_imports`, `ai_conversation_state`, `ai_turns`, `ai_handoffs`, `ai_budget_days`, `ai_budget_reservations`.
- Produces functions: `ai_budget_reserve(p_pool text, p_estimate numeric, p_limit numeric) returns uuid` (null = refused), `ai_budget_settle(p_id uuid, p_actual numeric) returns void`, `ai_budget_release(p_id uuid) returns void`, `ai_item_save(p_item jsonb, p_expected_revision int, p_actor text, p_reason text) returns jsonb`.

- [ ] **Step 1: Add PGlite and the script**

Run: `npm install --save-dev @electric-sql/pglite@0.3.15`

In `package.json` `"scripts"` add:

```json
    "test:0037": "node scripts/test-0037.mjs"
```

- [ ] **Step 2: Write the failing test**

Create `scripts/test-0037.mjs`:

```js
// Applies migration 0037 to an in-memory Postgres (PGlite) and checks the
// guarantees the AI Trainer relies on: immutability, scope constraints,
// pointer rules, revision conflicts and atomic budget reservation.
// PGlite has no Supabase roles, so the script creates stand-ins first.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role;
  create table notifications (id text primary key, user_id text, type text, message text, lead_id text, is_read boolean, created_at timestamptz, company_id text);
  create table preleads (id bigint generated always as identity primary key, phone text unique, takeover boolean default false);`);
await db.exec(readFileSync('supabase/migrations/0037_ai_trainer.sql', 'utf8'));

let pass = 0;
const ok = async (name, fn) => { await fn(); pass++; console.log('ok', name); };
const rejects = async (sql, params = []) => {
  let threw = false;
  try { await db.query(sql, params); } catch { threw = true; }
  assert.ok(threw, `expected failure: ${sql}`);
};

await ok('pointers seeded legacy', async () => {
  const r = await db.query(`select bot, mode, snapshot_id from ai_bot_pointers order by bot`);
  assert.deepEqual(r.rows, [{ bot: 'dubai', mode: 'legacy', snapshot_id: null }, { bot: 'eyad', mode: 'legacy', snapshot_id: null }]);
});

await ok('bots constraint', async () => {
  await rejects(`insert into ai_trainer_items (kind, bots, body, content_hash) values ('fact', '{}', '{}', 'h')`);
  await rejects(`insert into ai_trainer_items (kind, bots, body, content_hash) values ('fact', '{both}', '{}', 'h')`);
});

await ok('item_save creates revision 1 and audit', async () => {
  const r = await db.query(`select ai_item_save($1::jsonb, 0, 'Asad', null) as res`, [JSON.stringify({ kind: 'fact', bots: ['eyad'], project_ref: null, body: { topic: 't', text: 'x' }, content_hash: 'h1' })]);
  const res = r.rows[0].res;
  assert.equal(res.revision, 1);
  const a = await db.query(`select actor_claimed, auth_method, verified_user_id from ai_trainer_audit where entity_id = $1`, [res.id]);
  assert.deepEqual(a.rows[0], { actor_claimed: 'Asad', auth_method: 'trainer_key', verified_user_id: null });
  const rev = await db.query(`select count(*)::int as n from ai_trainer_item_revisions where item_id = $1`, [res.id]);
  assert.equal(rev.rows[0].n, 1);
});

await ok('item_save stale revision conflicts', async () => {
  const id = (await db.query(`select id from ai_trainer_items limit 1`)).rows[0].id;
  await db.query(`select ai_item_save($1::jsonb, 1, 'A', null)`, [JSON.stringify({ id, kind: 'fact', bots: ['eyad'], project_ref: null, body: { topic: 't', text: 'y' }, content_hash: 'h2' })]);
  await rejects(`select ai_item_save($1::jsonb, 1, 'A', null)`, [JSON.stringify({ id, kind: 'fact', bots: ['eyad'], project_ref: null, body: { topic: 't', text: 'z' }, content_hash: 'h3' })]);
});

await ok('duplicate active content rejected', async () => {
  await rejects(`select ai_item_save($1::jsonb, 0, 'A', null)`, [JSON.stringify({ kind: 'fact', bots: ['eyad'], project_ref: null, body: { topic: 't', text: 'y' }, content_hash: 'h2' })]);
});

await ok('retire needs reason', async () => {
  const id = (await db.query(`select id from ai_trainer_items limit 1`)).rows[0].id;
  await rejects(`select ai_item_save($1::jsonb, 2, 'A', null)`, [JSON.stringify({ id, kind: 'fact', bots: ['eyad'], project_ref: null, body: { topic: 't', text: 'y' }, content_hash: 'h2', status: 'retired' })]);
});

await ok('revisions and audit are append-only', async () => {
  await rejects(`update ai_trainer_item_revisions set revision = 9`);
  await rejects(`delete from ai_trainer_item_revisions`);
  await rejects(`update ai_trainer_audit set reason = 'x'`);
  await rejects(`delete from ai_trainer_audit`);
});

await ok('snapshot immutability', async () => {
  const s = (await db.query(`insert into ai_snapshots (version_no, content, checksum, core_version_frozen, created_by_claimed) values (1, '{"a":1}', 'c1', '1.0.0', 'A') returning id`)).rows[0].id;
  await rejects(`update ai_snapshots set content = '{"a":2}' where id = $1`, [s]);
  await rejects(`update ai_snapshots set checksum = 'x' where id = $1`, [s]);
  await rejects(`delete from ai_snapshots where id = $1`, [s]);
  await db.query(`update ai_snapshots set status = 'published', published_at = now(), published_by_claimed = 'A' where id = $1`, [s]);
  await rejects(`update ai_snapshots set published_by_claimed = 'B' where id = $1`, [s]);
});

await ok('pointer snapshot mode needs published snapshot', async () => {
  const cand = (await db.query(`insert into ai_snapshots (version_no, content, checksum, core_version_frozen, created_by_claimed) values (2, '{}', 'c2', '1.0.0', 'A') returning id`)).rows[0].id;
  await rejects(`update ai_bot_pointers set mode = 'snapshot', snapshot_id = $1 where bot = 'eyad'`, [cand]);
  await rejects(`update ai_bot_pointers set mode = 'snapshot', snapshot_id = null where bot = 'eyad'`);
});

await ok('budget reservations never exceed the limit under concurrency', async () => {
  const calls = Array.from({ length: 20 }, () => db.query(`select ai_budget_reserve('trainer', 0.1, 1.0) as id`));
  const res = await Promise.all(calls);
  const granted = res.filter(r => r.rows[0].id !== null).length;
  assert.equal(granted, 10);
  const d = (await db.query(`select reserved_usd::float as r from ai_budget_days where pool = 'trainer'`)).rows[0];
  assert.ok(Math.abs(d.r - 1.0) < 1e-9);
});

await ok('settle and release', async () => {
  const id = (await db.query(`select id from ai_budget_reservations where status = 'reserved' limit 1`)).rows[0].id;
  await db.query(`select ai_budget_settle($1, 0.05)`, [id]);
  const id2 = (await db.query(`select id from ai_budget_reservations where status = 'reserved' limit 1`)).rows[0].id;
  await db.query(`select ai_budget_release($1)`, [id2]);
  const d = (await db.query(`select reserved_usd::float as r, spent_usd::float as s from ai_budget_days where pool = 'trainer'`)).rows[0];
  assert.ok(Math.abs(d.r - 0.8) < 1e-9 && Math.abs(d.s - 0.05) < 1e-9);
});

await ok('anon has no grants', async () => {
  const r = await db.query(`select count(*)::int as n from information_schema.role_table_grants where grantee in ('anon','authenticated') and table_name like 'ai_%'`);
  assert.equal(r.rows[0].n, 0);
});

console.log(`\n${pass} passed`);
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test:0037`
Expected: FAIL with `ENOENT … 0037_ai_trainer.sql`

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/0037_ai_trainer.sql`:

```sql
-- AI Trainer (docs/superpowers/specs/2026-10-18-wecon-ai-trainer-design.md).
-- Additive only: no existing table is changed. Every table has RLS on and no
-- policy, so the browser never reads or writes them over PostgREST; the
-- ai-trainer Edge Function does, with the service role. Both bot pointers are
-- seeded as 'legacy', so the bots keep their current behaviour until a
-- deliberate, tested cutover. gen_random_uuid() is built into Postgres 13+,
-- so no extension is needed.

-- ── content ────────────────────────────────────────────────────────────────
create table if not exists ai_trainer_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('project','fact','rule','behaviour','example')),
  revision int not null default 1,
  status text not null default 'active' check (status in ('active','retired')),
  bots text[] not null check (cardinality(bots) between 1 and 2 and bots <@ array['eyad','dubai']),
  project_ref uuid references ai_trainer_items(id),
  body jsonb not null check (jsonb_typeof(body) = 'object'),
  content_hash text not null,
  retired_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (project_ref is null or kind in ('fact','rule','example')),
  check (status = 'active' or coalesce(retired_reason, '') <> '')
);
create unique index if not exists ai_trainer_items_active_hash on ai_trainer_items (kind, content_hash) where status = 'active';

create table if not exists ai_trainer_item_revisions (
  item_id uuid not null references ai_trainer_items(id),
  revision int not null,
  kind text not null,
  status text not null,
  bots text[] not null,
  project_ref uuid,
  body jsonb not null,
  content_hash text not null,
  created_at timestamptz not null default now(),
  primary key (item_id, revision)
);

create table if not exists ai_trainer_audit (
  id bigint generated always as identity primary key,
  entity text not null,
  entity_id text not null,
  action text not null,
  before jsonb,
  after jsonb,
  reason text,
  actor_claimed text not null,
  auth_method text not null default 'trainer_key',
  verified_user_id text,
  at timestamptz not null default now()
);

-- ── tests ──────────────────────────────────────────────────────────────────
create table if not exists ai_tests (
  id uuid primary key default gen_random_uuid(),
  revision int not null default 1,
  status text not null default 'active' check (status in ('active','retired')),
  bots text[] not null check (cardinality(bots) between 1 and 2 and bots <@ array['eyad','dubai']),
  spec jsonb not null check (jsonb_typeof(spec) = 'object'),
  origin text not null check (origin in ('playground','real','handwritten')),
  retired_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status = 'active' or coalesce(retired_reason, '') <> '')
);

create table if not exists ai_test_revisions (
  test_id uuid not null references ai_tests(id),
  revision int not null,
  status text not null,
  bots text[] not null,
  spec jsonb not null,
  change_reason text,
  created_at timestamptz not null default now(),
  primary key (test_id, revision)
);

-- ── snapshots and pointers ─────────────────────────────────────────────────
create table if not exists ai_snapshots (
  id uuid primary key default gen_random_uuid(),
  version_no int not null unique,
  status text not null default 'candidate' check (status in ('candidate','published')),
  content jsonb not null,
  checksum text not null,
  core_version_frozen text not null,
  created_by_claimed text not null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  published_by_claimed text
);

create table if not exists ai_bot_pointers (
  bot text primary key check (bot in ('eyad','dubai')),
  mode text not null default 'legacy' check (mode in ('legacy','snapshot')),
  snapshot_id uuid references ai_snapshots(id),
  changed_at timestamptz not null default now(),
  changed_by_claimed text,
  reason text,
  check ((mode = 'legacy' and snapshot_id is null) or (mode = 'snapshot' and snapshot_id is not null))
);
insert into ai_bot_pointers (bot) values ('eyad'), ('dubai') on conflict do nothing;

-- ── runs ───────────────────────────────────────────────────────────────────
create table if not exists ai_test_runs (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references ai_snapshots(id),
  snapshot_checksum text not null,
  bot text not null check (bot in ('eyad','dubai')),
  core_version text not null,
  reply_model text not null,
  judge_model text not null,
  prompt_version text not null,
  rubric_version text not null,
  status text not null default 'running' check (status in ('running','complete','incomplete','aborted')),
  test_ids uuid[] not null,
  counts jsonb not null default '{}',
  cost_usd numeric not null default 0,
  started_by_claimed text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists ai_test_results (
  id bigint generated always as identity primary key,
  run_id uuid not null references ai_test_runs(id),
  test_id uuid not null,
  test_revision int not null,
  reply jsonb not null,
  checks jsonb not null,
  judge jsonb not null,
  verdict text not null check (verdict in ('PASS','FAIL','INCONCLUSIVE')),
  created_at timestamptz not null default now(),
  unique (run_id, test_id)
);

create table if not exists ai_trainer_imports (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  report jsonb not null,
  actor_claimed text not null,
  at timestamptz not null default now()
);

-- ── runtime tables used at bot cutover (created now, unused in the MVP) ────
create table if not exists ai_conversation_state (
  conversation_id text primary key,
  bot text not null check (bot in ('eyad','dubai')),
  state jsonb not null default '{}',
  paused boolean not null default false,
  lease_turn_id uuid,
  lease_until timestamptz,
  revision int not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists ai_turns (
  id uuid primary key default gen_random_uuid(),
  bot text not null,
  conversation_id text not null,
  snapshot_id uuid,
  snapshot_checksum text,
  core_version text not null,
  model text,
  trace jsonb,
  outcome text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists ai_handoffs (
  id uuid primary key default gen_random_uuid(),
  conversation_id text not null,
  bot text not null,
  reason text not null,
  turn_id uuid,
  status text not null default 'open' check (status in ('open','closed')),
  notify_status text not null default 'pending' check (notify_status in ('pending','sent','failed')),
  notify_attempts int not null default 0,
  notify_last_error text,
  customer_msg_status text not null default 'pending' check (customer_msg_status in ('pending','sent','failed','skipped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists ai_handoffs_one_open on ai_handoffs (conversation_id) where status = 'open';

-- ── budget ─────────────────────────────────────────────────────────────────
create table if not exists ai_budget_days (
  pool text not null check (pool in ('trainer','live')),
  day date not null,
  limit_usd numeric not null,
  reserved_usd numeric not null default 0,
  spent_usd numeric not null default 0,
  primary key (pool, day)
);

create table if not exists ai_budget_reservations (
  id uuid primary key default gen_random_uuid(),
  pool text not null,
  day date not null,
  estimate_usd numeric not null check (estimate_usd > 0),
  actual_usd numeric,
  status text not null default 'reserved' check (status in ('reserved','settled','released')),
  created_at timestamptz not null default now()
);

-- One statement, row-locked: concurrent callers serialise on the day row, so
-- reserved + spent can never exceed the limit. Reservations older than 10
-- minutes that were never settled are first counted as spent at their
-- estimate, so a crash only ever makes the budget stricter.
create or replace function ai_budget_reserve(p_pool text, p_estimate numeric, p_limit numeric)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_day date := (now() at time zone 'Asia/Dhaka')::date; v_id uuid; v_ok int;
begin
  insert into ai_budget_days (pool, day, limit_usd) values (p_pool, v_day, p_limit) on conflict do nothing;
  perform 1 from ai_budget_days where pool = p_pool and day = v_day for update;
  with stale as (
    update ai_budget_reservations set status = 'settled', actual_usd = estimate_usd
     where pool = p_pool and day = v_day and status = 'reserved' and created_at < now() - interval '10 minutes'
     returning estimate_usd)
  update ai_budget_days set reserved_usd = reserved_usd - coalesce((select sum(estimate_usd) from stale), 0),
                            spent_usd = spent_usd + coalesce((select sum(estimate_usd) from stale), 0)
   where pool = p_pool and day = v_day;
  update ai_budget_days set reserved_usd = reserved_usd + p_estimate
   where pool = p_pool and day = v_day and spent_usd + reserved_usd + p_estimate <= limit_usd;
  get diagnostics v_ok = row_count;
  if v_ok = 0 then return null; end if;
  insert into ai_budget_reservations (pool, day, estimate_usd) values (p_pool, v_day, p_estimate) returning id into v_id;
  return v_id;
end $$;

create or replace function ai_budget_settle(p_id uuid, p_actual numeric)
returns void language plpgsql security definer set search_path = public as $$
declare r ai_budget_reservations;
begin
  update ai_budget_reservations set status = 'settled', actual_usd = p_actual
   where id = p_id and status = 'reserved' returning * into r;
  if not found then return; end if;
  update ai_budget_days set reserved_usd = reserved_usd - r.estimate_usd, spent_usd = spent_usd + p_actual
   where pool = r.pool and day = r.day;
end $$;

create or replace function ai_budget_release(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r ai_budget_reservations;
begin
  update ai_budget_reservations set status = 'released' where id = p_id and status = 'reserved' returning * into r;
  if not found then return; end if;
  update ai_budget_days set reserved_usd = reserved_usd - r.estimate_usd where pool = r.pool and day = r.day;
end $$;

-- ── item save: revision check, revision copy and audit in one transaction ──
-- p_item: {id?, kind, bots, project_ref, body, content_hash, status?}.
-- p_expected_revision: 0 for a new item, else the revision the editor loaded.
-- Raises 'revision_conflict' on a stale save and 'duplicate_content' on a
-- second active item with the same content.
create or replace function ai_item_save(p_item jsonb, p_expected_revision int, p_actor text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_before ai_trainer_items; v_after ai_trainer_items; v_status text := coalesce(p_item->>'status', 'active');
begin
  if v_status = 'retired' and coalesce(p_reason, '') = '' then raise exception 'reason_required'; end if;
  if p_expected_revision = 0 then
    insert into ai_trainer_items (kind, bots, project_ref, body, content_hash, status, retired_reason)
    values (p_item->>'kind', array(select jsonb_array_elements_text(p_item->'bots')),
            nullif(p_item->>'project_ref', '')::uuid, p_item->'body', p_item->>'content_hash', v_status,
            case when v_status = 'retired' then p_reason end)
    returning * into v_after;
  else
    select * into v_before from ai_trainer_items where id = (p_item->>'id')::uuid for update;
    if not found then raise exception 'not_found'; end if;
    if v_before.revision <> p_expected_revision then raise exception 'revision_conflict'; end if;
    update ai_trainer_items set
      bots = array(select jsonb_array_elements_text(p_item->'bots')),
      project_ref = nullif(p_item->>'project_ref', '')::uuid,
      body = p_item->'body', content_hash = p_item->>'content_hash', status = v_status,
      retired_reason = case when v_status = 'retired' then p_reason end,
      revision = revision + 1, updated_at = now()
    where id = v_before.id returning * into v_after;
  end if;
  insert into ai_trainer_item_revisions (item_id, revision, kind, status, bots, project_ref, body, content_hash)
  values (v_after.id, v_after.revision, v_after.kind, v_after.status, v_after.bots, v_after.project_ref, v_after.body, v_after.content_hash);
  insert into ai_trainer_audit (entity, entity_id, action, before, after, reason, actor_claimed)
  values ('item', v_after.id::text, case when v_before.id is null then 'create' when v_status = 'retired' then 'retire' else 'update' end,
          to_jsonb(v_before), to_jsonb(v_after), p_reason, p_actor);
  return jsonb_build_object('id', v_after.id, 'revision', v_after.revision);
exception when unique_violation then raise exception 'duplicate_content';
end $$;

-- ── immutability triggers ──────────────────────────────────────────────────
create or replace function ai_reject_change() returns trigger language plpgsql as $$
begin raise exception '% is append-only', tg_table_name; end $$;

do $$ declare t text; begin
  foreach t in array array['ai_trainer_item_revisions','ai_trainer_audit','ai_test_revisions','ai_test_results','ai_trainer_imports'] loop
    execute format('drop trigger if exists %I_append_only on %I', t, t);
    execute format('create trigger %I_append_only before update or delete on %I for each row execute function ai_reject_change()', t, t);
  end loop;
end $$;

-- A snapshot's content and checksum never change. The only allowed update is
-- publishing it once: status candidate → published with publisher and time.
create or replace function ai_snapshot_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'ai_snapshots cannot be deleted'; end if;
  if new.content is distinct from old.content or new.checksum is distinct from old.checksum
     or new.version_no is distinct from old.version_no or new.core_version_frozen is distinct from old.core_version_frozen
     or new.created_by_claimed is distinct from old.created_by_claimed or new.created_at is distinct from old.created_at then
    raise exception 'ai_snapshots content is immutable';
  end if;
  if old.status = 'published' and (new.status <> 'published' or new.published_at is distinct from old.published_at
     or new.published_by_claimed is distinct from old.published_by_claimed) then
    raise exception 'ai_snapshots publish fields are set once';
  end if;
  return new;
end $$;
drop trigger if exists ai_snapshots_guard on ai_snapshots;
create trigger ai_snapshots_guard before update or delete on ai_snapshots for each row execute function ai_snapshot_guard();

-- A run is finalised once; after that it cannot change.
create or replace function ai_run_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'ai_test_runs cannot be deleted'; end if;
  if old.status <> 'running' then raise exception 'ai_test_runs is final'; end if;
  return new;
end $$;
drop trigger if exists ai_test_runs_guard on ai_test_runs;
create trigger ai_test_runs_guard before update or delete on ai_test_runs for each row execute function ai_run_guard();

-- Pointer in snapshot mode must reference a published snapshot.
create or replace function ai_pointer_guard() returns trigger language plpgsql as $$
begin
  if new.mode = 'snapshot' and not exists (select 1 from ai_snapshots where id = new.snapshot_id and status = 'published') then
    raise exception 'pointer must reference a published snapshot';
  end if;
  return new;
end $$;
drop trigger if exists ai_bot_pointers_guard on ai_bot_pointers;
create trigger ai_bot_pointers_guard before insert or update on ai_bot_pointers for each row execute function ai_pointer_guard();

-- ── access: service role only ──────────────────────────────────────────────
do $$ declare t text; begin
  foreach t in array array['ai_trainer_items','ai_trainer_item_revisions','ai_trainer_audit','ai_tests','ai_test_revisions',
    'ai_snapshots','ai_bot_pointers','ai_test_runs','ai_test_results','ai_trainer_imports','ai_conversation_state','ai_turns',
    'ai_handoffs','ai_budget_days','ai_budget_reservations'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon, authenticated', t);
  end loop;
end $$;
revoke all on function ai_budget_reserve(text, numeric, numeric), ai_budget_settle(uuid, numeric), ai_budget_release(uuid),
  ai_item_save(jsonb, int, text, text) from public, anon, authenticated;
grant execute on function ai_budget_reserve(text, numeric, numeric), ai_budget_settle(uuid, numeric), ai_budget_release(uuid),
  ai_item_save(jsonb, int, text, text) to service_role;
```

- [ ] **Step 5: Run the tests**

Run: `npm run test:0037`
Expected: every line `ok …`, then `12 passed`. If `budget reservations never exceed the limit` fails because PGlite runs queries serially, the assertion still holds (10 granted); a different count is a real bug.

- [ ] **Step 6: Write the ops scripts**

Create `supabase/ops/0037_preflight.sql`:

```sql
-- Read-only. Run before applying 0037. Every row should say ok.
select 'no ai_ tables yet' as check, case when count(*) = 0 then 'ok' else 'STOP: ' || string_agg(table_name, ',') end as result
  from information_schema.tables where table_schema = 'public' and table_name like 'ai\_%';
select 'postgres 13 or later' as check, case when current_setting('server_version_num')::int >= 130000 then 'ok' else 'STOP' end;
```

Create `supabase/ops/0037_verify.sql`:

```sql
-- Read-only. Run after applying 0037. Every row should say PASS.
select 'tables' as check, case when count(*) = 15 then 'PASS' else 'FAIL ' || count(*) end
  from information_schema.tables where table_schema = 'public' and table_name like 'ai\_%';
select 'rls on' as check, case when bool_and(relrowsecurity) then 'PASS' else 'FAIL' end
  from pg_class where relname like 'ai\_%' and relkind = 'r';
select 'no anon grants' as check, case when count(*) = 0 then 'PASS' else 'FAIL' end
  from information_schema.role_table_grants where grantee in ('anon','authenticated') and table_name like 'ai\_%';
select 'pointers legacy' as check, case when count(*) = 2 and bool_and(mode = 'legacy') then 'PASS' else 'FAIL' end
  from ai_bot_pointers;
select 'anon cannot reserve budget' as check,
  case when has_function_privilege('anon', 'ai_budget_reserve(text, numeric, numeric)', 'execute') then 'FAIL' else 'PASS' end;
```

Create `supabase/ops/0037_rollback.sql`:

```sql
-- Drops everything 0037 created. Only valid while both pointers are 'legacy'
-- (the bots do not read these tables in legacy mode). Destroys trainer data.
do $$ begin
  if exists (select 1 from ai_bot_pointers where mode <> 'legacy') then
    raise exception 'a bot is not in legacy mode; move it back first';
  end if;
end $$;
drop table if exists ai_test_results, ai_test_runs, ai_bot_pointers, ai_snapshots, ai_test_revisions, ai_tests,
  ai_trainer_audit, ai_trainer_item_revisions, ai_trainer_imports, ai_conversation_state, ai_turns, ai_handoffs,
  ai_budget_reservations, ai_budget_days, ai_trainer_items cascade;
drop function if exists ai_budget_reserve(text, numeric, numeric), ai_budget_settle(uuid, numeric), ai_budget_release(uuid),
  ai_item_save(jsonb, int, text, text), ai_reject_change(), ai_snapshot_guard(), ai_run_guard(), ai_pointer_guard();
```

- [ ] **Step 7: Verify rollback restores a clean state**

Append to `scripts/test-0037.mjs`, before the final `console.log`:

```js
await ok('rollback drops everything', async () => {
  await db.exec(readFileSync('supabase/ops/0037_rollback.sql', 'utf8'));
  const r = await db.query(`select count(*)::int as n from information_schema.tables where table_name like 'ai\\_%'`);
  assert.equal(r.rows[0].n, 0);
  await db.exec(readFileSync('supabase/migrations/0037_ai_trainer.sql', 'utf8'));
});
```

Run: `npm run test:0037`
Expected: `13 passed`

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json supabase/migrations/0037_ai_trainer.sql supabase/ops/0037_*.sql scripts/test-0037.mjs
git commit -m "feat(ai-trainer): migration 0037 with immutability, scope and atomic budget

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: trainer-core context — freeze, language, project resolution, history

**Files:**
- Modify: `supabase/functions/_shared/trainer-core.ts`
- Modify: `supabase/functions/_shared/trainer-core.test.ts`

**Interfaces:**
- Consumes: Task 1 exports.
- Produces:
  - `type ItemRow = { id: string; kind: Kind; revision: number; status: 'active'|'retired'; bots: Bot[]; project_ref: string|null; body: any }`
  - `type SnapshotContent = { schema: 1; projects: ItemRow[]; items: ItemRow[]; retrieval: { mode: 'full' }; model_config: { reply_model: string; max_tokens: number }; prompt_version: string; rubric: { key: string; version: number } }`
  - `freezeContent(rows: ItemRow[], cfg: { reply_model: string; max_tokens: number; rubric_version: number }): { content: SnapshotContent; errors: string[] }`
  - `detectLanguage(text: string): 'bn'|'banglish'|'en'`
  - `type Turn = { role: 'customer'|'bot'|'agent'; text: string }`
  - `type ConvState = { active_project: string|null; active_source: 'explicit'|'ad'|'state'|null; language: 'bn'|'banglish'|'en'|null; first_price_at: Record<string,string>; asked: string[]; paused: boolean }`
  - `emptyState(): ConvState`
  - `resolveProject(text: string, state: ConvState, ad: { isAd: boolean; adText?: string }, projects: ItemRow[]): { projects: string[]; source: 'explicit'|'state'|'ad'|null; ambiguous: boolean }`
  - `buildHistory(rows: Turn[], limit?: number): Turn[]`

- [ ] **Step 1: Write the failing tests**

Append to `trainer-core.test.ts`:

```ts
import { freezeContent, detectLanguage, resolveProject, buildHistory, emptyState, type ItemRow } from "./trainer-core.ts";

const P = (id: string, name: string, aliases: any, extra: any = {}): ItemRow => ({
  id, kind: "project", revision: 1, status: "active", bots: ["eyad", "dubai"], project_ref: null,
  body: { name, aliases, media: { photos: [], floor_plans: [] }, ...extra },
});
const NUZ = P("p-nuz", "Wecon Nuznan", { bn: ["নুজনান"], banglish: ["nuznan", "nunan"], en: ["nuznan"] }, { tags: ["jolshiri"] });
const OSM = P("p-osm", "Wecon Osman Bellevue", { bn: ["ওসমান"], banglish: ["osman", "bellevue"], en: ["osman bellevue"] }, { tags: ["jolshiri"] });
const SUM = P("p-sum", "Wecon Summer Breeze", { banglish: ["summer breeze"], en: ["summer breeze"] });

test("freezeContent keeps active items, sorts by id, rejects dangling project refs", () => {
  const fact = { id: "f1", kind: "fact", revision: 2, status: "active", bots: ["eyad"], project_ref: "p-nuz", body: { topic: "a", text: "b" } } as ItemRow;
  const dead = { ...fact, id: "f0", status: "retired" } as ItemRow;
  const { content, errors } = freezeContent([fact, NUZ, dead], { reply_model: "m", max_tokens: 600, rubric_version: 1 });
  assert.deepEqual(errors, []);
  assert.deepEqual(content.items.map((i) => i.id), ["f1"]);
  assert.deepEqual(content.projects.map((p) => p.id), ["p-nuz"]);
  const orphan = { ...fact, project_ref: "p-x" } as ItemRow;
  assert.ok(freezeContent([orphan], { reply_model: "m", max_tokens: 600, rubric_version: 1 }).errors.length > 0);
});

test("freezeContent rejects an alias shared by two projects", () => {
  const dup = P("p-2", "Other", { banglish: ["nuznan"] });
  assert.ok(freezeContent([NUZ, dup], { reply_model: "m", max_tokens: 600, rubric_version: 1 }).errors.some((e) => e.includes("alias")));
});

test("detectLanguage", () => {
  assert.equal(detectLanguage("দাম কত?"), "bn");
  assert.equal(detectLanguage("Nuznan er size কত?"), "bn");
  assert.equal(detectLanguage("nuznan er dam koto?"), "banglish");
  assert.equal(detectLanguage("What is the price of Nuznan?"), "en");
  assert.equal(detectLanguage("‌‍"), "en");
});

test("resolveProject: explicit alias wins, Bangla script works", () => {
  const r = resolveProject("ওসমান প্রজেক্টের লোকেশন?", emptyState(), { isAd: false }, [NUZ, OSM, SUM]);
  assert.deepEqual(r, { projects: ["p-osm"], source: "explicit", ambiguous: false });
  assert.deepEqual(resolveProject("nunan er brochure", emptyState(), { isAd: false }, [NUZ, OSM]).projects, ["p-nuz"]);
});

test("resolveProject: two named projects", () => {
  const r = resolveProject("Nuznan ar Osman duitar size?", emptyState(), { isAd: false }, [NUZ, OSM]);
  assert.deepEqual(r.projects.sort(), ["p-nuz", "p-osm"]);
});

test("resolveProject: generic word alone resolves nothing", () => {
  assert.deepEqual(resolveProject("summer", emptyState(), { isAd: false }, [SUM]).projects, []);
});

test("resolveProject: state then ad, ad only when unambiguous", () => {
  const st = { ...emptyState(), active_project: "p-nuz", active_source: "explicit" as const };
  assert.deepEqual(resolveProject("location?", st, { isAd: false }, [NUZ, OSM]), { projects: ["p-nuz"], source: "state", ambiguous: false });
  assert.deepEqual(resolveProject("info", emptyState(), { isAd: true, adText: "Wecon Osman Bellevue Jolshiri" }, [NUZ, OSM]).projects, ["p-osm"]);
  const amb = resolveProject("info", emptyState(), { isAd: true, adText: "Nuznan and Osman" }, [NUZ, OSM]);
  assert.deepEqual(amb, { projects: [], source: null, ambiguous: true });
  assert.deepEqual(resolveProject("price koto?", emptyState(), { isAd: false }, [NUZ, OSM]).projects, []);
});

test("buildHistory excludes every agent slash command and its trailing note (spec 10.5.1, CC-46)", () => {
  const rows = [
    { role: "customer", text: "nuznan er dam koto?" },
    { role: "agent", text: "/fdh this client is looking in the 1st floor with long payment" },
    { role: "agent", text: "  /n you are good that's lets meet in the office" },
    { role: "agent", text: "/t" }, { role: "agent", text: "/FMKT its a testing data" }, { role: "agent", text: "/sendnz" },
    { role: "customer", text: "/fdh" }, { role: "agent", text: "Assalamu alaikum, ami Rahim" },
  ] as any;
  assert.deepEqual(buildHistory(rows), [
    { role: "customer", text: "nuznan er dam koto?" },
    { role: "customer", text: "/fdh" },
    { role: "agent", text: "Assalamu alaikum, ami Rahim" },
  ]);
});

test("buildHistory drops commands, keeps agent label, caps length", () => {
  const rows = [
    { role: "customer", text: "hi" }, { role: "agent", text: "/fdh note about client" },
    { role: "agent", text: "Hello, I am Rahim" }, { role: "bot", text: "" },
  ] as any;
  assert.deepEqual(buildHistory(rows), [{ role: "customer", text: "hi" }, { role: "agent", text: "Hello, I am Rahim" }]);
  const many = Array.from({ length: 30 }, (_, i) => ({ role: "customer", text: String(i) })) as any;
  assert.equal(buildHistory(many).length, 20);
  assert.equal(buildHistory(many)[0].text, "10");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test supabase/functions/_shared/trainer-core.test.ts`
Expected: FAIL with `does not provide an export named 'freezeContent'`

- [ ] **Step 3: Implement**

Append to `trainer-core.ts`:

```ts
// ── snapshot freeze ─────────────────────────────────────────────────────────
export type ItemRow = {
  id: string; kind: Kind; revision: number; status: "active" | "retired";
  bots: Bot[]; project_ref: string | null; body: any;
};
export type SnapshotContent = {
  schema: 1; projects: ItemRow[]; items: ItemRow[]; retrieval: { mode: "full" };
  model_config: { reply_model: string; max_tokens: number }; prompt_version: string;
  rubric: { key: string; version: number };
};
export const PROMPT_VERSION = "p1";

const norm = (s: string) => s.normalize("NFC").replace(/[​-‍﻿]/g, "").toLowerCase().trim();

function aliasesOf(p: ItemRow): string[] {
  const a = p.body?.aliases || {};
  return [p.body?.name, ...(a.bn || []), ...(a.banglish || []), ...(a.en || [])]
    .filter((x) => typeof x === "string" && x.trim()).map(norm);
}

// Copies active rows by value, sorted by id, so the content (and its checksum)
// depends only on what is active, not on load order.
export function freezeContent(
  rows: ItemRow[], cfg: { reply_model: string; max_tokens: number; rubric_version: number },
): { content: SnapshotContent; errors: string[] } {
  const active = rows.filter((r) => r.status === "active");
  const byId = (a: ItemRow, b: ItemRow) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const projects = active.filter((r) => r.kind === "project").sort(byId);
  const items = active.filter((r) => r.kind !== "project").sort(byId);
  const errors: string[] = [];
  const pids = new Set(projects.map((p) => p.id));
  for (const r of active) {
    for (const e of validateItem(r.kind, r.body)) errors.push(`${r.kind} ${r.id}: ${e}`);
    if (r.project_ref && !pids.has(r.project_ref)) errors.push(`${r.kind} ${r.id}: project ${r.project_ref} is not in the snapshot`);
  }
  const seen = new Map<string, string>();
  for (const p of projects) for (const a of new Set(aliasesOf(p))) {
    const other = seen.get(a);
    if (other && other !== p.id) errors.push(`alias "${a}" is used by ${other} and ${p.id}`);
    seen.set(a, p.id);
  }
  const strip = (r: ItemRow): ItemRow => ({
    id: r.id, kind: r.kind, revision: r.revision, status: r.status, bots: [...r.bots].sort() as Bot[],
    project_ref: r.project_ref, body: r.body,
  });
  return {
    errors,
    content: {
      schema: 1, projects: projects.map(strip), items: items.map(strip), retrieval: { mode: "full" },
      model_config: { reply_model: cfg.reply_model, max_tokens: cfg.max_tokens },
      prompt_version: PROMPT_VERSION, rubric: { key: "sales-default", version: cfg.rubric_version },
    },
  };
}

// ── language ────────────────────────────────────────────────────────────────
const BANGLISH = ["ami", "apni", "apnar", "koto", "dam", "taka", "ache", "achhe", "chai", "den", "dao", "kothay",
  "jomi", "kemon", "er", "ki", "na", "hobe", "korte", "bolen", "dite", "pathan", "kobe", "kono", "shob", "sob"];

export function detectLanguage(text: string): "bn" | "banglish" | "en" {
  const t = norm(text);
  const letters = [...t].filter((c) => /\p{L}/u.test(c));
  if (!letters.length) return "en";
  const bangla = letters.filter((c) => /[ঀ-৿]/.test(c)).length;
  if (bangla / letters.length >= 0.3 || bangla >= 2) return "bn";
  const words = t.split(/[^a-z]+/).filter(Boolean);
  const hits = words.filter((w) => BANGLISH.includes(w)).length;
  return hits >= 1 && hits / words.length >= 0.2 ? "banglish" : "en";
}

// ── conversation state and project resolution ───────────────────────────────
export type Turn = { role: "customer" | "bot" | "agent"; text: string };
export type ConvState = {
  active_project: string | null; active_source: "explicit" | "ad" | "state" | null;
  language: "bn" | "banglish" | "en" | null; first_price_at: Record<string, string>; asked: string[]; paused: boolean;
};
export const emptyState = (): ConvState => ({
  active_project: null, active_source: null, language: null, first_price_at: {}, asked: [], paused: false,
});

// A word that is a common English word never resolves a project on its own;
// it only counts as part of a longer alias such as "summer breeze".
const GENERIC = new Set(["summer", "arcade", "heritage", "breeze", "wecon", "mall", "manor", "orchid", "dale"]);

// \p{M} is kept: Bangla vowel signs and the hasanta are combining marks, and
// dropping them would split a word like "ওসমান" in two.
function mentioned(text: string, projects: ItemRow[]): string[] {
  const t = ` ${norm(text).replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")} `;
  const hit = new Set<string>();
  for (const p of projects) {
    for (const a of aliasesOf(p)) {
      const alias = a.replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim();
      if (!alias || GENERIC.has(alias)) continue;
      if (t.includes(` ${alias} `) || (/[ঀ-৿]/.test(alias) && t.includes(alias))) { hit.add(p.id); break; }
    }
  }
  return [...hit];
}

export function resolveProject(
  text: string, state: ConvState, ad: { isAd: boolean; adText?: string }, projects: ItemRow[],
): { projects: string[]; source: "explicit" | "state" | "ad" | null; ambiguous: boolean } {
  const named = mentioned(text, projects);
  if (named.length) return { projects: named, source: "explicit", ambiguous: false };
  if (state.active_project && projects.some((p) => p.id === state.active_project)) {
    return { projects: [state.active_project], source: "state", ambiguous: false };
  }
  if (ad.isAd && ad.adText) {
    const fromAd = mentioned(ad.adText, projects);
    if (fromAd.length === 1) return { projects: fromAd, source: "ad", ambiguous: false };
    if (fromAd.length > 1) return { projects: [], source: null, ambiguous: true };
  }
  return { projects: [], source: null, ambiguous: false };
}

// ── history ────────────────────────────────────────────────────────────────
// Agent commands (/f…, /n…, /t) and empty rows never reach the model; human
// agent messages are labelled as the sales agent, not as the bot.
export function buildHistory(rows: Turn[], limit = 20): Turn[] {
  return rows.filter((r) => r.text && r.text.trim() && !(r.role === "agent" && r.text.trim().startsWith("/")))
    .slice(-limit);
}
```

- [ ] **Step 4: Run tests**

Run: `node --test supabase/functions/_shared/trainer-core.test.ts`
Expected: PASS, `fail 0`

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/trainer-core.ts supabase/functions/_shared/trainer-core.test.ts
git commit -m "feat(ai-trainer): snapshot freeze, language, project resolution, history

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: trainer-core turn — prompt, output parsing, guards, media, runTurn

**Files:**
- Modify: `supabase/functions/_shared/trainer-core.ts`
- Modify: `supabase/functions/_shared/trainer-core.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 3.
- Produces:
  - `type ModelOut = { intent: string; project_ref: string|null; language: 'bn'|'banglish'|'en'; reply: string; media: { type: 'photo'|'floorplan'|'brochure'|'map'; project_ref: string; floor?: string }[]; handoff: boolean; asked: string[]; used_item_ids: string[]; clarify: boolean }`
  - `buildPrompt(c: SnapshotContent, bot: Bot, history: Turn[], text: string, state: ConvState, resolved: string[], lang: string): { system: string; messages: { role: 'user'|'assistant'; content: string }[] }`
  - `parseModelOutput(raw: string): ModelOut | null`
  - `guardReply(out: ModelOut, c: SnapshotContent, resolved: string[], evidenceText: string): string[]`
  - `type MediaAction = { type: 'image'|'document'; url: string; caption: string; kind: string; project_ref: string; floor?: string }`
  - `resolveMedia(out: ModelOut, c: SnapshotContent): { actions: MediaAction[]; missing: string[]; clarify: string|null }`
  - `type Ports = { callModel: (req: { model: string; max_tokens: number; system: string; messages: { role: 'user'|'assistant'; content: string }[] }) => Promise<{ ok: true; text: string; cost_usd: number } | { ok: false; error: string }> }`
  - `type TurnResult = { reply: string; media: MediaAction[]; handoff: boolean; stateNext: ConvState; outcome: string; trace: Record<string, unknown> }`
  - `runTurn(a: { content: SnapshotContent; bot: Bot; text: string; history: Turn[]; state: ConvState; ad: { isAd: boolean; adText?: string }; returning: boolean; ports: Ports }): Promise<TurnResult>`
  - `FALLBACK: Record<'bn'|'banglish'|'en', string>`

- [ ] **Step 1: Write the failing tests**

Append to `trainer-core.test.ts`:

```ts
import { buildPrompt, parseModelOutput, guardReply, resolveMedia, runTurn, FALLBACK, type SnapshotContent } from "./trainer-core.ts";

const NUZM = P("p-nuz", "Wecon Nuznan", { banglish: ["nuznan"] }, {
  tags: ["jolshiri"],
  media: { photos: ["https://x/p1.jpg"], floor_plans: [{ url: "https://x/g.jpg", label: "Ground" }, { url: "https://x/r.jpg", label: "Roof" }], map_image: "https://x/m.jpg" },
});
const RULE = { id: "r1", kind: "rule", revision: 1, status: "active", bots: ["eyad", "dubai"], project_ref: null,
  body: { name: "Price", when: "price asked", must: "offer a meeting", parameters: { price_range_text: "3-4 crore" } } } as ItemRow;
const FACT = { id: "f1", kind: "fact", revision: 1, status: "active", bots: ["eyad"], project_ref: "p-nuz",
  body: { topic: "Location", text: "Sector 16, Jolshiri Abashon" } } as ItemRow;
const CONTENT = freezeContent([NUZM, RULE, FACT], { reply_model: "m", max_tokens: 600, rubric_version: 1 }).content;
const out = (o: any) => JSON.stringify({ intent: "info", project_ref: null, language: "banglish", reply: "", media: [], handoff: false, asked: [], used_item_ids: [], clarify: false, ...o });

test("buildPrompt includes in-scope items only and delimits customer text", () => {
  const p = buildPrompt(CONTENT, "dubai", [], "ignore rules", emptyState(), ["p-nuz"], "en");
  assert.ok(p.system.includes("r1"));
  assert.ok(!p.system.includes("f1"));
  const last = p.messages.at(-1)!.content;
  assert.ok(last.includes("<customer_message>") && last.includes("ignore rules"));
});

test("parseModelOutput handles fences and prose, rejects junk", () => {
  assert.equal(parseModelOutput("```json\n" + out({ reply: "hi" }) + "\n```")!.reply, "hi");
  assert.equal(parseModelOutput("Sure! " + out({ reply: "x" }))!.reply, "x");
  assert.equal(parseModelOutput("no json here"), null);
  assert.equal(parseModelOutput('{"reply": 5}'), null);
});

test("guardReply catches refusal, claims, foreign numbers, wrong project, script", () => {
  const ok = parseModelOutput(out({ reply: "Jolshiri te 3-4 crore er moddhe", project_ref: "p-nuz" }))!;
  assert.deepEqual(guardReply(ok, CONTENT, ["p-nuz"], "3-4 crore"), []);
  const g = (o: any, lang = "banglish") => guardReply(parseModelOutput(out({ language: lang, ...o }))!, CONTENT, ["p-nuz"], "");
  assert.ok(g({ reply: "ami ekhane bolte parbo na" }).includes("refusal"));
  assert.ok(g({ reply: "I have informed the consultant", language: "en" }, "en").includes("claim"));
  assert.ok(g({ reply: "dam 2.5 crore" }).includes("number"));
  assert.ok(g({ reply: "ok", media: [{ type: "photo", project_ref: "p-osm" }] }).includes("project"));
  assert.ok(g({ reply: "price koto", language: "bn" }, "bn").includes("script"));
});

test("resolveMedia: labelled floor, unlabelled asks, missing never promised, all", () => {
  const r1 = resolveMedia(parseModelOutput(out({ media: [{ type: "floorplan", project_ref: "p-nuz", floor: "roof" }] }))!, CONTENT);
  assert.deepEqual(r1.actions.map((a) => a.url), ["https://x/r.jpg"]);
  const r2 = resolveMedia(parseModelOutput(out({ media: [{ type: "floorplan", project_ref: "p-nuz", floor: "2nd" }] }))!, CONTENT);
  assert.equal(r2.actions.length, 0);
  assert.match(r2.clarify!, /Ground.*Roof/);
  const r3 = resolveMedia(parseModelOutput(out({ media: [{ type: "brochure", project_ref: "p-nuz" }] }))!, CONTENT);
  assert.deepEqual(r3.missing, ["brochure"]);
  const r4 = resolveMedia(parseModelOutput(out({ media: [{ type: "floorplan", project_ref: "p-nuz", floor: "all" }] }))!, CONTENT);
  assert.equal(r4.actions.length, 2);
});

const stub = (...texts: string[]) => {
  const calls: any[] = [];
  return { calls, ports: { callModel: async (req: any) => { calls.push(req); const t = texts.shift(); return t === undefined ? { ok: false as const, error: "down" } : { ok: true as const, text: t, cost_usd: 0.001 }; } } };
};

test("runTurn: greeting-only from returning contact makes no model call", async () => {
  const s = stub();
  const r = await runTurn({ content: CONTENT, bot: "eyad", text: "assalamu alaikum", history: [], state: emptyState(), ad: { isAd: false }, returning: true, ports: s.ports });
  assert.equal(r.reply, ""); assert.equal(r.outcome, "skipped_greeting"); assert.equal(s.calls.length, 0);
});

test("runTurn: wants a person gives handoff without model", async () => {
  const s = stub();
  const r = await runTurn({ content: CONTENT, bot: "eyad", text: "agent er sathe kotha bolte chai", history: [], state: emptyState(), ad: { isAd: false }, returning: false, ports: s.ports });
  assert.equal(r.handoff, true); assert.equal(s.calls.length, 0); assert.ok(!/informed/i.test(r.reply));
});

test("runTurn: carries project in state across turns", async () => {
  const s = stub(out({ reply: "Nuznan Jolshiri te", project_ref: "p-nuz", used_item_ids: ["f1"] }), out({ reply: "Sector 16, Jolshiri Abashon", project_ref: "p-nuz" }));
  const t1 = await runTurn({ content: CONTENT, bot: "eyad", text: "nuznan kothay?", history: [], state: emptyState(), ad: { isAd: false }, returning: false, ports: s.ports });
  assert.equal(t1.stateNext.active_project, "p-nuz");
  const t2 = await runTurn({ content: CONTENT, bot: "eyad", text: "location?", history: [{ role: "customer", text: "nuznan kothay?" }, { role: "bot", text: t1.reply }], state: t1.stateNext, ad: { isAd: false }, returning: true, ports: s.ports });
  assert.equal(t2.outcome, "ok");
  assert.ok((s.calls[1].system as string).includes("f1"));
});

test("runTurn: invalid output re-asks once, then fallback plus handoff", async () => {
  const s = stub("garbage", "still garbage");
  const r = await runTurn({ content: CONTENT, bot: "eyad", text: "nuznan er dam koto?", history: [], state: emptyState(), ad: { isAd: false }, returning: false, ports: s.ports });
  assert.equal(s.calls.length, 2); assert.equal(r.outcome, "fallback_invalid_output"); assert.equal(r.reply, FALLBACK.banglish); assert.equal(r.handoff, true);
});

test("runTurn: model down gives fallback, never silence", async () => {
  const s = stub();
  const r = await runTurn({ content: CONTENT, bot: "eyad", text: "What is the size of Nuznan?", history: [], state: emptyState(), ad: { isAd: false }, returning: false, ports: s.ports });
  assert.equal(r.outcome, "fallback_model_error"); assert.equal(r.reply, FALLBACK.en);
});

test("runTurn: guard failure re-asks, then accepts a clean reply", async () => {
  const s = stub(out({ reply: "ami bolte parbo na" }), out({ reply: "Ami ekta meeting set korte pari" }));
  const r = await runTurn({ content: CONTENT, bot: "eyad", text: "nuznan er dam koto?", history: [], state: emptyState(), ad: { isAd: false }, returning: false, ports: s.ports });
  assert.equal(r.outcome, "ok"); assert.equal(r.reply, "Ami ekta meeting set korte pari");
  assert.ok((s.calls[1].messages.at(-1).content as string).includes("refusal"));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test supabase/functions/_shared/trainer-core.test.ts`
Expected: FAIL with `does not provide an export named 'buildPrompt'`

- [ ] **Step 3: Implement**

Append to `trainer-core.ts`:

```ts
// ── prompt ──────────────────────────────────────────────────────────────────
export type ModelOut = {
  intent: string; project_ref: string | null; language: "bn" | "banglish" | "en"; reply: string;
  media: { type: "photo" | "floorplan" | "brochure" | "map"; project_ref: string; floor?: string }[];
  handoff: boolean; asked: string[]; used_item_ids: string[]; clarify: boolean;
};

const LANG_NAME = { bn: "Bangla in Bangla script", banglish: "Banglish (Bengali written in Latin letters)", en: "English" };

function projectLine(p: ItemRow): string {
  const b = p.body;
  const m = b.media || {};
  const floors = (m.floor_plans || []).map((f: any) => f.label || "unlabelled");
  const bits = [b.region && `region: ${b.region}`, b.type && `type: ${b.type}`, b.size_text && `size: ${b.size_text}`,
    b.address && `address: ${b.address}`, b.tags?.length && `tags: ${b.tags.join(", ")}`].filter(Boolean);
  const media = [m.photos?.length && "photos", floors.length && `floor plans: ${floors.join(", ")}`, m.brochure && "brochure",
    m.map_image && "map"].filter(Boolean);
  return `- [${p.id}] ${b.name} (${bits.join(" · ")})${media.length ? ` media: ${media.join(", ")}` : " media: none"}`;
}

export function buildPrompt(
  c: SnapshotContent, bot: Bot, history: Turn[], text: string, state: ConvState, resolved: string[], lang: string,
): { system: string; messages: { role: "user" | "assistant"; content: string }[] } {
  const scoped = c.items.filter((i) => itemApplies(i, bot, resolved));
  const of = (k: Kind) => scoped.filter((i) => i.kind === k);
  const resolvedProjects = c.projects.filter((p) => resolved.includes(p.id));
  const examples = of("example").slice(0, 6);
  const system = [
    "You are WECON Properties' WhatsApp sales consultant. Use ONLY the facts below. Never invent a project, price, size, availability or action.",
    "",
    "Catalog (names and regions):",
    ...c.projects.map((p) => `- [${p.id}] ${p.body.name}${p.body.region ? ` (${p.body.region})` : ""}`),
    "",
    resolvedProjects.length ? "Projects in this conversation:\n" + resolvedProjects.map(projectLine).join("\n") : "No project is resolved yet. If the customer's question needs one, ask which project or area they mean.",
    "",
    "Business rules (always follow):",
    ...of("rule").map((r) => `- [${r.id}] ${r.body.name}: when ${r.body.when}; must ${r.body.must}${r.body.must_not ? `; must not ${r.body.must_not}` : ""}${r.body.parameters ? `; parameters ${JSON.stringify(r.body.parameters)}` : ""}`),
    "",
    "Behaviour:",
    ...of("behaviour").map((b) => `- [${b.id}] ${b.body.aspect}: ${b.body.instruction}`),
    "",
    "Facts:",
    ...of("fact").map((f) => `- [${f.id}] ${f.body.topic}: ${f.body.text}`),
    "",
    examples.length ? "Examples of good replies:\n" + examples.map((e) => `- [${e.id}] customer: "${e.body.conversation.at(-1)?.text ?? ""}" -> ideal: "${e.body.ideal_reply}"`).join("\n") : "",
    "",
    `Conversation state: ${JSON.stringify({ active_project: state.active_project, first_price_given_for: Object.keys(state.first_price_at), already_asked: state.asked })}`,
    `Reply in ${LANG_NAME[lang as keyof typeof LANG_NAME] ?? "English"}. Short, friendly, no emoji. Do not ask again for anything in already_asked.`,
    "Never say you cannot answer and stop. Never say a person has been informed or that anything was booked or sent.",
    "Only request media that the project lists. Use project ids from the catalog.",
    'Return STRICT JSON only: {"intent": string, "project_ref": string|null, "language": "bn"|"banglish"|"en", "reply": string, "media": [{"type": "photo"|"floorplan"|"brochure"|"map", "project_ref": string, "floor"?: string}], "handoff": boolean, "asked": [string], "used_item_ids": [string], "clarify": boolean}',
  ].join("\n");
  const messages = [
    ...history.map((h) => ({ role: (h.role === "customer" ? "user" : "assistant") as "user" | "assistant",
      content: h.role === "agent" ? `[sales agent] ${h.text}` : h.text })),
    { role: "user" as const, content: `<customer_message>\n${text}\n</customer_message>` },
  ];
  return { system, messages };
}

// ── output parsing and guards ───────────────────────────────────────────────
export function parseModelOutput(raw: string): ModelOut | null {
  const t = String(raw || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s === -1 || e <= s) return null;
  try {
    const o = JSON.parse(t.slice(s, e + 1));
    if (typeof o?.reply !== "string" || !["bn", "banglish", "en"].includes(o.language)) return null;
    return {
      intent: String(o.intent || ""), project_ref: typeof o.project_ref === "string" ? o.project_ref : null,
      language: o.language, reply: o.reply, handoff: o.handoff === true, clarify: o.clarify === true,
      media: Array.isArray(o.media) ? o.media.filter((m: any) => m && ["photo", "floorplan", "brochure", "map"].includes(m.type) && typeof m.project_ref === "string") : [],
      asked: Array.isArray(o.asked) ? o.asked.filter(isStr) : [],
      used_item_ids: Array.isArray(o.used_item_ids) ? o.used_item_ids.filter(isStr) : [],
    };
  } catch { return null; }
}

const REFUSAL = [/parbo\s*na/i, /bolte\s*parbo/i, /confirm\s*korte\s*parbo/i, /can'?t\s+(tell|discuss|share|say)/i,
  /cannot\s+(tell|discuss|share|say)/i, /বলতে\s*পারব\s*না/, /পারব\s*না/];
const CLAIM = [/\binformed\b/i, /\bnotified\b/i, /jaanie\s*dichi/i, /janiye\s*dichi/i, /\bbooked\b/i, /have\s+sent/i,
  /জানিয়ে\s*দিয়েছি/];

export function guardReply(out: ModelOut, c: SnapshotContent, resolved: string[], evidenceText: string): string[] {
  const errs: string[] = [];
  const r = out.reply;
  if (REFUSAL.some((x) => x.test(r))) errs.push("refusal");
  if (CLAIM.some((x) => x.test(r))) errs.push("claim");
  const nums = r.match(/\d+(?:[.,]\d+)?/g) || [];
  if (nums.some((n) => !evidenceText.includes(n))) errs.push("number");
  const ids = new Set(c.projects.map((p) => p.id));
  if ((out.project_ref && !ids.has(out.project_ref)) || out.media.some((m) => !resolved.includes(m.project_ref))) errs.push("project");
  if (r.trim()) {
    const scriptBn = /[ঀ-৿]/.test(r);
    if (out.language === "bn" && !scriptBn) errs.push("script");
    if (out.language !== "bn" && scriptBn) errs.push("script");
  }
  return errs;
}

// ── media ───────────────────────────────────────────────────────────────────
export type MediaAction = { type: "image" | "document"; url: string; caption: string; kind: string; project_ref: string; floor?: string };

export function resolveMedia(out: ModelOut, c: SnapshotContent): { actions: MediaAction[]; missing: string[]; clarify: string | null } {
  const actions: MediaAction[] = []; const missing: string[] = []; let clarify: string | null = null;
  for (const m of out.media) {
    const p = c.projects.find((x) => x.id === m.project_ref);
    if (!p) { missing.push(m.type); continue; }
    const md = p.body.media || {}; const name = p.body.name;
    if (m.type === "photo") {
      if (md.photos?.length) md.photos.slice(0, 3).forEach((u: string) => actions.push({ type: "image", url: u, caption: name, kind: "photo", project_ref: p.id }));
      else missing.push("photo");
    } else if (m.type === "map") {
      if (md.map_image) actions.push({ type: "image", url: md.map_image, caption: `${name} location`, kind: "map", project_ref: p.id });
      else missing.push("map");
    } else if (m.type === "brochure") {
      if (md.brochure) actions.push({ type: "document", url: md.brochure, caption: `${name} brochure`, kind: "brochure", project_ref: p.id });
      else missing.push("brochure");
    } else {
      const plans: { url: string; label?: string }[] = md.floor_plans || [];
      if (!plans.length) { missing.push("floorplan"); continue; }
      const want = norm(m.floor || "");
      if (want === "all" || want === "sob" || want === "shob") {
        plans.slice(0, 10).forEach((f) => actions.push({ type: "image", url: f.url, caption: `${name} ${f.label || "floor plan"}`, kind: "floorplan", project_ref: p.id, floor: f.label }));
        continue;
      }
      const hit = want ? plans.find((f) => f.label && (norm(f.label) === want || norm(f.label).startsWith(want) || want.startsWith(norm(f.label)))) : undefined;
      if (hit) actions.push({ type: "image", url: hit.url, caption: `${name} ${hit.label}`, kind: "floorplan", project_ref: p.id, floor: hit.label });
      else clarify = `Which floor plan would you like for ${name}: ${plans.map((f) => f.label || "unlabelled").join(", ")}?`;
    }
  }
  return { actions, missing, clarify };
}

// ── turn ────────────────────────────────────────────────────────────────────
export type Ports = {
  callModel: (req: { model: string; max_tokens: number; system: string; messages: { role: "user" | "assistant"; content: string }[] }) =>
    Promise<{ ok: true; text: string; cost_usd: number } | { ok: false; error: string }>;
};
export type TurnResult = { reply: string; media: MediaAction[]; handoff: boolean; stateNext: ConvState; outcome: string; trace: Record<string, unknown> };

export const FALLBACK = {
  bn: "ধন্যবাদ। আমাদের একজন কনসালট্যান্ট শিগগিরই আপনার সাথে যোগাযোগ করবেন।",
  banglish: "Dhonnobad. Amader ekjon consultant khub shiggiri apnar sathe jogajog korben.",
  en: "Thank you. One of our consultants will get back to you shortly.",
};
const GREETING = [/^(hi|hello|hey|salam|assalamu ?alaikum|as-?salamu ?alaikum|good (morning|evening|afternoon)|kemon achen)[\s!.?]*$/i,
  /^(আসসালামু আলাইকুম|সালাম|হাই|হ্যালো|কেমন আছেন)[\s!.?।]*$/];
const WANTS_PERSON = [/(agent|manush|human|person|consultant).*(kotha|talk|speak)/i, /(kotha|talk|speak).*(agent|manush|human|person)/i,
  /(এজেন্ট|মানুষ).*কথা/];

export async function runTurn(a: {
  content: SnapshotContent; bot: Bot; text: string; history: Turn[]; state: ConvState;
  ad: { isAd: boolean; adText?: string }; returning: boolean; ports: Ports;
}): Promise<TurnResult> {
  const lang = detectLanguage(a.text);
  const trace: Record<string, unknown> = { core_version: CORE_VERSION, language: lang };
  const base = { ...a.state, language: lang };
  const t = norm(a.text);
  if (GREETING.some((g) => g.test(t))) {
    trace.pre = "greeting";
    return { reply: "", media: [], handoff: false, stateNext: base, outcome: a.returning ? "skipped_greeting" : "skipped_greeting_new", trace };
  }
  if (WANTS_PERSON.some((g) => g.test(a.text))) {
    trace.pre = "wants_person";
    return { reply: FALLBACK[lang], media: [], handoff: true, stateNext: { ...base, paused: true }, outcome: "handoff_requested", trace };
  }
  const res = resolveProject(a.text, a.state, a.ad, a.content.projects);
  trace.project = res;
  const history = buildHistory(a.history);
  const prompt = buildPrompt(a.content, a.bot, history, a.text, a.state, res.projects, lang);
  const scoped = a.content.items.filter((i) => itemApplies(i, a.bot, res.projects));
  trace.items_in_scope = scoped.map((i) => `${i.id}@${i.revision}`);
  const evidence = [...scoped.map((i) => JSON.stringify(i.body)), ...a.content.projects.filter((p) => res.projects.includes(p.id)).map((p) => JSON.stringify(p.body)), ...history.map((h) => h.text), a.text].join("\n");
  const req = { model: a.content.model_config.reply_model, max_tokens: a.content.model_config.max_tokens, system: prompt.system, messages: prompt.messages };
  let cost = 0; let errors: string[] = []; let parsed: ModelOut | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const msgs = attempt === 0 ? req.messages : [...req.messages, { role: "user" as const, content: `Your previous answer was rejected (${errors.join(", ")}). Return corrected STRICT JSON only.` }];
    const r = await a.ports.callModel({ ...req, messages: msgs });
    if (!r.ok) { trace.model_error = r.error; trace.cost_usd = cost; return { reply: FALLBACK[lang], media: [], handoff: true, stateNext: { ...base, paused: true }, outcome: "fallback_model_error", trace }; }
    cost += r.cost_usd;
    parsed = parseModelOutput(r.text);
    errors = parsed ? guardReply(parsed, a.content, res.projects, evidence) : ["schema"];
    if (!errors.length) break;
  }
  trace.cost_usd = cost; trace.guard_errors = errors;
  if (!parsed || errors.length) {
    return { reply: FALLBACK[lang], media: [], handoff: true, stateNext: { ...base, paused: true }, outcome: "fallback_invalid_output", trace };
  }
  const media = resolveMedia(parsed, a.content);
  trace.media_missing = media.missing; trace.used_item_ids = parsed.used_item_ids; trace.intent = parsed.intent;
  const reply = media.clarify ? `${parsed.reply}${parsed.reply ? "\n" : ""}${media.clarify}` : parsed.reply;
  const active = res.projects.length === 1 ? res.projects[0] : (parsed.project_ref && res.projects.includes(parsed.project_ref) ? parsed.project_ref : a.state.active_project);
  const stateNext: ConvState = {
    ...base, active_project: active, active_source: res.projects.length ? res.source : a.state.active_source,
    asked: [...new Set([...a.state.asked, ...parsed.asked])].slice(-20),
    first_price_at: parsed.intent === "price" && active && !a.state.first_price_at[active]
      ? { ...a.state.first_price_at, [active]: "now" } : a.state.first_price_at,
    paused: parsed.handoff ? true : a.state.paused,
  };
  return { reply, media: media.actions, handoff: parsed.handoff, stateNext, outcome: "ok", trace };
}
```

- [ ] **Step 4: Run tests**

Run: `node --test supabase/functions/_shared/trainer-core.test.ts`
Expected: PASS, `fail 0`

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/trainer-core.ts supabase/functions/_shared/trainer-core.test.ts
git commit -m "feat(ai-trainer): prompt, guards, media resolution and runTurn

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: trainer-core evaluation — checks, verdict, publish gate, redaction

**Files:**
- Modify: `supabase/functions/_shared/trainer-core.ts`
- Modify: `supabase/functions/_shared/trainer-core.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 3, 4.
- Produces:
  - `type Check = { type: 'language_is'|'no_reply'|'project_resolved_is'|'asks_clarification'|'media_action'|'no_media'|'handoff'|'must_contain_exact'|'must_not_contain'|'uses_item'|'max_length'; value?: unknown }`
  - `type TestSpec = { title: string; setup: { isAd: boolean; adText?: string; returning: boolean; state?: Partial<ConvState> }; conversation: Turn[]; target: string; checks: Check[]; ideal_reply: string; judge: 'rubric'|'none'; exact_required?: string; samples?: number }`
  - `validateTestSpec(s: unknown): string[]`
  - `runChecks(spec: TestSpec, r: TurnResult): { type: string; pass: boolean; detail?: string }[]`
  - `type JudgeAttempt = { verdict: 'pass'|'fail'|'inconclusive'; rationale: string; error?: string }`
  - `judgeVerdict(attempts: JudgeAttempt[]): 'pass'|'fail'|'inconclusive'`
  - `finalVerdict(checks: { pass: boolean }[], judge: 'none'|'pass'|'fail'|'inconclusive'|'skipped'): 'PASS'|'FAIL'|'INCONCLUSIVE'`
  - `buildJudgePrompt(spec: TestSpec, r: TurnResult, rubric: string): { system: string; messages: { role: 'user'; content: string }[] }`
  - `parseJudge(raw: string): JudgeAttempt`
  - `publishGate(a: { snapshot: { id: string; checksum: string }; run: { snapshot_checksum: string; status: string; core_version: string; bot: string } | null; results: { test_id: string; test_revision: number; verdict: string }[]; activeTests: { id: string; revision: number; bots: Bot[] }[]; bot: Bot; coreVersion: string }): { ok: boolean; reasons: string[] }`
  - `redactTurns(turns: Turn[], names: string[]): { turns: Turn[]; rejected: boolean }`

- [ ] **Step 1: Write the failing tests**

Append to `trainer-core.test.ts`:

```ts
import { validateTestSpec, runChecks, judgeVerdict, finalVerdict, parseJudge, publishGate, redactTurns, type TestSpec, type TurnResult } from "./trainer-core.ts";

const SPEC: TestSpec = { title: "price", setup: { isAd: false, returning: false }, conversation: [], target: "nuznan er dam koto?",
  checks: [{ type: "language_is", value: "banglish" }, { type: "handoff", value: false }, { type: "no_media" }], ideal_reply: "meeting", judge: "rubric" };
const TR = (o: Partial<TurnResult>): TurnResult => ({ reply: "Ami ekta meeting set korte pari", media: [], handoff: false, stateNext: emptyState(), outcome: "ok", trace: { language: "banglish", project: { projects: ["p-nuz"] }, used_item_ids: [] }, ...o });

test("validateTestSpec", () => {
  assert.deepEqual(validateTestSpec(SPEC), []);
  assert.ok(validateTestSpec({ ...SPEC, checks: [{ type: "bogus" }] }).length > 0);
  assert.ok(validateTestSpec({ ...SPEC, checks: [{ type: "must_contain_exact", value: "x" }] }).some((e) => e.includes("exact_required")));
});

test("runChecks: media checks read actions, not text", () => {
  const media = (xs: { type: string; pass: boolean }[]) => xs.find((c) => c.type === "media_action")!.pass;
  const r = runChecks({ ...SPEC, checks: [{ type: "media_action", value: { kind: "brochure", project_ref: "p-nuz" } }] }, TR({ reply: "brochure pathacchi" }));
  assert.equal(media(r), false);
  const r2 = runChecks({ ...SPEC, checks: [{ type: "media_action", value: { kind: "brochure", project_ref: "p-nuz" } }] },
    TR({ media: [{ type: "document", url: "u", caption: "c", kind: "brochure", project_ref: "p-nuz" }] }));
  assert.equal(media(r2), true);
});

test("runChecks: mandatory checks always run", () => {
  const r = runChecks({ ...SPEC, checks: [] }, TR({ reply: "ami bolte parbo na" }));
  assert.ok(r.some((c) => c.type === "mandatory:refusal" && !c.pass));
});

test("verdict table", () => {
  const P1 = [{ pass: true }], F1 = [{ pass: false }];
  assert.equal(finalVerdict(F1, "skipped"), "FAIL");
  assert.equal(finalVerdict(P1, "none"), "PASS");
  assert.equal(finalVerdict(P1, "pass"), "PASS");
  assert.equal(finalVerdict(P1, "fail"), "FAIL");
  assert.equal(finalVerdict(P1, "inconclusive"), "INCONCLUSIVE");
});

test("judge majority over attempts", () => {
  const a = (v: any) => ({ verdict: v, rationale: "" });
  assert.equal(judgeVerdict([a("pass")]), "pass");
  assert.equal(judgeVerdict([a("fail"), a("pass"), a("pass")]), "pass");
  assert.equal(judgeVerdict([a("fail"), a("fail"), a("pass")]), "fail");
  assert.equal(judgeVerdict([a("inconclusive"), a("pass"), a("fail")]), "inconclusive");
  assert.equal(judgeVerdict([a("fail")]), "inconclusive");
});

test("parseJudge: invalid output is inconclusive", () => {
  assert.equal(parseJudge("nonsense").verdict, "inconclusive");
  assert.equal(parseJudge('{"verdict":"pass","rationale":"ok","criteria":{}}').verdict, "pass");
});

test("publishGate", () => {
  const base = { snapshot: { id: "s", checksum: "c" }, bot: "eyad" as const, coreVersion: "1.0.0",
    activeTests: [{ id: "t1", revision: 2, bots: ["eyad"] as any }, { id: "t2", revision: 1, bots: ["dubai"] as any }],
    run: { snapshot_checksum: "c", status: "complete", core_version: "1.0.0", bot: "eyad" },
    results: [{ test_id: "t1", test_revision: 2, verdict: "PASS" }] };
  assert.deepEqual(publishGate(base), { ok: true, reasons: [] });
  assert.equal(publishGate({ ...base, results: [{ test_id: "t1", test_revision: 2, verdict: "INCONCLUSIVE" }] }).ok, false);
  assert.equal(publishGate({ ...base, results: [{ test_id: "t1", test_revision: 1, verdict: "PASS" }] }).ok, false);
  assert.equal(publishGate({ ...base, run: { ...base.run, snapshot_checksum: "x" } }).ok, false);
  assert.equal(publishGate({ ...base, run: { ...base.run, status: "incomplete" } }).ok, false);
  assert.equal(publishGate({ ...base, run: null }).ok, false);
  assert.equal(publishGate({ ...base, coreVersion: "2.0.0" }).ok, false);
});

test("redactTurns", () => {
  const r = redactTurns([{ role: "customer", text: "ami Rahim, number +880 1712-345678, mail a@b.com" }, { role: "agent", text: "/fdh note" }], ["Rahim"]);
  assert.equal(r.rejected, false);
  assert.equal(r.turns.length, 1);
  assert.ok(!/1712|a@b|Rahim/.test(r.turns[0].text));
  assert.ok(r.turns[0].text.includes("{customer}"));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test supabase/functions/_shared/trainer-core.test.ts`
Expected: FAIL with `does not provide an export named 'validateTestSpec'`

- [ ] **Step 3: Implement**

Append to `trainer-core.ts`:

```ts
// ── tests and verdicts ──────────────────────────────────────────────────────
export type Check = { type: string; value?: unknown };
export type TestSpec = {
  title: string; setup: { isAd: boolean; adText?: string; returning: boolean; state?: Partial<ConvState> };
  conversation: Turn[]; target: string; checks: Check[]; ideal_reply: string; judge: "rubric" | "none";
  exact_required?: string; samples?: number;
};
const CHECK_TYPES = ["language_is", "no_reply", "project_resolved_is", "asks_clarification", "media_action", "no_media",
  "handoff", "must_contain_exact", "must_not_contain", "uses_item", "max_length"];

export function validateTestSpec(s: unknown): string[] {
  const e: string[] = [];
  const t = s as TestSpec;
  if (!t || typeof t !== "object") return ["spec must be an object"];
  if (!isStr(t.title) || !t.title.trim()) e.push("title is required");
  if (!isStr(t.target) || !t.target.trim()) e.push("target is required");
  if (!t.setup || typeof t.setup.isAd !== "boolean" || typeof t.setup.returning !== "boolean") e.push("setup.isAd and setup.returning are required");
  if (!Array.isArray(t.conversation) || !t.conversation.every((x) => x && ["customer", "bot", "agent"].includes(x.role) && isStr(x.text))) e.push("conversation is invalid");
  if (!Array.isArray(t.checks)) e.push("checks must be a list");
  else for (const c of t.checks) {
    if (!CHECK_TYPES.includes(c?.type)) e.push(`unknown check: ${c?.type}`);
    if (c?.type === "must_contain_exact" && !(isStr(t.exact_required) && t.exact_required.trim())) e.push("must_contain_exact needs exact_required with a reason");
  }
  if (!["rubric", "none"].includes(t.judge)) e.push("judge must be rubric or none");
  if (t.judge === "rubric" && !(isStr(t.ideal_reply) && t.ideal_reply.trim())) e.push("ideal_reply is required for the judge");
  if (t.samples !== undefined && ![1, 3].includes(t.samples)) e.push("samples must be 1 or 3");
  return e;
}

export function runChecks(spec: TestSpec, r: TurnResult): { type: string; pass: boolean; detail?: string }[] {
  const out: { type: string; pass: boolean; detail?: string }[] = [];
  const lang = (r.trace.language as string) || detectLanguage(r.reply);
  out.push({ type: "mandatory:refusal", pass: !REFUSAL.some((x) => x.test(r.reply)) });
  out.push({ type: "mandatory:claim", pass: !CLAIM.some((x) => x.test(r.reply)) });
  out.push({ type: "mandatory:outcome", pass: !["fallback_invalid_output"].includes(r.outcome), detail: r.outcome });
  const resolved = ((r.trace.project as any)?.projects as string[]) || [];
  for (const c of spec.checks) {
    const v = c.value as any;
    switch (c.type) {
      case "language_is": out.push({ type: c.type, pass: lang === v, detail: lang }); break;
      case "no_reply": out.push({ type: c.type, pass: !r.reply.trim() }); break;
      case "project_resolved_is": out.push({ type: c.type, pass: v === null ? resolved.length === 0 : resolved.length === 1 && resolved[0] === v, detail: resolved.join(",") }); break;
      case "asks_clarification": out.push({ type: c.type, pass: /\?|？|কি\b/.test(r.reply) }); break;
      case "media_action": out.push({ type: c.type, pass: r.media.filter((m) => m.kind === v.kind && (!v.project_ref || m.project_ref === v.project_ref) && (!v.floor || m.floor === v.floor)).length >= (v.count ?? 1) }); break;
      case "no_media": out.push({ type: c.type, pass: r.media.length === 0 }); break;
      case "handoff": out.push({ type: c.type, pass: r.handoff === v }); break;
      case "must_contain_exact": out.push({ type: c.type, pass: r.reply.includes(String(v)) }); break;
      case "must_not_contain": out.push({ type: c.type, pass: !norm(r.reply).includes(norm(String(v))) }); break;
      case "uses_item": out.push({ type: c.type, pass: ((r.trace.used_item_ids as string[]) || []).includes(String(v)) }); break;
      case "max_length": out.push({ type: c.type, pass: r.reply.length <= Number(v) }); break;
    }
  }
  return out;
}

export type JudgeAttempt = { verdict: "pass" | "fail" | "inconclusive"; rationale: string; error?: string };

export function judgeVerdict(attempts: JudgeAttempt[]): "pass" | "fail" | "inconclusive" {
  if (attempts.length === 1) return attempts[0].verdict === "pass" ? "pass" : "inconclusive";
  const n = (v: string) => attempts.filter((a) => a.verdict === v).length;
  if (n("pass") >= 2) return "pass";
  if (n("fail") >= 2) return "fail";
  return "inconclusive";
}

export function finalVerdict(checks: { pass: boolean }[], judge: "none" | "pass" | "fail" | "inconclusive" | "skipped"): "PASS" | "FAIL" | "INCONCLUSIVE" {
  if (checks.some((c) => !c.pass)) return "FAIL";
  if (judge === "none" || judge === "pass") return "PASS";
  if (judge === "fail") return "FAIL";
  return "INCONCLUSIVE";
}

export const RUBRIC_V1 = `Rubric sales-default v1. Score each 1-5:
answered: the reply answers the customer's actual question.
context: uses earlier turns; does not re-ask what is known.
correct: every statement is supported by the facts given; nothing invented.
tone: natural, short, friendly, in the customer's language.
sales: moves the sale forward (discovery question or meeting offer) when appropriate.
verdict "pass" only if no criterion is below 3 and "correct" is at least 4. "inconclusive" if you cannot tell.`;

export function buildJudgePrompt(spec: TestSpec, r: TurnResult, rubric: string) {
  return {
    system: `You grade one WhatsApp sales reply. ${rubric}\nReturn STRICT JSON only: {"verdict": "pass"|"fail"|"inconclusive", "criteria": {"answered": n, "context": n, "correct": n, "tone": n, "sales": n}, "rationale": string}`,
    messages: [{ role: "user" as const, content: JSON.stringify({
      conversation: spec.conversation, customer_message: spec.target, reply: r.reply,
      media_sent: r.media.map((m) => ({ kind: m.kind, floor: m.floor })), ideal_reply: spec.ideal_reply }) }],
  };
}

export function parseJudge(raw: string): JudgeAttempt {
  const t = String(raw || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  try {
    const o = JSON.parse(t.slice(s, e + 1));
    if (["pass", "fail", "inconclusive"].includes(o.verdict) && isStr(o.rationale)) return { verdict: o.verdict, rationale: o.rationale };
  } catch { /* fall through */ }
  return { verdict: "inconclusive", rationale: "", error: "invalid judge output" };
}

export function publishGate(a: {
  snapshot: { id: string; checksum: string };
  run: { snapshot_checksum: string; status: string; core_version: string; bot: string } | null;
  results: { test_id: string; test_revision: number; verdict: string }[];
  activeTests: { id: string; revision: number; bots: Bot[] }[]; bot: Bot; coreVersion: string;
}): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!a.run) return { ok: false, reasons: ["no test run for this snapshot"] };
  if (a.run.status !== "complete") reasons.push(`run is ${a.run.status}`);
  if (a.run.snapshot_checksum !== a.snapshot.checksum) reasons.push("run was for different content");
  if (a.run.bot !== a.bot) reasons.push("run was for the other bot");
  if (a.run.core_version !== a.coreVersion) reasons.push(`run used core ${a.run.core_version}, current is ${a.coreVersion}`);
  for (const t of a.activeTests.filter((x) => x.bots.includes(a.bot))) {
    const r = a.results.find((x) => x.test_id === t.id && x.test_revision === t.revision);
    if (!r) reasons.push(`test ${t.id} rev ${t.revision} not run`);
    else if (r.verdict !== "PASS") reasons.push(`test ${t.id} is ${r.verdict}`);
  }
  return { ok: reasons.length === 0, reasons };
}

// ── redaction for real conversations ───────────────────────────────────────
const PHONE = /\+?\d[\d\s-]{6,}\d/g;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/g;
const URL_RE = /https?:\/\/\S+/g;

export function redactTurns(turns: Turn[], names: string[]): { turns: Turn[]; rejected: boolean } {
  const ns = names.filter((n) => n && n.trim().length >= 2).map((n) => n.trim());
  const out = buildHistory(turns, 6).map((t) => {
    let x = t.text.replace(EMAIL, "{email}").replace(URL_RE, "{link}").replace(PHONE, "{phone}");
    for (const n of ns) x = x.split(n).join("{customer}");
    return { ...t, text: x };
  });
  // A fresh, non-global pattern: .test() on the shared global EMAIL would
  // carry lastIndex from one turn to the next and skip matches.
  const rejected = out.some((t) => /\d{7,}/.test(t.text.replace(/\s|-/g, "")) || /[\w.+-]+@[\w-]+\.[\w.]+/.test(t.text));
  return { turns: out, rejected };
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test:trainer`
Expected: trainer-core tests PASS. The handler test file does not exist yet, so Node reports it as missing; run `node --test supabase/functions/_shared/trainer-core.test.ts` instead until Task 6.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/trainer-core.ts supabase/functions/_shared/trainer-core.test.ts
git commit -m "feat(ai-trainer): checks, judge verdicts, publish gate and redaction

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: ai-trainer handler — auth, items, tests, import, playground

**Files:**
- Create: `supabase/functions/_shared/trainer-handler.ts`
- Create: `supabase/functions/_shared/trainer-handler.test.ts`

**Interfaces:**
- Consumes: all trainer-core exports.
- Produces:
  - `type Db = { select(path: string): Promise<any[]>; insert(table: string, row: object): Promise<any>; patch(table: string, filter: string, patch: object): Promise<boolean>; rpc(fn: string, args: object): Promise<{ ok: boolean; data?: any; error?: string }> }`
  - `type Llm = { chat(req: { model: string; max_tokens: number; system: string; messages: { role: string; content: string }[] }): Promise<{ ok: true; text: string; prompt_tokens: number; completion_tokens: number } | { ok: false; error: string }> }`
  - `type Env = { trainerKey: string; budgetUsd: number; replyModel: string; judgeModel: string; pricePerMTok: { in: number; out: number } }`
  - `handleTrainer(req: { method: string; headers: Headers; ip: string; body: any }, deps: { db: Db; llm: Llm; env: Env; now?: () => Date }): Promise<{ status: number; body: any }>`

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/_shared/trainer-handler.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleTrainer, type Db, type Llm } from "./trainer-handler.ts";

// In-memory stand-in for the ai_ tables. It implements just the PostgREST
// paths and RPCs the handler uses, including revision conflicts and the
// atomic budget rule, so handler logic is tested without a database.
function memDb() {
  const t: Record<string, any[]> = { ai_trainer_items: [], ai_tests: [], ai_test_revisions: [], ai_snapshots: [], ai_bot_pointers: [{ bot: "eyad", mode: "legacy", snapshot_id: null }, { bot: "dubai", mode: "legacy", snapshot_id: null }], ai_test_runs: [], ai_test_results: [], ai_trainer_audit: [], ai_trainer_imports: [], wa_projects: [], wa_knowledge: [], wa_message_corrections: [], ai_budget_days: [] };
  const budget = { reserved: 0, spent: 0 }; const resv: Record<string, number> = {};
  let n = 0; const id = () => `id${++n}`;
  const db: Db & { t: typeof t } = {
    t,
    async select(path) {
      const [table, q] = path.split("?");
      let rows = [...(t[table] || [])];
      for (const part of (q || "").split("&")) {
        const m = /^(\w+)=eq\.(.+)$/.exec(part);
        if (m) rows = rows.filter((r) => String(r[m[1]]) === decodeURIComponent(m[2]));
      }
      return rows;
    },
    async insert(table, row) { const r = { id: id(), ...row }; t[table].push(r); return r; },
    async patch(table, filter, patch) {
      const [k, v] = filter.split("=eq."); const r = t[table].find((x) => String(x[k]) === decodeURIComponent(v));
      if (!r) return false; Object.assign(r, patch); return true;
    },
    async rpc(fn, a: any) {
      if (fn === "ai_budget_reserve") { if (budget.spent + budget.reserved + a.p_estimate > a.p_limit) return { ok: true, data: null }; budget.reserved += a.p_estimate; const rid = id(); resv[rid] = a.p_estimate; return { ok: true, data: rid }; }
      if (fn === "ai_budget_settle") { budget.reserved -= resv[a.p_id]; budget.spent += a.p_actual; return { ok: true }; }
      if (fn === "ai_budget_release") { budget.reserved -= resv[a.p_id]; return { ok: true }; }
      if (fn === "ai_item_save") {
        const it = a.p_item;
        if (it.status === "retired" && !a.p_reason) return { ok: false, error: "reason_required" };
        if (t.ai_trainer_items.some((x) => x.status === "active" && x.kind === it.kind && x.content_hash === it.content_hash && x.id !== it.id)) return { ok: false, error: "duplicate_content" };
        if (a.p_expected_revision === 0) { const r = { ...it, id: id(), revision: 1, status: it.status || "active" }; t.ai_trainer_items.push(r); t.ai_trainer_audit.push({ actor_claimed: a.p_actor }); return { ok: true, data: { id: r.id, revision: 1 } }; }
        const cur = t.ai_trainer_items.find((x) => x.id === it.id);
        if (!cur) return { ok: false, error: "not_found" };
        if (cur.revision !== a.p_expected_revision) return { ok: false, error: "revision_conflict" };
        Object.assign(cur, it, { revision: cur.revision + 1 }); t.ai_trainer_audit.push({ actor_claimed: a.p_actor });
        return { ok: true, data: { id: cur.id, revision: cur.revision } };
      }
      return { ok: false, error: "unknown rpc" };
    },
  };
  return db;
}

const llm = (...texts: string[]): Llm & { calls: any[] } => {
  const calls: any[] = [];
  return { calls, async chat(req) { calls.push(req); const x = texts.shift(); return x === undefined ? { ok: false, error: "down" } : { ok: true, text: x, prompt_tokens: 100, completion_tokens: 50 }; } };
};
const ENV = { trainerKey: "k".repeat(43), budgetUsd: 1, replyModel: "m", judgeModel: "j", pricePerMTok: { in: 1, out: 5 } };
// The failed-key counter is module state shared by every test in this file, so
// the rate-limit test uses its own IP and cannot lock the others out.
const call = (deps: any, action: string, payload: any = {}, key = ENV.trainerKey, ip = "1.1.1.1") =>
  handleTrainer({ method: "POST", headers: new Headers({ "x-trainer-key": key }), ip, body: { action, payload, actor_claimed: "Asad" } }, deps);

test("rejects missing or wrong key, accepts right key", async () => {
  const deps = { db: memDb(), llm: llm(), env: ENV };
  assert.equal((await call(deps, "items.list", {}, "")).status, 401);
  assert.equal((await call(deps, "items.list", {}, "wrong")).status, 401);
  assert.equal((await call(deps, "items.list")).status, 200);
});

test("rate limits repeated bad keys per ip", async () => {
  const deps = { db: memDb(), llm: llm(), env: ENV };
  for (let i = 0; i < 10; i++) await call(deps, "items.list", {}, "bad", "9.9.9.9");
  assert.equal((await call(deps, "items.list", {}, ENV.trainerKey, "9.9.9.9")).status, 429);
  assert.equal((await call(deps, "items.list")).status, 200);
});

test("items.create validates schema and scope", async () => {
  const deps = { db: memDb(), llm: llm(), env: ENV };
  assert.equal((await call(deps, "items.create", { kind: "fact", bots: ["eyad"], project_ref: null, body: { topic: "" } })).status, 422);
  assert.equal((await call(deps, "items.create", { kind: "fact", bots: ["both"], project_ref: null, body: { topic: "a", text: "b" } })).status, 422);
  const ok = await call(deps, "items.create", { kind: "fact", bots: ["eyad"], project_ref: null, body: { topic: "a", text: "b" } });
  assert.equal(ok.status, 200); assert.equal(ok.body.data.revision, 1);
});

test("items.update with stale revision returns 409; duplicate returns 409", async () => {
  const deps = { db: memDb(), llm: llm(), env: ENV };
  const c = await call(deps, "items.create", { kind: "fact", bots: ["eyad"], project_ref: null, body: { topic: "a", text: "b" } });
  const idv = c.body.data.id;
  assert.equal((await call(deps, "items.update", { id: idv, revision: 1, kind: "fact", bots: ["eyad"], project_ref: null, body: { topic: "a", text: "c" } })).status, 200);
  assert.equal((await call(deps, "items.update", { id: idv, revision: 1, kind: "fact", bots: ["eyad"], project_ref: null, body: { topic: "a", text: "d" } })).status, 409);
  assert.equal((await call(deps, "items.create", { kind: "fact", bots: ["eyad"], project_ref: null, body: { topic: "a", text: "c" } })).status, 409);
});

test("playground.turn on drafts reserves budget and returns trace; refuses when budget spent", async () => {
  const out = JSON.stringify({ intent: "info", project_ref: null, language: "en", reply: "Which project?", media: [], handoff: false, asked: ["project"], used_item_ids: [], clarify: true });
  const db = memDb();
  const deps = { db, llm: llm(out), env: ENV };
  const r = await call(deps, "playground.turn", { bot: "eyad", source: "drafts", text: "What is the price?", history: [], state: null, setup: { isAd: false, returning: false } });
  assert.equal(r.status, 200); assert.equal(r.body.data.result.reply, "Which project?");
  assert.ok(r.body.data.result.trace.core_version);
  const poor = { db: memDb(), llm: llm(out), env: { ...ENV, budgetUsd: 0.0000001 } };
  assert.equal((await call(poor, "playground.turn", { bot: "eyad", source: "drafts", text: "price?", history: [], state: null, setup: { isAd: false, returning: false } })).status, 429);
});

test("tests.create validates spec; tests.retire needs reason", async () => {
  const deps = { db: memDb(), llm: llm(), env: ENV };
  assert.equal((await call(deps, "tests.create", { bots: ["eyad"], origin: "handwritten", spec: { title: "" } })).status, 422);
  const spec = { title: "t", setup: { isAd: false, returning: false }, conversation: [], target: "hi", checks: [{ type: "no_reply" }], ideal_reply: "", judge: "none" };
  const c = await call(deps, "tests.create", { bots: ["eyad"], origin: "handwritten", spec });
  assert.equal(c.status, 200);
  assert.equal((await call(deps, "tests.retire", { id: c.body.data.id, revision: 1, reason: "" })).status, 422);
  assert.equal((await call(deps, "tests.retire", { id: c.body.data.id, revision: 1, reason: "obsolete" })).status, 200);
});

test("import.preview classifies legacy rows and reports duplicates", async () => {
  const db = memDb();
  db.t.wa_projects.push({ id: 7, name: "Wecon Nuznan", keywords: ["nuznan"], region: "Dhaka", nature: "Residential", sft: "2850", address: "Sector 16, Jolshiri Abashon", photos: [], floor_plans: ["https://x/g.jpg"], floor_plan_labels: ["Ground"], brochure_url: "", map_image_url: "", is_active: true });
  db.t.wa_knowledge.push({ id: "k1", title: "Land", body: "If a customer offers land, give 01335142002", is_active: true });
  const deps = { db, llm: llm(), env: ENV };
  const r = await call(deps, "import.preview", {});
  assert.equal(r.status, 200);
  assert.equal(r.body.data.rows.find((x: any) => x.source === "wa_projects").proposed.kind, "project");
  assert.equal(r.body.data.rows.find((x: any) => x.source === "wa_knowledge").proposed.kind, "rule");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test supabase/functions/_shared/trainer-handler.test.ts`
Expected: FAIL with `Cannot find module './trainer-handler.ts'`

- [ ] **Step 3: Implement the handler (part 1: shell, auth, items, tests, import, playground)**

Create `supabase/functions/_shared/trainer-handler.ts`:

```ts
// ai-trainer request handler. Deno-free: the Edge Function passes in real
// database and OpenRouter ports, the Node tests pass in-memory ones. Every
// privileged action requires the X-Trainer-Key header, compared in constant
// time. The key is a temporary shared secret (spec §9): actor names in audit
// rows are claimed, not verified.
import {
  CORE_VERSION, KINDS, validateItem, validateScope, contentHash, freezeContent, checksumOf, canonicalJson,
  runTurn, emptyState, validateTestSpec, runChecks, buildJudgePrompt, parseJudge, judgeVerdict, finalVerdict,
  publishGate, redactTurns, RUBRIC_V1, type ItemRow, type Kind, type Bot, type SnapshotContent, type TestSpec,
  type Ports, type ConvState,
} from "./trainer-core.ts";

export type Db = {
  select(path: string): Promise<any[]>;
  insert(table: string, row: object): Promise<any>;
  patch(table: string, filter: string, patch: object): Promise<boolean>;
  rpc(fn: string, args: object): Promise<{ ok: boolean; data?: any; error?: string }>;
};
export type Llm = {
  chat(req: { model: string; max_tokens: number; system: string; messages: { role: string; content: string }[] }):
    Promise<{ ok: true; text: string; prompt_tokens: number; completion_tokens: number } | { ok: false; error: string }>;
};
export type Env = { trainerKey: string; budgetUsd: number; replyModel: string; judgeModel: string; pricePerMTok: { in: number; out: number } };
type Deps = { db: Db; llm: Llm; env: Env; now?: () => Date };
type Res = { status: number; body: any };

const ok = (data: unknown): Res => ({ status: 200, body: { ok: true, data } });
const fail = (status: number, code: string, message: string, details?: unknown): Res =>
  ({ status, body: { ok: false, error: { code, message, details } } });

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Failed key attempts per IP: 10 in 10 minutes locks that IP out for 10 minutes.
// Kept in module memory, so it resets on a cold start; that only loosens the
// limit briefly and never lets a wrong key through.
const fails = new Map<string, number[]>();
function limited(ip: string, now: number): boolean {
  const xs = (fails.get(ip) || []).filter((t) => now - t < 600_000);
  fails.set(ip, xs);
  return xs.length >= 10;
}

// Reserve the maximum cost of a call before making it; settle with the real
// usage afterwards, or release if the call never reached the provider.
async function withBudget<T>(deps: Deps, estimateUsd: number, fn: () => Promise<{ value: T; actualUsd: number | null }>): Promise<T | "over_budget"> {
  const r = await deps.db.rpc("ai_budget_reserve", { p_pool: "trainer", p_estimate: estimateUsd, p_limit: deps.env.budgetUsd });
  if (!r.ok || !r.data) return "over_budget";
  try {
    const { value, actualUsd } = await fn();
    if (actualUsd === null) await deps.db.rpc("ai_budget_release", { p_id: r.data });
    else await deps.db.rpc("ai_budget_settle", { p_id: r.data, p_actual: actualUsd });
    return value;
  } catch (e) {
    await deps.db.rpc("ai_budget_settle", { p_id: r.data, p_actual: estimateUsd });
    throw e;
  }
}

const cost = (env: Env, pin: number, pout: number) => (pin * env.pricePerMTok.in + pout * env.pricePerMTok.out) / 1e6;
const estimate = (env: Env, chars: number, maxTokens: number) => cost(env, Math.ceil(chars / 3) + 200, maxTokens);

// One budgeted model call shaped as trainer-core's Ports.callModel.
function portsFor(deps: Deps): Ports {
  return {
    callModel: async (req) => {
      const chars = req.system.length + req.messages.reduce((n, m) => n + m.content.length, 0);
      const r = await withBudget(deps, estimate(deps.env, chars, req.max_tokens), async () => {
        const x = await deps.llm.chat(req);
        if (!x.ok) return { value: x, actualUsd: null };
        return { value: x, actualUsd: cost(deps.env, x.prompt_tokens, x.completion_tokens) };
      });
      if (r === "over_budget") throw new BudgetError();
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, text: r.text, cost_usd: cost(deps.env, r.prompt_tokens, r.completion_tokens) };
    },
  };
}
class BudgetError extends Error { constructor() { super("over_budget"); } }

const activeProjectIds = async (db: Db) =>
  new Set((await db.select("ai_trainer_items?kind=eq.project&status=eq.active&select=id")).map((r) => r.id));

async function saveItem(deps: Deps, p: any, actor: string, expected: number, reason: string | null): Promise<Res> {
  if (!KINDS.includes(p.kind)) return fail(422, "schema", "unknown kind");
  const errs = [...validateItem(p.kind as Kind, p.body), ...validateScope(p.kind, p.bots, p.project_ref ?? null, await activeProjectIds(deps.db))];
  if (errs.length) return fail(422, "schema", "invalid item", errs);
  const item = { id: p.id, kind: p.kind, bots: p.bots, project_ref: p.project_ref ?? null, body: p.body,
    content_hash: await contentHash(p.kind, p.body), status: p.status || "active" };
  const r = await deps.db.rpc("ai_item_save", { p_item: item, p_expected_revision: expected, p_actor: actor, p_reason: reason });
  if (!r.ok) {
    if (r.error?.includes("revision_conflict")) return fail(409, "revision_conflict", "Someone else changed this item. Reload and try again.");
    if (r.error?.includes("duplicate_content")) return fail(409, "duplicate", "An active item with the same content already exists.");
    if (r.error?.includes("reason_required")) return fail(422, "reason_required", "A reason is required.");
    if (r.error?.includes("not_found")) return fail(404, "not_found", "Item not found.");
    return fail(500, "db", r.error || "save failed");
  }
  return ok(r.data);
}

async function loadDrafts(db: Db): Promise<ItemRow[]> {
  return (await db.select("ai_trainer_items?status=eq.active&select=*")) as ItemRow[];
}

async function contentFor(deps: Deps, source: string, snapshotId?: string): Promise<{ content: SnapshotContent; checksum: string; errors: string[] }> {
  if (source === "drafts") {
    const { content, errors } = freezeContent(await loadDrafts(deps.db), { reply_model: deps.env.replyModel, max_tokens: 600, rubric_version: 1 });
    return { content, checksum: await checksumOf(content), errors };
  }
  const s = (await deps.db.select(`ai_snapshots?id=eq.${encodeURIComponent(snapshotId || "")}&select=*`))[0];
  if (!s) throw new Error("snapshot not found");
  const sum = await checksumOf(s.content);
  if (sum !== s.checksum) throw new Error("snapshot checksum mismatch");
  return { content: s.content, checksum: sum, errors: [] };
}

function wordsFromKnowledge(body: string): "rule" | "behaviour" | "fact" {
  const b = body.toLowerCase();
  if (/(never|always|must|only|offer|do not|don't)/.test(b)) return "rule";
  if (/(tone|friendly|polite|style|emoji)/.test(b)) return "behaviour";
  return "fact";
}

async function importPreview(deps: Deps): Promise<Res> {
  const rows: any[] = [];
  const existing = new Set((await deps.db.select("ai_trainer_items?status=eq.active&select=content_hash")).map((r) => r.content_hash));
  for (const p of await deps.db.select("wa_projects?select=*")) {
    const labels: string[] = p.floor_plan_labels || [];
    const body: any = {
      name: p.name, aliases: { banglish: p.keywords || [], en: [String(p.name || "").toLowerCase()] },
      region: p.region || undefined, type: p.nature || undefined, address: p.address || undefined,
      size_text: p.sft ? `${p.sft} sft` : undefined, tags: /jolshiri/i.test(p.address || "") ? ["jolshiri"] : undefined,
      media: { photos: p.photos || [], floor_plans: (p.floor_plans || []).map((u: string, i: number) => (labels[i] ? { url: u, label: labels[i] } : { url: u })),
        brochure: p.brochure_url || undefined, map_image: p.map_image_url || undefined, video: p.video_url || undefined },
      send_code: p.send_code || undefined, legacy_wa_project_id: p.id,
    };
    Object.keys(body).forEach((k) => body[k] === undefined && delete body[k]);
    const errs = validateItem("project", body);
    const hash = await contentHash("project", body);
    rows.push({ source: "wa_projects", source_id: p.id, proposed: { kind: "project", bots: ["eyad", "dubai"], body },
      status: errs.length ? "rejected" : existing.has(hash) ? "duplicate" : "ready", errors: errs,
      warnings: (p.floor_plans || []).length > labels.length ? ["some floor plans have no label"] : [] });
  }
  for (const k of await deps.db.select("wa_knowledge?select=*")) {
    const kind = wordsFromKnowledge(k.body || "");
    const body = kind === "rule" ? { name: k.title, when: k.title, must: k.body }
      : kind === "behaviour" ? { aspect: "tone", instruction: k.body } : { topic: k.title, text: k.body };
    const hash = await contentHash(kind, body);
    rows.push({ source: "wa_knowledge", source_id: k.id, proposed: { kind, bots: ["eyad", "dubai"], body },
      status: existing.has(hash) ? "duplicate" : "ready", errors: validateItem(kind, body) });
  }
  for (const c of await deps.db.select("wa_message_corrections?select=*")) {
    const red = redactTurns([{ role: "customer", text: c.customer_message || "" }], []);
    const body = { conversation: red.turns.length ? red.turns : [{ role: "customer", text: "" }], original_reply: c.original_reply || undefined,
      ideal_reply: c.corrected_reply || "", reason: c.note || "imported correction", source: "real" };
    rows.push({ source: "wa_message_corrections", source_id: c.id, proposed: { kind: "example", bots: ["eyad", "dubai"], body },
      status: red.rejected ? "rejected" : "ready", errors: red.rejected ? ["redaction check failed"] : validateItem("example", body) });
  }
  return ok({ rows });
}

async function importCommit(deps: Deps, p: any, actor: string): Promise<Res> {
  const decisions: any[] = Array.isArray(p.decisions) ? p.decisions : [];
  const report: any[] = [];
  for (const d of decisions) {
    if (d.decision !== "import") { report.push({ ...d.ref, result: "rejected", reason: d.reason || "rejected by reviewer" }); continue; }
    const r = await saveItem(deps, d.item, actor, 0, null);
    report.push({ ...d.ref, result: r.status === 200 ? "imported" : r.body.error.code === "duplicate" ? "duplicate" : "rejected",
      item_id: r.body?.data?.id, reason: r.body?.error?.message, kind: d.item.kind });
  }
  await deps.db.insert("ai_trainer_imports", { source: "legacy", report, actor_claimed: actor });
  return ok({ report });
}

async function saveTest(deps: Deps, p: any, actor: string, create: boolean): Promise<Res> {
  const errs = [...validateTestSpec(p.spec), ...validateScope("fact", p.bots, null, new Set())];
  if (!["playground", "real", "handwritten"].includes(p.origin)) errs.push("origin is not allowed");
  if (errs.length) return fail(422, "schema", "invalid test", errs);
  if (create) {
    const row = await deps.db.insert("ai_tests", { bots: p.bots, spec: p.spec, origin: p.origin, revision: 1, status: "active" });
    await deps.db.insert("ai_test_revisions", { test_id: row.id, revision: 1, status: "active", bots: p.bots, spec: p.spec });
    await deps.db.insert("ai_trainer_audit", { entity: "test", entity_id: row.id, action: "create", after: row, actor_claimed: actor });
    return ok({ id: row.id, revision: 1 });
  }
  if (!p.reason?.trim()) return fail(422, "reason_required", "A reason is required to change a test.");
  const cur = (await deps.db.select(`ai_tests?id=eq.${encodeURIComponent(p.id)}&select=*`))[0];
  if (!cur) return fail(404, "not_found", "Test not found.");
  if (cur.revision !== p.revision) return fail(409, "revision_conflict", "Someone else changed this test.");
  const next = cur.revision + 1;
  await deps.db.patch("ai_tests", `id=eq.${cur.id}`, { spec: p.spec, bots: p.bots, revision: next, updated_at: new Date().toISOString() });
  await deps.db.insert("ai_test_revisions", { test_id: cur.id, revision: next, status: cur.status, bots: p.bots, spec: p.spec, change_reason: p.reason });
  await deps.db.insert("ai_trainer_audit", { entity: "test", entity_id: cur.id, action: "update", before: cur, after: { ...cur, spec: p.spec, revision: next }, reason: p.reason, actor_claimed: actor });
  return ok({ id: cur.id, revision: next });
}

async function retireTest(deps: Deps, p: any, actor: string): Promise<Res> {
  if (!p.reason?.trim()) return fail(422, "reason_required", "A reason is required to retire a test.");
  const cur = (await deps.db.select(`ai_tests?id=eq.${encodeURIComponent(p.id)}&select=*`))[0];
  if (!cur) return fail(404, "not_found", "Test not found.");
  if (cur.revision !== p.revision) return fail(409, "revision_conflict", "Someone else changed this test.");
  await deps.db.patch("ai_tests", `id=eq.${cur.id}`, { status: "retired", retired_reason: p.reason, revision: cur.revision + 1 });
  await deps.db.insert("ai_test_revisions", { test_id: cur.id, revision: cur.revision + 1, status: "retired", bots: cur.bots, spec: cur.spec, change_reason: p.reason });
  await deps.db.insert("ai_trainer_audit", { entity: "test", entity_id: cur.id, action: "retire", before: cur, reason: p.reason, actor_claimed: actor });
  return ok({ id: cur.id, revision: cur.revision + 1 });
}

async function playgroundTurn(deps: Deps, p: any): Promise<Res> {
  if (!["eyad", "dubai"].includes(p.bot)) return fail(422, "schema", "bot must be eyad or dubai");
  if (typeof p.text !== "string" || !p.text.trim() || p.text.length > 2000) return fail(422, "schema", "text is required (max 2000 characters)");
  const { content, checksum, errors } = await contentFor(deps, p.source || "drafts", p.snapshot_id);
  if (errors.length) return fail(422, "freeze", "Drafts have errors. Fix them first.", errors);
  const state: ConvState = { ...emptyState(), ...(p.state || {}) };
  const result = await runTurn({ content, bot: p.bot, text: p.text, history: Array.isArray(p.history) ? p.history : [], state,
    ad: { isAd: !!p.setup?.isAd, adText: p.setup?.adText }, returning: !!p.setup?.returning, ports: portsFor(deps) });
  return ok({ result, checksum, core_version: CORE_VERSION });
}

export async function handleTrainer(req: { method: string; headers: Headers; ip: string; body: any }, deps: Deps): Promise<Res> {
  if (req.method !== "POST") return fail(405, "method", "POST only");
  const now = (deps.now?.() ?? new Date()).getTime();
  if (limited(req.ip, now)) return fail(429, "rate_limited", "Too many wrong keys. Try again in 10 minutes.");
  const key = req.headers.get("x-trainer-key") || "";
  if (!deps.env.trainerKey || !safeEqual(key, deps.env.trainerKey)) {
    fails.set(req.ip, [...(fails.get(req.ip) || []), now]);
    return fail(401, "unauthorized", "Trainer access key is missing or wrong.");
  }
  const { action, payload: p = {}, actor_claimed } = req.body || {};
  const actor = String(actor_claimed || "unknown").slice(0, 120);
  try {
    switch (action) {
      case "auth.check": return ok({ core_version: CORE_VERSION });
      case "items.list": return ok(await deps.db.select("ai_trainer_items?select=*"));
      case "items.create": return await saveItem(deps, p, actor, 0, null);
      case "items.update": return await saveItem(deps, p, actor, Number(p.revision), p.reason ?? null);
      case "items.retire": return await saveItem(deps, { ...p, status: "retired" }, actor, Number(p.revision), p.reason || "");
      case "items.history": return ok(await deps.db.select(`ai_trainer_audit?entity_id=eq.${encodeURIComponent(p.id)}&select=*`));
      case "import.preview": return await importPreview(deps);
      case "import.commit": return await importCommit(deps, p, actor);
      case "tests.list": return ok(await deps.db.select("ai_tests?select=*"));
      case "tests.create": return await saveTest(deps, p, actor, true);
      case "tests.update": return await saveTest(deps, p, actor, false);
      case "tests.retire": return await retireTest(deps, p, actor);
      case "playground.turn": return await playgroundTurn(deps, p);
      default: return await handleRunsAndPublish(action, p, actor, deps);
    }
  } catch (e) {
    if (e instanceof BudgetError) return fail(429, "over_budget", "Today's AI Trainer budget is used up.");
    return fail(500, "error", e instanceof Error ? e.message : String(e));
  }
}

// Implemented in Task 7.
async function handleRunsAndPublish(action: string, _p: any, _actor: string, _deps: Deps): Promise<Res> {
  return fail(400, "unknown_action", `Unknown action: ${action}`);
}

export const _internals = { contentFor, portsFor, withBudget, saveItem, canonicalJson, buildJudgePrompt, parseJudge,
  judgeVerdict, finalVerdict, runChecks, publishGate, RUBRIC_V1, freezeContent, checksumOf };
export type { Bot, TestSpec };
```

- [ ] **Step 4: Run tests**

Run: `npm run test:trainer`
Expected: PASS, `fail 0` for both files.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/trainer-handler.ts supabase/functions/_shared/trainer-handler.test.ts
git commit -m "feat(ai-trainer): handler with key auth, items, tests, import and playground

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: ai-trainer handler — snapshots, runs, publish, rollback, status

**Files:**
- Modify: `supabase/functions/_shared/trainer-handler.ts` (replace `handleRunsAndPublish`)
- Modify: `supabase/functions/_shared/trainer-handler.test.ts`

**Interfaces:**
- Consumes: Task 6.
- Produces actions: `snapshot.freeze`, `snapshot.list`, `runs.start {snapshot_id, bot}`, `runs.step {run_id}` (≤5 tests), `runs.get {run_id}`, `publish {snapshot_id, bot}`, `rollback {bot, snapshot_id?, legacy?, reason}`, `status`.

- [ ] **Step 1: Write the failing tests**

Append to `trainer-handler.test.ts`:

```ts
const OUT = (o: any = {}) => JSON.stringify({ intent: "info", project_ref: null, language: "en", reply: "Which project are you interested in?", media: [], handoff: false, asked: [], used_item_ids: [], clarify: true, ...o });
const JPASS = JSON.stringify({ verdict: "pass", criteria: {}, rationale: "good" });
const JFAIL = JSON.stringify({ verdict: "fail", criteria: {}, rationale: "bad" });
const SPEC1 = { title: "price no project", setup: { isAd: false, returning: false }, conversation: [], target: "What is the price?", checks: [{ type: "handoff", value: false }], ideal_reply: "ask which project", judge: "rubric" };

async function setup(llmTexts: string[]) {
  const db = memDb();
  const deps = { db, llm: llm(...llmTexts), env: ENV };
  await call(deps, "items.create", { kind: "fact", bots: ["eyad"], project_ref: null, body: { topic: "a", text: "b" } });
  await call(deps, "tests.create", { bots: ["eyad"], origin: "handwritten", spec: SPEC1 });
  const s = await call(deps, "snapshot.freeze", {});
  return { db, deps, snapId: s.body.data.id };
}

test("full flow: freeze, run, publish allowed on all PASS", async () => {
  const { deps, snapId } = await setup([OUT(), JPASS]);
  const run = await call(deps, "runs.start", { snapshot_id: snapId, bot: "eyad" });
  assert.equal(run.status, 200);
  const step = await call(deps, "runs.step", { run_id: run.body.data.id });
  assert.equal(step.body.data.status, "complete");
  const pub = await call(deps, "publish", { snapshot_id: snapId, bot: "eyad" });
  assert.equal(pub.status, 200);
  const st = await call(deps, "status", {});
  assert.equal(st.body.data.pointers.find((x: any) => x.bot === "eyad").mode, "snapshot");
});

test("publish refused on FAIL", async () => {
  const { deps, snapId } = await setup([OUT(), JFAIL, JFAIL, JFAIL]);
  const run = await call(deps, "runs.start", { snapshot_id: snapId, bot: "eyad" });
  await call(deps, "runs.step", { run_id: run.body.data.id });
  const pub = await call(deps, "publish", { snapshot_id: snapId, bot: "eyad" });
  assert.equal(pub.status, 409); assert.ok(pub.body.error.details.some((r: string) => r.includes("FAIL")));
});

test("publish refused on INCONCLUSIVE when the judge is down", async () => {
  const { deps, snapId } = await setup([OUT()]);
  const run = await call(deps, "runs.start", { snapshot_id: snapId, bot: "eyad" });
  await call(deps, "runs.step", { run_id: run.body.data.id });
  const r = await call(deps, "runs.get", { run_id: run.body.data.id });
  assert.equal(r.body.data.results[0].verdict, "INCONCLUSIVE");
  assert.equal((await call(deps, "publish", { snapshot_id: snapId, bot: "eyad" })).status, 409);
});

test("deterministic failure skips judge and fails", async () => {
  const { deps, snapId } = await setup([OUT({ handoff: true })]);
  const run = await call(deps, "runs.start", { snapshot_id: snapId, bot: "eyad" });
  await call(deps, "runs.step", { run_id: run.body.data.id });
  const r = await call(deps, "runs.get", { run_id: run.body.data.id });
  assert.equal(r.body.data.results[0].verdict, "FAIL");
  assert.equal(r.body.data.results[0].judge.verdict, "skipped");
});

test("rollback to legacy needs a reason", async () => {
  const { deps, snapId } = await setup([OUT(), JPASS]);
  const run = await call(deps, "runs.start", { snapshot_id: snapId, bot: "eyad" });
  await call(deps, "runs.step", { run_id: run.body.data.id });
  await call(deps, "publish", { snapshot_id: snapId, bot: "eyad" });
  assert.equal((await call(deps, "rollback", { bot: "eyad", legacy: true, reason: "" })).status, 422);
  assert.equal((await call(deps, "rollback", { bot: "eyad", legacy: true, reason: "test" })).status, 200);
});

test("freeze refuses when drafts have errors", async () => {
  const db = memDb();
  const deps = { db, llm: llm(), env: ENV };
  db.t.ai_trainer_items.push({ id: "x", kind: "fact", revision: 1, status: "active", bots: ["eyad"], project_ref: "missing", body: { topic: "a", text: "b" } });
  assert.equal((await call(deps, "snapshot.freeze", {})).status, 422);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test supabase/functions/_shared/trainer-handler.test.ts`
Expected: FAIL; new tests get `400 unknown_action`.

- [ ] **Step 3: Implement**

In `trainer-handler.ts`, replace the whole `handleRunsAndPublish` stub with:

```ts
const STEP_SIZE = 5;

async function freeze(deps: Deps, actor: string): Promise<Res> {
  const { content, errors } = freezeContent(await loadDrafts(deps.db), { reply_model: deps.env.replyModel, max_tokens: 600, rubric_version: 1 });
  if (errors.length) return fail(422, "freeze", "Drafts have errors. Fix them first.", errors);
  const checksum = await checksumOf(content);
  const prev = await deps.db.select("ai_snapshots?select=id,checksum,version_no");
  const same = prev.find((s) => s.checksum === checksum);
  if (same) return ok({ id: same.id, version_no: same.version_no, checksum, reused: true });
  const version_no = prev.reduce((m, s) => Math.max(m, s.version_no), 0) + 1;
  const row = await deps.db.insert("ai_snapshots", { version_no, content, checksum, core_version_frozen: CORE_VERSION, created_by_claimed: actor });
  await deps.db.insert("ai_trainer_audit", { entity: "snapshot", entity_id: row.id, action: "freeze", after: { version_no, checksum }, actor_claimed: actor });
  return ok({ id: row.id, version_no, checksum, reused: false });
}

async function startRun(deps: Deps, p: any, actor: string): Promise<Res> {
  if (!["eyad", "dubai"].includes(p.bot)) return fail(422, "schema", "bot must be eyad or dubai");
  const { checksum } = await contentFor(deps, "snapshot", p.snapshot_id);
  const tests = (await deps.db.select("ai_tests?status=eq.active&select=id,bots")).filter((t) => t.bots.includes(p.bot));
  const row = await deps.db.insert("ai_test_runs", {
    snapshot_id: p.snapshot_id, snapshot_checksum: checksum, bot: p.bot, core_version: CORE_VERSION,
    reply_model: deps.env.replyModel, judge_model: deps.env.judgeModel, prompt_version: "p1", rubric_version: "sales-default@1",
    status: "running", test_ids: tests.map((t) => t.id), counts: {}, cost_usd: 0, started_by_claimed: actor,
  });
  return ok({ id: row.id, total: tests.length });
}

// Judge with retries: one attempt, and two more only if the first is not a pass.
async function judge(deps: Deps, spec: TestSpec, r: any): Promise<{ verdict: string; attempts: any[] }> {
  const prompt = buildJudgePrompt(spec, r, RUBRIC_V1);
  const attempts: any[] = [];
  const once = async () => {
    for (let i = 0; i < 2; i++) {
      const x = await portsFor(deps).callModel({ model: deps.env.judgeModel, max_tokens: 400, system: prompt.system, messages: prompt.messages });
      if (x.ok) { const a = parseJudge(x.text); if (!a.error) return a; if (i === 1) return a; }
      else if (i === 1) return { verdict: "inconclusive" as const, rationale: "", error: x.error };
    }
    return { verdict: "inconclusive" as const, rationale: "", error: "unreachable" };
  };
  attempts.push(await once());
  if (attempts[0].verdict !== "pass") { attempts.push(await once()); attempts.push(await once()); }
  return { verdict: judgeVerdict(attempts), attempts };
}

async function stepRun(deps: Deps, p: any): Promise<Res> {
  const run = (await deps.db.select(`ai_test_runs?id=eq.${encodeURIComponent(p.run_id)}&select=*`))[0];
  if (!run) return fail(404, "not_found", "Run not found.");
  if (run.status !== "running") return ok({ status: run.status });
  const { content, checksum } = await contentFor(deps, "snapshot", run.snapshot_id);
  if (checksum !== run.snapshot_checksum) return fail(409, "checksum", "Snapshot content changed under this run.");
  const done = new Set((await deps.db.select(`ai_test_results?run_id=eq.${encodeURIComponent(run.id)}&select=test_id`)).map((r) => r.test_id));
  const todo = run.test_ids.filter((id: string) => !done.has(id)).slice(0, STEP_SIZE);
  for (const tid of todo) {
    const t = (await deps.db.select(`ai_tests?id=eq.${encodeURIComponent(tid)}&select=*`))[0];
    const spec: TestSpec = t.spec;
    const samples = spec.samples === 3 ? 3 : 1;
    let verdict: "PASS" | "FAIL" | "INCONCLUSIVE" = "PASS"; let last: any = null; let lastChecks: any[] = []; let lastJudge: any = { verdict: "none" };
    for (let i = 0; i < samples && verdict === "PASS"; i++) {
      const r = await runTurn({ content, bot: run.bot, text: spec.target, history: spec.conversation, state: { ...emptyState(), ...(spec.setup.state || {}) },
        ad: { isAd: spec.setup.isAd, adText: spec.setup.adText }, returning: spec.setup.returning, ports: portsFor(deps) });
      const checks = runChecks(spec, r);
      const failed = checks.some((c) => !c.pass);
      const j = failed ? { verdict: "skipped", attempts: [] } : spec.judge === "none" ? { verdict: "none", attempts: [] } : await judge(deps, spec, r);
      verdict = finalVerdict(checks, j.verdict as any);
      last = r; lastChecks = checks; lastJudge = j;
    }
    await deps.db.insert("ai_test_results", { run_id: run.id, test_id: t.id, test_revision: t.revision,
      reply: { reply: last.reply, media: last.media, handoff: last.handoff, outcome: last.outcome, trace: last.trace },
      checks: lastChecks, judge: lastJudge, verdict });
  }
  const results = await deps.db.select(`ai_test_results?run_id=eq.${encodeURIComponent(run.id)}&select=verdict`);
  if (results.length >= run.test_ids.length) {
    const counts = { PASS: 0, FAIL: 0, INCONCLUSIVE: 0 } as Record<string, number>;
    results.forEach((r) => counts[r.verdict]++);
    await deps.db.patch("ai_test_runs", `id=eq.${run.id}`, { status: "complete", counts, finished_at: new Date().toISOString() });
    return ok({ status: "complete", counts });
  }
  return ok({ status: "running", done: results.length, total: run.test_ids.length });
}

async function gateFor(deps: Deps, snapshotId: string, bot: Bot) {
  const snap = (await deps.db.select(`ai_snapshots?id=eq.${encodeURIComponent(snapshotId)}&select=*`))[0];
  if (!snap) return { snap: null, gate: { ok: false, reasons: ["snapshot not found"] } };
  if (await checksumOf(snap.content) !== snap.checksum) return { snap, gate: { ok: false, reasons: ["snapshot checksum mismatch"] } };
  const runs = (await deps.db.select(`ai_test_runs?snapshot_id=eq.${encodeURIComponent(snapshotId)}&select=*`))
    .filter((r) => r.bot === bot && r.status === "complete").sort((a, b) => String(b.finished_at).localeCompare(String(a.finished_at)));
  const run = runs[0] || null;
  const results = run ? await deps.db.select(`ai_test_results?run_id=eq.${encodeURIComponent(run.id)}&select=*`) : [];
  const activeTests = await deps.db.select("ai_tests?status=eq.active&select=id,revision,bots");
  return { snap, run, gate: publishGate({ snapshot: snap, run, results, activeTests, bot, coreVersion: CORE_VERSION }) };
}

async function publish(deps: Deps, p: any, actor: string): Promise<Res> {
  if (!["eyad", "dubai"].includes(p.bot)) return fail(422, "schema", "bot must be eyad or dubai");
  const { snap, gate } = await gateFor(deps, p.snapshot_id, p.bot);
  if (!gate.ok) return fail(409, "gate", "Publish is blocked.", gate.reasons);
  if (snap.status !== "published") {
    await deps.db.patch("ai_snapshots", `id=eq.${snap.id}`, { status: "published", published_at: new Date().toISOString(), published_by_claimed: actor });
  }
  const before = (await deps.db.select(`ai_bot_pointers?bot=eq.${p.bot}&select=*`))[0];
  await deps.db.patch("ai_bot_pointers", `bot=eq.${p.bot}`, { mode: "snapshot", snapshot_id: snap.id, changed_at: new Date().toISOString(), changed_by_claimed: actor, reason: "publish" });
  await deps.db.insert("ai_trainer_audit", { entity: "pointer", entity_id: p.bot, action: "publish", before, after: { snapshot_id: snap.id, version_no: snap.version_no }, actor_claimed: actor });
  return ok({ bot: p.bot, snapshot_id: snap.id, version_no: snap.version_no });
}

async function rollback(deps: Deps, p: any, actor: string): Promise<Res> {
  if (!["eyad", "dubai"].includes(p.bot)) return fail(422, "schema", "bot must be eyad or dubai");
  if (!String(p.reason || "").trim()) return fail(422, "reason_required", "A reason is required to roll back.");
  const before = (await deps.db.select(`ai_bot_pointers?bot=eq.${p.bot}&select=*`))[0];
  if (p.legacy) {
    await deps.db.patch("ai_bot_pointers", `bot=eq.${p.bot}`, { mode: "legacy", snapshot_id: null, changed_at: new Date().toISOString(), changed_by_claimed: actor, reason: p.reason });
  } else {
    const snap = (await deps.db.select(`ai_snapshots?id=eq.${encodeURIComponent(p.snapshot_id)}&select=*`))[0];
    if (!snap || snap.status !== "published") return fail(422, "schema", "Only a published snapshot can be rolled back to.");
    const { gate } = await gateFor(deps, snap.id, p.bot);
    if (!gate.ok) return fail(409, "gate", "That version is not certified for the current core. Run its tests first.", gate.reasons);
    await deps.db.patch("ai_bot_pointers", `bot=eq.${p.bot}`, { mode: "snapshot", snapshot_id: snap.id, changed_at: new Date().toISOString(), changed_by_claimed: actor, reason: p.reason });
  }
  await deps.db.insert("ai_trainer_audit", { entity: "pointer", entity_id: p.bot, action: "rollback", before, after: { legacy: !!p.legacy, snapshot_id: p.snapshot_id ?? null }, reason: p.reason, actor_claimed: actor });
  return ok({ bot: p.bot });
}

async function handleRunsAndPublish(action: string, p: any, actor: string, deps: Deps): Promise<Res> {
  switch (action) {
    case "snapshot.freeze": return await freeze(deps, actor);
    case "snapshot.list": return ok((await deps.db.select("ai_snapshots?select=id,version_no,status,checksum,core_version_frozen,created_at,created_by_claimed,published_at,published_by_claimed"))
      .sort((a, b) => b.version_no - a.version_no));
    case "runs.start": return await startRun(deps, p, actor);
    case "runs.step": return await stepRun(deps, p);
    case "runs.get": {
      const run = (await deps.db.select(`ai_test_runs?id=eq.${encodeURIComponent(p.run_id)}&select=*`))[0];
      if (!run) return fail(404, "not_found", "Run not found.");
      return ok({ ...run, results: await deps.db.select(`ai_test_results?run_id=eq.${encodeURIComponent(run.id)}&select=*`) });
    }
    case "publish": return await publish(deps, p, actor);
    case "rollback": return await rollback(deps, p, actor);
    case "status": return ok({
      core_version: CORE_VERSION,
      pointers: await deps.db.select("ai_bot_pointers?select=*"),
      budget: await deps.db.select("ai_budget_days?pool=eq.trainer&select=*"),
    });
    default: return fail(400, "unknown_action", `Unknown action: ${action}`);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test:trainer`
Expected: PASS, `fail 0`

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/trainer-handler.ts supabase/functions/_shared/trainer-handler.test.ts
git commit -m "feat(ai-trainer): snapshots, stepped test runs, gated publish and rollback

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: ai-trainer Edge Function shell

**Files:**
- Create: `supabase/functions/ai-trainer/index.ts`

**Interfaces:**
- Consumes: `handleTrainer`, `Db`, `Llm`, `Env` from Task 6; `SUPABASE_URL`, `SERVICE_KEY`, `sbSelect` from `_shared/wa.ts`.

- [ ] **Step 1: Write the shell**

Create `supabase/functions/ai-trainer/index.ts`:

```ts
// ai-trainer: the AI Trainer's server side. All logic is in
// ../_shared/trainer-handler.ts and ../_shared/trainer-core.ts, which have no
// Deno dependency and are tested under Node (npm run test:trainer). This file
// only wires real ports: PostgREST with the service role, and OpenRouter.
//
// Deploy (owner approval required):
//   npx supabase secrets set AI_TRAINER_KEY=<32+ random bytes, base64> AI_TRAINER_DAILY_BUDGET_USD=2
//   npx supabase functions deploy ai-trainer --no-verify-jwt
//
// --no-verify-jwt because the CRM mints no Supabase JWT; access is the
// X-Trainer-Key header, a temporary shared secret (spec §9).
import { handleTrainer, type Db, type Llm } from "../_shared/trainer-handler.ts";
import { SUPABASE_URL, SERVICE_KEY, sbSelect } from "../_shared/wa.ts";

const H = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };
const CORS = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "content-type, x-trainer-key, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const db: Db = {
  select: sbSelect,
  async insert(table, row) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, { method: "POST", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify(row) });
    if (!r.ok) throw new Error(`insert ${table} failed: ${r.status} ${await r.text()}`);
    return (await r.json())[0];
  },
  async patch(table, filter, patch) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, { method: "PATCH", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify(patch) });
    if (!r.ok) throw new Error(`patch ${table} failed: ${r.status} ${await r.text()}`);
    return true;
  },
  async rpc(fn, args) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: H, body: JSON.stringify(args) });
    const text = await r.text();
    if (!r.ok) return { ok: false, error: text };
    return { ok: true, data: text ? JSON.parse(text) : null };
  },
};

const llm: Llm = {
  async chat(req) {
    const key = Deno.env.get("OPENROUTER_API_KEY") ?? "";
    if (!key) return { ok: false, error: "OPENROUTER_API_KEY not configured" };
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 30_000);
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST", signal: ctl.signal,
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": "https://wepro.app", "X-Title": "WEPRO AI Trainer" },
        body: JSON.stringify({ model: req.model, max_tokens: req.max_tokens, messages: [{ role: "system", content: req.system }, ...req.messages] }),
      });
      if (!r.ok) return { ok: false, error: `OpenRouter ${r.status}` };
      const j = await r.json();
      return { ok: true, text: String(j?.choices?.[0]?.message?.content ?? ""), prompt_tokens: j?.usage?.prompt_tokens ?? 0, completion_tokens: j?.usage?.completion_tokens ?? 0 };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    } finally {
      clearTimeout(timer);
    }
  },
};

const env = {
  trainerKey: Deno.env.get("AI_TRAINER_KEY") ?? "",
  budgetUsd: Number(Deno.env.get("AI_TRAINER_DAILY_BUDGET_USD") ?? "2"),
  replyModel: Deno.env.get("OPENROUTER_MODEL")?.trim() || "anthropic/claude-haiku-5.5",
  judgeModel: Deno.env.get("AI_TRAINER_JUDGE_MODEL")?.trim() || "anthropic/claude-sonnet-5.5",
  // List prices per million tokens; override when the models change.
  pricePerMTok: { in: Number(Deno.env.get("AI_PRICE_IN_PER_MTOK") ?? "2"), out: Number(Deno.env.get("AI_PRICE_OUT_PER_MTOK") ?? "10") },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  let body: unknown = null;
  try { body = await req.json(); } catch { /* handled below */ }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  const res = await handleTrainer({ method: req.method, headers: req.headers, ip, body }, { db, llm, env });
  return new Response(JSON.stringify(res.body), { status: res.status, headers: { ...CORS, "Content-Type": "application/json" } });
});
```

Price defaults intentionally use the more expensive (judge-model) rate so the budget errs strict.

- [ ] **Step 2: Check it type-checks**

There is no Deno on this machine (Verified). Run the Node tests again to confirm the handler it wraps still passes:

Run: `npm run test:trainer`
Expected: PASS. Deno type-checking happens at deploy (`supabase functions deploy` bundles and fails on type errors).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/ai-trainer/index.ts
git commit -m "feat(ai-trainer): Edge Function shell with PostgREST and OpenRouter ports

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Browser client and page registration

**Files:**
- Create: `src/lib/aiTrainer.js`
- Create: `src/components/views/AiTrainerView.jsx`
- Create: `src/components/aitrainer/aitrainer.css`
- Modify: `src/App.jsx` (PAGES, destructure, PageBody)
- Modify: `src/lib/constants.js` (NAV_SCOPES, FEATURE_KEYS, FEATURE_LABELS)
- Modify: `src/lib/navMeta.js`, `src/lib/navHistory.js`, `src/components/Sidebar.jsx`
- Modify: `index.html` (icon subset: add `fact_check`, `play_arrow`, `science`, `smart_toy`)

**Interfaces:**
- Produces:
  - `getTrainerKey(): string`, `setTrainerKey(k: string): void`, `clearTrainerKey(): void`
  - `trainerCall(user, action, payload = {}): Promise<any>` (throws `Error` with `.code`, `.details`, `.status`)
  - default export `AiTrainerView`

- [ ] **Step 1: Write the client**

Create `src/lib/aiTrainer.js`:

```js
// Browser side of the AI Trainer. Every call goes to the ai-trainer Edge
// Function with the Trainer access key Management entered for this browser
// session. The key lives in sessionStorage only (cleared when the tab session
// ends); the server holds the real secret and checks it on every call.
import { SB_URL, SB_KEY } from './supabase.js';

export const TRAINER_URL = `${SB_URL}/functions/v1/ai-trainer`;
const KEY = 'aitrainer.key';

export function getTrainerKey() { try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; } }
export function setTrainerKey(k) { try { sessionStorage.setItem(KEY, k); } catch { /* private mode: key lasts this page only */ } }
export function clearTrainerKey() { try { sessionStorage.removeItem(KEY); } catch { /* nothing stored */ } }

export async function trainerCall(user, action, payload = {}) {
  let r;
  try {
    r = await fetch(TRAINER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SB_KEY, 'X-Trainer-Key': getTrainerKey() },
      body: JSON.stringify({ action, payload, actor_claimed: user?.name || user?.email || 'unknown' }),
    });
  } catch {
    throw Object.assign(new Error('Could not reach the AI Trainer service. It may not be deployed yet.'), { code: 'network' });
  }
  let j = null;
  try { j = await r.json(); } catch { /* not JSON */ }
  if (!r.ok || !j?.ok) {
    if (r.status === 401) clearTrainerKey();
    const e = j?.error || {};
    throw Object.assign(new Error(e.message || `Request failed (HTTP ${r.status})`), { code: e.code, details: e.details, status: r.status });
  }
  return j.data;
}
```

- [ ] **Step 2: Write the page shell with key gate and tabs**

Create `src/components/views/AiTrainerView.jsx`:

```jsx
import { useCallback, useState } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import useNavState from '../../hooks/useNavState.js';
import { isChatAdmin } from '../../lib/wa.js';
import { getTrainerKey, setTrainerKey, clearTrainerKey, trainerCall } from '../../lib/aiTrainer.js';
import KnowledgeTab from '../aitrainer/KnowledgeTab.jsx';
import BehaviourTab from '../aitrainer/BehaviourTab.jsx';
import PlaygroundTab from '../aitrainer/PlaygroundTab.jsx';
import QualityTab from '../aitrainer/QualityTab.jsx';
import '../aitrainer/aitrainer.css';

// AI Trainer: Management trains the WhatsApp bot here. Edits are drafts; the
// bots only use a snapshot after it passes every regression test and is
// published (docs/superpowers/specs/2026-10-18-wecon-ai-trainer-design.md).
// isChatAdmin only decides what to show; the server checks the access key.
const TABS = [
  ['knowledge', 'Knowledge', 'menu_book'],
  ['behaviour', 'Behaviour', 'psychology'],
  ['playground', 'Playground', 'chat'],
  ['quality', 'Quality & Publish', 'fact_check'],
];

function KeyGate({ user, onOk }) {
  const [k, setK] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    setTrainerKey(k.trim());
    try { await trainerCall(user, 'auth.check'); onOk(); }
    catch (x) { clearTrainerKey(); setErr(x.message); }
    finally { setBusy(false); }
  };
  return (
    <form className="ait-gate" onSubmit={submit}>
      <Mi>key</Mi>
      <p>Enter the AI Trainer access key. It is kept for this browser tab only.</p>
      <input className="fi" type="password" autoComplete="off" value={k} onChange={e => setK(e.target.value)} aria-label="AI Trainer access key" />
      {err && <div className="ait-err" role="alert">{err}</div>}
      <button className="btn btn-p" disabled={busy || !k.trim()}>{busy ? 'Checking…' : 'Unlock'}</button>
    </form>
  );
}

export default function AiTrainerView() {
  const { user, showToast } = useApp();
  const [tab, setTab] = useNavState('aitrainer.tab', 'knowledge');
  const [unlocked, setUnlocked] = useState(() => !!getTrainerKey());
  // Stable across renders: the tabs load data in effects keyed on `api`, so a
  // new function every render would refetch in a loop.
  const api = useCallback((action, payload) => trainerCall(user, action, payload).catch((e) => {
    if (e.status === 401) setUnlocked(false);
    throw e;
  }), [user]);
  if (!isChatAdmin(user)) return <div className="ea-count" style={{ padding: 18 }}>Only Management can use the AI Trainer.</div>;
  if (!unlocked) return <KeyGate user={user} onOk={() => setUnlocked(true)} />;
  const props = { api, showToast, user };
  return (
    <div className="ait">
      <div className="fin-tabs" role="tablist" aria-label="AI Trainer sections">
        {TABS.map(([k, l, ic]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            <Mi>{ic}</Mi>{l}
          </button>
        ))}
      </div>
      {tab === 'knowledge' && <KnowledgeTab {...props} />}
      {tab === 'behaviour' && <BehaviourTab {...props} />}
      {tab === 'playground' && <PlaygroundTab {...props} />}
      {tab === 'quality' && <QualityTab {...props} />}
    </div>
  );
}
```

Create `src/components/aitrainer/aitrainer.css`:

```css
/* AI Trainer page. Reuses .fin-tabs, .analytics-card, .btn, .fi and .modal
   from the app; only what is specific to the trainer lives here. */
.ait { display: flex; flex-direction: column; gap: 16px; }
.ait-gate { max-width: 420px; margin: 40px auto; display: flex; flex-direction: column; gap: 12px; align-items: stretch; text-align: center; }
.ait-err { color: var(--red); font-size: 13px; }
.ait-list { display: flex; flex-direction: column; gap: 8px; }
.ait-row { display: flex; gap: 12px; align-items: flex-start; justify-content: space-between; padding: 10px 12px; border-radius: 10px; background: var(--card); }
.ait-row .meta { font-size: 12px; opacity: .7; }
.ait-badge { display: inline-flex; gap: 4px; align-items: center; padding: 2px 8px; border-radius: 999px; font-size: 12px; background: var(--bg2); }
.ait-badge.pass { color: var(--green); }
.ait-badge.fail { color: var(--red); }
.ait-badge.inc { color: var(--amber, #c80); }
.ait-chat { display: flex; flex-direction: column; gap: 8px; min-height: 240px; }
.ait-msg { max-width: 80%; padding: 8px 12px; border-radius: 12px; white-space: pre-wrap; }
.ait-msg.customer { align-self: flex-end; background: var(--bg2); }
.ait-msg.bot { align-self: flex-start; background: var(--card); }
.ait-trace { font-size: 12px; opacity: .8; margin-top: 4px; }
.ait-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 320px); gap: 16px; }
@media (max-width: 900px) { .ait-grid { grid-template-columns: minmax(0, 1fr); } }
```

- [ ] **Step 3: Register the page**

In `src/App.jsx` `PAGES` (line ~49), add after the `RelayView` line:

```js
  AiTrainerView: () => import('./components/views/AiTrainerView.jsx'),
```

In the destructure at line ~93, add `AiTrainerView` after `RelayView`.

In `PageBody`, after `if (view === 'relay') return <RelayView />;` add:

```js
  if (view === 'aitrainer') return <AiTrainerView />;
```

In `src/lib/constants.js` `NAV_SCOPES`, after `relay: ['MANAGEMENT'],` add:

```js
  aitrainer: ['MANAGEMENT'],
```

In `FEATURE_KEYS`, add `'aitrainer'` after `'relay'`. In `FEATURE_LABELS`, add `aitrainer: 'AI Trainer',` after `relay: 'WhatsApp Relay',`.

In `src/lib/navMeta.js` after the `relay` line add:

```js
  aitrainer: { ico: 'smart_toy', lbl: 'AI Trainer' },
```

In `src/lib/navHistory.js` `VIEW_TITLES` after `relay: 'WhatsApp Relay',` add:

```js
  aitrainer: 'AI Trainer',
```

In `src/components/Sidebar.jsx` line 16, change `keys: ['inventory', 'team', 'accounts', 'relay']` to:

```js
  { label: 'Admin', keys: ['inventory', 'team', 'accounts', 'relay', 'aitrainer'] },
```

In `index.html`, add `fact_check`, `play_arrow`, `science` and `smart_toy` to the `icon_names=` list, keeping alphabetical order. Check it stays sorted:

Run: `grep -o 'icon_names=[^"&]*' index.html | tr ',' '\n' | sed 1d | sort -c && echo SORTED`
Expected: `SORTED`

- [ ] **Step 4: Create placeholder tab files so the build passes**

The tab components are built in Tasks 10 to 12. Create each now with its final export name and a loading line, so this task builds on its own:

```jsx
// src/components/aitrainer/KnowledgeTab.jsx (Task 10 replaces this)
export default function KnowledgeTab() { return <div className="ea-count">Loading…</div>; }
```

Create `BehaviourTab.jsx`, `PlaygroundTab.jsx` and `QualityTab.jsx` the same way, each with its own component name.

- [ ] **Step 5: Lint and build**

Run: `npm run lint 2>&1 | tail -3 && npm run build 2>&1 | tail -3`
Expected: lint `✖ 3 problems (1 error, 2 warnings)` (the existing baseline, none in new files); build `✓ built`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/aiTrainer.js src/components/views/AiTrainerView.jsx src/components/aitrainer/ src/App.jsx src/lib/constants.js src/lib/navMeta.js src/lib/navHistory.js src/components/Sidebar.jsx index.html
git commit -m "feat(ai-trainer): page shell, key gate, client and navigation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Knowledge and Behaviour tabs with one item editor

**Files:**
- Create: `src/components/aitrainer/ItemEditor.jsx`
- Create: `src/components/aitrainer/ItemList.jsx`, `src/components/aitrainer/useItems.js`
- Replace: `src/components/aitrainer/KnowledgeTab.jsx`, `src/components/aitrainer/BehaviourTab.jsx`

**Interfaces:**
- Consumes: `api(action, payload)` from Task 9; actions `items.list`, `items.create`, `items.update`, `items.retire`, `import.preview`, `import.commit`.
- Produces: `ItemEditor({ kind, initial, projects, onClose, onSaved, api, showToast })`; `initial` is an item row or `null` for a new item.

- [ ] **Step 1: Write ItemEditor**

Create `src/components/aitrainer/ItemEditor.jsx`:

```jsx
import { useState } from 'react';
import Mi from '../Mi.jsx';

// One modal for every item kind. The body is edited as typed fields for the
// common kinds and as JSON for projects (their media lists are long); the
// server validates the schema either way and returns field errors.
const FIELDS = {
  fact: [['topic', 'Topic'], ['text', 'Fact', 'area'], ['source', 'Source (brochure, management, website)']],
  rule: [['name', 'Name'], ['when', 'When', 'area'], ['must', 'Must', 'area'], ['must_not', 'Must not', 'area']],
  behaviour: [['aspect', 'Aspect (tone, language, greeting, discovery, pricing, objection, meeting, handoff)'], ['instruction', 'Instruction', 'area']],
  example: [['ideal_reply', 'Ideal reply', 'area'], ['reason', 'Why this is right', 'area'], ['original_reply', 'Original (wrong) reply', 'area']],
};
const NEW_BODY = {
  fact: { topic: '', text: '' }, rule: { name: '', when: '', must: '' }, behaviour: { aspect: 'tone', instruction: '' },
  example: { conversation: [{ role: 'customer', text: '' }], ideal_reply: '', reason: '', source: 'handwritten' },
  project: { name: '', aliases: { bn: [], banglish: [], en: [] }, media: { photos: [], floor_plans: [] } },
};
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v !== undefined));

export default function ItemEditor({ kind, initial, projects, onClose, onSaved, api, showToast }) {
  const [body, setBody] = useState(() => initial?.body || NEW_BODY[kind]);
  const [json, setJson] = useState(() => JSON.stringify(initial?.body || NEW_BODY[kind], null, 2));
  const [bots, setBots] = useState(() => initial?.bots || ['eyad', 'dubai']);
  const [projectRef, setProjectRef] = useState(initial?.project_ref || '');
  const [errors, setErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  const scoped = kind === 'fact' || kind === 'rule' || kind === 'example';
  const toggleBot = (b) => setBots(v => (v.includes(b) ? v.filter(x => x !== b) : [...v, b]));

  const save = async () => {
    let b = body;
    if (kind === 'project') { try { b = JSON.parse(json); } catch { setErrors(['Body is not valid JSON']); return; } }
    if (kind === 'example' && typeof b.customer_text === 'string') {
      const { customer_text, ...rest } = b;
      b = { ...rest, conversation: [{ role: 'customer', text: customer_text }] };
    }
    setSaving(true); setErrors([]);
    const payload = { kind, bots, project_ref: scoped && projectRef ? projectRef : null, body: kind === 'project' ? b : clean(b) };
    try {
      if (initial) await api('items.update', { ...payload, id: initial.id, revision: initial.revision });
      else await api('items.create', payload);
      showToast('Saved as a draft. Live bots are not affected until you publish.', 'ok');
      onSaved(); onClose();
    } catch (e) {
      setErrors(Array.isArray(e.details) ? e.details : [e.message]);
    } finally { setSaving(false); }
  };

  return (
    <div className="mov on" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 640 }}>
        <div className="m-hd">
          <div className="m-ttl">{initial ? `Edit ${kind}` : `New ${kind}`}</div>
          <button className="m-x" onClick={onClose} aria-label="Close"><Mi>close</Mi></button>
        </div>
        <div className="m-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {kind === 'project' ? (
            <div className="fg"><label>Project (JSON)</label><textarea className="fi" rows={16} value={json} onChange={e => setJson(e.target.value)} spellCheck={false} /></div>
          ) : (
            <>
              {kind === 'example' && (
                <div className="fg"><label>Customer message</label>
                  <textarea className="fi" rows={2} value={body.customer_text ?? body.conversation?.at(-1)?.text ?? ''} onChange={e => setBody(v => ({ ...v, customer_text: e.target.value }))} /></div>
              )}
              {FIELDS[kind].map(([k, l, t]) => (
                <div className="fg" key={k}><label>{l}</label>
                  {t === 'area'
                    ? <textarea className="fi" rows={3} value={body[k] || ''} onChange={e => setBody(v => ({ ...v, [k]: e.target.value }))} />
                    : <input className="fi" value={body[k] || ''} onChange={e => setBody(v => ({ ...v, [k]: e.target.value }))} />}
                </div>
              ))}
            </>
          )}
          <div className="ea-row" style={{ gap: 16 }}>
            <span>Bots:</span>
            {['eyad', 'dubai'].map(b => (
              <label key={b} style={{ display: 'inline-flex', gap: 6 }}><input type="checkbox" checked={bots.includes(b)} onChange={() => toggleBot(b)} />{b}</label>
            ))}
          </div>
          {scoped && (
            <div className="fg"><label>Project</label>
              <select className="fi" value={projectRef} onChange={e => setProjectRef(e.target.value)}>
                <option value="">Company-wide</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.body.name}</option>)}
              </select>
            </div>
          )}
          {errors.length > 0 && <ul className="ait-err" role="alert">{errors.map(e => <li key={e}>{e}</li>)}</ul>}
        </div>
        <div className="m-ft">
          <button className="btn btn-g" onClick={onClose}>Cancel</button>
          <button className="btn btn-p" disabled={saving || bots.length === 0} onClick={save}>{saving ? 'Saving…' : 'Save draft'}</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write the shared item list and its hook**

Two files, because the `react-refresh/only-export-components` lint rule rejects
a file that exports both a component and a hook.

Create `src/components/aitrainer/ItemList.jsx`:

```jsx
import Mi from '../Mi.jsx';

// Active items of one kind, with edit and retire buttons.
export default function ItemList({ items, kind, projects, onEdit, onRetire }) {
  const rows = items.filter(i => i.kind === kind && i.status === 'active');
  if (!rows.length) return <div className="ea-count">None yet.</div>;
  const pname = (id) => projects.find(p => p.id === id)?.body.name;
  return (
    <div className="ait-list">
      {rows.map(i => (
        <div className="ait-row" key={i.id}>
          <div>
            <div style={{ fontWeight: 600 }}>{i.body.name || i.body.topic || i.body.aspect || i.body.ideal_reply?.slice(0, 60)}</div>
            <div>{i.body.text || i.body.must || i.body.instruction || i.body.address || i.body.reason || ''}</div>
            <div className="meta">rev {i.revision} · {i.bots.join(', ')}{i.project_ref ? ` · ${pname(i.project_ref) || 'unknown project'}` : ''}</div>
          </div>
          <div className="ea-row">
            <button className="btn btn-g btn-sm" onClick={() => onEdit(i)} aria-label="Edit"><Mi>edit</Mi></button>
            <button className="btn btn-g btn-sm" onClick={() => onRetire(i)} aria-label="Retire"><Mi>delete</Mi></button>
          </div>
        </div>
      ))}
    </div>
  );
}
```

Create `src/components/aitrainer/useItems.js`:

```js
import { useCallback, useEffect, useState } from 'react';

// Loads every trainer item once and reloads after a change. Retiring asks for
// the required reason first.
export function useItems(api, showToast) {
  const [items, setItems] = useState(null);
  const reload = useCallback(() => api('items.list').then(setItems).catch(e => showToast(e.message, 'err')), [api, showToast]);
  useEffect(() => { reload(); }, [reload]);
  const retire = async (i) => {
    const reason = window.prompt('Why retire this item? (required)');
    if (!reason?.trim()) return;
    try { await api('items.retire', { ...i, revision: i.revision, reason }); reload(); }
    catch (e) { showToast(e.message, 'err'); }
  };
  return { items, reload, retire };
}
```

- [ ] **Step 3: Write KnowledgeTab with legacy import**

Replace `src/components/aitrainer/KnowledgeTab.jsx`:

```jsx
import { useState } from 'react';
import Mi from '../Mi.jsx';
import ItemEditor from './ItemEditor.jsx';
import ItemList from './ItemList.jsx';
import { useItems } from './useItems.js';

// Projects, facts and rules. Everything here is a draft until published from
// Quality & Publish. The legacy import copies wa_projects, wa_knowledge and
// wa_message_corrections into drafts, one reviewed row at a time; the legacy
// tables are never changed.
function ImportWizard({ api, showToast, onDone }) {
  const [rows, setRows] = useState(null);
  const [decide, setDecide] = useState({});
  const [report, setReport] = useState(null);
  const load = async () => {
    try {
      const d = await api('import.preview');
      setRows(d.rows);
      setDecide(Object.fromEntries(d.rows.map((r, n) => [n, r.status === 'ready' ? 'import' : 'reject'])));
    } catch (e) { showToast(e.message, 'err'); }
  };
  const commit = async () => {
    const decisions = rows.map((r, n) => ({ ref: { source: r.source, source_id: r.source_id }, decision: decide[n], item: r.proposed,
      reason: decide[n] === 'reject' ? (r.status === 'duplicate' ? 'duplicate' : r.errors?.join('; ') || 'rejected by reviewer') : undefined }));
    try { const d = await api('import.commit', { decisions }); setReport(d.report); onDone(); }
    catch (e) { showToast(e.message, 'err'); }
  };
  if (report) return (
    <div className="analytics-card">
      <b>Import report</b>
      {['imported', 'duplicate', 'rejected'].map(k => <div key={k}>{k}: {report.filter(r => r.result === k).length}</div>)}
      <ul>{report.filter(r => r.result !== 'imported').map((r, n) => <li key={n}>{r.source} {r.source_id}: {r.result} — {r.reason}</li>)}</ul>
    </div>
  );
  if (!rows) return <button className="btn btn-g" onClick={load}><Mi>upload</Mi>Import from WA Relay</button>;
  return (
    <div className="analytics-card">
      <b>Review each legacy row before importing</b>
      <div className="ait-list">
        {rows.map((r, n) => (
          <div className="ait-row" key={n}>
            <div>
              <div>{r.source} · {r.proposed.kind} · {r.proposed.body.name || r.proposed.body.topic || r.proposed.body.ideal_reply?.slice(0, 50)}</div>
              <div className="meta">{r.status}{r.errors?.length ? ` · ${r.errors.join('; ')}` : ''}{r.warnings?.length ? ` · ${r.warnings.join('; ')}` : ''}</div>
            </div>
            <div className="ea-row">
              {r.source === 'wa_knowledge' && (
                <select className="fi" value={r.proposed.kind} aria-label="Kind" onChange={e => {
                  const kind = e.target.value; const old = r.proposed.body;
                  const text = old.must || old.instruction || old.text || ''; const title = old.name || old.topic || 'Imported';
                  const body = kind === 'rule' ? { name: title, when: title, must: text } : kind === 'behaviour' ? { aspect: 'tone', instruction: text } : { topic: title, text };
                  setRows(v => v.map((x, i) => (i === n ? { ...x, proposed: { ...x.proposed, kind, body } } : x)));
                }}>
                  <option value="rule">rule</option><option value="behaviour">behaviour</option><option value="fact">fact</option>
                </select>
              )}
              <select className="fi" value={decide[n]} onChange={e => setDecide(v => ({ ...v, [n]: e.target.value }))} aria-label="Decision" disabled={r.status === 'rejected'}>
                <option value="import">Import</option><option value="reject">Reject</option>
              </select>
            </div>
          </div>
        ))}
      </div>
      <button className="btn btn-p" onClick={commit}>Import decided rows</button>
    </div>
  );
}

export default function KnowledgeTab({ api, showToast }) {
  const { items, reload, retire } = useItems(api, showToast);
  const [edit, setEdit] = useState(null);
  if (!items) return <div className="ea-count">Loading…</div>;
  const projects = items.filter(i => i.kind === 'project' && i.status === 'active');
  const section = (kind, title) => (
    <section>
      <div className="ea-row" style={{ justifyContent: 'space-between' }}>
        <h3>{title}</h3>
        <button className="btn btn-g btn-sm" onClick={() => setEdit({ kind, item: null })}><Mi>add</Mi>Add</button>
      </div>
      <ItemList items={items} kind={kind} projects={projects} onEdit={i => setEdit({ kind, item: i })} onRetire={retire} />
    </section>
  );
  return (
    <div className="ait">
      <ImportWizard api={api} showToast={showToast} onDone={reload} />
      {section('project', 'Projects')}
      {section('fact', 'Facts')}
      {section('rule', 'Business rules')}
      {edit && <ItemEditor kind={edit.kind} initial={edit.item} projects={projects} api={api} showToast={showToast} onClose={() => setEdit(null)} onSaved={reload} />}
    </div>
  );
}
```

- [ ] **Step 4: Write BehaviourTab**

Replace `src/components/aitrainer/BehaviourTab.jsx`:

```jsx
import { useState } from 'react';
import Mi from '../Mi.jsx';
import ItemEditor from './ItemEditor.jsx';
import ItemList from './ItemList.jsx';
import { useItems } from './useItems.js';

// Behaviour instructions (tone, discovery, pricing, handoff…) and conversation
// examples. Examples also come from the Playground's "Mark wrong" action.
export default function BehaviourTab({ api, showToast }) {
  const { items, reload, retire } = useItems(api, showToast);
  const [edit, setEdit] = useState(null);
  if (!items) return <div className="ea-count">Loading…</div>;
  const projects = items.filter(i => i.kind === 'project' && i.status === 'active');
  const section = (kind, title) => (
    <section>
      <div className="ea-row" style={{ justifyContent: 'space-between' }}>
        <h3>{title}</h3>
        <button className="btn btn-g btn-sm" onClick={() => setEdit({ kind, item: null })}><Mi>add</Mi>Add</button>
      </div>
      <ItemList items={items} kind={kind} projects={projects} onEdit={i => setEdit({ kind, item: i })} onRetire={retire} />
    </section>
  );
  return (
    <div className="ait">
      {section('behaviour', 'Behaviour instructions')}
      {section('example', 'Conversation examples')}
      {edit && <ItemEditor kind={edit.kind} initial={edit.item} projects={projects} api={api} showToast={showToast} onClose={() => setEdit(null)} onSaved={reload} />}
    </div>
  );
}
```

- [ ] **Step 5: Lint and build**

Run: `npm run lint 2>&1 | tail -3 && npm run build 2>&1 | tail -3`
Expected: lint at the baseline (1 error, 2 warnings, none in `src/components/aitrainer/`); build `✓ built`.

- [ ] **Step 6: Commit**

```bash
git add src/components/aitrainer/
git commit -m "feat(ai-trainer): knowledge and behaviour tabs with item editor and legacy import

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Playground tab

**Files:**
- Replace: `src/components/aitrainer/PlaygroundTab.jsx`

**Interfaces:**
- Consumes: actions `playground.turn`, `snapshot.list`, `items.list`, `items.create`, `tests.create`.

- [ ] **Step 1: Write the Playground**

Replace `src/components/aitrainer/PlaygroundTab.jsx`:

```jsx
import { useEffect, useState } from 'react';
import Mi from '../Mi.jsx';

// Multi-turn chat against drafts or any snapshot, through the same core the
// bots will run. Nothing is sent on WhatsApp. Each bot reply shows its trace,
// and a wrong reply can be saved as an example and a regression test.
const SETUP = { isAd: false, adText: '', returning: false };

function MarkWrong({ turn, history, bot, api, showToast, onClose }) {
  const [ideal, setIdeal] = useState('');
  const [reason, setReason] = useState('');
  const [asTest, setAsTest] = useState(true);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    const conversation = [...history.map(h => ({ role: h.role, text: h.text })), { role: 'customer', text: turn.customer }];
    try {
      await api('items.create', { kind: 'example', bots: [bot], project_ref: null,
        body: { conversation, original_reply: turn.reply || undefined, ideal_reply: ideal, reason, source: 'playground' } });
      if (asTest) {
        await api('tests.create', { bots: [bot], origin: 'playground', spec: {
          title: turn.customer.slice(0, 60), setup: turn.setup, conversation: history.map(h => ({ role: h.role, text: h.text })),
          target: turn.customer, checks: [{ type: 'handoff', value: false }], ideal_reply: ideal, judge: 'rubric' } });
      }
      showToast(asTest ? 'Saved as an example and a test' : 'Saved as an example', 'ok');
      onClose();
    } catch (e) { showToast(e.message, 'err'); }
    finally { setSaving(false); }
  };
  return (
    <div className="analytics-card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <b>Correct this reply</b>
      <textarea className="fi" rows={3} placeholder="Ideal reply" value={ideal} onChange={e => setIdeal(e.target.value)} />
      <textarea className="fi" rows={2} placeholder="Why (required)" value={reason} onChange={e => setReason(e.target.value)} />
      <label style={{ display: 'inline-flex', gap: 6 }}><input type="checkbox" checked={asTest} onChange={e => setAsTest(e.target.checked)} />Also save as a regression test</label>
      <div className="ea-row">
        <button className="btn btn-g" onClick={onClose}>Cancel</button>
        <button className="btn btn-p" disabled={saving || !ideal.trim() || !reason.trim()} onClick={save}>Save</button>
      </div>
    </div>
  );
}

export default function PlaygroundTab({ api, showToast }) {
  const [bot, setBot] = useState('eyad');
  const [source, setSource] = useState('drafts');
  const [snapshots, setSnapshots] = useState([]);
  const [setup, setSetup] = useState(SETUP);
  const [turns, setTurns] = useState([]);
  const [state, setState] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(null);
  const [names, setNames] = useState({});

  useEffect(() => {
    api('snapshot.list').then(setSnapshots).catch(() => {});
    api('items.list').then(rows => setNames(Object.fromEntries(rows.map(r => [r.id, r.body.name || r.body.topic || r.body.title || r.kind])))).catch(() => {});
  }, [api]);

  const history = turns.flatMap(t => [{ role: 'customer', text: t.customer }, ...(t.reply ? [{ role: 'bot', text: t.reply }] : [])]);
  const reset = () => { setTurns([]); setState(null); setWrong(null); };

  const send = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    const isSnap = source !== 'drafts';
    try {
      const d = await api('playground.turn', { bot, source: isSnap ? 'snapshot' : 'drafts', snapshot_id: isSnap ? source : undefined,
        text, history, state, setup: { ...setup, returning: setup.returning || turns.length > 0 } });
      setTurns(v => [...v, { customer: text, setup, ...d.result, checksum: d.checksum }]);
      setState(d.result.stateNext);
      setText('');
    } catch (x) {
      showToast(x.code === 'freeze' ? `Drafts have errors: ${(x.details || []).join('; ')}` : x.message, 'err');
    } finally { setBusy(false); }
  };

  return (
    <div className="ait-grid">
      <div className="analytics-card">
        <div className="ait-chat" aria-live="polite">
          {turns.map((t, n) => (
            <div key={n} style={{ display: 'contents' }}>
              <div className="ait-msg customer">{t.customer}</div>
              <div className="ait-msg bot">
                {t.reply || <i>(no reply: {t.outcome})</i>}
                {t.media?.map((m, i) => <div key={i} className="ait-trace"><Mi>{m.type === 'document' ? 'description' : 'image'}</Mi> {m.caption}</div>)}
                <div className="ait-trace">
                  {t.outcome}{t.handoff ? ' · handoff' : ''} · project: {(t.trace?.project?.projects || []).map(id => names[id] || id).join(', ') || 'none'}
                  {' '}· used: {(t.trace?.used_item_ids || []).map(id => names[id] || id).join(', ') || 'none'}
                  {t.trace?.guard_errors?.length ? ` · guards: ${t.trace.guard_errors.join(', ')}` : ''}
                  {t.trace?.media_missing?.length ? ` · missing media: ${t.trace.media_missing.join(', ')}` : ''}
                </div>
                <button className="btn btn-g btn-sm" onClick={() => setWrong({ turn: t, history: history.slice(0, n * 2) })}><Mi>edit</Mi>Mark wrong</button>
              </div>
            </div>
          ))}
        </div>
        {wrong && <MarkWrong {...wrong} bot={bot} api={api} showToast={showToast} onClose={() => setWrong(null)} />}
        <form className="ea-row" onSubmit={send} style={{ marginTop: 12 }}>
          <input className="fi" value={text} onChange={e => setText(e.target.value)} placeholder="Write as the customer…" aria-label="Customer message" maxLength={2000} />
          <button className="btn btn-p" disabled={busy || !text.trim()}><Mi>send</Mi>{busy ? '…' : 'Send'}</button>
        </form>
      </div>
      <div className="analytics-card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label>Bot <select className="fi" value={bot} onChange={e => { setBot(e.target.value); reset(); }}><option value="eyad">eyad</option><option value="dubai">dubai</option></select></label>
        <label>Version <select className="fi" value={source} onChange={e => { setSource(e.target.value); reset(); }}>
          <option value="drafts">Current drafts</option>
          {snapshots.map(s => <option key={s.id} value={s.id}>v{s.version_no} ({s.status})</option>)}
        </select></label>
        <label style={{ display: 'inline-flex', gap: 6 }}><input type="checkbox" checked={setup.isAd} onChange={e => setSetup(v => ({ ...v, isAd: e.target.checked }))} />Came from an ad</label>
        {setup.isAd && <input className="fi" placeholder="Ad text" value={setup.adText} onChange={e => setSetup(v => ({ ...v, adText: e.target.value }))} />}
        <label style={{ display: 'inline-flex', gap: 6 }}><input type="checkbox" checked={setup.returning} onChange={e => setSetup(v => ({ ...v, returning: e.target.checked }))} />Returning contact</label>
        <div className="ait-trace">State: {state ? `project ${names[state.active_project] || state.active_project || 'none'}, language ${state.language || '—'}` : 'new conversation'}</div>
        <button className="btn btn-g" onClick={reset}><Mi>refresh</Mi>Reset conversation</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Lint and build**

Run: `npm run lint 2>&1 | tail -3 && npm run build 2>&1 | tail -3`
Expected: lint at the baseline; build `✓ built`.

- [ ] **Step 3: Commit**

```bash
git add src/components/aitrainer/PlaygroundTab.jsx
git commit -m "feat(ai-trainer): multi-turn playground with trace and mark-wrong

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Quality & Publish tab

**Files:**
- Replace: `src/components/aitrainer/QualityTab.jsx`

**Interfaces:**
- Consumes: actions `status`, `snapshot.freeze`, `snapshot.list`, `runs.start`, `runs.step`, `runs.get`, `publish`, `rollback`, `tests.list`, `tests.retire`.

- [ ] **Step 1: Write the tab**

Replace `src/components/aitrainer/QualityTab.jsx`:

```jsx
import { useCallback, useEffect, useState } from 'react';
import Mi from '../Mi.jsx';

// Per-bot state (legacy or published snapshot), freeze, stepped test runs,
// results, gated publish and rollback. Publish is refused by the server while
// any test fails or is inconclusive; this screen only shows why.
const cls = (v) => (v === 'PASS' ? 'pass' : v === 'FAIL' ? 'fail' : 'inc');

export default function QualityTab({ api, showToast }) {
  const [status, setStatus] = useState(null);
  const [snaps, setSnaps] = useState([]);
  const [tests, setTests] = useState([]);
  const [bot, setBot] = useState('eyad');
  const [snapId, setSnapId] = useState('');
  const [run, setRun] = useState(null);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(null);

  // State is set in the promise callback, not synchronously in the effect,
  // which the react-hooks lint rule forbids.
  const reload = useCallback(() => Promise.all([api('status'), api('snapshot.list'), api('tests.list')])
    .then(([s, l, t]) => { setStatus(s); setSnaps(l); setTests(t); })
    .catch(e => showToast(e.message, 'err')), [api, showToast]);
  useEffect(() => { reload(); }, [reload]);

  const freeze = async () => {
    setBusy(true);
    try { const d = await api('snapshot.freeze'); setSnapId(d.id); showToast(d.reused ? `Drafts unchanged: v${d.version_no}` : `Candidate v${d.version_no} created`, 'ok'); reload(); }
    catch (e) { showToast(e.code === 'freeze' ? `Fix drafts first: ${(e.details || []).join('; ')}` : e.message, 'err'); }
    finally { setBusy(false); }
  };

  const runTests = async () => {
    if (!snapId) return;
    setBusy(true); setBlocked(null);
    try {
      const r = await api('runs.start', { snapshot_id: snapId, bot });
      let s = { status: 'running' };
      while (s.status === 'running') {
        s = await api('runs.step', { run_id: r.id });
        setRun({ id: r.id, progress: s });
      }
      setRun(await api('runs.get', { run_id: r.id }));
    } catch (e) { showToast(e.message, 'err'); }
    finally { setBusy(false); }
  };

  const publish = async () => {
    setBusy(true); setBlocked(null);
    try { await api('publish', { snapshot_id: snapId, bot }); showToast(`Published to ${bot}`, 'ok'); reload(); }
    catch (e) { if (e.code === 'gate') setBlocked(e.details || [e.message]); else showToast(e.message, 'err'); }
    finally { setBusy(false); }
  };

  const rollback = async (b, legacy, toId) => {
    const reason = window.prompt(legacy ? `Why move ${b} back to legacy? (required)` : `Why roll ${b} back? (required)`);
    if (!reason?.trim()) return;
    try { await api('rollback', { bot: b, legacy, snapshot_id: toId, reason }); showToast('Done', 'ok'); reload(); }
    catch (e) { showToast(e.details ? `${e.message} ${e.details.join('; ')}` : e.message, 'err'); }
  };

  const retireTest = async (t) => {
    const reason = window.prompt('Why retire this test? (required)');
    if (!reason?.trim()) return;
    try { await api('tests.retire', { id: t.id, revision: t.revision, reason }); reload(); }
    catch (e) { showToast(e.message, 'err'); }
  };

  if (!status) return <div className="ea-count">Loading…</div>;
  const snapById = Object.fromEntries(snaps.map(s => [s.id, s]));
  const budget = status.budget?.[0];

  return (
    <div className="ait">
      <section className="ea-row" style={{ gap: 12, flexWrap: 'wrap' }}>
        {status.pointers.map(p => (
          <div key={p.bot} className="analytics-card" style={{ minWidth: 240 }}>
            <b>{p.bot}</b>
            <div>{p.mode === 'legacy' ? 'Legacy: unversioned live reads, not a published version' : `Snapshot v${snapById[p.snapshot_id]?.version_no ?? '?'} · ${snapById[p.snapshot_id]?.checksum?.slice(0, 12) ?? ''}`}</div>
            <div className="meta">changed {new Date(p.changed_at).toLocaleString()}{p.changed_by_claimed ? ` · claimed by ${p.changed_by_claimed}` : ''}</div>
            {p.mode === 'snapshot' && <button className="btn btn-g btn-sm" onClick={() => rollback(p.bot, true)}><Mi>undo</Mi>Back to legacy</button>}
          </div>
        ))}
        <div className="analytics-card">
          <b>Core</b><div>{status.core_version}</div>
          <b>Budget today</b><div>{budget ? `$${(Number(budget.spent_usd) + Number(budget.reserved_usd)).toFixed(3)} of $${Number(budget.limit_usd).toFixed(2)}` : 'unused'}</div>
        </div>
      </section>

      <section className="analytics-card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="ea-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-g" disabled={busy} onClick={freeze}><Mi>science</Mi>Freeze drafts as candidate</button>
          <select className="fi" value={snapId} onChange={e => { setSnapId(e.target.value); setRun(null); setBlocked(null); }} aria-label="Snapshot">
            <option value="">Choose a version</option>
            {snaps.map(s => <option key={s.id} value={s.id}>v{s.version_no} ({s.status})</option>)}
          </select>
          <select className="fi" value={bot} onChange={e => setBot(e.target.value)} aria-label="Bot"><option value="eyad">eyad</option><option value="dubai">dubai</option></select>
          <button className="btn btn-g" disabled={busy || !snapId} onClick={runTests}><Mi>play_arrow</Mi>Run tests ({tests.filter(t => t.status === 'active' && t.bots.includes(bot)).length})</button>
          <button className="btn btn-p" disabled={busy || !snapId} onClick={publish}>Publish to {bot}</button>
          {snapId && snapById[snapId]?.status === 'published' && <button className="btn btn-g" onClick={() => rollback(bot, false, snapId)}>Roll {bot} back to this version</button>}
        </div>
        {run?.progress && run.progress.status === 'running' && <div>Running… {run.progress.done}/{run.progress.total}</div>}
        {blocked && <div className="ait-err" role="alert"><b>Publish blocked:</b><ul>{blocked.map(r => <li key={r}>{r}</li>)}</ul></div>}
        {run?.results && (
          <div className="ait-list">
            <div>Run {run.status}: {Object.entries(run.counts || {}).map(([k, v]) => `${k} ${v}`).join(' · ')}</div>
            {run.results.map(r => {
              const t = tests.find(x => x.id === r.test_id);
              return (
                <div className="ait-row" key={r.id}>
                  <div>
                    <span className={`ait-badge ${cls(r.verdict)}`}>{r.verdict}</span> <b>{t?.spec?.title || r.test_id}</b>
                    <div>Reply: {r.reply.reply || `(none: ${r.reply.outcome})`}</div>
                    <div className="meta">{r.checks.filter(c => !c.pass).map(c => `failed ${c.type}${c.detail ? ` (${c.detail})` : ''}`).join(' · ') || 'all checks passed'}</div>
                    <div className="meta">Judge: {r.judge.verdict}{r.judge.attempts?.map((a, i) => ` · #${i + 1} ${a.verdict}${a.rationale ? `: ${a.rationale}` : ''}${a.error ? ` (${a.error})` : ''}`).join('')}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h3>Regression tests</h3>
        <div className="ait-list">
          {tests.filter(t => t.status === 'active').map(t => (
            <div className="ait-row" key={t.id}>
              <div><b>{t.spec.title}</b><div>{t.spec.target}</div><div className="meta">rev {t.revision} · {t.bots.join(', ')} · {t.origin}</div></div>
              <button className="btn btn-g btn-sm" onClick={() => retireTest(t)} aria-label="Retire test"><Mi>delete</Mi></button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Lint and build**

Run: `npm run lint 2>&1 | tail -3 && npm run build 2>&1 | tail -3`
Expected: lint at the baseline; build `✓ built`.

- [ ] **Step 3: Commit**

```bash
git add src/components/aitrainer/QualityTab.jsx
git commit -m "feat(ai-trainer): quality and publish tab with gated publish and rollback

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task C0: Record the deployed Eyad bot in git (no deploy)

Spec §10.5.4: production `wa-bot-eyad` v38 contains the direct `/send` push and LID target handling that no git branch has. Until this task is done, **no one may deploy `wa-bot-eyad` or `wa-bot-dubai` from this repository**, because that would silently replace working live behaviour.

**Files:**
- Create: `supabase/functions/wa-bot-eyad/index.ts` (v38 content), `supabase/functions/_shared/wa.ts` and `_shared/ai.ts` (only if v38's bundled copies differ from the repo), on branch `phase0/reconcile-eyad-v38` from the current HEAD

- [ ] **Step 1: Download v38 read-only into a scratch folder outside the repository**

Run: `npx supabase functions download wa-bot-eyad --project-ref sbqmougcvnplgjgihpwe --use-api` from inside a temporary directory, or the MCP `get_edge_function` call, saving files under `/tmp/eyad-v38/`.
Expected: `functions/wa-bot-eyad/index.ts` contains `handleSendDocs` with `photos || []).slice(0, 3)`.

- [ ] **Step 2: Compare with the repository**

Run: `diff <(sed 's/\r$//' supabase/functions/wa-bot-eyad/index.ts) /tmp/eyad-v38/functions/wa-bot-eyad/index.ts | grep -c '^[<>]'`
Expected: non-zero (71 on 2026-10-18). Repeat for `_shared/wa.ts` and `_shared/ai.ts`.

- [ ] **Step 3: Commit the deployed files on their own branch and tag it**

```bash
git switch -c phase0/reconcile-eyad-v38
cp /tmp/eyad-v38/functions/wa-bot-eyad/index.ts supabase/functions/wa-bot-eyad/index.ts
# copy _shared files only where Step 2 showed a difference
git add supabase/functions/wa-bot-eyad/index.ts supabase/functions/_shared/
git commit -m "chore: record deployed wa-bot-eyad v38 source

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git tag deployed/wa-bot-eyad-v38
git switch feat/ai-trainer-mvp
```

Nothing is pushed or deployed. The owner decides when to merge and push it.

---

### Task C1: Command compatibility contract tests

**Files:**
- Create: `scripts/command-compat/routing.ts`, a pure, Deno-free copy of both bots' parse and route logic that is reviewed line by line against the deployed source
- Create: `scripts/command-compat/routing.test.ts`
- Create: `scripts/command-compat/fixtures.ts` (the 17 `/f` and 11 `/send` mappings)
- Modify: `package.json` (script)

The bots themselves are not changed. The copy lets the contract run under Node today, and at cutover (spec §10.4) the bots import the same module, so these tests then cover the real code. Any difference between the copy and the deployed source is a test failure to investigate, not a reason to edit the bots.

**Interfaces:**
- Produces:
  - `type Parsed = { kind: 'ignore'|'command'|'inbound'; command: string; text: string; phone: string; remote: string; fromMe: boolean; target: string }`
  - `parseEyad(payload: any): Parsed`, `parseDubai(payload: any): Parsed`
  - `type Effects = { createLead?: { p_phone: string; p_cmd: string }; note?: string; notedPhone?: string; takeover?: boolean; send: { kind: 'text'|'document'|'image'; to: string; url?: string; caption?: string; template?: string }[]; capi?: boolean; ai?: boolean }`
  - `routeCommand(bot: 'eyad'|'dubai', p: Parsed, ctx: { settings: Record<string, boolean>; leadResult?: { status: string; notify?: boolean; ctwa_clid?: string }; project?: { name: string; brochure_url?: string; photos?: string[] } | null; leadForNote?: boolean }): Effects`
  - `extractTrailingNote(text: string): string`, `splitPhoneFromNote(note: string): { phone: string; text: string }`

- [ ] **Step 1: Write the fixtures**

Create `scripts/command-compat/fixtures.ts`:

```ts
// Existing command mappings that must not change (spec §10.5). Checked
// against production wa_agents and wa_projects on 2026-10-18.
export const FORWARD = [
  ["/fdh", "Dhaka pool", "Dhaka", true, true], ["/faz", "Md.Azizul Haque", "Dhaka", false, true],
  ["/fmj", "Mehjabeen Mumtaha Rahman", "Dhaka", false, true], ["/fk", "Kamrul Shikder", "Dhaka", false, true],
  ["/fl", "Mainul", "Dhaka", false, false], ["/fctg", "Chittagong pool", "Chattogram", true, true],
  ["/fm", "Masud Chowdhury", "Chattogram", false, true], ["/fs", "Shabbir Newaz", "Chattogram", false, true],
  ["/fmr", "Maruf Alam", "Chattogram", false, true], ["/fh", "Hillol Chowdhury", "Chattogram", false, true],
  ["/fsn", "Shahin", "Cumilla", false, true], ["/fcml", "Cumilla pool", "Cumilla", true, true],
  ["/fdp", "Deep", "Cumilla", false, true], ["/fkl", "Kamal", "Cumilla", false, true],
  ["/fdu", "Dubai (Jaber Hossain)", "Dubai", false, true], ["/fmkt", "Marketing pool", "Marketing", true, true],
  ["/frahat", "Mr Rahat", "Marketing", false, true],
] as const;

export const SEND = [
  ["/sendca", "Wecon Chowdhury Arcade"], ["/senddk", "Wecon Dakshinayan"], ["/sendio", "Wecon Iqbal Orchid"],
  ["/sendjm", "Wecon JM Heritage Mall"], ["/sendmm", "Momtaz Manor"], ["/sendnz", "Wecon Nuznan"],
  ["/sendos", "Wecon Osman Bellevue"], ["/sendphc", "P2P Helthcare"], ["/sendsb", "Wecon Summer Breeze"],
  ["/sendsd", "Wecon South Dale"], ["/sendss", "Shafiq Sapphire"],
] as const;

export const ALL_ON = { manualForwardEnabled: true, takeoverEnabled: true, notesEnabled: true, docsCommandEnabled: true,
  customerNotifyEnabled: true, metaCapiEnabled: true };

// A Wasender messages.upsert payload. fromMe/remote/text vary per case.
export const payload = (o: { fromMe: boolean; text: string; remote?: string; pn?: string | null }) => ({
  event: "messages.upsert",
  data: { messages: {
    key: { id: "m1", fromMe: o.fromMe, remoteJid: o.remote ?? "8801700000000@s.whatsapp.net", ...(o.pn === null ? {} : { cleanedSenderPn: o.pn ?? "8801700000000" }) },
    pushName: "Test", messageBody: o.text, message: { conversation: o.text },
  } },
});
```

- [ ] **Step 2: Write the failing tests**

Create `scripts/command-compat/routing.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { FORWARD, SEND, ALL_ON, payload } from "./fixtures.ts";
import { parseEyad, parseDubai, routeCommand, extractTrailingNote, splitPhoneFromNote } from "./routing.ts";

const created = { status: "created", notify: true, ctwa_clid: "" };

for (const bot of ["eyad", "dubai"] as const) {
  const parse = bot === "eyad" ? parseEyad : parseDubai;

  for (const [taq] of FORWARD) {
    test(`${bot} CC-01..17 ${taq} routes to lead creation, no AI`, () => {
      const p = parse(payload({ fromMe: true, text: taq }));
      assert.equal(p.kind, "command"); assert.equal(p.command, taq);
      const e = routeCommand(bot, p, { settings: ALL_ON, leadResult: created });
      assert.deepEqual(e.createLead, { p_phone: "8801700000000", p_cmd: taq });
      assert.equal(e.ai, undefined);
    });
  }

  test(`${bot} CC-18 upper-case token`, () => {
    assert.equal(parse(payload({ fromMe: true, text: "/FDH" })).command, "/fdh");
  });

  test(`${bot} CC-19 trailing note`, () => {
    const e = routeCommand(bot, parse(payload({ fromMe: true, text: "/fdh this client wants a morning call" })), { settings: ALL_ON, leadResult: created });
    assert.equal(e.note, "this client wants a morning call");
  });

  test(`${bot} CC-21 /fl notify false sends nothing to customer`, () => {
    const e = routeCommand(bot, parse(payload({ fromMe: true, text: "/fl" })), { settings: ALL_ON, leadResult: { status: "created", notify: false } });
    assert.equal(e.send.length, 0);
  });

  test(`${bot} CC-22 exists sends already-assigned`, () => {
    const e = routeCommand(bot, parse(payload({ fromMe: true, text: "/fdh" })), { settings: ALL_ON, leadResult: { status: "exists" } });
    assert.equal(e.send[0].template, "already_assigned");
  });

  test(`${bot} CC-23 unknown_command / no_agent_available send nothing`, () => {
    for (const status of ["unknown_command", "no_agent_available", "error"]) {
      assert.equal(routeCommand(bot, parse(payload({ fromMe: true, text: "/fzz" })), { settings: ALL_ON, leadResult: { status } }).send.length, 0);
    }
  });

  test(`${bot} CC-24 /t sets takeover and sends handover`, () => {
    const e = routeCommand(bot, parse(payload({ fromMe: true, text: "/t" })), { settings: ALL_ON });
    assert.equal(e.takeover, true); assert.equal(e.send[0].template, "handover"); assert.equal(e.ai, undefined);
  });

  test(`${bot} CC-26/27 /n`, () => {
    assert.equal(routeCommand(bot, parse(payload({ fromMe: true, text: "/n wants 3 bed" })), { settings: ALL_ON, leadForNote: true }).note, "wants 3 bed");
    assert.equal(routeCommand(bot, parse(payload({ fromMe: true, text: "/n" })), { settings: ALL_ON, leadForNote: true }).note, undefined);
    assert.equal(routeCommand(bot, parse(payload({ fromMe: true, text: "/n x" })), { settings: ALL_ON, leadForNote: false }).note, undefined);
  });

  test(`${bot} CC-42 customer typing /fdh is inbound, not a command`, () => {
    const p = parse(payload({ fromMe: false, text: "/fdh" }));
    assert.equal(p.kind, "inbound");
  });

  test(`${bot} CC-43 fromMe without slash is ignored`, () => {
    assert.equal(parse(payload({ fromMe: true, text: "fdh" })).kind, "ignore");
  });

  test(`${bot} CC-44 group chat is ignored`, () => {
    assert.equal(parse(payload({ fromMe: true, text: "/fdh", remote: "1203630@g.us" })).kind, "ignore");
  });

  test(`${bot} CC-45 toggles off`, () => {
    const off = (k: string) => ({ ...ALL_ON, [k]: false });
    const p = (t: string) => parse(payload({ fromMe: true, text: t }));
    assert.equal(routeCommand(bot, p("/fdh"), { settings: off("manualForwardEnabled"), leadResult: created }).createLead, undefined);
    assert.equal(routeCommand(bot, p("/t"), { settings: off("takeoverEnabled") }).takeover, undefined);
    assert.equal(routeCommand(bot, p("/n x"), { settings: off("notesEnabled"), leadForNote: true }).note, undefined);
    assert.equal(routeCommand(bot, p("/fdh"), { settings: off("customerNotifyEnabled"), leadResult: created }).send.length, 0);
    assert.equal(routeCommand(bot, p("/fdh"), { settings: off("metaCapiEnabled"), leadResult: { ...created, ctwa_clid: "c" } }).capi, undefined);
  });
}

test("CC-20 phone in trailing note is split out", () => {
  const r = splitPhoneFromNote(extractTrailingNote("/fdh his number is 01712345678 call after 5"));
  assert.equal(r.phone, "8801712345678");
  assert.ok(!r.text.includes("01712345678"));
  assert.equal(splitPhoneFromNote("no number here").phone, null);
});

for (const [code, name] of SEND) {
  test(`eyad CC-28..38 ${code} pushes brochure then up to 3 photos`, () => {
    const project = { name, brochure_url: "https://x/b.pdf", photos: ["https://x/1.jpg", "https://x/2.jpg", "https://x/3.jpg", "https://x/4.jpg"] };
    const e = routeCommand("eyad", parseEyad(payload({ fromMe: true, text: code })), { settings: ALL_ON, project });
    assert.deepEqual(e.send.map((s) => s.kind), ["document", "image", "image", "image"]);
    assert.equal(e.send[0].caption, `${name} — Brochure`);
    assert.equal(e.ai, undefined);
  });
}

test("eyad CC-39 missing brochure or photos", () => {
  const p = (c: string) => parseEyad(payload({ fromMe: true, text: c }));
  assert.deepEqual(routeCommand("eyad", p("/sendmm"), { settings: ALL_ON, project: { name: "Momtaz Manor", photos: ["https://x/1.jpg"] } }).send.map((s) => s.kind), ["image"]);
  assert.deepEqual(routeCommand("eyad", p("/sendss"), { settings: ALL_ON, project: { name: "Shafiq Sapphire", brochure_url: "https://x/b.pdf", photos: [] } }).send.map((s) => s.kind), ["document"]);
});

test("eyad CC-40 unknown code sends nothing", () => {
  assert.equal(routeCommand("eyad", parseEyad(payload({ fromMe: true, text: "/sendxx" })), { settings: ALL_ON, project: null }).send.length, 0);
});

test("eyad: hidden-number customer is sent to the @lid JID", () => {
  const p = parseEyad(payload({ fromMe: true, text: "/sendnz", remote: "123456@lid", pn: null }));
  const e = routeCommand("eyad", p, { settings: ALL_ON, project: { name: "Wecon Nuznan", brochure_url: "https://x/b.pdf" } });
  assert.equal(e.send[0].to, "123456@lid");
});

test("dubai CC-41 /send codes are not handled (current behaviour)", () => {
  const e = routeCommand("dubai", parseDubai(payload({ fromMe: true, text: "/sendnz" })), { settings: ALL_ON, project: { name: "Wecon Nuznan", brochure_url: "https://x/b.pdf" } });
  assert.equal(e.send.length, 0);
});
```

In `package.json` `"scripts"`, add:

```json
    "test:commands": "node --test scripts/command-compat/routing.test.ts"
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test:commands`
Expected: FAIL with `Cannot find module './routing.ts'`

- [ ] **Step 4: Write the routing copy**

Create `scripts/command-compat/routing.ts`. Each function is copied from the deployed source (Task C0 tag `deployed/wa-bot-eyad-v38`, and `wa-bot-dubai` v34, which equals git), with network and database calls replaced by entries in `Effects`. Keep the same order of checks as the source.

```ts
// Contract copy of the bots' command parsing and routing (spec §10.5). It is
// a line-for-line port of wa-bot-eyad v38 and wa-bot-dubai v34 with I/O
// replaced by an Effects record, so the existing command behaviour can be
// tested under Node without changing or deploying the bots. If a test fails,
// compare this file with the deployed source before touching anything else.

export type Parsed = { kind: "ignore" | "command" | "inbound"; command: string; text: string; phone: string; remote: string; fromMe: boolean; target: string };
export type Effects = {
  createLead?: { p_phone: string; p_cmd: string }; note?: string; notedPhone?: string | null; takeover?: boolean;
  send: { kind: "text" | "document" | "image"; to: string; url?: string; caption?: string; template?: string }[];
  capi?: boolean; ai?: boolean;
};

function base(payload: any) {
  const msg = payload?.data?.messages ?? {};
  const key = msg?.key ?? {};
  const m = msg?.message ?? {};
  const remote = String(key?.remoteJid ?? "");
  const cleaned = String(key?.cleanedSenderPn || "").trim();
  const phone = String(cleaned || remote).replace(/@.*$/, "").replace(/\D/g, "");
  const fromMe = key?.fromMe === true;
  const text = String(msg?.messageBody || m?.conversation || m?.extendedTextMessage?.text || m?.imageMessage?.caption || "").trim();
  let kind: Parsed["kind"] = "ignore";
  if (!phone || remote.endsWith("@g.us")) kind = "ignore";
  else if (fromMe && text.startsWith("/")) kind = "command";
  else if (!fromMe) kind = "inbound";
  return { kind, phone, remote, fromMe, text, cleaned, command: kind === "command" ? text.toLowerCase().split(/\s+/)[0] : "" };
}

// Eyad v38: send target is the phone when a real number exists, else the raw JID.
export function parseEyad(payload: any): Parsed {
  const b = base(payload);
  return { kind: b.kind, command: b.command, text: b.text, phone: b.phone, remote: b.remote, fromMe: b.fromMe, target: b.cleaned ? b.phone : b.remote };
}

// Dubai v34: a hidden-number (@lid) sender is addressed as "<digits>@lid".
export function parseDubai(payload: any): Parsed {
  const b = base(payload);
  const isLid = !b.cleaned && b.remote.endsWith("@lid");
  return { kind: b.kind, command: b.command, text: b.text, phone: b.phone, remote: b.remote, fromMe: b.fromMe, target: isLid ? `${b.phone}@lid` : b.phone };
}

export function extractTrailingNote(rawText: string): string {
  return rawText.trim().split(/\s+/).slice(1).join(" ").trim();
}

// Copied verbatim from deployed wa-bot-eyad v38 _shared/wa.ts.
const BD_MOBILE = /^(?:880)?1[3-9]\d{8}$/;
function looksLikeRealPhone(phone: string): boolean {
  return BD_MOBILE.test(String(phone || "").replace(/\D/g, ""));
}

// Pulls the first Bangladeshi mobile number mentioned in free text — an
// agent's "/f* note: ... his number is 01730078392" is the main source, for
// a contact whose WhatsApp phone turned out to be a LID (see
// looksLikeRealPhone above) — and returns the note with that mention
// stripped out, so it isn't left sitting in the note once the number has
// its own place (the lead's phone field).
export function splitPhoneFromNote(text: string): { phone: string | null; text: string } {
  const raw = String(text || "");
  const m = raw.match(/(?:\+?880[\s-]?|0)1[3-9]\d(?:[\s-]?\d){7}/);
  if (!m) return { phone: null, text: raw };
  const digits = m[0].replace(/\D/g, "");
  const norm = digits.startsWith("880") ? digits : "880" + digits.replace(/^0/, "");
  if (!looksLikeRealPhone(norm)) return { phone: null, text: raw };
  // Drop the number itself plus a short leading "his/her number is" /
  // "number:" style lead-in right before it, if there is one — otherwise
  // the note reads like a sentence missing its object ("his number is .").
  const cleaned = raw
    .replace(new RegExp(`(?:\\b(?:his|her|my|the|contact|phone|number)\\b[^.]{0,20})?${m[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"), "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,!?])/g, "$1")
    .replace(/^[\s.,-]+|[\s.,-]+$/g, "")
    .trim();
  return { phone: norm, text: cleaned };
}

export function routeCommand(
  bot: "eyad" | "dubai", p: Parsed,
  ctx: { settings: Record<string, boolean>; leadResult?: { status: string; notify?: boolean; ctwa_clid?: string };
    project?: { name: string; brochure_url?: string; photos?: string[] } | null; leadForNote?: boolean },
): Effects {
  const e: Effects = { send: [] };
  const s = ctx.settings;
  if (p.kind !== "command") return e;
  if (p.command === "/t") {
    if (!s.takeoverEnabled) return e;
    e.takeover = true;
    // Both bots address the dialable target (v38 handleTakeover: p.target; Dubai: evt.waTo).
    e.send.push({ kind: "text", to: p.target, template: "handover" });
    return e;
  }
  if (p.command === "/n") {
    if (!s.notesEnabled) return e;
    const raw = extractTrailingNote(p.text);
    if (raw && ctx.leadForNote) e.note = raw;
    return e;
  }
  if (p.command.startsWith("/f")) {
    if (!s.manualForwardEnabled) return e;
    e.createLead = { p_phone: p.phone, p_cmd: p.command };
    const r = ctx.leadResult;
    if (!r) return e;
    const trailing = extractTrailingNote(p.text);
    if (trailing) { const sp = splitPhoneFromNote(trailing); e.note = sp.text || trailing; if (sp.phone) e.notedPhone = sp.phone; }
    if (s.metaCapiEnabled && r.status === "created" && (r.ctwa_clid || "") !== "") e.capi = true;
    const to = p.target;
    if (!s.customerNotifyEnabled) { /* no customer message */ }
    else if (r.status === "created" && r.notify === true) e.send.push({ kind: "text", to, template: "assigned" });
    else if (r.status === "exists") e.send.push({ kind: "text", to, template: "already_assigned" });
    return e;
  }
  if (bot === "eyad" && p.command.startsWith("/send")) {
    if (!s.docsCommandEnabled) return e;
    const pr = ctx.project;
    if (!pr) return e;
    if (pr.brochure_url) e.send.push({ kind: "document", to: p.target, url: pr.brochure_url, caption: `${pr.name} — Brochure` });
    for (const url of (pr.photos || []).slice(0, 3)) e.send.push({ kind: "image", to: p.target, url, caption: pr.name });
    return e;
  }
  return e;
}
```

`splitPhoneFromNote` and `looksLikeRealPhone` above are verbatim from the deployed v38 `_shared/wa.ts`. Send targets match the deployed source: v38 sends `/t` and `/f` messages to `p.target` (`index.ts:361,427,429`), and Dubai to `evt.waTo`. If the Task C0 tag differs from this, the tag decides and the copy follows it.

- [ ] **Step 5: Run tests**

Run: `npm run test:commands`
Expected: PASS, `fail 0`. A failure means the copy differs from the deployed source; fix the copy, never the bots.

- [ ] **Step 6: Commit**

```bash
git add scripts/command-compat/ package.json
git commit -m "test: WhatsApp command compatibility contract (17 /f, /t, /n, 11 /send, self-chat guard)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Production setup and MVP acceptance (owner approval at each step)

No code. Each numbered step changes production and needs the owner's explicit approval when it is reached.

- [ ] **Step 1 (approval: apply 0037).** In the Supabase SQL editor: run `supabase/ops/0037_preflight.sql` (all `ok`), apply `supabase/migrations/0037_ai_trainer.sql`, run `supabase/ops/0037_verify.sql` (all `PASS`). Both pointers are `legacy`, so the bots are unaffected.

- [ ] **Step 2 (approval: secrets).** Generate the key and set the secrets. The value is typed into the terminal, never into a file:

```bash
openssl rand -base64 32
npx supabase secrets set AI_TRAINER_KEY=<value> AI_TRAINER_DAILY_BUDGET_USD=2
```

Share the key with Management through a private channel. Do not put it in `.env`.

- [ ] **Step 3 (approval: deploy function).**

```bash
npx supabase functions deploy ai-trainer --no-verify-jwt
```

Check it refuses without the key:

Run: `curl -s -X POST "$VITE_SUPABASE_URL/functions/v1/ai-trainer" -H 'Content-Type: application/json' -d '{"action":"status"}'`
Expected: `{"ok":false,"error":{"code":"unauthorized",…}}`

- [ ] **Step 4.** Run the app locally (`npm run dev`, bound to localhost) and work through spec §12.1, the manual acceptance checklist, item by item. Record each result.

- [ ] **Step 5 (approval: site deploy).** Through the normal git flow (`dev`, then `main`). The page only appears for Management and only works with the key.

**First usable milestone:** end of Step 4. Management can train, test, correct and gate-publish against the real database, and no customer is affected because both bots stay in legacy mode. Moving a bot to a published snapshot needs the separate cutover plan (spec §10.4 and §13 steps 7 to 10).

---

## Self-review notes

- **Command compatibility (spec §10.5).** Task C0 records deployed Eyad v38 in git; Task C1 adds contract tests CC-01..CC-45 for both bots; Task 3 adds CC-46 (`buildHistory` excludes slash commands and agent notes). No bot code changes.
- **Spec coverage.** Covered by this plan: §1 MVP acceptance (Task 13 with §12.1), §4.1–4.5 tables, isolation, checksum and scope (Tasks 1–3), §4.6 legacy mode display (Task 12), §4.7 import with per-row decision and report (Tasks 6 and 10), §6.1–6.2 core and turn steps (Tasks 3–4), §6.6 failure outcomes relevant to the capture sink (Task 4), §7 checks, judge, verdicts, publish gate, long runs (Tasks 5 and 7), §8 sources 1 and 3 plus redaction (Tasks 5, 10, 11), §9 key, rate limit, claimed actor, atomic budget (Tasks 2 and 6), §10.1–10.3 UI and actions (Tasks 7, 9–12). Deferred, with the reason stated in the File Structure section: §5 embeddings, §6.3 WhatsApp sink with lease, pause and handoff runtime, §6.4 handler-level parity across both deploy units, §6.5 bot health endpoint, §8 source 2 (real WhatsApp reviews and the Conversations action), compare mode. The tables those need are created in 0037.
- **Placeholders.** Task 9 creates temporary tab files on purpose, so the page builds before Tasks 10–12 replace them. Each has its final export name.
- **Type consistency.** `ItemRow`, `SnapshotContent`, `ConvState`, `TurnResult`, `TestSpec`, `Ports` are defined once in trainer-core and imported by the handler. Action names match between the handler (Tasks 6–7) and the UI (Tasks 9–12).
