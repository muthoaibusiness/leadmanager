// npm run test:ui — repository-level UI integration check for the AI Trainer.
// Mounts the real AI Trainer tabs in happy-dom, wired to the real
// trainer-handler with an in-memory db and a scripted model. Drives the MVP
// flow through the UI: add a fact, run a Playground turn, mark it wrong and
// save a test, freeze, run tests, publish blocked on FAIL, then pass.
import { Window } from "happy-dom";
const w = new Window({ url: "http://localhost/" });
// Element, PointerEvent and the observers are what radix (ui/select.jsx) needs.
for (const k of ["document", "navigator", "HTMLElement", "Element", "Node", "Event", "CustomEvent", "KeyboardEvent", "MouseEvent", "PointerEvent", "FocusEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "sessionStorage", "localStorage", "DOMRect", "ResizeObserver", "MutationObserver", "DocumentFragment", "HTMLButtonElement", "HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement", "SVGElement", "ShadowRoot", "Text"]) {
  if (w[k]) Object.defineProperty(globalThis, k, { value: w[k], configurable: true, writable: true });
}
Object.defineProperty(globalThis, "window", { value: w, configurable: true, writable: true }); globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const R = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const React = await import(`${R}/node_modules/react/index.js`);
const { createRoot } = await import(`${R}/node_modules/react-dom/client.js`);
const { act } = React;
const { handleTrainer } = await import(`${R}/supabase/functions/_shared/trainer-handler.ts`);

const t = { ai_trainer_items: [], ai_tests: [], ai_test_revisions: [], ai_snapshots: [], ai_bot_pointers: [{ bot: "eyad", mode: "legacy", snapshot_id: null, changed_at: new Date().toISOString() }, { bot: "dubai", mode: "legacy", snapshot_id: null, changed_at: new Date().toISOString() }], ai_test_runs: [], ai_test_results: [], ai_trainer_audit: [], ai_trainer_imports: [], ai_budget_days: [], wa_projects: [], wa_knowledge: [], wa_message_corrections: [], ai_playground_conversations: [], ai_playground_turns: [], ai_model_configs: [], users: [{ id: "u", role: "MANAGEMENT", is_active: true }] };
let n = 0; const id = () => `id${++n}`;
let vaultKey = null;
const db = {
  async select(path) { const [table, q] = path.split("?"); let rows = [...(t[table] || [])]; const ord = /order=(\w+)\.(asc|desc)/.exec(q || ""); if (ord) rows.sort((a, b) => (String(a[ord[1]]) < String(b[ord[1]]) ? -1 : 1) * (ord[2] === "asc" ? 1 : -1)); for (const part of (q || "").split("&")) { const m = /^(\w+)=eq\.(.+)$/.exec(part); if (m) rows = rows.filter((r) => String(r[m[1]]) === decodeURIComponent(m[2])); } return rows; },
  async insert(table, row) { const r = { id: id(), ...row }; t[table].push(r); return r; },
  async patch(table, filter, patch) { const [k, v] = filter.split("=eq."); const r = t[table].find((x) => String(x[k]) === decodeURIComponent(v)); if (r) Object.assign(r, patch); return !!r; },
  async rpc(fn, a) {
    if (fn === "ai_item_save") { const it = a.p_item; if (t.ai_trainer_items.some((x) => x.status === "active" && x.kind === it.kind && x.content_hash === it.content_hash && x.id !== it.id)) return { ok: false, error: "duplicate_content" }; if (a.p_expected_revision === 0) { const r = { ...it, id: id(), revision: 1, status: it.status || "active" }; t.ai_trainer_items.push(r); return { ok: true, data: { id: r.id, revision: 1 } }; } const c = t.ai_trainer_items.find((x) => x.id === it.id); if (c.revision !== a.p_expected_revision) return { ok: false, error: "revision_conflict" }; Object.assign(c, it, { revision: c.revision + 1 }); return { ok: true, data: { id: c.id, revision: c.revision } }; }
    if (fn === "ai_pointer_set") { const p = t.ai_bot_pointers.find((x) => x.bot === a.p_bot); if (a.p_check_expected && (p.snapshot_id ?? null) !== (a.p_expected_snapshot_id ?? null)) return { ok: false, error: "pointer_moved" }; const sn = t.ai_snapshots.find((x) => x.id === a.p_snapshot_id); if (a.p_publish && sn && sn.status !== "published") Object.assign(sn, { status: "published" }); Object.assign(p, { mode: a.p_mode, snapshot_id: a.p_snapshot_id, changed_at: new Date().toISOString(), changed_by_claimed: a.p_actor, reason: a.p_reason }); t.ai_trainer_audit.push({ entity: "pointer", action: a.p_action }); return { ok: true, data: p }; }
    if (fn === "ai_budget_reserve") return { ok: true, data: id() };
    if (fn === "ai_model_key_set") { const r = t.ai_model_configs.find((x) => x.scope === a.p_scope); vaultKey = a.p_key; if (new URL(r.base_url).hostname !== new URL(a.p_expected_base_url).hostname) return { ok: false, error: "host_mismatch" }; Object.assign(r, { key_last4: a.p_key.slice(-4), key_host: new URL(a.p_expected_base_url).hostname, key_set_at: new Date().toISOString(), last_test: null }); return { ok: true }; }
    if (fn === "ai_model_key_get") return { ok: true, data: vaultKey };
    return { ok: true };
  },
};
// Scripted model: replies, then the judge. judgeVerdict decides pass/fail.
let judge = "fail";
const reply = (o) => JSON.stringify({ intent: "info", project_ref: null, language: "en", reply: "Which project are you interested in?", media: [], handoff: false, asked: ["project"], used_item_ids: [], clarify: true, ...o });
const llm = { async chat(req) { const isJudge = req.system.startsWith("You grade"); return { ok: true, text: isJudge ? JSON.stringify({ verdict: judge, criteria: {}, rationale: `judge says ${judge}` }) : reply({}), prompt_tokens: 10, completion_tokens: 5 }; } };
const env = { budgetUsd: 5, replyModel: "m", judgeModel: "j", pricePerMTok: { in: 1, out: 5 } };
// Scripted configured provider for the Model & API tab: the first test fails auth, the next succeeds.
const modelCalls = []; const modelOut = [{ ok: false, code: "auth", error: "Provider rejected the API key (HTTP 401)" }, { ok: true, text: "OK", prompt_tokens: 1, completion_tokens: 1 }];
const modelLlm = (cfg, key) => ({ async chat(req) { modelCalls.push({ cfg, key, model: req.model }); return modelOut.shift(); } });
const api = async (action, payload) => {
  const r = await handleTrainer({ method: "POST", headers: new Headers(), ip: "127.0.0.1", body: { action, payload } }, { db, llm, env, modelLlm, actor: async () => ({ id: "u", name: "Test Manager", role: "MANAGEMENT", is_active: true }) });
  if (!r.body.ok) throw Object.assign(new Error(r.body.error.message), { code: r.body.error.code, details: r.body.error.details, status: r.status });
  return r.body.data;
};
const toasts = []; const showToast = (m, k) => toasts.push(`${k}:${m}`);
globalThis.window.confirm = () => true;
globalThis.window.prompt = () => "testing"; // reasons for retire/rollback

const tick = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const btn = (label) => $$("button").find((b) => b.textContent.trim().includes(label));
const click = async (el) => { await act(async () => { el.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); }); await tick(20); };
const type = async (el, v) => { await act(async () => { const proto = el.tagName === "TEXTAREA" ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v); el.dispatchEvent(new w.Event("input", { bubbles: true })); }); };
const pickNative = async (el, v) => { await act(async () => { Object.getOwnPropertyDescriptor(w.HTMLSelectElement.prototype, "value").set.call(el, v); el.dispatchEvent(new w.Event("change", { bubbles: true })); }); await tick(20); };
// Radix select (ui/select.jsx): open the trigger named `label`, choose the option whose text matches.
const trig = (label) => $(`.sel-trigger[aria-label="${label}"]`);
const options = async (label) => { await act(async () => { trig(label).dispatchEvent(new w.PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" })); }); await tick(30); return $$('[role="option"]'); };
const pick = async (label, match) => { const o = (await options(label)).find((x) => match.test(x.textContent)); if (o) await click(o); await tick(20); return !!o; };
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
ok(document.body.textContent.includes("sources the model reports using:"), "trace shown, worded as model-reported");
ok(document.body.textContent.includes("saved exactly as typed"), "storage notice shown");
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
// History: both turns were saved under one conversation, listed in History.
ok(t.ai_playground_conversations.length === 1 && t.ai_playground_turns.length === 2, "both turns saved under one Playground conversation");
ok(t.ai_playground_turns.map((x) => x.seq).join(",") === "1,2", "turns saved in order");
await tick(400);
ok(document.body.textContent.includes("What is the price?") && /2 turns/.test(document.body.textContent), "History lists the conversation with its turn count");
root.unmount();

// 2b. Reload: a fresh mount has no conversation open; opening it from History
// loads the saved turns, and the next message continues it.
root = await mount("PlaygroundTab");
await tick(400);
ok($$(".ait-msg.bot").length === 0, "after reload, a new conversation is shown until one is opened");
const item = $$('[aria-label="Saved Playground conversations"] button')[0];
await click(item); await tick(100);
ok($$(".ait-msg.bot").length === 2 && document.body.textContent.includes("Jolshiri"), "opening it from History loads its full history");
const botTrigger = () => $$(".sel-trigger")[0];
ok(botTrigger().disabled === true || botTrigger().hasAttribute("data-disabled"), "bot/version are fixed for a saved conversation");
await type($('input[aria-label="Customer message"]'), "parking?"); await click(btn("Send")); await tick(80);
ok(t.ai_playground_conversations.length === 1 && t.ai_playground_turns.length === 3 && t.ai_playground_turns[2].seq === 3, "continuing adds turn 3 to the same conversation");
await click(btn("New conversation")); await tick(50);
ok($$(".ait-msg.bot").length === 0 && botTrigger().disabled === false && !botTrigger().hasAttribute("data-disabled"), "New conversation clears the chat and unlocks settings");
// A double submit (Enter then click before the first reply lands) sends one turn.
const turnsBefore = t.ai_playground_turns.length;
await type($('input[aria-label="Customer message"]'), "double send?");
const form = $('input[aria-label="Customer message"]').closest("form");
await act(async () => { form.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true })); form.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true })); });
await tick(80);
ok(t.ai_playground_turns.length === turnsBefore + 1, "a double submit saves one turn, not two");
ok($$(".ait-msg.customer").filter((m) => m.textContent.includes("double send?")).length === 1, "and shows it once");
root.unmount();

// 3. Quality: freeze, run (judge fails), publish blocked; then judge passes, new run, publish works.
root = await mount("QualityTab");
ok(document.body.textContent.includes("Legacy: unversioned live reads"), "both bots shown as Legacy");
await click(btn("Freeze drafts as candidate")); await tick(50);
ok(await pick("Snapshot", /^v1 /), "candidate listed and chosen");
// dubai has no regression test (the one saved above is eyad's): nothing to certify, Publish is off.
await pick("Bot", /^dubai$/);
ok(btn("Publish to dubai")?.disabled === true && document.body.textContent.includes("No active regression tests for dubai"), "Publish is off and says why when the bot has no active tests");
await pick("Bot", /^eyad$/);
ok(btn("Publish to eyad")?.disabled === false && !document.body.textContent.includes("No active regression tests"), "with an active test, Publish is available (the server still gates it on the run)");
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
ok(toasts.some((m) => m.includes("not live yet") || m.includes("not live")), "publish toast says the version is not live yet");
ok((await options("Snapshot")).some((o) => /active on eyad/.test(o.textContent)), "snapshot label shows the bot it is active on");
await act(async () => { document.activeElement?.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); }); await tick(30);
ok(document.body.textContent.includes("no bot reads published versions yet"), "pointer card says customers still get legacy");
await click(btn("Back to legacy")); await tick(80);
ok(t.ai_bot_pointers.find((p) => p.bot === "eyad").mode === "legacy", "rollback to legacy works");
root.unmount();

// 4. Test numbers: switch defaults off, enabling goes through the audited
// action, the allow-list shows, and a test thread renders with its turn trace.
t.wa_bot_settings = [{ bot: "eyad", trainer_test_mode: false, test_numbers: ["8801711000001"] }, { bot: "dubai", trainer_test_mode: false, test_numbers: [] }];
t.wa_conversations = [{ id: "eyad:8801711000001@s.whatsapp.net", account: "eyad", phone: "8801711000001", name: "Tester" }];
t.wa_messages = [
  { id: "m1", conversation_id: "eyad:8801711000001@s.whatsapp.net", direction: "IN", type: "text", body: "Nuznan location?", status: "DELIVERED", wa_timestamp: "2026-10-18T01:00:00Z" },
  { id: "m2", conversation_id: "eyad:8801711000001@s.whatsapp.net", direction: "OUT", type: "text", body: "Wecon Nuznan is in Jolshiri.", status: "DELIVERED", sender_name: "AI Trainer", wa_id: "wa1", wa_timestamp: "2026-10-18T01:00:05Z" },
];
t.ai_turns = [{ id: "turn1", conversation_id: "eyad:8801711000001@s.whatsapp.net", outcome: "ok", core_version: "1.0.0", model: "m", started_at: "2026-10-18T01:00:01Z", trace: { reply: "Wecon Nuznan is in Jolshiri.", project: { projects: ["p1"], source: "explicit" }, used_item_ids: [] } }];
const likeSelect = db.select;
db.select = async (path) => {
  const m = /^wa_conversations\?account=eq\.(\w+)&phone=like\.\*(\d+)/.exec(path);
  if (m) return t.wa_conversations.filter((c) => c.account === m[1] && c.phone.endsWith(m[2]));
  return likeSelect(path);
};
globalThis.window.confirm = () => true;
root = await mount("TestNumbersTab");
const sw = $('[aria-label="Trainer test mode for Eyad Bot"]');
ok(sw && sw.getAttribute("aria-checked") === "false", "trainer test mode shows Off by default");
ok(document.body.textContent.includes("+8801711000001"), "test number listed");
ok(document.body.textContent.includes("Wecon Nuznan is in Jolshiri.") && document.body.textContent.includes("DELIVERED"), "test thread shows the reply and its delivery status");
ok(document.body.textContent.includes("Trainer turns (1)"), "turn trace listed");
await click(sw); await tick(50);
ok(t.wa_bot_settings[0].trainer_test_mode === true, "switch turns test mode on through the trainer action");
ok(t.ai_trainer_audit.some((a) => a.entity === "test_mode" && a.action === "enable"), "test mode change audited");
ok(t.wa_bot_settings[1].trainer_test_mode === false, "dubai test mode untouched");
root.unmount();
// 5. Model & API: validation, save with a key, masked key, failed then successful test.
root = await mount("ModelTab");
ok(document.body.textContent.includes("Used by the Playground only"), "model tab says it is Playground only");
const mi = (label) => $$("label").find((l) => l.textContent.startsWith(label)).querySelector("input, select");
await pickNative(mi("Provider"), "custom");
await type(mi("API base URL"), "http://api.example.com/v1"); await type(mi("Model ID"), "acme/chat-1");
await click(btn("Save"));
ok(document.body.textContent.includes("must start with https://"), "http base URL refused in the form");
ok(t.ai_model_configs.length === 0, "nothing saved on a validation error");
await type(mi("API base URL"), "https://api.example.com/v1"); await click(btn("Save"));
ok(document.body.textContent.includes("required the first time"), "first save needs a key");
await type(mi("API key"), "sk-ui-SECRET-4321"); await click(btn("Save")); await tick(30);
ok(vaultKey === "sk-ui-SECRET-4321", "key stored through the vault RPC");
ok(document.body.textContent.includes("••••4321") && !document.body.innerHTML.includes("SECRET"), "only the masked key is shown");
ok(mi("API key").value === "", "key field cleared after save");
await click(btn("Test connection")); await tick(30);
ok(document.body.textContent.includes("Provider rejected the API key"), "failed test shows a safe error");
ok(!document.body.textContent.includes("connected"), "failed test is not reported as connected");
await click(btn("Test connection")); await tick(30);
ok(document.body.textContent.includes("connected"), "successful test reported only after the provider answered");
ok(modelCalls.every((c) => c.key === "sk-ui-SECRET-4321" && c.cfg.base_url === "https://api.example.com/v1" && c.model === "acme/chat-1"), "test used the saved config and key");
ok(t.ai_model_configs.length === 1 && t.ai_model_configs[0].scope === "playground", "settings saved for the Playground scope only");
root.unmount();
console.log("toasts:", toasts.filter((x) => x.startsWith("err") && !x.includes("Connection failed")).join(" | ") || "no error toasts");
