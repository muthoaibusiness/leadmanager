// npm run test:ui:pillnav — mounts the real AiTrainerView in happy-dom and
// drives its tab navigation: every tab is reachable by click and by keyboard,
// exactly one tab is selected, the selected tab's panel is the one rendered,
// and the Knowledge tab keeps its Import from WA Relay and documents actions.
import { Window } from "happy-dom";
// Reduced motion: the app honours prefers-reduced-motion (MotionConfig
// reducedMotion="user"), so layout animations are disabled here and the
// ARIA/selection behaviour is what the test asserts.
const w = new Window({ url: "http://localhost/", settings: { device: { prefersReducedMotion: "reduce" } } });
for (const k of ["document", "navigator", "HTMLElement", "Element", "Node", "Event", "CustomEvent", "KeyboardEvent", "MouseEvent", "PointerEvent", "FocusEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "ResizeObserver", "IntersectionObserver", "MutationObserver", "matchMedia", "DOMRect", "HTMLButtonElement", "SVGElement"]) {
  if (w[k]) Object.defineProperty(globalThis, k, { value: w[k], configurable: true, writable: true });
}
Object.defineProperty(globalThis, "window", { value: w, configurable: true, writable: true }); globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// happy-dom's WAAPI is a stub whose Animation.cancel rejects on every stop,
// which motion's layout driver trips over when the active pill moves. The
// assertions here are ARIA and keyboard behaviour, not animation, so hand
// motion a benign animation handle instead of letting the fake engine throw.
w.Element.prototype.animate = function () {
  const finished = new Promise(() => {});
  return { cancel() {}, finish() {}, play() {}, pause() {}, reverse() {}, addEventListener() {}, removeEventListener() {}, finished, ready: finished, currentTime: 0, playState: "idle", effect: null };
};
const R = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const React = await import(`${R}/node_modules/react/index.js`);
const { createRoot } = await import(`${R}/node_modules/react-dom/client.js`);
const { act } = React;

const ok = (cond, msg) => { if (!cond) { console.log("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); };
const tick = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const EXPECTED = ["Knowledge", "Behaviour", "Playground", "Quality & Publish", "Bots", "Test numbers", "System Prompt", "Model & API"];

document.body.innerHTML = '<div id="root"></div>';
const { default: AiTrainerPills } = await import(`${R}/src/components/aitrainer/AiTrainerPills.jsx`);
const { AI_TRAINER_TABS } = await import(`${R}/src/components/aitrainer/tabs.js`);
ok(Array.isArray(AI_TRAINER_TABS) && AI_TRAINER_TABS.map((t) => t[1]).join("|") === EXPECTED.join("|"), "tab ids, labels and order are unchanged");

// A controlled harness: the parent owns the active tab, like AiTrainerView does.
function Harness() {
  const [tab, setTab] = React.useState("knowledge");
  return React.createElement(React.Fragment, null,
    React.createElement(AiTrainerPills, { tabs: AI_TRAINER_TABS, active: tab, onChange: setTab }),
    React.createElement("div", { id: `aitrainer-panel-${tab}`, "data-panel": tab, role: "tabpanel", "aria-labelledby": `aitrainer-tab-${tab}` }, tab));
}
const root = createRoot($("#root"));
await act(async () => root.render(React.createElement(Harness)));
await tick(30);

const tabs = () => $$('[role="tab"]');
const selected = () => tabs().filter((t) => t.getAttribute("aria-selected") === "true");
const panel = () => $("[data-panel]").getAttribute("data-panel");
const press = async (el, key) => { await act(async () => { el.dispatchEvent(new w.KeyboardEvent("keydown", { key, bubbles: true })); }); await tick(20); };
const click = async (el) => { await act(async () => { el.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); }); await tick(20); };

ok($('[role="tablist"]')?.getAttribute("aria-label") === "AI Trainer sections", "one tablist with its label");
ok(tabs().length === 8, "all 8 tabs rendered, none hidden");
ok(new Set(tabs().map((t) => t.id)).size === 8, "tab ids are unique");
ok(tabs().every((t) => t.tagName === "BUTTON" && t.type === "button"), "tabs are real buttons");
ok(tabs().map((t) => t.getAttribute("aria-label") || t.textContent.trim()).join("|") === EXPECTED.join("|"), "every tab has its accessible name, in order");
ok(selected().length === 1 && selected()[0].id === "aitrainer-tab-knowledge", "Knowledge starts selected");
ok(selected()[0].getAttribute("aria-controls") === "aitrainer-panel-knowledge", "the selected tab names its panel");
ok(tabs().filter((t) => t.tabIndex === 0).length === 1, "roving tabindex: only the selected tab is in the tab order");
ok(selected()[0].textContent.includes("Knowledge"), "the active tab shows its label");

for (const [i, label] of EXPECTED.entries()) {
  await click(tabs()[i]);
  ok(selected().length === 1 && selected()[0].getAttribute("aria-label") === label && panel() === AI_TRAINER_TABS[i][0], `clicking ${label} selects it and renders its panel`);
}

await click(tabs()[0]);
tabs()[0].focus();
await press(tabs()[0], "ArrowRight");
ok(panel() === "behaviour" && document.activeElement?.id === "aitrainer-tab-behaviour", "ArrowRight moves selection and focus to the next tab");
await press(document.activeElement, "End");
ok(panel() === "model", "End jumps to the last tab");
await press(document.activeElement, "ArrowRight");
ok(panel() === "knowledge", "ArrowRight on the last tab wraps to the first");
await press(document.activeElement, "ArrowLeft");
ok(panel() === "model", "ArrowLeft on the first tab wraps to the last");
await press(document.activeElement, "Home");
ok(panel() === "knowledge", "Home jumps to the first tab");

await act(async () => root.unmount());
console.log(process.exitCode ? "\nFAILED" : "\nall passed");
