// npm run test:ui:prompt — mounts the System Prompt tab in happy-dom, wired to
// the real trainer-handler with an in-memory db and a scripted model. Drives
// edit, save, publish, an unsaved draft, test, Playground use and rollback.
import { Window } from "happy-dom";
const w = new Window({ url: "http://localhost/" });
for (const k of ["document", "navigator", "HTMLElement", "Element", "Node", "Event", "CustomEvent", "KeyboardEvent", "MouseEvent", "PointerEvent", "FocusEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "sessionStorage", "localStorage", "DOMRect", "ResizeObserver", "MutationObserver"]) {
  if (w[k]) Object.defineProperty(globalThis, k, { value: w[k], configurable: true, writable: true });
}
Object.defineProperty(globalThis, "window", { value: w, configurable: true, writable: true }); globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const R = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const React = await import(`${R}/node_modules/react/index.js`);
const { createRoot } = await import(`${R}/node_modules/react-dom/client.js`);
const { act } = React;
const { handleTrainer } = await import(`${R}/supabase/functions/_shared/trainer-handler.ts`);

const t = { ai_trainer_items: [], ai_snapshots: [], ai_trainer_audit: [], ai_playground_conversations: [], ai_playground_turns: [], ai_model_configs: [],
  ai_system_prompts: [], ai_system_prompt_pointers: [{ bot: "eyad", company_id: "c1", prompt_id: null }, { bot: "dubai", company_id: "c1", prompt_id: null }],
  users: [{ id: "u", role: "MANAGEMENT", is_active: true }] };
let n = 0; const id = () => `id${++n}`;
const db = {
  async select(path) { const [table, q] = path.split("?"); let rows = [...(t[table] || [])]; for (const part of (q || "").split("&")) { const m = /^(\w+)=eq\.(.+)$/.exec(part); if (m) rows = rows.filter((r) => String(r[m[1]]) === decodeURIComponent(m[2])); } return rows; },
  async insert(table, row) { const r = { id: id(), created_at: new Date().toISOString(), ...row }; (t[table] ||= []).push(r); return r; },
  async patch(table, filter, patch) { const [k, v] = filter.split("=eq."); const r = t[table].find((x) => String(x[k]) === decodeURIComponent(v)); if (r) Object.assign(r, patch); return !!r; },
  async rpc(fn) { if (fn === "ai_budget_reserve") return { ok: true, data: id() }; return { ok: true }; },
};
// Records the operator instructions each model call received. The reply stays
// a fixed grounded sentence, so the grounding guard never interferes.
const seen = [];
const opOf = (system) => ((/<operator_instructions>\n([\s\S]*?)\n<\/operator_instructions>/.exec(system) || [])[1] || "BUILT-IN").split(":")[0];
const llm = { async chat(req) {
  seen.push(opOf(req.system));
  return { ok: true, text: JSON.stringify({ intent: "info", project_ref: null, language: "en", reply: "Which project are you interested in?", media: [], handoff: false, asked: [], used_item_ids: [], clarify: true }), prompt_tokens: 10, completion_tokens: 5 };
} };
const lastSeen = () => seen.at(-1);
const env = { budgetUsd: 5, replyModel: "m", judgeModel: "j", pricePerMTok: { in: 1, out: 5 } };
const api = async (action, payload) => {
  const r = await handleTrainer({ method: "POST", headers: new Headers(), ip: "127.0.0.1", body: { action, payload, actor_claimed: "Test Manager", user_id: "u" } }, { db, llm, env });
  if (!r.body.ok) throw Object.assign(new Error(r.body.error.message), { code: r.body.error.code, details: r.body.error.details });
  return r.body.data;
};
const toasts = []; const showToast = (m, k) => toasts.push(`${k}:${m}`);
window.confirm = () => true; window.prompt = () => "v2 was too pushy";

const tick = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const $ = (s) => document.querySelector(s); const $$ = (s) => [...document.querySelectorAll(s)];
const btn = (label) => $$("button").find((b) => b.textContent.trim().includes(label));
const click = async (el) => { await act(async () => { el.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); }); await tick(40); };
const type = async (el, v) => { await act(async () => { const proto = el.tagName === "TEXTAREA" ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v); el.dispatchEvent(new w.Event("input", { bubbles: true })); }); };
const submit = async (form) => { await act(async () => { form.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true })); }); await tick(60); };
const ok = (c, msg) => { if (!c) { console.log("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); };
const body = () => document.body.textContent;
const playground = async (cid, prompt, bot = "eyad") => { await api("playground.turn", { bot, source: "drafts", text: "hello there, price?", client_turn_id: cid, setup: {}, ...(prompt ? { prompt } : {}) }); return lastSeen(); };

document.body.replaceChildren(Object.assign(document.createElement("div"), { id: "root" }));
const C = (await import(`${R}/src/components/aitrainer/PromptTab.jsx`)).default;
const root = createRoot($("#root"));
await act(async () => root.render(React.createElement(C, { api, showToast })));
await tick(80);

ok(body().includes("Nothing published"), "starts with nothing published");
ok(btn("Save draft").disabled && btn("Publish").disabled, "Save and Publish disabled with no edits");
const ta = () => $("#sp-body");
await type(ta(), "PROMPT-V1: You are Eyad. Offer a site visit.");
ok(body().includes("Unsaved changes") && /\d+ \/ 12,000 characters/.test(body()), "character count and unsaved state shown");
ok(btn("Publish").disabled, "cannot publish before saving");
await click(btn("Save draft"));
ok(t.ai_system_prompts.length === 1 && t.ai_system_prompts[0].status === "draft", "Save draft writes a draft version");
ok(document.querySelector('[role="status"]').textContent === "Draft v1 not published", "status badge shows the unpublished draft");
ok((await playground("c-0001-uiui")) === "BUILT-IN", "a saved but unpublished draft does not reach the Playground");
await click(btn("Publish v1"));
ok(body().includes("Published v2"), "publishing makes v2 the published version");
ok((await playground("c-0002-uiui")) === "PROMPT-V1", "the published prompt reaches the model");

await type(ta(), "PROMPT-V3: You are Eyad. Never offer a visit.");
await click(btn("Save draft"));
ok((await playground("c-0003-uiui")) === "PROMPT-V1", "a newer draft leaves published behaviour unchanged");
ok((await playground("c-0004-uiui", "draft")) === "PROMPT-V3", "the draft is used only when the tester asks for it");

await type($("#sp-try"), "Can I visit the site?");
await submit($(".sp-try"));
ok(lastSeen() === "PROMPT-V3" && body().includes("Which project are you interested in?"), "Test prompt runs the text in the editor and shows the reply");
const versionsBefore = t.ai_system_prompts.length;
ok(versionsBefore === 3, "Test prompt saved no version");

await click(btn("Publish v3"));
ok(body().includes("Published v4"), "v3 published as v4");
ok((await playground("c-0005-uiui")) === "PROMPT-V3", "published behaviour changed after publish");
await click(btn("Use this"));
ok(body().includes("Published v2") && body().includes("rolled back: v2 was too pushy"), "rollback restores v2 with its reason");
ok((await playground("c-0006-uiui")) === "PROMPT-V1", "rollback restores the earlier behaviour");

ok(t.ai_system_prompt_pointers.find((p) => p.bot === "dubai").prompt_id === null, "dubai's pointer never moved");
ok((await playground("c-0007-uiui", undefined, "dubai")) === "BUILT-IN", "dubai never gets eyad's prompt");
ok(t.ai_playground_turns.every((x) => !JSON.stringify(x.trace).includes("You are Eyad")), "prompt text is not copied into turn traces");
ok(t.ai_playground_turns.at(-2).trace.system_prompt?.version_no === 2, "trace names the prompt version in use");
root.unmount();
console.log("toasts:", toasts.filter((x) => x.startsWith("err")).join(" | ") || "no error toasts");
