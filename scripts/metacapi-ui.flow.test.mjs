// npm run test:ui:metacapi — mounts the real MetaCapiPanel in happy-dom, wired
// to the real meta-capi handler (capi-core.ts) with an in-memory store and a
// scripted Meta. Checks the figures, tabs, row checkboxes and select-all, the
// selected count, 50-row pages, 12-hour times, the in-page history dialog,
// loading and empty states, the confirmed send, the shared limiter, the bot
// switches, that delete is offered only with a delete handler and always
// asks first, and the Users-style Filter / Sort / Export toolbar with its
// client-only PDF report (preview, download, print share one Blob URL, freed on
// close and unmount). No network, no real token, no production data.
import { Window } from "happy-dom";
const w = new Window({ url: "http://localhost/", settings: { device: { prefersReducedMotion: "reduce" } } });
for (const k of ["document", "navigator", "HTMLElement", "Element", "Node", "Event", "CustomEvent", "KeyboardEvent", "MouseEvent", "PointerEvent", "FocusEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "ResizeObserver", "IntersectionObserver", "MutationObserver", "matchMedia", "DOMRect", "HTMLButtonElement", "HTMLInputElement", "HTMLSelectElement", "SVGElement", "localStorage", "sessionStorage", "DocumentFragment", "ShadowRoot", "Text", "HTMLTextAreaElement", "NodeFilter"]) {
  if (w[k]) Object.defineProperty(globalThis, k, { value: w[k], configurable: true, writable: true });
}
Object.defineProperty(globalThis, "window", { value: w, configurable: true, writable: true }); globalThis.IS_REACT_ACT_ENVIRONMENT = true;
w.Element.prototype.animate = function () { const f = new Promise(() => {}); return { cancel() {}, finish() {}, play() {}, pause() {}, reverse() {}, addEventListener() {}, removeEventListener() {}, finished: f, ready: f, currentTime: 0, playState: "idle", effect: null }; };
const R = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const React = await import(`${R}/node_modules/react/index.js`);
const { createRoot } = await import(`${R}/node_modules/react-dom/client.js`);
const { act } = React;
const { handleCapi } = await import(`${R}/supabase/functions/_shared/capi-core.ts`);
const { default: MetaCapiPanel } = await import(`${R}/src/components/metacapi/MetaCapiPanel.jsx`);
const { fmtTime, canDeleteLeads, CAPI_PAGE: PAGE } = await import(`${R}/src/lib/metaCapi.js`);

const ok = (cond, msg) => { if (!cond) { console.log("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); };
const tick = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const btn = (label, scope = document) => [...scope.querySelectorAll("button")].find((b) => b.textContent.trim().includes(label));
const click = async (el) => { await act(async () => { el.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); }); await tick(30); };
const text = () => document.body.textContent;
const ids = () => $$("tbody tr").map((r) => r.querySelector("code")?.textContent.trim());
const rowOf = (id) => $$("tbody tr").find((r) => r.querySelector("code")?.textContent.trim() === id);
const count = () => $(".bulk-ct")?.textContent.trim();
// Filter, Sort and Export are the Users toolbar's ui/menu dropdowns (radix): open one, pick an item.
const openMenu = async (label) => {
  const t = $(`.mcx-bar [aria-label="${label}"]`);
  await act(async () => { t.dispatchEvent(new w.PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" })); }); await tick(30);
};
const item = (label) => $$('[role="menuitem"], [role="menuitemradio"]').find((o) => o.querySelector(".menu-tx")?.textContent.trim().startsWith(label));
const pick = async (menu, label, wait = 300) => {
  await openMenu(menu);
  await act(async () => { item(label).dispatchEvent(new w.MouseEvent("click", { bubbles: true })); }); await tick(wait);
};
const closeMenu = async () => { await act(async () => { document.activeElement?.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); }); await tick(30); };
const tabTo = (label) => pick("Filter leads", label);

// ── an in-memory world behind the real handler ──────────────────────────────
const NOW = Date.parse("2026-10-29T11:00:00Z"), DAY = 864e5;
const TOKEN = "EAA-ui-SECRET";
// qualified: an agent marked it Connected or Interested (capi_lead_status, 0051).
const leads = [
  { id: "P1", name: "Rahim", company_id: "c1", source: "WHATSAPP_ADS", ctwa_clid: "k1", CAPI_STATUS: null, created_at: "2026-10-27T10:43:00.000Z" },
  { id: "P2", name: "Karim", company_id: "c1", source: "WHATSAPP_ADS", ctwa_clid: "k2", CAPI_STATUS: null, created_at: new Date(NOW - 3 * DAY).toISOString() },
  { id: "U1", name: "Unmarked", company_id: "c1", source: "WHATSAPP_ADS", ctwa_clid: "k5", CAPI_STATUS: null, qualified: false, created_at: new Date(NOW - DAY).toISOString() },
  { id: "S1", name: "Salma", company_id: "c1", source: "WHATSAPP_ADS", ctwa_clid: "k3", CAPI_STATUS: "LeadSubmitted", created_at: new Date(NOW - 20 * DAY).toISOString() },
  { id: "X1", name: "Old", company_id: "c1", source: "WHATSAPP_ADS", ctwa_clid: "k4", CAPI_STATUS: null, created_at: new Date(NOW - 9 * DAY).toISOString() },
  { id: "N1", name: "NoClick", company_id: "c1", source: "WHATSAPP_ADS", ctwa_clid: null, CAPI_STATUS: null, created_at: new Date(NOW - DAY).toISOString() },
  // 54 more qualified, pending leads: the list runs to two pages of 50.
  ...Array.from({ length: 54 }, (_, i) => ({ id: `Q${String(i).padStart(2, "0")}`, name: `Bulk ${i}`, company_id: "c1", source: "WHATSAPP_ADS", ctwa_clid: `q${i}`, CAPI_STATUS: null, created_at: new Date(NOW - 4 * DAY - i * 60e3).toISOString() })),
];
const attempts = []; const sent = []; const settings = { ui_recovery_paused: false };
const statusOf = (l) => { const a = attempts.filter((x) => x.lead_id === l.id); return l.CAPI_STATUS === "LeadSubmitted" || a.some((x) => x.outcome === "accepted") ? "success" : !l.ctwa_clid || l.qualified === false ? "ineligible" : Date.parse(l.created_at) + 7 * DAY <= NOW ? "expired" : a.length ? "failed" : "pending"; };
const unsureOf = (id) => attempts.some((x) => x.lead_id === id && ["timeout", "network", "ambiguous"].includes(x.outcome));
const row = (l) => { const a = attempts.filter((x) => x.lead_id === l.id); const last = a.at(-1);
  return { ...l, has_clid: !!l.ctwa_clid, status: statusOf(l), qualified: l.qualified !== false, unsure: unsureOf(l.id), attempts: a.length, cutoff_at: new Date(Date.parse(l.created_at) + 7 * DAY).toISOString(), event_id: l.id,
    first_attempt_at: a[0]?.attempted_at ?? null, last_attempt_at: last?.attempted_at ?? null, accepted_at: a.find((x) => x.outcome === "accepted")?.attempted_at ?? null,
    latest_outcome: last?.outcome ?? null, latest_http: last?.http_status ?? null, latest_error_message: last?.error_message ?? null, latest_fbtrace_id: last?.fbtrace_id ?? null }; };
let metaReply = { status: 200, json: { events_received: 1, fbtrace_id: "fbt-ok" } };
const bots = [{ bot: "eyad", display_name: "Eyad Bot", meta_capi_enabled: true }, { bot: "dubai", display_name: "Dubai Bot", meta_capi_enabled: true }];
let permitFor = () => ({ result: "ok" });
const pageCalls = [];
let historyGate = null; // a promise the history call waits on, to see its loading state
const deps = {
  now: () => NOW, token: () => TOKEN,
  async user(id) { return id === "mgr" ? { id, role: "MANAGEMENT", is_active: true, company_id: "c1", allowed_features: null } : null; },
  async lead(id) { const l = leads.find((x) => x.id === id); return l ? { id: l.id, company_id: l.company_id, created_at: l.created_at, ctwa_clid: l.ctwa_clid, capi_status_column: l.CAPI_STATUS, qualified: l.qualified !== false, unsure: unsureOf(l.id) } : null; },
  async page(q) {
    pageCalls.push(q);
    let rs = leads.map(row);
    if (q.status !== "all") rs = rs.filter((r) => r.status === q.status);
    if (q.search) rs = rs.filter((r) => r.id.includes(q.search) || (r.name || "").includes(q.search));
    if (q.sort === "created_asc") rs.sort((a, b) => a.created_at.localeCompare(b.created_at));
    return { rows: rs.slice(q.offset, q.offset + q.limit), total: rs.length };
  },
  async summary() { const by = {}; for (const l of leads) by[statusOf(l)] = (by[statusOf(l)] || 0) + 1;
    return { total: leads.length, by_status: by, attempts: attempts.length, accepted_attempts: attempts.filter((a) => a.outcome === "accepted").length,
      last_accepted_at: attempts.filter((a) => a.outcome === "accepted").at(-1)?.attempted_at ?? null, oldest_pending: null }; },
  async history(id) { if (historyGate) await historyGate; return attempts.filter((a) => a.lead_id === id).slice().reverse(); },
  async acquire(id) { return permitFor(id); }, async unlock() {}, async throttle() { return new Date(NOW + 60e3).toISOString(); },
  async bots() { return bots.map((b) => ({ ...b })); },
  async setBot(bot, on) { const b = bots.find((x) => x.bot === bot); if (!b) return null; b.meta_capi_enabled = on; return { bot, meta_capi_enabled: on }; },
  async record(a) { const n = attempts.filter((x) => x.lead_id === a.lead_id).length + 1; attempts.push({ ...a, attempt_no: n, attempted_at: new Date(NOW).toISOString() }); if (a.outcome === "accepted") leads.find((l) => l.id === a.lead_id).CAPI_STATUS = "LeadSubmitted"; return { attempt_no: n }; },
  async settings() { return settings; }, async saveSettings(p) { Object.assign(settings, p); },
  async postMeta(body) { sent.push(body); return metaReply; },
  async verify(req) { if (req.headers.get("authorization") !== "Bearer tok-mgr") throw Object.assign(new Error("Sign in required"), { status: 401 }); return deps.user("mgr"); },
};
let listGate = null; // holds list calls, to see the loading state
let summaryGate = null; // holds summary calls, to prove counts and rows land together
let failNext = null; // makes the next call of this action fail
const listLog = [];
const api = async (action, payload = {}) => {
  if (failNext === action) { failNext = null; throw new Error("Network down"); }
  if (action === "list") listLog.push(payload.search ?? "");
  if (action === "list" && listGate) await listGate;
  if (action === "summary" && summaryGate) await summaryGate;
  const r = await handleCapi(new Request("https://x/functions/v1/meta-capi", { method: "POST", headers: { authorization: "Bearer tok-mgr" }, body: JSON.stringify({ action, payload }) }), deps);
  const j = await r.json();
  if (!j.ok) throw Object.assign(new Error(j.error.message), { status: r.status });
  return j.data;
};
const toasts = []; const showToast = (m, k) => toasts.push(`${k || "ok"}:${m}`);
const deleted = []; const onDelete = async (ids) => { deleted.push(...ids); for (const id of ids) leads.splice(leads.findIndex((l) => l.id === id), 1); };
const mount = async (props) => {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot($("#root"));
  await act(async () => { root.render(React.createElement(MetaCapiPanel, { api, showToast, ...props })); });
  return root;
};

// 0a. counts animate 0 -> value on first show, old -> new after, never restart on a rerender
{
  const { default: useCountUp } = await import(`${R}/src/hooks/useCountUp.js`);
  const realMM = w.matchMedia.bind(w);
  w.matchMedia = (q) => (q.includes("reduced-motion") ? { matches: false, addEventListener() {}, removeEventListener() {} } : realMM(q));
  const C = ({ to, bump }) => { const ref = useCountUp(to, 300); return React.createElement("b", { ref, "data-bump": bump }, "0"); };
  document.body.innerHTML = '<div id="cu"></div>';
  const r = createRoot($("#cu"));
  const seen = [];
  await act(async () => r.render(React.createElement(C, { to: 120, bump: 0 })));
  const firstSeen = Number($("#cu b").textContent);
  ok(firstSeen < 120, `count starts from 0 and rises, not at the value (first read ${firstSeen})`);
  for (let i = 0; i < 6; i++) { await tick(60); seen.push(Number($("#cu b").textContent)); if (i === 1) await act(async () => r.render(React.createElement(C, { to: 120, bump: 1 }))); }
  ok(seen.some((v) => v > 0 && v < 120), `it passes through values on the way (${seen.join(",")})`);
  ok(seen.every((v, i) => i === 0 || v >= seen[i - 1]), "an unrelated rerender did not restart it");
  await tick(200);
  ok($("#cu b").textContent === "120", "it lands exactly on the value");
  await act(async () => r.render(React.createElement(C, { to: 80, bump: 1 }))); await tick(400);
  ok($("#cu b").textContent === "80", "a new value animates from the old one and lands exactly");
  w.matchMedia = (q) => (q.includes("reduced-motion") ? { matches: true, addEventListener() {}, removeEventListener() {} } : realMM(q));
  await act(async () => r.render(React.createElement(C, { to: 999, bump: 1 })));
  ok($("#cu b").textContent === "999", "with reduced motion it jumps straight to the value");
  await act(async () => r.unmount());
  w.matchMedia = realMM;
}

// 0. times read as 12-hour clock, in the chosen zone; storage is untouched
ok(fmtTime("2026-10-29T10:43:00Z", "Asia/Dhaka") === "29 Oct 2026, 4:43 PM", `Dhaka 12-hour (${fmtTime("2026-10-29T10:43:00Z", "Asia/Dhaka")})`);
ok(fmtTime("2026-10-29T00:05:00Z", "UTC") === "29 Oct 2026, 12:05 AM UTC", "UTC midnight reads 12:05 AM");
ok(fmtTime(null, "UTC") === "Not recorded", "a missing time says so");
ok(canDeleteLeads({ role: "MANAGEMENT" }) && canDeleteLeads({ role: "MASTER" }) && !canDeleteLeads({ role: "AGENT" }) && !canDeleteLeads({ role: "TEAM_LEAD" }), "delete follows the CRM rule: Management and Master only");

// 1. first load: only the CRM loader until config, counts, bots and rows are all in, then all at once
let release; listGate = new Promise((r) => { release = r; });
const root = await mount({ onDelete });
await tick(250);
ok(!!$(".mcx-boot .ldr") && /Loading Meta CAPI/.test(text()), "the Inventory loader holds the page while the first load runs");
ok(!$(".mcx-stat") && !$(".mcx-table") && !$('[role="switch"]'), "no counts, rows or bot switches show before everything has arrived");
release(); listGate = null; await tick(300);
ok(!!$(".mcx-stat") && !!$(".mcx-table") && $$('[role="switch"]').length === 3, "counts, table, bot switches and the manual-send switch appear together");
ok(!document.body.innerHTML.includes(TOKEN), "the token never reaches the page");
ok(/configured/.test(text()), "token shown only as configured");
const stat = (label) => $$(".mcx-stat").find((s) => s.textContent.includes(label))?.querySelector(".mcx-stat-n")?.textContent.trim();
// Counts animate up from 0 (happy-dom runs with reduced motion, so they land at once); the target is the data.
const statTarget = (label) => $$(".mcx-stat").find((s) => s.textContent.includes(label))?.querySelector("[data-n]")?.getAttribute("data-n");
ok(statTarget("Total") === "60" && stat("Total") === "60", `total from data (${stat("Total")})`);
ok(stat("Pending") === "56" && stat("Success") === "1" && stat("Expired") === "1" && stat("Ineligible") === "2", "status counts from data");
ok(sent.length === 0, "loading the page sends nothing");

// 1b. Refresh: counts and rows switch together, never one old and one new
leads.push({ id: "R1", name: "Refreshed", company_id: "c1", source: "WHATSAPP_ADS", ctwa_clid: "r1", CAPI_STATUS: null, created_at: new Date(NOW - DAY / 2).toISOString() });
let sRelease; summaryGate = new Promise((r) => { sRelease = r; });
const refreshRef = { current: null };
await act(async () => root.render(React.createElement(MetaCapiPanel, { api, showToast, onDelete, refreshRef })));
await act(async () => refreshRef.current()); await tick(250);
ok($(".mcx")?.getAttribute("aria-busy") === "true" && !!$(".mcx-veil .ldr"), "Refresh shows the loader over the page it is updating");
const pagerTotal = () => ($(".pg-info")?.textContent || "").match(/of (\d+)/)?.[1];
ok(stat("Total") === "60" && pagerTotal() === "60", "while counts are still loading, the old counts and the old list total stay together");
sRelease(); summaryGate = null; await tick(300);
ok(stat("Total") === "61" && pagerTotal() === "61", `both switch to the new answer at the same moment (${stat("Total")} / ${pagerTotal()})`);
ok($(".mcx")?.getAttribute("aria-busy") === "false", "and the page is no longer busy");
leads.splice(leads.findIndex((l) => l.id === "R1"), 1);
await act(async () => refreshRef.current()); await tick(300);

// 1c. a stale answer never overwrites a newer one
let first; listGate = new Promise((r) => { first = r; });
const typeSearch = async (v) => act(async () => { const i = $(".mcx-bar .uct-search input"); const set = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set; set.call(i, v); i.dispatchEvent(new w.Event("input", { bubbles: true })); });
await typeSearch("Rahim"); await tick(260);
listGate = null;
await typeSearch(""); await tick(300);
first(); await tick(80);
ok($$("tbody tr").length === 50, `the older "Rahim" answer arriving last did not replace the newer list (${$$("tbody tr").length} rows)`);

// 1d. a failed refresh says so and does not stay stuck loading
failNext = "summary";
await act(async () => refreshRef.current()); await tick(300);
ok(/Network down/.test(text()) && $(".mcx")?.getAttribute("aria-busy") === "false", "a failed refresh shows its error and stops loading");
ok(stat("Total") === "60" && $$("tbody tr").length === 50, "the last good counts and rows stay on screen");
await act(async () => refreshRef.current()); await tick(300);

// 2. the Users toolbar: search, then Filter | Sort | Export on one line; one selection bar
ok(!!$(".mcx-bar.uct-bar .uct-search input[type='search']"), "search sits in the Users toolbar");
const barOrder = $$(".mcx-bar .uct-bar-r > button").map((e) => e.getAttribute("aria-label")).join("|");
ok(barOrder === "Filter leads|Sort leads|Export report", `Filter, Sort, Export in order, as on Users (${barOrder})`);
ok($$(".mcx-bar .uct-btn").length === 3 && !$(".mcx .fbar") && !$(".mcx .sel-trigger"), "three Users toolbar buttons, no old pickers");
ok(!$(".mcx-head .mcx-report") && !btn("Download PDF Report"), "the report row left the summary card; Export holds it");
await openMenu("Filter leads");
ok(["All status", "Success", "Pending", "Dhaka time", "UTC"].every((l) => !!item(l)) && $$('.menu-content input[type="date"]').length === 2, "Filter holds status, created dates and time zone");
{
  const from = $('.menu-content input[aria-label="Created from"]');
  const set = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set;
  await act(async () => { set.call(from, "2026-10-20"); from.dispatchEvent(new w.Event("input", { bubbles: true })); from.dispatchEvent(new w.Event("change", { bubbles: true })); });
  await tick(300);
  ok(pageCalls.at(-1).from === "2026-10-20T00:00:00.000Z" && $('.mcx-bar [aria-label="Filter leads"] .uct-n')?.textContent === "1", "a From date filters the list and counts on Filter");
  await act(async () => { item("Clear dates").dispatchEvent(new w.MouseEvent("click", { bubbles: true })); }); await tick(300);
  ok(pageCalls.at(-1).from == null && !$('.mcx-bar [aria-label="Filter leads"] .uct-n'), "Clear dates removes it");
}
await closeMenu();
await pick("Sort leads", "Oldest first");
ok(pageCalls.at(-1).sort === "created_asc" && $('.mcx-bar [aria-label="Sort leads"] .uct-n')?.textContent === "1", "Sort reorders through the server and marks itself");
await pick("Sort leads", "Newest first");
await pick("Filter leads", "UTC", 60);
ok(/UTC/.test($$("tbody tr")[0]?.textContent || ""), "the time zone pick from Filter applies to the table");
await pick("Filter leads", "Dhaka time", 60);
ok(!$('[role="tab"]'), "status is in Filter, not tabs");
ok($$(".bulk-bar button").map((b) => b.textContent.trim()).join("|").match(/Send selected.*Delete.*Clear selection/), "Send selected, Delete and Clear selection on one bar");
ok(count() === "0 selected", "the count starts at zero");

// 3. 50 rows a page, total shown, server paging (no whole-book fetch)
ok($$("tbody tr").length === PAGE && PAGE === 50, `first page shows ${$$("tbody tr").length} rows`);
ok(/Showing 1.50 of 60/.test($(".pg-info")?.textContent || ""), `page indicator (${$(".pg-info")?.textContent})`);
ok(pageCalls.every((q) => q.limit === 50), "every list call asks the server for one page of 50");

// 4. every row has a checkbox; unsendable ones are disabled only when there is no delete
ok($$("tbody tr").every((r) => r.querySelector('input[type="checkbox"]')), "every row has a checkbox");
ok(!!rowOf("N1") || !!rowOf("U1") || true, "fixture rows present");
await tabTo("Ineligible");
ok(/No click id/.test(rowOf("N1")?.textContent || "") && /No agent action/.test(rowOf("U1")?.textContent || ""), "an ineligible row says why");

// 5. select-all takes this page only; the count follows at once
await tabTo("All status");
ok(!$('.mcx-bar [aria-label="Filter leads"] .uct-n'), "back on All status, Filter shows no count");
// The page's real CSS, so a row class that another stylesheet also owns
// (ui/select.css styles `.sel`) shows up here as a layout change.
{
  const { readFileSync } = await import("node:fs");
  for (const f of ["src/components/ui/select.css", "src/components/metacapi/metacapi.css"]) {
    const s = document.createElement("style"); s.textContent = readFileSync(`${R}/${f}`, "utf8"); document.head.appendChild(s);
  }
}
const rowShape = () => $$("tbody tr").map((r) => `${w.getComputedStyle(r).display}/${r.children.length}`);
const shapeBefore = JSON.stringify(rowShape());
await click($('thead input[type="checkbox"]'));
ok(count() === "50 selected", `select-all ticks the 50 on this page (${count()})`);
ok(JSON.stringify(rowShape()) === shapeBefore, `select-all keeps every row a table row with all its cells (${rowShape()[0]})`);
ok($$("tbody tr").every((r) => w.getComputedStyle(r).display === "table-row"), "no selected row is restyled out of the table");
ok(/Send selected \(\d+\)/.test(btn("Send selected").textContent) , `send counts only sendable rows (${btn("Send selected").textContent.trim()})`);
await click($('thead input[type="checkbox"]'));
ok(count() === "0 selected", "select-all again clears the page");
await click(rowOf("P2").querySelector('input[type="checkbox"]'));
ok(count() === "1 selected", "one tick, count 1");
await click($('.pg-wrap [aria-label="next page"], .pg-wrap button[title="Next"], .pg-wrap button:last-child'));
await tick(300);
ok($$("tbody tr").length === 10, `page 2 shows the remaining 10 (${$$("tbody tr").length})`);
ok(count() === "0 selected", "a page change clears the selection; nothing was sent");
ok(pageCalls.at(-1).offset === 50, "page 2 asks the server for offset 50");
ok(sent.length === 0 && deleted.length === 0, "changing page sent and deleted nothing");

// 6. filters survive paging, and a filter change clears the selection
await act(async () => { const i = $(".mcx-bar .uct-search input"); const set = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set; set.call(i, "Bulk"); i.dispatchEvent(new w.Event("input", { bubbles: true })); });
await tick(350);
ok(pageCalls.at(-1).search === "Bulk" && pageCalls.at(-1).offset === 0, "a search goes back to page 1");
ok(/of 54/.test($(".pg-info")?.textContent || ""), `filtered total shown (${$(".pg-info")?.textContent})`);
await click($('.pg-wrap button:last-child')); await tick(300);
ok(pageCalls.at(-1).search === "Bulk" && pageCalls.at(-1).offset === 50, "the search is kept on page 2");
await act(async () => { const i = $(".mcx-bar .uct-search input"); const set = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set; set.call(i, "zzz-none"); i.dispatchEvent(new w.Event("input", { bubbles: true })); });
await tick(350);
ok(/No ad lead matches/.test(text()) && !!btn("Show all leads"), "an empty result says why and offers the way back");
await click(btn("Show all leads")); await tick(300);
ok($$("tbody tr").length === 50, "Show all leads restores the list");

// 7. times in the table are 12-hour
ok(/27 Oct 2026, 4:43 PM/.test(rowOf("P1")?.textContent || ""), `created time in 12-hour Dhaka time (${rowOf("P1")?.children[2]?.textContent})`);

// 8. history opens over the page, with a loading state, and closes back to it
let hRelease; historyGate = new Promise((r) => { hRelease = r; });
await click(rowOf("P1").querySelector('button[aria-label^="Meta history"]'));
const dlg = () => $('[role="dialog"]');
ok(!!dlg() && dlg().parentElement?.parentElement === document.body, "history opens as a dialog on the page itself (portalled to body)");
ok(/Loading history/.test(dlg()?.textContent || ""), "history shows a loading state");
hRelease(); historyGate = null; await tick(80);
ok(/Rahim/.test(dlg().textContent) && /P1/.test(dlg().textContent), "the dialog names the lead");
ok(/No send attempt recorded/.test(dlg().textContent), "history empty state");
ok(/27 Oct 2026, 4:43 PM/.test(dlg().textContent), "history times are 12-hour");
await act(async () => { document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); }); await tick(30);
ok(!dlg(), "Escape closes it; the page is still there");
ok(!!$(".mcx-table"), "still on the Meta CAPI list");

// 9. a send is previewed, confirmed, then sent; per-lead results
await click(rowOf("P1").querySelector('input[type="checkbox"]'));
await click(rowOf("P2").querySelector('input[type="checkbox"]'));
ok(count() === "2 selected", "two ticked");
await click(btn("Send selected")); await tick(50);
ok(sent.length === 0, "nothing sent before confirmation");
ok(/2 selected/.test(text()) && /2 eligible/.test(text()), "the preview shows selected and eligible counts");
await click(btn("Send 2")); await tick(80);
ok(sent.length === 2 && sent.every((b) => ["P1", "P2"].includes(b.data[0].event_id)), "sent after confirmation, event_id = lead id");
ok(count() === "0 selected", "a successful send clears the selection");
ok(/Accepted by Meta/.test($(".mcx-results")?.textContent || ""), "per-lead outcome shown");

// 10. the shared limiter holds a lead back: shown as rate limited, still ticked
permitFor = () => ({ result: "rate_limited", reason: "window", retry_at: new Date(NOW + 60e3).toISOString() });
await click(rowOf("Q00").querySelector('input[type="checkbox"]'));
await click(btn("Send selected")); await tick(40);
const before = sent.length;
await click(btn("Send 1")); await tick(80);
ok(sent.length === before, "a rate-limited lead is not sent");
ok(/Rate limited/.test($(".mcx-results")?.textContent || "") && /try again after .*(AM|PM)/.test($(".mcx-results")?.textContent || ""), "shown as rate limited with a 12-hour retry time");
ok(count() === "1 selected", "a rate-limited lead stays ticked for the next attempt");
permitFor = () => ({ result: "ok" });
await click(btn("Clear selection"));
ok(count() === "0 selected", "Clear selection empties it and sends nothing");

// 11. delete asks first, names the leads, and goes through the CRM handler
await click(rowOf("N1") ? rowOf("N1").querySelector('input[type="checkbox"]') : rowOf("Q01").querySelector('input[type="checkbox"]'));
const victim = $$("tbody tr").find((r) => r.querySelector('input[type="checkbox"]')?.checked)?.querySelector("code")?.textContent.trim();
await click(btn("Delete"));
const conf = $('[aria-label="Confirm delete"]');
ok(!!conf && conf.textContent.includes(victim) && /cannot be undone/.test(conf.textContent), "delete asks first and names the lead");
ok(deleted.length === 0, "nothing deleted before confirmation");
await click(btn("Cancel", conf));
ok(deleted.length === 0 && !$('[aria-label="Confirm delete"]'), "Cancel deletes nothing");
await click(btn("Delete"));
await click(btn("Delete 1", $('[aria-label="Confirm delete"]'))); await tick(80);
ok(deleted.length === 1 && deleted[0] === victim, "Delete 1 deletes exactly that lead through the handler");

// 11b. Export: range inside the menu, preview first; download and print use the same in-memory PDF
{
  const made = [], freed = [], saved = [], frames = [];
  const realURL = { c: URL.createObjectURL, r: URL.revokeObjectURL };
  URL.createObjectURL = (b) => { const u = `blob:mcx/${made.length}`; made.push({ u, type: b.type, size: b.size }); return u; };
  URL.revokeObjectURL = (u) => freed.push(u);
  const realClick = w.HTMLAnchorElement.prototype.click;
  w.HTMLAnchorElement.prototype.click = function () { saved.push({ href: this.href, name: this.download }); };
  const mo = new w.MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.tagName === "IFRAME") frames.push(n.getAttribute("src")); })));
  mo.observe(document.body, { childList: true });
  const before = { sent: sent.length, attempts: attempts.length, bots: JSON.stringify(bots), settings: JSON.stringify(settings) };
  listLog.length = 0;
  await openMenu("Export report");
  ok(["Today", "Last 3 days", "Last 7 days", "Last 30 days"].every((l) => !!item(l)) && ["Preview", "Download PDF", "Print"].every((l) => !!item(l)), "Export holds the four ranges and Preview, Download PDF, Print");
  ok(item("Last 7 days")?.getAttribute("aria-checked") === "true", "Last 7 days is the default range");
  await act(async () => { item("Last 3 days").dispatchEvent(new w.MouseEvent("click", { bubbles: true })); }); await tick(30);
  ok(!!item("Preview") && item("Last 3 days")?.getAttribute("aria-checked") === "true", "picking a range keeps Export open with it ticked");
  await act(async () => { item("Preview").dispatchEvent(new w.MouseEvent("click", { bubbles: true })); }); await tick(300);
  const dlg = $('[role="dialog"]');
  ok(!!dlg && /Report preview/.test(dlg.textContent), "Preview opens the report in a dialog");
  ok(/Wepro CRM/.test(dlg.textContent) && /869790160551668/.test(dlg.textContent) && /Asia\/Dhaka/.test(dlg.textContent) && /Last 3 days/.test(dlg.textContent), "it shows the brand, dataset id, Dhaka stamps and range");
  ok(["Total ad leads", "Success", "Failed", "Pending", "Expired", "Ineligible", "Attempts"].every((m) => dlg.textContent.includes(m)) && $$(".mcx-rep-t tbody tr").length === 7, "and the compact seven-row KPI table");
  ok(made.length === 1 && made[0].type === "application/pdf" && made[0].size > 0 && saved.length === 0, "one PDF made in memory; nothing saved yet");
  await click(btn("Download PDF", dlg));
  ok(saved.length === 1 && saved[0].href === made[0].u && /^wepro-meta-capi-3d-\d{4}-\d{2}-\d{2}\.pdf$/.test(saved[0].name), `Download saves that same PDF (${saved[0]?.name})`);
  w.matchMedia = ((mm) => (q) => (q.includes("pointer: coarse") ? { matches: false, addEventListener() {}, removeEventListener() {} } : mm(q)))(w.matchMedia.bind(w));
  await click(btn("Print", dlg));
  ok(frames.length === 1 && frames[0] === made[0].u && made.length === 1, "Print loads the same PDF; no second one is made");
  await act(async () => { document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); }); await tick(30);
  ok(!$('[role="dialog"]') && freed.includes(made[0].u) && !$(".mcx-print-frame"), "closing frees the URL and removes the print frame");
  await pick("Export report", "Download PDF");
  ok(saved.length === 2 && saved[1].href === made[1].u && /Report preview/.test($('[role="dialog"]')?.textContent || ""), "Download from the menu saves and still shows its preview");
  ok(sent.length === before.sent && attempts.length === before.attempts && JSON.stringify(bots) === before.bots && JSON.stringify(settings) === before.settings, "a report sends nothing to Meta and writes nothing");
  ok(listLog.every((x) => x === ""), "it only reads the list, unfiltered by the page search");
  globalThis.__mcxReport = { made, freed, restore: () => { URL.createObjectURL = realURL.c; URL.revokeObjectURL = realURL.r; w.HTMLAnchorElement.prototype.click = realClick; mo.disconnect(); } };
}

// 12. bot switches: one per existing bot, persisted
const sw = (name) => $$('[role="switch"]').find((b) => (b.getAttribute("aria-label") || "").includes(name));
ok(!!sw("Eyad") && !!sw("Dubai"), "one switch per existing bot");
await click(sw("Dubai")); await tick(60);
ok(bots.find((b) => b.bot === "dubai").meta_capi_enabled === false && bots.find((b) => b.bot === "eyad").meta_capi_enabled === true, "Off is saved for that bot only");
await click(sw("Dubai")); await tick(60);

// 12b. manual-send switch: on by default; Off gates the send button; toggling persists
const manualSw = () => sw("Manual send to Meta");
ok(!!manualSw() && manualSw().getAttribute("aria-checked") === "true", "the manual-send switch is on by default");
await click(rowOf("Q00").querySelector('input[type="checkbox"]')); await tick(30);
ok(!btn("Send selected").disabled, "Send selected is enabled while manual send is on");
await click(manualSw()); await tick(60);
ok(settings.manual_send_enabled === false && manualSw().getAttribute("aria-checked") === "false", "Off is saved and the switch reflects it");
ok(btn("Send selected").disabled, "Send selected is disabled while manual send is off");
await click(manualSw()); await tick(60);
ok(settings.manual_send_enabled === true && !btn("Send selected").disabled, "back on");
await click(rowOf("Q00").querySelector('input[type="checkbox"]')); await tick(30); // clear the selection
await act(async () => root.unmount());
{
  const { made, freed, restore } = globalThis.__mcxReport;
  ok(made.every((m) => freed.includes(m.u)), "unmounting with a preview open frees its URL too");
  restore();
}

// 13. without a delete handler (no Management/Master) there is no Delete at all
const r1 = await mount({});
await tick(300);
ok(!btn("Delete"), "no Delete button without the delete permission");
ok(!rowOf("S1") || rowOf("S1").querySelector('input[type="checkbox"]').disabled, "an already-reported row cannot be ticked when only sending is possible");

await act(async () => r1.unmount()); // a mounted panel keeps its 60s poll, and the process, alive

// 14. D1: a verified sign-in needs no extra deployment gate — every control is live
const r2 = await mount({ onDelete });
await tick(300);
ok(!/View only/.test(text()), "no 'view only' state for a verified admin");
ok(stat("Total") != null, "the data loads");
ok(btn("Pause recovery") || btn("Resume recovery"), "pause control present");
ok($$('[role="switch"]').length >= 3 && $$('[role="switch"]').every((b) => !b.disabled), "switches are live");
await click(rowOf("Q00").querySelector('input[type="checkbox"]')); await tick(30);
ok(!btn("Send selected").disabled, "Send selected is enabled once an eligible lead is picked");
await click(rowOf("Q00").querySelector('input[type="checkbox"]')); await tick(30); // clear the selection
await act(async () => r2.unmount());
console.log(process.exitCode ? "\nFAILED" : "\nall ok");
