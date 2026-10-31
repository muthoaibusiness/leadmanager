// npm run test:ui:docs — the Markdown knowledge path end to end in happy-dom,
// wired to the real trainer-handler: save an embedding model in Model & API,
// write a Markdown document, review and index it, see a Playground turn use
// it with its source, then change the model and see publish blocked until
// the document is re-indexed. The embedder is a deterministic stub.
import { Window } from "happy-dom";
const w = new Window({ url: "http://localhost/" });
for (const k of ["document", "navigator", "HTMLElement", "Element", "Node", "Event", "CustomEvent", "KeyboardEvent", "MouseEvent", "PointerEvent", "FocusEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "sessionStorage", "localStorage", "DOMRect", "ResizeObserver", "MutationObserver", "DocumentFragment", "HTMLButtonElement", "HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement", "SVGElement", "ShadowRoot", "Text"]) {
  if (w[k]) Object.defineProperty(globalThis, k, { value: w[k], configurable: true, writable: true });
}
Object.defineProperty(globalThis, "window", { value: w, configurable: true, writable: true }); globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const R = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const React = await import(`${R}/node_modules/react/index.js`);
const { createRoot } = await import(`${R}/node_modules/react-dom/client.js`);
const { act } = React;
const { handleTrainer } = await import(`${R}/supabase/functions/_shared/trainer-handler.ts`);

const t = { ai_trainer_items: [], ai_snapshots: [], ai_trainer_audit: [], ai_playground_conversations: [], ai_playground_turns: [], ai_model_configs: [],
  ai_trainer_documents: [], ai_trainer_chunks: [], ai_system_prompts: [], ai_system_prompt_pointers: [], ai_bot_pointers: [], users: [{ id: "u", role: "MANAGEMENT", is_active: true }] };
const vault = {};
let n = 0; const id = () => `id${++n}`;
const host = (u) => new URL(u).hostname;
const db = {
  async select(path) { const [table, q] = path.split("?"); let rows = [...(t[table] || [])]; for (const part of (q || "").split("&")) { const m = /^(\w+)=eq\.(.+)$/.exec(part); if (m) rows = rows.filter((r) => String(r[m[1]]) === decodeURIComponent(m[2])); } return rows; },
  async insert(table, row) { const r = { id: id(), created_at: new Date().toISOString(), ...row }; (t[table] ||= []).push(r); return r; },
  async patch(table, filter, patch) { const [k, v] = filter.split("=eq."); const r = t[table].find((x) => String(x[k]) === decodeURIComponent(v)); if (r) Object.assign(r, patch); return !!r; },
  async rpc(fn, a) {
    if (fn === "ai_budget_reserve") return { ok: true, data: id() };
    if (fn === "ai_model_key_set") { const r = t.ai_model_configs.find((x) => x.scope === a.p_scope); if (host(r.base_url) !== host(a.p_expected_base_url)) return { ok: false, error: "host_mismatch" }; vault[a.p_scope] = a.p_key; Object.assign(r, { key_last4: a.p_key.slice(-4), key_host: host(a.p_expected_base_url), key_set_at: new Date().toISOString() }); return { ok: true }; }
    if (fn === "ai_model_key_get") return { ok: true, data: vault[a.p_scope] ?? null };
    // Stand-in for ai_match_doc_chunks: same filters (company, indexed version, model, dimension, bot), cosine order.
    if (fn === "ai_match_doc_chunks") {
      const q = JSON.parse(a.p_query); const cos = (x, y) => x.reduce((s, v, i) => s + v * y[i], 0) / (Math.hypot(...x) * Math.hypot(...y) || 1);
      return { ok: true, data: t.ai_trainer_chunks.filter((c) => { const d = t.ai_trainer_documents.find((x) => x.id === c.document_id);
        return d && d.status === "indexed" && d.indexed_version === c.document_version && d.index_model === a.p_model && c.company_id === a.p_company && c.embedding_model === a.p_model && c.embedding_dim === q.length && c.bots.includes(a.p_bot); })
        .map((c) => ({ id: c.id, document_id: c.document_id, document_version: c.document_version, chunk_no: c.chunk_no, section: c.section, chunk_text: c.chunk_text,
          title: t.ai_trainer_documents.find((x) => x.id === c.document_id).title, score: cos(JSON.parse(c.embedding), q) })).sort((x, y) => y.score - x.score).slice(0, a.p_k) };
    }
    return { ok: true };
  },
};
// Deterministic stub embedder: 4 topic axes, so "size" text lands near the sizes section.
const AXES = [/size|sqft|boro|বড়|ফ্ল্যাট/i, /location|kothay|sector|কোথায়/i, /price|dam|taka|দাম/i, /handover|kobe|হস্তান্তর/i];
const embCalls = [];
const embedWith = (cfg, key) => async (text) => { embCalls.push({ model: cfg.model, key }); const v = AXES.map((r) => (r.test(text) ? 1 : 0.05)); return { ok: true, vector: cfg.dim === 4 ? v : [...v, 0.01].slice(0, cfg.dim), tokens: 3 }; };
const seen = [];
const llm = { async chat(req) { seen.push(req.system); return { ok: true, text: JSON.stringify({ intent: "info", project_ref: null, language: "en", reply: "Type B is 1,850 sqft.", media: [], handoff: false, asked: [], used_item_ids: [], clarify: false }), prompt_tokens: 10, completion_tokens: 5 }; } };
const env = { budgetUsd: 5, replyModel: "m", judgeModel: "j", pricePerMTok: { in: 1, out: 5 }, companyId: "c1" };
const api = async (action, payload) => {
  const r = await handleTrainer({ method: "POST", headers: new Headers(), ip: "127.0.0.1", body: { action, payload } }, { db, llm, env, embedWith, actor: async () => ({ id: "u", name: "Test Manager", role: "MANAGEMENT", is_active: true }) });
  if (!r.body.ok) throw Object.assign(new Error(r.body.error.message), { code: r.body.error.code, details: r.body.error.details });
  return r.body.data;
};
const toasts = []; const showToast = (m, k) => toasts.push(`${k}:${m}`);

const tick = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const $ = (s) => document.querySelector(s); const $$ = (s) => [...document.querySelectorAll(s)];
const btn = (label) => $$("button").find((b) => b.textContent.trim().includes(label));
const click = async (el) => { await act(async () => { el.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); }); await tick(60); };
const type = async (el, v) => { await act(async () => { const proto = el.tagName === "TEXTAREA" ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v); el.dispatchEvent(new w.Event("input", { bubbles: true })); }); };
const submit = async (form) => { await act(async () => { form.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true })); }); await tick(60); };
const ok = (c, msg) => { if (!c) { console.log("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); };
const body = () => document.body.textContent;
const field = (label) => $$("label").find((l) => l.textContent.startsWith(label))?.querySelector("input, textarea");
const mount = async (path, props = {}) => {
  document.body.replaceChildren(Object.assign(document.createElement("div"), { id: "root" }));
  const C = (await import(`${R}/src/components/aitrainer/${path}.jsx`)).default;
  const root = createRoot($("#root"));
  await act(async () => root.render(React.createElement(C, { api, showToast, ...props })));
  await tick(80);
  return root;
};

// 1. Model & API: save an embedding model (OpenAI, custom key), test it.
let root = await mount("EmbeddingModel");
ok(body().includes("Embedding model") && body().includes("Not set"), "embedding section starts unset");
// Pick OpenAI in the Radix select: open the trigger, choose the option.
const trig = $$(".sel-trigger")[0];
await act(async () => { trig.dispatchEvent(new w.PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" })); }); await tick(40);
const optOpenai = $$('[role="option"]').find((o) => o.textContent.trim() === "OpenAI");
ok(!!optOpenai, "provider list offers OpenAI");
if (optOpenai) await click(optOpenai);
ok(trig.textContent.includes("OpenAI"), "OpenAI selected");
await type(field("API base URL"), "https://api.openai.com/v1");
await type(field("Embedding model ID"), "text-embedding-3-small");
await type(field("Vector size"), "4");
await submit($(".em-form"));
ok(body().includes("Enter a key"), "a key is required the first time");
await type(field("API key"), "sk-emb-UI-KEY-4321");
await submit($(".em-form"));
ok(vault.embedding === "sk-emb-UI-KEY-4321" && !document.body.innerHTML.includes("UI-KEY"), "key stored server-side and never shown");
ok(body().includes("text-embedding-3-small") && body().includes("4 dims"), "active embedding model shown");
await click(btn("Test connection"));
ok(body().includes("connected") && body().includes("4 dims"), "test connection reports a real vector of the saved size");
root.unmount();

// 2. Knowledge: write a Markdown document, review, index.
root = await mount("DocumentsPanel");
ok(body().includes("No documents yet"), "documents start empty");
await click(btn("New document"));
await type(field("Title"), "Nuznan fact sheet");
await type($("#dp-body"), "# Wecon Nuznan\n## Location\nSector 16, Jolshiri Abashon.\n## Apartment sizes\n| Type | Size |\n| --- | --- |\n| B | 1,850 sqft |\n## Handover\nDecember 2027.");
await click(btn("Save draft"));
ok(body().includes("Nuznan fact sheet") && body().includes("Draft"), "the document is a draft");
ok(t.ai_trainer_chunks.length === 0, "a draft is not indexed");
await click(btn("Mark reviewed"));
ok(body().includes("Reviewed, not indexed") && body().includes("Publishing is blocked"), "reviewed but unindexed blocks publishing");
await click(btn("Index"));
ok(body().includes("Indexed") && body().includes("text-embedding-3-small (4)"), "indexed with the saved model and size");
ok(t.ai_trainer_chunks.length === 3 && t.ai_trainer_chunks.every((c) => c.company_id === "c1" && c.embedding_model === "text-embedding-3-small" && c.embedding_dim === 4), "3 sections stored with company, model and size");
ok(embCalls.every((c) => c.key === "sk-emb-UI-KEY-4321"), "indexing used the saved embedding key");
ok(body().includes("All reviewed documents are indexed"), "publish gate clear");
root.unmount();

// 3. Playground: a paraphrased size question retrieves the sizes section and the reply is grounded on it.
const turn = await api("playground.turn", { bot: "eyad", source: "drafts", text: "nuznan er flat koto boro?", client_turn_id: "c-0001-docs", setup: {} });
ok(turn.turn.outcome === "ok" && turn.turn.reply === "Type B is 1,850 sqft.", "the reply grounded only by the document passes the guard");
ok(turn.turn.trace.documents[0].section === "Wecon Nuznan > Apartment sizes", "the top hit is the sizes section");
ok(seen.at(-1).includes("Nuznan fact sheet, Wecon Nuznan > Apartment sizes"), "the excerpt reaches the model with its source");

// 3b. The Playground shows the retrieved sections under the reply, from the saved trace.
root.unmount();
root = await mount("PlaygroundTab");
await tick(300);
await click($$('[aria-label="Saved Playground conversations"] button')[0]); await tick(150);
const docList = $('[aria-label="Knowledge sections retrieved for this reply"]');
ok(!!docList && docList.textContent.includes("Nuznan fact sheet › Wecon Nuznan › Apartment sizes"), "the reply lists the retrieved Knowledge section by document and heading");
ok(/Knowledge retrieved \(\d+\)/.test(body()) && /[01]\.\d\d$/.test(docList?.querySelector(".ait-docs-score")?.textContent || ""), "each retrieved section shows its similarity score");
root.unmount();
root = await mount("DocumentsPanel");

// 4. Change the embedding model: the document needs re-index and publishing is blocked until it is.
await api("embedconfig.save", { provider: "openai", base_url: "https://api.openai.com/v1", model: "text-embedding-3-large", embedding_dim: 5 });
root = await mount("DocumentsPanel");
ok(body().includes("Needs re-index") && body().includes("Publishing is blocked"), "a model change marks the document for re-index and blocks publishing");
const stale = await api("playground.turn", { bot: "eyad", source: "drafts", text: "nuznan er flat koto boro?", client_turn_id: "c-0002-docs", setup: {} });
ok(!stale.turn.trace.documents || !stale.turn.trace.documents.length, "old-model vectors are not searched with the new model");
await click(btn("Re-index"));
ok(body().includes("text-embedding-3-large (5)") && body().includes("All reviewed documents are indexed"), "re-indexed with the new model; gate clear again");

// 5. Editing the document returns it to draft.
await click(btn("Edit")); await tick(40);
await type($("#dp-body"), "# Wecon Nuznan\n## Apartment sizes\n| B | 1,900 sqft |");
await click(btn("Save draft"));
const d2 = t.ai_trainer_documents[0];
ok(d2.version === 2 && d2.status === "draft", "an edit is a new draft version");
ok(body().includes("v2") && body().includes("Draft"), "the list shows v2 as a draft");
ok((await api("docs.list")).blockers.length === 0 && (await api("docs.list")).publish_ready === true, "a draft is not yet live knowledge, so it does not block publishing on its own");
const stillOld = await api("playground.turn", { bot: "eyad", source: "drafts", text: "nuznan er flat koto boro?", client_turn_id: "c-0003-docs", setup: {} });
ok(!stillOld.turn.trace.documents?.length, "the edited (unreviewed) document stops answering until it is reviewed and indexed again");
root.unmount();

// 6. Project tag: a document is tagged with its project, an untagged project
// document is flagged, and a title naming one project cannot carry another's tag.
t.ai_trainer_items.push(
  { id: "p-nuz", kind: "project", revision: 1, status: "active", bots: ["eyad", "dubai"], project_ref: null, body: { name: "Wecon Nuznan", aliases: { banglish: ["nuznan"] }, media: {} } },
  { id: "p-osm", kind: "project", revision: 1, status: "active", bots: ["eyad", "dubai"], project_ref: null, body: { name: "Wecon Osman Bellevue", aliases: { banglish: ["osman"] }, media: {} } });
root = await mount("DocumentsPanel");
ok(body().includes("Names Wecon Nuznan but is not tagged with it"), "the untagged Nuznan document is flagged");
await click(btn("New document"));
const pick = $$("label").find((l) => l.textContent.startsWith("Project"))?.querySelector("select");
ok(!!pick && [...pick.options].some((o) => o.textContent === "Wecon Osman Bellevue"), "the editor offers the active projects");
await type(field("Title"), "Wecon Osman Bellevue fact sheet");
await type($("#dp-body"), "# Wecon Osman Bellevue\n## Apartment sizes\nEach apartment is 2850 sqft.");
await act(async () => { pick.value = "p-osm"; pick.dispatchEvent(new w.Event("change", { bubbles: true })); });
await click(btn("Save draft"));
ok(t.ai_trainer_documents.some((d) => d.title === "Wecon Osman Bellevue fact sheet" && d.project_ref === "p-osm"), "saved with its project");
ok(body().includes("Wecon Osman Bellevue") && body().includes("v1"), "listed with its project name");
await click(btn("New document"));
await type(field("Title"), "Wecon Nuznan brochure");
await type($("#dp-body"), "# Wecon Nuznan\nRooftop garden.");
const pick2 = $$("label").find((l) => l.textContent.startsWith("Project"))?.querySelector("select");
await act(async () => { pick2.value = "p-osm"; pick2.dispatchEvent(new w.Event("change", { bubbles: true })); });
await click(btn("Save draft"));
ok(body().includes("The title names Wecon Nuznan"), "a Nuznan document tagged with Osman is refused with a reason");
root.unmount();
console.log("toasts:", toasts.filter((x) => x.startsWith("err")).join(" | ") || "no error toasts");
