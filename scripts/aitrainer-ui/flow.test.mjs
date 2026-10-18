// npm run test:ui — repository-level UI integration check for the AI Trainer.
// Mounts the real AI Trainer tabs in happy-dom, wired to the real
// trainer-handler with an in-memory db and a scripted model. Drives the MVP
// flow through the UI: add a fact, run a Playground turn, mark it wrong and
// save a test, freeze, run tests, publish blocked on FAIL, then pass.
import { Window } from "happy-dom";
const w = new Window({ url: "http://localhost/" });
for (const k of ["document", "navigator", "HTMLElement", "Node", "Event", "KeyboardEvent", "MouseEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "sessionStorage", "localStorage"]) {
  Object.defineProperty(globalThis, k, { value: w[k], configurable: true, writable: true });
}
Object.defineProperty(globalThis, "window", { value: w, configurable: true, writable: true }); globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const R = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const React = await import(`${R}/node_modules/react/index.js`);
const { createRoot } = await import(`${R}/node_modules/react-dom/client.js`);
const { act } = React;
const { handleTrainer } = await import(`${R}/supabase/functions/_shared/trainer-handler.ts`);

const t = { ai_trainer_items: [], ai_tests: [], ai_test_revisions: [], ai_snapshots: [], ai_bot_pointers: [{ bot: "eyad", mode: "legacy", snapshot_id: null, changed_at: new Date().toISOString() }, { bot: "dubai", mode: "legacy", snapshot_id: null, changed_at: new Date().toISOString() }], ai_test_runs: [], ai_test_results: [], ai_trainer_audit: [], ai_trainer_imports: [], ai_budget_days: [], wa_projects: [], wa_knowledge: [], wa_message_corrections: [], users: [{ id: "u", role: "MANAGEMENT", is_active: true }] };
let n = 0; const id = () => `id${++n}`;
const db = {
  async select(path) { const [table, q] = path.split("?"); let rows = [...(t[table] || [])]; for (const part of (q || "").split("&")) { const m = /^(\w+)=eq\.(.+)$/.exec(part); if (m) rows = rows.filter((r) => String(r[m[1]]) === decodeURIComponent(m[2])); } return rows; },
  async insert(table, row) { const r = { id: id(), ...row }; t[table].push(r); return r; },
  async patch(table, filter, patch) { const [k, v] = filter.split("=eq."); const r = t[table].find((x) => String(x[k]) === decodeURIComponent(v)); if (r) Object.assign(r, patch); return !!r; },
  async rpc(fn, a) {
    if (fn === "ai_item_save") { const it = a.p_item; if (t.ai_trainer_items.some((x) => x.status === "active" && x.kind === it.kind && x.content_hash === it.content_hash && x.id !== it.id)) return { ok: false, error: "duplicate_content" }; if (a.p_expected_revision === 0) { const r = { ...it, id: id(), revision: 1, status: it.status || "active" }; t.ai_trainer_items.push(r); return { ok: true, data: { id: r.id, revision: 1 } }; } const c = t.ai_trainer_items.find((x) => x.id === it.id); if (c.revision !== a.p_expected_revision) return { ok: false, error: "revision_conflict" }; Object.assign(c, it, { revision: c.revision + 1 }); return { ok: true, data: { id: c.id, revision: c.revision } }; }
    if (fn === "ai_budget_reserve") return { ok: true, data: id() };
    return { ok: true };
  },
};
// Scripted model: replies, then the judge. judgeVerdict decides pass/fail.
let judge = "fail";
const reply = (o) => JSON.stringify({ intent: "info", project_ref: null, language: "en", reply: "Which project are you interested in?", media: [], handoff: false, asked: ["project"], used_item_ids: [], clarify: true, ...o });
const llm = { async chat(req) { const isJudge = req.system.startsWith("You grade"); return { ok: true, text: isJudge ? JSON.stringify({ verdict: judge, criteria: {}, rationale: `judge says ${judge}` }) : reply({}), prompt_tokens: 10, completion_tokens: 5 }; } };
const env = { budgetUsd: 5, replyModel: "m", judgeModel: "j", pricePerMTok: { in: 1, out: 5 } };
const api = async (action, payload) => {
  const r = await handleTrainer({ method: "POST", headers: new Headers(), ip: "127.0.0.1", body: { action, payload, actor_claimed: "Test Manager", user_id: "u" } }, { db, llm, env });
  if (!r.body.ok) throw Object.assign(new Error(r.body.error.message), { code: r.body.error.code, details: r.body.error.details, status: r.status });
  return r.body.data;
};
const toasts = []; const showToast = (m, k) => toasts.push(`${k}:${m}`);
globalThis.window.prompt = () => "testing"; // reasons for retire/rollback

const tick = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const btn = (label) => $$("button").find((b) => b.textContent.trim().includes(label));
const click = async (el) => { await act(async () => { el.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); }); await tick(20); };
const type = async (el, v) => { await act(async () => { const proto = el.tagName === "TEXTAREA" ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v); el.dispatchEvent(new w.Event("input", { bubbles: true })); }); };
const pick = async (el, v) => { await act(async () => { Object.getOwnPropertyDescriptor(w.HTMLSelectElement.prototype, "value").set.call(el, v); el.dispatchEvent(new w.Event("change", { bubbles: true })); }); await tick(20); };
const ok = (cond, msg) => { if (!cond) { console.log("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); };

const mount = async (path) => {
  document.body.innerHTML = '<div id="root"></div>';
  const C = (await import(`${R}/src/components/aitrainer/${path}.jsx`)).default;
  const root = createRoot($("#root"));
  await act(async () => root.render(React.createElement(C, { api, showToast, user: { id: "u", name: "Test Manager", role: "MANAGEMENT" } })));
  await tick(50);
  return root;
};

// 1. Knowledge: add a draft fact through the editor.
let root = await mount("KnowledgeTab");
ok(document.body.textContent.includes("Facts"), "Knowledge tab rendered with Facts section");
const addBtns = $$("button").filter((b) => b.textContent.includes("Add"));
await click(addBtns[1]);
const fields = $$(".modal input.fi, .modal textarea.fi");
await type(fields[0], "Handover"); await type(fields[1], "Handover is planned for 2027");
await click(btn("Save draft"));
ok(t.ai_trainer_items.some((i) => i.kind === "fact" && i.body.topic === "Handover"), "fact saved as a draft row");
ok(document.body.textContent.includes("Handover is planned for 2027"), "fact listed after save");
root.unmount();

// 2. Playground: two turns, then mark wrong -> example + test.
root = await mount("PlaygroundTab");
const input = $('input[aria-label="Customer message"]');
await type(input, "What is the price?"); await click(btn("Send")); await tick(50);
ok(document.body.textContent.includes("Which project are you interested in?"), "Playground turn 1 replied from the core");
ok(document.body.textContent.includes("used:"), "trace shown");
await type($('input[aria-label="Customer message"]'), "Jolshiri"); await click(btn("Send")); await tick(50);
ok($$(".ait-msg.bot").length === 2, "Playground turn 2 replied (multi-turn)");
await click($$("button").filter((b) => b.textContent.includes("Mark wrong"))[1]);
const tas = $$(".analytics-card textarea");
await type(tas[0], "Which area or project are you looking at? I can share details."); await type(tas[1], "Should ask area first");
await click($$("button").find((b) => b.textContent.trim() === "Save"));
ok(t.ai_trainer_items.some((i) => i.kind === "example" && i.body.source === "playground"), "correction saved as example");
ok(t.ai_tests.length === 1, "correction saved as regression test");
const saved = t.ai_tests[0]?.spec;
ok(saved?.setup?.state && "active_project" in saved.setup.state && saved.setup.returning === true,
  "saved test carries the state from before the corrected turn");
ok(saved?.target === "Jolshiri" && saved?.conversation?.length === 2 && saved.conversation[0].text === "What is the price?",
  "saved test replays turn 2 with turn 1 as its history");
root.unmount();

// 3. Quality: freeze, run (judge fails), publish blocked; then judge passes, new run, publish works.
root = await mount("QualityTab");
ok(document.body.textContent.includes("Legacy: unversioned live reads"), "both bots shown as Legacy");
await click(btn("Freeze drafts as candidate")); await tick(50);
const snapSel = $('select[aria-label="Snapshot"]');
ok(snapSel.options.length >= 2, "candidate listed");
await pick(snapSel, snapSel.options[1].value);
await click(btn("Run tests")); await tick(200);
ok(document.body.textContent.includes("FAIL"), "run shows FAIL");
await click(btn("Publish to eyad")); await tick(50);
ok(document.body.textContent.includes("Publish blocked"), "publish blocked on FAIL");
ok(t.ai_bot_pointers.find((p) => p.bot === "eyad").mode === "legacy", "eyad pointer unchanged");
judge = "garbage";
await click(btn("Run tests")); await tick(200);
ok(document.body.textContent.includes("INCONCLUSIVE"), "run shows INCONCLUSIVE when the judge returns no valid verdict");
await click(btn("Publish to eyad")); await tick(50);
ok(document.body.textContent.includes("Publish blocked") && t.ai_bot_pointers.find((p) => p.bot === "eyad").mode === "legacy", "publish blocked on INCONCLUSIVE");
judge = "pass";
await click(btn("Run tests")); await tick(200);
ok(document.body.textContent.includes("PASS"), "new run shows PASS");
await click(btn("Publish to eyad")); await tick(80);
ok(t.ai_bot_pointers.find((p) => p.bot === "eyad").mode === "snapshot", "publish succeeded after all PASS");
ok(t.ai_bot_pointers.find((p) => p.bot === "dubai").mode === "legacy", "dubai untouched");
await click(btn("Back to legacy")); await tick(80);
ok(t.ai_bot_pointers.find((p) => p.bot === "eyad").mode === "legacy", "rollback to legacy works");
root.unmount();
console.log("toasts:", toasts.filter((x) => x.startsWith("err")).join(" | ") || "no error toasts");
