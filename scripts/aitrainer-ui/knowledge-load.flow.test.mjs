// vite-node scripts/aitrainer-ui/knowledge-load.flow.test.mjs
// The Knowledge tab's first load: the documents request goes out beside the
// items request (not after it), and the sections under the documents card wait
// for that card, so nothing shows first and then moves down.
import { Window } from "happy-dom";
const w = new Window({ url: "http://localhost/" });
for (const k of ["document", "navigator", "HTMLElement", "Element", "Node", "Event", "CustomEvent", "KeyboardEvent", "MouseEvent", "PointerEvent", "FocusEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "sessionStorage", "localStorage", "DOMRect", "ResizeObserver", "MutationObserver", "DocumentFragment", "HTMLButtonElement", "HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement", "SVGElement", "ShadowRoot", "Text"]) {
  if (w[k]) Object.defineProperty(globalThis, k, { value: w[k], configurable: true, writable: true });
}
Object.defineProperty(globalThis, "window", { value: w, configurable: true, writable: true }); globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// happy-dom's WAAPI is a stub whose Animation.cancel rejects on every stop,
// which motion trips over when the ring loader (ui/loader.jsx) unmounts. The
// assertions here are not about animation, so hand motion a benign handle
// (as pillnav.flow.test.mjs and metacapi-ui.flow.test.mjs do).
w.Element.prototype.animate = function () {
  const finished = new Promise(() => {});
  return { cancel() {}, finish() {}, play() {}, pause() {}, reverse() {}, addEventListener() {}, removeEventListener() {}, finished, ready: finished, currentTime: 0, playState: "idle", effect: null };
};
const R = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const React = await import(`${R}/node_modules/react/index.js`);
const { createRoot } = await import(`${R}/node_modules/react-dom/client.js`);
const { default: KnowledgeTab } = await import(`${R}/src/components/aitrainer/KnowledgeTab.jsx`);
const { act } = React;

const ok = (cond, msg) => { if (!cond) { console.log("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); };
const tick = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const text = () => document.body.textContent;

const items = [{ id: "i1", kind: "fact", status: "active", revision: 1, bots: ["eyad"], project_ref: null, body: { topic: "Handover", text: "Handover is planned for 2027" } }];
const docs = { publish_ready: true, blockers: [], association: [], documents: [] };

// Mounts the tab against a server that answers each action after `delay[action]` ms.
async function mount(delay, fail = {}) {
  const calls = [];
  const api = (action) => {
    calls.push(action);
    return new Promise((res, rej) => setTimeout(() => (fail[action] ? rej(new Error("server down")) : res(action === "items.list" ? items : docs)), delay[action]));
  };
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById("root"));
  await act(async () => root.render(React.createElement(KnowledgeTab, { api, showToast: () => {} })));
  return { calls, root };
}

// Items answer first, documents later.
let m = await mount({ "items.list": 20, "docs.list": 150 });
await tick(5);
ok(m.calls.includes("docs.list"), "the documents request goes out before the items request has answered");
await tick(65);
ok(!text().includes("Facts") && !text().includes("Knowledge documents"), "the sections do not show ahead of the documents card");
await tick(180);
ok(text().includes("Knowledge documents") && text().includes("Facts") && text().includes("Business rules"), "then the card and the sections show together");
m.root.unmount();

// Documents answer first, items later.
m = await mount({ "items.list": 150, "docs.list": 20 });
await tick(70);
ok(text().includes("Knowledge documents") && !text().includes("Facts"), "the documents card can show first; the sections follow under it");
await tick(180);
ok(text().includes("Facts"), "the sections show once the items answer");
m.root.unmount();

// The documents request fails: its error shows and the sections are not held back.
m = await mount({ "items.list": 20, "docs.list": 40 }, { "docs.list": true });
await tick(120);
ok(text().includes("Could not load documents") && text().includes("Facts"), "a failed documents request does not hide the sections");
m.root.unmount();

console.log(process.exitCode ? "\nknowledge-load: FAILED" : "\nknowledge-load: all passed");
process.exit(process.exitCode || 0);
