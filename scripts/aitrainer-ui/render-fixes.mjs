// vite-node scripts/aitrainer-ui/render-fixes.mjs — renders the two fixed views
// (Quality with no tests, Playground retrieved sections) to static HTML with the
// app's CSS, so they can be screenshotted without a backend.
import { writeFileSync, readFileSync } from "node:fs";
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
const tick = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const DOC = (title, section, score) => ({ id: `${title}${section}`, document_id: "d", version: 1, chunk_no: 1, title, section, score });
const turn = { id: "t1", seq: 1, customer_text: "Dakshinayan er handover kobe?", reply: "Dakshinayan er handover date amader catalog e specific kora nei. Apni chaile ami agent er sathe ekta meeting set kore dite pari.",
  media: [], handoff: true, outcome: "ok", created_at: "2026-10-19T11:35:00Z", finished_at: "2026-10-19T11:35:06Z", setup: { isAd: false, adText: "", returning: false },
  trace: { model: "deepseek/deepseek-v4-flash-0731", used_item_ids: [], project: { projects: [] },
    documents: [DOC("Wecon Dakshinayan fact sheet", "Wecon Dakshinayan", 0.61), DOC("Wecon Dakshinayan fact sheet", "Wecon Dakshinayan > Location", 0.54), DOC("WECON sales offices", "WECON sales offices > Dhaka", 0.41)] } };
const conv = { id: "c1", bot: "eyad", source: "drafts", setup: turn.setup, title: turn.customer_text, turn_count: 1, created_at: turn.created_at, last_activity_at: turn.finished_at };
const api = async (a) => ({
  "playground.list": [conv], "playground.get": { conversation: conv, turns: [turn] }, "items.list": [], "snapshot.list": [{ id: "s1", version_no: 1, status: "candidate", checksum: "abc" }],
  status: { core_version: "1.5.0", pointers: [{ bot: "eyad", mode: "legacy", snapshot_id: null, changed_at: "2026-10-18T02:07:00Z" }, { bot: "dubai", mode: "legacy", snapshot_id: null, changed_at: "2026-10-18T02:07:00Z" }], budget: [] },
  "tests.list": [],
}[a] ?? []);
const css = ["src/index.css", "src/components/aitrainer/aitrainer.css", "src/components/ui/select.css"].map((f) => readFileSync(`${R}/${f}`, "utf8")).join("\n");
for (const [name, comp, after] of [["quality", "QualityTab", null], ["playground", "PlaygroundTab", "open"]]) {
  document.body.innerHTML = '<div id="root"></div>';
  const C = (await import(`${R}/src/components/aitrainer/${comp}.jsx`)).default;
  const root = createRoot(document.querySelector("#root"));
  await act(async () => root.render(React.createElement(C, { api, showToast: () => {} })));
  await tick(300);
  if (after === "open") { document.querySelector('[aria-label="Saved Playground conversations"] button').dispatchEvent(new w.MouseEvent("click", { bubbles: true })); await tick(300); document.querySelector(".ait-docs")?.setAttribute("open", ""); }
  writeFileSync(`/tmp/vis/${name}.html`, `<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><link href="https://fonts.googleapis.com/icon?family=Material+Symbols+Outlined" rel="stylesheet"><style>${css}\nbody{padding:24px;background:var(--bg)}</style></head><body><div class="ait"><div class="ait-panel">${document.querySelector("#root").innerHTML}</div></div></body></html>`);
  root.unmount();
}
console.log("rendered");
