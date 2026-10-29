// npm run test:ui:metacapi — mounts the real MetaCapiPanel in happy-dom, wired
// to the real meta-capi handler (capi-core.ts) with an in-memory store and a
// scripted Meta. Checks the dashboard figures, the status tabs, the history
// drawer, and that a batch retry is previewed and confirmed before anything is
// sent. No network, no real token, no production data.
import { Window } from "happy-dom";
const w = new Window({ url: "http://localhost/", settings: { device: { prefersReducedMotion: "reduce" } } });
for (const k of ["document", "navigator", "HTMLElement", "Element", "Node", "Event", "CustomEvent", "KeyboardEvent", "MouseEvent", "PointerEvent", "FocusEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "ResizeObserver", "IntersectionObserver", "MutationObserver", "matchMedia", "DOMRect", "HTMLButtonElement", "HTMLInputElement", "HTMLSelectElement", "SVGElement", "localStorage", "sessionStorage", "DocumentFragment", "ShadowRoot", "Text", "HTMLTextAreaElement"]) {
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

const ok = (cond, msg) => { if (!cond) { console.log("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); };
const tick = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const btn = (label) => $$("button").find((b) => b.textContent.trim().includes(label));
const click = async (el) => { await act(async () => { el.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); }); await tick(30); };
const text = () => document.body.textContent;

// ── an in-memory world behind the real handler ──────────────────────────────
const NOW = Date.parse("2026-10-29T11:00:00Z"), DAY = 864e5;
const TOKEN = "EAA-ui-SECRET";
// qualified: an agent marked it Connected or Interested (capi_lead_status, 0051).
const leads = [
  { id: "P1", name: "Rahim", company_id: "c1", source: "WHATSAPP_ADS", ctwa_clid: "k1", CAPI_STATUS: null, created_at: new Date(NOW - 2 * DAY).toISOString() },
  { id: "P2", name: "Karim", company_id: "c1", source: "WHATSAPP_ADS", ctwa_clid: "k2", CAPI_STATUS: null, created_at: new Date(NOW - 3 * DAY).toISOString() },
  { id: "U1", name: "Unmarked", company_id: "c1", source: "WHATSAPP_ADS", ctwa_clid: "k5", CAPI_STATUS: null, qualified: false, created_at: new Date(NOW - DAY).toISOString() },
  { id: "S1", name: "Salma", company_id: "c1", source: "WHATSAPP_ADS", ctwa_clid: "k3", CAPI_STATUS: "LeadSubmitted", created_at: new Date(NOW - 20 * DAY).toISOString() },
  { id: "X1", name: "Old", company_id: "c1", source: "WHATSAPP_ADS", ctwa_clid: "k4", CAPI_STATUS: null, created_at: new Date(NOW - 9 * DAY).toISOString() },
  { id: "N1", name: "NoClick", company_id: "c1", source: "WHATSAPP_ADS", ctwa_clid: null, CAPI_STATUS: null, created_at: new Date(NOW - DAY).toISOString() },
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
const deps = {
  now: () => NOW, token: () => TOKEN,
  async user(id) { return id === "mgr" ? { id, role: "MANAGEMENT", is_active: true, company_id: "c1", allowed_features: null } : null; },
  async lead(id) { const l = leads.find((x) => x.id === id); return l ? { id: l.id, company_id: l.company_id, created_at: l.created_at, ctwa_clid: l.ctwa_clid, capi_status_column: l.CAPI_STATUS, qualified: l.qualified !== false, unsure: unsureOf(l.id) } : null; },
  async page(q) { let rs = leads.map(row); if (q.status !== "all") rs = rs.filter((r) => r.status === q.status); return { rows: rs.slice(q.offset, q.offset + q.limit), total: rs.length }; },
  async summary() { const by = {}; for (const l of leads) by[statusOf(l)] = (by[statusOf(l)] || 0) + 1;
    return { total: leads.length, by_status: by, attempts: attempts.length, accepted_attempts: attempts.filter((a) => a.outcome === "accepted").length,
      last_accepted_at: attempts.filter((a) => a.outcome === "accepted").at(-1)?.attempted_at ?? null,
      oldest_pending: (() => { const p = leads.filter((l) => ["pending", "failed"].includes(statusOf(l))).sort((a, b) => a.created_at.localeCompare(b.created_at))[0]; return p ? { id: p.id, created_at: p.created_at, cutoff_at: new Date(Date.parse(p.created_at) + 7 * DAY).toISOString() } : null; })() }; },
  async history(id) { return attempts.filter((a) => a.lead_id === id).slice().reverse(); },
  async acquire(id) { return permitFor(id); }, async unlock() {}, async throttle() { return new Date(NOW + 60e3).toISOString(); },
  async bots() { return bots.map((b) => ({ ...b })); },
  async setBot(bot, on) { const b = bots.find((x) => x.bot === bot); if (!b) return null; b.meta_capi_enabled = on; return { bot, meta_capi_enabled: on }; },
  async record(a) { const n = attempts.filter((x) => x.lead_id === a.lead_id).length + 1; attempts.push({ ...a, attempt_no: n, attempted_at: new Date(NOW).toISOString() }); if (a.outcome === "accepted") leads.find((l) => l.id === a.lead_id).CAPI_STATUS = "LeadSubmitted"; return { attempt_no: n }; },
  async settings() { return settings; }, async saveSettings(p) { Object.assign(settings, p); },
  async postMeta(body) { sent.push(body); return metaReply; },
  allowUnverifiedActor: () => allowSend,
};
let allowSend = true;
const calls = [];
const api = async (action, payload = {}) => {
  calls.push(action);
  const r = await handleCapi(new Request("https://x/functions/v1/meta-capi", { method: "POST", body: JSON.stringify({ action, payload, userId: "mgr" }) }), deps);
  const j = await r.json();
  if (!j.ok) throw Object.assign(new Error(j.error.message), { status: r.status });
  return j.data;
};
const toasts = []; const showToast = (m, k) => toasts.push(`${k || "ok"}:${m}`);

document.body.innerHTML = '<div id="root"></div>';
const root = createRoot($("#root"));
await act(async () => { root.render(React.createElement(MetaCapiPanel, { api, showToast })); });
await tick(300);

// 1. dashboard, from the data
ok(text().includes("Configured"), "token shown only as configured");
ok(!document.body.innerHTML.includes(TOKEN), "the token never reaches the page");
const stat = (label) => $$(".mc-stat").find((s) => s.textContent.includes(label))?.querySelector(".mc-stat-n")?.textContent.trim();
ok(stat("Total") === "6", `total from data (${stat("Total")})`);
ok(stat("Pending") === "2" && stat("Success") === "1" && stat("Expired") === "1" && stat("Ineligible") === "2", "status counts from data");
ok(text().includes("Not recorded"), "no invented time where nothing was logged");
ok(sent.length === 0 && !calls.includes("retry"), "loading the page sends nothing");

// 2. status tabs filter on the server
const tabs = $$('[role="tab"]').map((t) => t.textContent.trim());
ok(["All", "Success", "Failed", "Pending", "Expired", "Ineligible"].every((l) => tabs.some((t) => t.includes(l))), `tabs: ${tabs.join(", ")}`);
await click($$('[role="tab"]').find((t) => t.textContent.includes("Pending")));
await tick(300);
const ids = () => $$("tbody tr").map((r) => r.querySelector("td:nth-child(2)")?.textContent.trim());
ok(JSON.stringify(ids().sort()) === JSON.stringify(["P1", "P2"]), `pending rows (${ids()})`);

// 3. select-all takes every sendable row on the page; the count follows; a batch is previewed, then confirmed, then sent
const all = () => $('thead input[type="checkbox"]');
ok(!!all(), "a select-all checkbox heads the table");
await click(all());
ok(/2 selected/.test($(".mc-bulk")?.textContent || ""), `selected count shown (${$(".mc-bulk")?.textContent})`);
ok($$('tbody input[type="checkbox"]').every((c) => c.checked), "every sendable row is ticked");
await click(all());
ok(!/selected/.test($(".mc-bulk")?.textContent || "") || /0 selected/.test($(".mc-bulk").textContent), "select-all again clears the selection");
await click(all());
await click(btn("Send selected"));
await tick(50);
ok(sent.length === 0, "nothing sent before confirmation");
ok(/2 selected/.test(text()) && /2 eligible/.test(text()), "the preview shows selected and eligible counts");
await click(btn("Send 2"));
await tick(80);
ok(sent.length === 2, `sent after confirmation (${sent.length})`);
ok(sent.every((b) => b.data[0].event_id === b.data[0].event_id && ["P1", "P2"].includes(b.data[0].event_id)), "event_id = lead id");
ok(/accepted/i.test(text()), "per-lead outcome shown");

// 4. history drawer shows the attempt and Meta's answer, and the lead is now a success
await click($$('[role="tab"]').find((t) => t.textContent.includes("Success")));
await tick(300);
await click($$("tbody tr").find((r) => r.textContent.includes("P1")).querySelector("button"));
await tick(50);
const drawer = $('[role="dialog"]');
ok(drawer && /fbt-ok/.test(drawer.textContent) && /200/.test(drawer.textContent), "history shows HTTP status and fbtrace_id");

// 4b. a lead no agent marked is shown as not eligible and can never be ticked
await click($$('[role="tab"]').find((t) => t.textContent.includes("Ineligible")));
await tick(300);
const u1 = $$("tbody tr").find((r) => r.textContent.includes("U1"));
ok(!!u1 && !u1.querySelector('input[type="checkbox"]'), "an unqualified lead has no checkbox");
ok(/No agent action/i.test(u1?.textContent || ""), `the row says why (${u1?.textContent})`);

// 5. Meta rejects: recorded as failed with its code; the lead is not marked reported
metaReply = { status: 400, json: { error: { code: 190, error_subcode: 464, type: "OAuthException", message: "Error validating access token", fbtrace_id: "fbt-bad" } } };
await click($('[role="dialog"] .m-x'));
ok(!$('[role="dialog"]'), "the history drawer closes");
await click($$('[role="tab"]').find((t) => t.textContent.includes("All")));
await tick(300);
const p2row = () => $$("tbody tr").find((r) => r.textContent.includes("P2"));
leads.find((l) => l.id === "P2").CAPI_STATUS = null; attempts.splice(0, attempts.length, ...attempts.filter((a) => a.lead_id !== "P2"));
await click(btn("Refresh"));
await tick(300);
ok(!!p2row()?.querySelector('input[type="checkbox"]'), "a reset lead is selectable again");
await click(p2row().querySelector('input[type="checkbox"]'));
await click(btn("Send selected")); await tick(40);
await click(btn("Send 1")); await tick(80);
ok(/190/.test(text()) && /rejected/i.test(text()), "a rejection shows Meta's code");
ok(leads.find((l) => l.id === "P2").CAPI_STATUS === null, "a rejected lead stays unreported");

// 5b. single-lead retry from the history drawer, and both clocks shown at once
metaReply = { status: 200, json: { events_received: 1, fbtrace_id: "fbt-one" } };
const before = sent.length;
await click($$("tbody tr").find((r) => r.textContent.includes("P2")).querySelector('button[aria-label^="History"]'));
await tick(80);
const d2 = $('[role="dialog"]');
ok(/UTC/.test(d2.textContent) && /Dhaka/.test(d2.textContent), "times shown in UTC and Dhaka together");
const one = [...d2.querySelectorAll("button")].find((b) => b.textContent.includes("Retry this lead"));
ok(!!one, "single-lead retry offered for an eligible lead");
await click(one); await tick(60);
ok(sent.length === before, "single retry is previewed first, not sent");
await click([...$('[role="dialog"]').querySelectorAll("button")].find((b) => b.textContent.includes("Send 1"))); await tick(80);
ok(sent.length === before + 1 && sent.at(-1).data[0].event_id === "P2", "single retry sends exactly that lead after confirmation");
await click($('[role="dialog"] .m-x'));

// 5c. the shared limiter holds a lead back: shown per lead as rate limited, nothing sent
leads.find((l) => l.id === "P2").CAPI_STATUS = null; attempts.splice(0, attempts.length, ...attempts.filter((a) => a.lead_id !== "P2"));
permitFor = () => ({ result: "rate_limited", reason: "window", retry_at: new Date(NOW + 60e3).toISOString() });
await click(btn("Refresh")); await tick(300);
const sentBefore = sent.length;
await click(p2row().querySelector('input[type="checkbox"]'));
await click(btn("Send selected")); await tick(40);
await click(btn("Send 1")); await tick(80);
ok(sent.length === sentBefore, "a rate-limited lead is not sent");
ok(/rate limit/i.test($(".mc-results")?.textContent || ""), `per-lead outcome says rate limited (${$(".mc-results")?.textContent})`);
permitFor = () => ({ result: "ok" });

// 5d. bot switches: one per existing bot, persisted, and the page says what Off means
const sw = (name) => $$('[role="switch"]').find((b) => (b.getAttribute("aria-label") || "").includes(name));
ok(!!sw("Eyad") && !!sw("Dubai"), "one switch per existing bot");
ok(sw("Dubai").getAttribute("aria-checked") === "true", "starts from the saved value");
await click(sw("Dubai")); await tick(60);
ok(bots.find((b) => b.bot === "dubai").meta_capi_enabled === false, "Off is saved for that bot only");
ok(bots.find((b) => b.bot === "eyad").meta_capi_enabled === true, "the other bot is untouched");
ok(sw("Dubai").getAttribute("aria-checked") === "false", "the switch shows the saved state");
await click(sw("Dubai")); await tick(60);
ok(bots.find((b) => b.bot === "dubai").meta_capi_enabled === true, "and back on");

root.unmount();

// 6. D1: with no verified sign-in, the page shows the data but no send or pause control works
allowSend = false; sent.length = 0;
document.body.innerHTML = '<div id="root"></div>';
const root2 = createRoot($("#root"));
await act(async () => { root2.render(React.createElement(MetaCapiPanel, { api, showToast })); });
await tick(300);
ok(/verified sign-in/i.test(text()), "the page says why sending is off");
ok(stat("Total") === "6", "the data still loads");
ok(!btn("Pause recovery") && !btn("Resume recovery"), "no pause control");
ok(!btn("Send selected") || btn("Send selected").disabled === true, "send is disabled");
ok($$('tbody input[type="checkbox"]').length === 0 && !$('thead input[type="checkbox"]'), "no lead can be selected");
ok($$('[role="switch"]').length === 2 && $$('[role="switch"]').every((b) => b.disabled), "bot switches show their state but cannot be changed");
ok(sent.length === 0, "nothing sent");
root2.unmount();
console.log(process.exitCode ? "\nFAILED" : "\nall ok");
