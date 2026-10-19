// npm run test:ui:botcontrol — mounts the Bots control in happy-dom with a
// scripted ai-trainer API and a fetch stub for the wa_bot_settings reads and
// direct-write check. Checks the bot dropdown (All Bots by default), the customer-reply
// switch, and that Publish / Rollback stay disabled until the data allows them.
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

// wa_bot_settings as production holds it today: AI replies off on both bots.
const settings = [{ bot: "eyad", faq_agent_enabled: false, display_name: "Eyad Bot" }, { bot: "dubai", faq_agent_enabled: false, display_name: "Dubai Bot" }];
const writes = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes("/rest/v1/wa_bot_settings") && (init.method || "GET") === "GET") return new Response(JSON.stringify(settings), { status: 200 });
  if (u.includes("/rest/v1/wa_bot_settings") && init.method === "POST") {
    const rows = JSON.parse(init.body); writes.push(...rows);
    for (const r of rows) Object.assign(settings.find((s) => s.bot === r.bot), r);
    return new Response("[]", { status: 201 });
  }
  return new Response("[]", { status: 200 });
};
window.confirm = () => true;

const calls = [];
const state = { pointers: [{ bot: "eyad", mode: "legacy", snapshot_id: null }, { bot: "dubai", mode: "legacy", snapshot_id: null }],
  snapshots: [{ id: "s1", version_no: 1, status: "candidate", created_at: "2026-10-18T10:00:00Z" }], runs: [] };
const api = async (action, payload) => {
  calls.push([action, payload]);
  if (action === "status") return { core_version: "c1", pointers: state.pointers, budget: [] };
  if (action === "snapshot.list") return state.snapshots;
  if (action === "runs.list") { if (state.noRunsList) throw Object.assign(new Error("Unknown action: runs.list"), { code: "unknown_action" }); return state.runs; }
  if (action === "bots.set_replies") { settings.find((s) => s.bot === payload.bot).faq_agent_enabled = payload.enabled; return { bot: payload.bot, faq_agent_enabled: payload.enabled }; }
  throw Object.assign(new Error(`unexpected ${action}`), { code: "test" });
};
const toasts = []; const showToast = (m, k) => toasts.push(`${k}:${m}`);

const tick = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const $$ = (sel) => [...document.querySelectorAll(sel)];
const btn = (label) => $$("button").find((b) => b.textContent.trim().includes(label));
const click = async (el) => { await act(async () => { el.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); }); await tick(30); };
const ok = (cond, msg) => { if (!cond) { console.log("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); };

document.body.replaceChildren(Object.assign(document.createElement("div"), { id: "root" }));
const BotControl = (await import(`${R}/src/components/aitrainer/BotControl.jsx`)).default;
const root = createRoot(document.getElementById("root"));
await act(async () => root.render(React.createElement(BotControl, { api, showToast })));
await tick(80);

const cards = () => $$("article.bc-card").map((a) => a.querySelector("h3").textContent);
ok(btn("All Bots") !== undefined, "dropdown defaults to All Bots");
ok(cards().join(",") === "Eyad Bot,Dubai Bot", "All Bots shows both bot cards");
ok(document.body.textContent.includes("No automatic answers") && !document.body.textContent.includes("Legacy FAQ agent"), "replies off on both bots: customers get no automatic answer, not a live agent");
ok(!$$(".cot-badge").some((b) => b.textContent.trim() === "Live"), "no hardcoded Live badge");
ok(document.body.textContent.includes("Publish unlocks when the latest tests all pass.") && document.body.textContent.includes("Nothing published to roll back."), "why Publish and Rollback are disabled is visible text, not a tooltip");
ok(!document.body.textContent.includes("v1 · Production"), "the candidate is never labelled as production");
ok(document.body.textContent.includes("v1 · Candidate") && document.body.textContent.includes("Not tested"), "candidate shown with its real test state");
ok(btn("Publish v1").disabled, "Publish disabled until the candidate's tests pass");
ok(btn("Rollback").disabled, "Rollback disabled while the pointer is legacy");
ok(!btn("Run tests").disabled, "Run tests enabled for a candidate");

const sw = () => $$('button[role="switch"]');
ok(sw().length === 2 && sw().every((s) => s.getAttribute("aria-checked") === "false"), "both switches read Off, as production does");
await click(sw()[1]);
const setCalls = () => calls.filter(([a]) => a === "bots.set_replies");
ok(setCalls().length === 1 && setCalls()[0][1].bot === "dubai" && setCalls()[0][1].enabled === true, "switch goes through bots.set_replies for the chosen bot only");
ok(writes.length === 0, "the browser never writes wa_bot_settings directly");
ok(sw()[1].getAttribute("aria-checked") === "true" && sw()[0].getAttribute("aria-checked") === "false", "dubai on after reload, eyad untouched");
ok(document.body.textContent.includes("Legacy FAQ agent"), "with replies on, customers get the legacy agent");
await click(sw()[1]);
ok(settings[1].faq_agent_enabled === false, "switch back off");

window.confirm = () => false;
await click(sw()[0]);
ok(setCalls().length === 2 && settings[0].faq_agent_enabled === false, "cancelling the confirm sends nothing");
window.confirm = () => true;

// Bot filter. Radix opens on pointerdown; drive the radio item directly.
const trigger = btn("All Bots");
await act(async () => { trigger.dispatchEvent(new w.PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" })); }); await tick(40);
const dubaiItem = $$('[role="menuitemradio"]').find((e) => e.textContent.includes("Dubai Bot"));
ok(!!dubaiItem, "dropdown lists the bots");
if (dubaiItem) { await click(dubaiItem); }
ok(cards().join(",") === "Dubai Bot", "choosing Dubai Bot shows only its card");

// A complete run over zero tests (production today: no active tests) is not a pass.
state.runs = [{ id: "r0", snapshot_id: "s1", bot: "dubai", status: "complete", counts: { PASS: 0, FAIL: 0, INCONCLUSIVE: 0 }, started_at: "2026-10-19T00:30:00Z" }];
await click(btn("Refresh"));
ok(btn("Publish v1").disabled && document.body.textContent.includes("No tests to run") && document.body.textContent.includes("Publish needs at least one regression test"),
  "a run over zero tests leaves Publish off and says a regression test is needed");
// A passing run enables Publish; a published pointer enables Rollback but stays "not live".
state.runs = [{ id: "r1", snapshot_id: "s1", bot: "dubai", status: "complete", counts: { PASS: 3, FAIL: 0, INCONCLUSIVE: 0 }, started_at: "2026-10-19T01:00:00Z" }];
await click(btn("Refresh"));
ok(!btn("Publish v1").disabled && document.body.textContent.includes("Tests passed"), "a passing run enables Publish");
state.pointers[1] = { bot: "dubai", mode: "snapshot", snapshot_id: "s1" };
state.snapshots = [{ ...state.snapshots[0], status: "published", published_at: "2026-10-19T02:00:00Z" }];
await click(btn("Refresh"));
ok(!btn("Rollback").disabled, "a published pointer enables Rollback");
ok(document.body.textContent.includes("Not live") && !document.body.textContent.includes("AI Trainer\u00a0·") && !/v1 · AI Trainer/.test(document.body.textContent), "a published version is shown as not live while the bots ignore it");

// An ai-trainer without runs.list (deployed before it) still renders both cards.
state.noRunsList = true;
state.snapshots = [...state.snapshots, { id: "s2", version_no: 2, status: "candidate", created_at: "2026-10-19T03:00:00Z" }];
await click(btn("Refresh"));
ok(!document.body.textContent.includes("Could not load the bots"), "cards still load when runs.list is unknown");
ok(document.body.textContent.includes("Test status unavailable"), "test state reads unavailable, not 'not tested'");
state.noRunsList = false;

ok(!calls.some(([a]) => ["publish", "rollback", "runs.start"].includes(a)), "no production action ran without a click");
root.unmount();
console.log("toasts:", toasts.filter((x) => x.startsWith("err")).join(" | ") || "no error toasts");
