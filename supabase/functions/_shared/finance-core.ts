// Finance core — every read and write of the finance_* tables, behind one
// request handler. Web-standard code only (fetch, Request, Response, crypto):
// no Deno globals, so the same file runs in the Edge Function and under Node
// in the test harness.
//
// Trust model: the caller names a userId; the users table says whether that
// account may use Inventory (role MANAGEMENT, or an allowed_features grant of
// 'inventory'). Every row is read and written with the service role and scoped
// to the actor's company. Figures (amount / committed / spent / remaining) are
// computed HERE and handed to the browser ready-made, so there is one
// definition of each number.
//
// Budgets have no approval step (migration 0024): a budget's amount is its
// envelope from the moment it is saved. The old request/approval tables are
// kept as history and no longer written.

import { renderStatement, TEMPLATES, CURRENCIES } from "../../../Invoice-templates/index.js";

export type Env = { url: string; serviceKey: string; allowedOrigin?: string };

type Row = Record<string, any>;
type Actor = { id: string; name: string; role: string; companyId: string };
type Ctx = { env: Env; actor: Actor; db: Db; reqUrl: URL };

const EXPENSE_KINDS = ["COMMITTED", "PAID"];
const ENTITY_TYPES = ["budget", "expense", "invoice"];
const UPLOAD_MIMES = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
const MAX_UPLOAD = 10 * 1024 * 1024;
const BUCKET = "finance-media";
const SIGN_SECONDS = 3600;

class Fail extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

const rid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);
const nowIso = () => new Date().toISOString();
const enc = encodeURIComponent;
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const str = (v: unknown, max = 2000) => String(v ?? "").slice(0, max);
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

// ── PostgREST + Storage with the service role ────────────────────────────────
class Db {
  env: Env;
  constructor(env: Env) { this.env = env; }
  private h(extra: Record<string, string> = {}) {
    return { apikey: this.env.serviceKey, Authorization: `Bearer ${this.env.serviceKey}`, "Content-Type": "application/json", ...extra };
  }
  async select(path: string): Promise<Row[]> {
    const r = await fetch(`${this.env.url}/rest/v1/${path}`, { headers: this.h() });
    if (!r.ok) throw new Fail(502, `Database read failed (${r.status})`);
    return r.json();
  }
  async insert(table: string, rows: Row[]): Promise<Row[]> {
    const r = await fetch(`${this.env.url}/rest/v1/${table}`, { method: "POST", headers: this.h({ Prefer: "return=representation" }), body: JSON.stringify(rows) });
    if (r.status === 409) throw new Fail(409, await conflictMessage(r));
    if (!r.ok) throw new Fail(502, `Database write failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
    return r.json();
  }
  async patch(table: string, filter: string, patch: Row): Promise<Row[]> {
    const r = await fetch(`${this.env.url}/rest/v1/${table}?${filter}`, { method: "PATCH", headers: this.h({ Prefer: "return=representation" }), body: JSON.stringify(patch) });
    if (r.status === 409) throw new Fail(409, await conflictMessage(r));
    if (!r.ok) throw new Fail(502, `Database update failed (${r.status})`);
    return r.json();
  }
  async del(table: string, filter: string): Promise<void> {
    const r = await fetch(`${this.env.url}/rest/v1/${table}?${filter}`, { method: "DELETE", headers: this.h({ Prefer: "return=minimal" }) });
    if (!r.ok) throw new Fail(502, `Database delete failed (${r.status})`);
  }
  async upload(path: string, bytes: Uint8Array, mime: string): Promise<void> {
    const r = await fetch(`${this.env.url}/storage/v1/object/${BUCKET}/${path}`, {
      method: "POST", headers: { apikey: this.env.serviceKey, Authorization: `Bearer ${this.env.serviceKey}`, "Content-Type": mime, "x-upsert": "false" }, body: bytes,
    });
    if (!r.ok) throw new Fail(502, `Upload failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
  }
  async signedUrl(path: string): Promise<string> {
    const r = await fetch(`${this.env.url}/storage/v1/object/sign/${BUCKET}/${path}`, { method: "POST", headers: this.h(), body: JSON.stringify({ expiresIn: SIGN_SECONDS }) });
    if (!r.ok) throw new Fail(502, `Could not sign the file link (${r.status})`);
    const j = await r.json();
    return `${this.env.url}/storage/v1${j.signedURL}`;
  }
}
async function conflictMessage(r: Response) {
  const t = await r.text();
  if (/one_final_per_expense/.test(t)) return "One of these expenses is already on a final statement";
  if (/company_number_key/.test(t)) return "Another statement took that number just now. Save again";
  return "That change conflicts with an existing record";
}

// ── the actor ────────────────────────────────────────────────────────────────
async function loadActor(db: Db, userId: unknown): Promise<Actor> {
  if (!userId || typeof userId !== "string") throw new Fail(401, "Sign in required");
  const rows = await db.select(`users?id=eq.${enc(userId)}&select=id,name,role,is_active,company_id,allowed_features`);
  const u = rows[0];
  if (!u || u.is_active === false) throw new Fail(401, "Unknown or inactive account");
  const af = Array.isArray(u.allowed_features) ? u.allowed_features : null;
  // Same rule as canSee() in the browser: a saved feature list overrides the role default.
  const canSee = af ? af.includes("inventory") : u.role === "MANAGEMENT";
  if (!canSee) throw new Fail(403, "Inventory is not enabled for this account");
  if (!u.company_id) throw new Fail(403, "This account belongs to no company");
  return { id: u.id, name: u.name || "", role: u.role, companyId: u.company_id };
}

// ── figures: the one definition of each number ───────────────────────────────
export type Figures = { amount: number; committed: number; spent: number; remaining: number; overrun: boolean };
export function figuresFor(budget: Row, expenses: Row[]): Figures {
  const amount = num(budget.draft_amount);
  let committed = 0, spent = 0;
  for (const e of expenses) {
    if (e.budget_id !== budget.id) continue;
    if (e.kind === "COMMITTED") committed += num(e.amount); else spent += num(e.amount);
  }
  const remaining = amount - committed - spent;
  return { amount, committed, spent, remaining, overrun: committed + spent > amount };
}

const publicBase = (ctx: Ctx) => ctx.env.url ? `${ctx.env.url.replace(/\/+$/, "")}/functions/v1/finance` : `${ctx.reqUrl.origin}${ctx.reqUrl.pathname}`;

// ── helpers ──────────────────────────────────────────────────────────────────
const co = (ctx: Ctx) => `company_id=eq.${enc(ctx.actor.companyId)}`;

async function one(ctx: Ctx, table: string, id: unknown): Promise<Row> {
  if (!id || typeof id !== "string") throw new Fail(400, "Missing id");
  const rows = await ctx.db.select(`${table}?id=eq.${enc(id)}&${co(ctx)}&select=*`);
  if (!rows[0]) throw new Fail(404, "Not found");
  return rows[0];
}

async function logEvent(ctx: Ctx, entityType: string, entityId: string, action: string, data: Row = {}) {
  await ctx.db.insert("finance_events", [{
    id: "fe_" + rid(), company_id: ctx.actor.companyId, entity_type: entityType, entity_id: entityId, action, data,
    user_id: ctx.actor.id, user_name: ctx.actor.name, at: nowIso(),
  }]);
}

async function notify(ctx: Ctx, userIds: string[], type: string, message: string) {
  const ids = [...new Set(userIds.filter((id) => id && id !== ctx.actor.id))];
  if (!ids.length) return;
  await ctx.db.insert("notifications", ids.map((user_id) => ({
    id: "n" + rid(), user_id, type, message, lead_id: null, is_read: false, created_at: nowIso(), company_id: ctx.actor.companyId,
  })));
}

const diff = (before: Row, after: Row, keys: string[]) => {
  const d: Row = {};
  for (const k of keys) if (JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null)) d[k] = { from: before[k] ?? null, to: after[k] ?? null };
  return d;
};

// ── actions ──────────────────────────────────────────────────────────────────
async function load(ctx: Ctx) {
  const c = co(ctx);
  const [budgets, expenses, invoices, lines, comments, events] = await Promise.all([
    ctx.db.select(`finance_budgets?${c}&select=*&order=created_at.desc`),
    ctx.db.select(`finance_expenses?${c}&select=*&order=spent_on.desc`),
    ctx.db.select(`finance_invoices?${c}&select=*&order=created_at.desc`),
    ctx.db.select(`finance_invoice_lines?${c}&select=*&order=position.asc`),
    ctx.db.select(`finance_comments?${c}&select=*&order=created_at.asc`),
    ctx.db.select(`finance_events?${c}&select=*&order=at.desc&limit=1000`),
  ]);
  const figures: Record<string, Figures> = {};
  for (const b of budgets) figures[b.id] = figuresFor(b, expenses);
  // The share links point at this function's public address. req.url inside the
  // Edge runtime is the internal one (http, no /functions/v1), so build from env.
  const shareBase = publicBase(ctx);
  return { actor: { id: ctx.actor.id }, budgets, expenses, invoices, lines, comments, events, figures, shareBase };
}

const BUDGET_FIELDS = ["title", "purpose", "notes", "projects", "team_id", "team_name", "draft_amount"];
function budgetPatchFrom(b: Row): Row {
  const title = str(b.title, 160).trim();
  if (!title) throw new Fail(400, "A budget needs a title");
  const draft_amount = num(b.draftAmount);
  if (draft_amount < 0) throw new Fail(400, "The amount can't be negative");
  // Several projects per budget; property_id / property_name keep the first for older readers.
  const seen = new Set<string>();
  const projects = (Array.isArray(b.projects) ? b.projects : []).slice(0, 50)
    .map((p: Row) => ({ id: str(p?.id, 80), name: str(p?.name, 160) }))
    .filter((p: Row) => p.id && !seen.has(p.id) && seen.add(p.id));
  return {
    title, purpose: str(b.purpose), notes: str(b.notes, 4000), draft_amount, projects,
    property_id: projects[0]?.id ?? null, property_name: projects[0]?.name ?? "",
    team_id: b.teamId ? str(b.teamId, 80) : null, team_name: str(b.teamName, 160),
  };
}
async function budgetSave(ctx: Ctx, body: Row) {
  const b = body.budget || {};
  const patch = budgetPatchFrom(b);
  if (b.id) {
    const cur = await one(ctx, "finance_budgets", b.id);
    const [row] = await ctx.db.patch("finance_budgets", `id=eq.${enc(cur.id)}&${co(ctx)}`, { ...patch, updated_at: nowIso() });
    await logEvent(ctx, "budget", cur.id, "updated", diff(cur, patch, BUDGET_FIELDS));
    return { budget: row };
  }
  const [row] = await ctx.db.insert("finance_budgets", [{
    id: "fb_" + rid(), company_id: ctx.actor.companyId, ...patch, status: "APPROVED",
    created_by: ctx.actor.id, created_by_name: ctx.actor.name, created_at: nowIso(), updated_at: nowIso(),
  }]);
  await logEvent(ctx, "budget", row.id, "created", { title: row.title, draft_amount: row.draft_amount });
  return { budget: row };
}

// Ids from a bulk request: strings only, de-duplicated, capped.
function idList(raw: unknown): string[] {
  const ids = [...new Set((Array.isArray(raw) ? raw : []).filter((x) => typeof x === "string" && x).map((x) => str(x, 80)))];
  if (!ids.length) throw new Fail(400, "Nothing selected");
  if (ids.length > 200) throw new Fail(400, "Select at most 200 at a time");
  return ids;
}
const inList = (ids: string[]) => `in.(${ids.map(enc).join(",")})`;

// Comments point at their record by (entity_type, entity_id) with no foreign
// key, so they are removed alongside it.
async function dropComments(ctx: Ctx, type: string, ids: string[]) {
  if (ids.length) await ctx.db.del("finance_comments", `entity_type=eq.${type}&entity_id=${inList(ids)}&${co(ctx)}`);
}

// Deleting a budget takes its expenses and statements with it (the foreign
// keys cascade), so the whole envelope goes in one step.
async function budgetsDelete(ctx: Ctx, ids: string[]) {
  const budgets = await ctx.db.select(`finance_budgets?id=${inList(ids)}&${co(ctx)}&select=id,title`);
  if (!budgets.length) throw new Fail(404, "Not found");
  const bids = budgets.map((b) => b.id);
  const f = `budget_id=${inList(bids)}&${co(ctx)}&select=id`;
  const [ex, inv] = await Promise.all([ctx.db.select(`finance_expenses?${f}`), ctx.db.select(`finance_invoices?${f}`)]);
  await Promise.all([dropComments(ctx, "budget", bids), dropComments(ctx, "expense", ex.map((r) => r.id)), dropComments(ctx, "invoice", inv.map((r) => r.id))]);
  await ctx.db.del("finance_budgets", `id=${inList(bids)}&${co(ctx)}`);
  for (const b of budgets) await logEvent(ctx, "budget", b.id, "deleted", { title: b.title, expenses: ex.length, statements: inv.length });
  return { ok: true, deleted: bids.length };
}
const budgetDelete = (ctx: Ctx, body: Row) => budgetsDelete(ctx, idList([body.budgetId]));
const budgetDeleteMany = (ctx: Ctx, body: Row) => budgetsDelete(ctx, idList(body.budgetIds));

const EXPENSE_FIELDS = ["amount", "spent_on", "category", "description", "payment_method", "kind", "spent_by", "lead_id", "property_id", "attachments"];
function expensePatchFrom(e: Row): Row {
  const amount = num(e.amount);
  if (amount <= 0) throw new Fail(400, "The amount must be above zero");
  const spent_on = str(e.spentOn, 10);
  if (!isDate(spent_on)) throw new Fail(400, "Pick a valid date");
  const kind = String(e.kind || "PAID").toUpperCase();
  if (!EXPENSE_KINDS.includes(kind)) throw new Fail(400, "Kind must be COMMITTED or PAID");
  const attachments = Array.isArray(e.attachments) ? e.attachments.slice(0, 20).map((a: Row) => ({ path: str(a.path, 300), name: str(a.name, 160), mime: str(a.mime, 80), size: num(a.size) })) : [];
  return {
    amount, spent_on, kind, category: str(e.category, 80), description: str(e.description), payment_method: str(e.paymentMethod, 60),
    spent_by: e.spentBy ? str(e.spentBy, 80) : null, spent_by_name: str(e.spentByName, 160),
    lead_id: e.leadId ? str(e.leadId, 80) : null, lead_name: str(e.leadName, 160),
    property_id: e.propertyId ? str(e.propertyId, 80) : null, property_name: str(e.propertyName, 160), attachments,
  };
}
async function onFinalStatement(ctx: Ctx, expenseId: string) {
  const rows = await ctx.db.select(`finance_invoice_lines?expense_id=eq.${enc(expenseId)}&is_final=eq.true&${co(ctx)}&select=id`);
  return rows.length > 0;
}
async function budgetFigures(ctx: Ctx, budgetId: string) {
  const [[b], expenses] = await Promise.all([
    ctx.db.select(`finance_budgets?id=eq.${enc(budgetId)}&${co(ctx)}&select=*`),
    ctx.db.select(`finance_expenses?budget_id=eq.${enc(budgetId)}&${co(ctx)}&select=*`),
  ]);
  return figuresFor(b, expenses);
}

async function expenseSave(ctx: Ctx, body: Row) {
  const e = body.expense || {};
  const b = await one(ctx, "finance_budgets", e.budgetId);
  const patch = expensePatchFrom(e);
  let row: Row;
  if (e.id) {
    const cur = await one(ctx, "finance_expenses", e.id);
    if (cur.budget_id !== b.id) throw new Fail(400, "An expense can't move to another budget");
    if (await onFinalStatement(ctx, cur.id)) throw new Fail(409, "This expense is on a final statement and can't change");
    [row] = await ctx.db.patch("finance_expenses", `id=eq.${enc(cur.id)}&${co(ctx)}`, { ...patch, updated_at: nowIso() });
    await logEvent(ctx, "expense", cur.id, "updated", { budget_id: b.id, ...diff(cur, patch, EXPENSE_FIELDS) });
  } else {
    [row] = await ctx.db.insert("finance_expenses", [{
      id: "fx_" + rid(), company_id: ctx.actor.companyId, budget_id: b.id, ...patch, created_by: ctx.actor.id, created_at: nowIso(), updated_at: nowIso(),
    }]);
    await logEvent(ctx, "expense", row.id, "created", { budget_id: b.id, amount: row.amount, kind: row.kind, category: row.category });
  }
  const figures = await budgetFigures(ctx, b.id);
  if (figures.overrun) await logEvent(ctx, "budget", b.id, "overrun", { remaining: figures.remaining, expense_id: row.id });
  return { expense: row, figures };
}

async function expenseDelete(ctx: Ctx, body: Row) {
  const cur = await one(ctx, "finance_expenses", body.expenseId);
  if (await onFinalStatement(ctx, cur.id)) throw new Fail(409, "This expense is on a final statement and can't be deleted");
  await ctx.db.del("finance_expenses", `id=eq.${enc(cur.id)}&${co(ctx)}`);
  await logEvent(ctx, "expense", cur.id, "deleted", { budget_id: cur.budget_id, amount: cur.amount, description: cur.description });
  return { ok: true, figures: await budgetFigures(ctx, cur.budget_id) };
}

function linesFrom(raw: unknown): Row[] {
  if (!Array.isArray(raw) || !raw.length) throw new Fail(400, "A statement needs at least one line");
  return raw.slice(0, 200).map((l: Row, i: number) => {
    const qty = num(l.qty ?? 1), unit_price = num(l.unitPrice);
    if (qty < 0 || unit_price < 0) throw new Fail(400, `Line ${i + 1}: quantity and price can't be negative`);
    // Template-specific columns (a Meta line's impressions and CPM).
    const x = (typeof l.extra === "object" && l.extra) ? l.extra : {};
    const extra: Row = {};
    if (x.impressions != null && x.impressions !== "") extra.impressions = Math.max(0, Math.round(num(x.impressions)));
    if (x.cpm != null && x.cpm !== "") extra.cpm = Math.max(0, num(x.cpm));
    if (x.campaign) extra.campaign = str(x.campaign, 200);
    if (x.cid) extra.cid = str(x.cid, 24); // the editor's campaign card
    if (x.est === true) extra.est = true; // impressions estimated from the CPM, not read off the vendor receipt
    return { expense_id: l.expenseId ? str(l.expenseId, 80) : null, position: i, description: str(l.description, 500), qty, unit_price, extra };
  });
}
// The statement's look: which template (Invoice-templates/), its currency, the
// service period, and the vendor fields a receipt template shows.
function layoutFrom(raw: unknown): Row {
  const l = (typeof raw === "object" && raw ? raw : {}) as Row;
  const template = Object.hasOwn(TEMPLATES, str(l.template, 40)) ? str(l.template, 40) : "default";
  const currency = CURRENCIES.includes(str(l.currency, 8)) ? str(l.currency, 8) : (TEMPLATES as Row)[template].currency;
  const date = (v: unknown) => { const d = str(v, 10); return isDate(d) ? d : ""; };
  const periodFrom = date(l.periodFrom), periodTo = date(l.periodTo);
  if (periodFrom && periodTo && periodTo < periodFrom) throw new Fail(400, "The period ends before it starts");
  return {
    template, currency, accent: str(l.accent, 20), showQty: l.showQty !== false, footer: str(l.footer, 300),
    vendorRef: str(l.vendorRef, 80), paidOn: date(l.paidOn), periodFrom, periodTo,
    // Payment block of an ad-spend template (Meta).
    paidTime: /^\d{2}:\d{2}$/.test(str(l.paidTime, 5)) ? str(l.paidTime, 5) : "",
    accountId: str(l.accountId, 60), paymentMethod: str(l.paymentMethod, 80), paymentRef: str(l.paymentRef, 60), productType: str(l.productType, 60),
    cpm: Math.max(0, num(l.cpm)), billingAmount: Math.max(0, num(l.billingAmount)),
    periodToTime: /^\d{2}:\d{2}$/.test(str(l.periodToTime, 5)) ? str(l.periodToTime, 5) : "",
  };
}
async function invoiceSave(ctx: Ctx, body: Row) {
  const inv = body.invoice || {};
  const b = await one(ctx, "finance_budgets", inv.budgetId);
  const lines = linesFrom(inv.lines);
  // every linked expense belongs to this budget and sits on no final statement yet
  const ids = lines.map((l) => l.expense_id).filter(Boolean) as string[];
  if (ids.length) {
    const ex = await ctx.db.select(`finance_expenses?id=in.(${ids.map(enc).join(",")})&${co(ctx)}&select=id,budget_id`);
    for (const id of ids) {
      const x = ex.find((r) => r.id === id);
      if (!x || x.budget_id !== b.id) throw new Fail(400, "A line points at an expense outside this budget");
    }
    const taken = await ctx.db.select(`finance_invoice_lines?expense_id=in.(${ids.map(enc).join(",")})&is_final=eq.true&${co(ctx)}&select=expense_id,invoice_id`);
    const other = taken.find((t) => t.invoice_id !== inv.id);
    if (other) throw new Fail(409, "One of these expenses is already on a final statement");
  }
  const fields = {
    title: str(inv.title, 160) || "Expense statement", issued_on: isDate(str(inv.issuedOn, 10)) ? str(inv.issuedOn, 10) : nowIso().slice(0, 10),
    from_name: str(inv.fromName, 200), bill_to: str(inv.billTo, 400), notes: str(inv.notes, 2000),
    layout: layoutFrom(inv.layout),
  };
  let row: Row;
  if (inv.id) {
    const cur = await one(ctx, "finance_invoices", inv.id);
    if (cur.status !== "DRAFT") throw new Fail(409, "A final statement can't be edited");
    [row] = await ctx.db.patch("finance_invoices", `id=eq.${enc(cur.id)}&${co(ctx)}`, { ...fields, updated_at: nowIso() });
    await ctx.db.del("finance_invoice_lines", `invoice_id=eq.${enc(cur.id)}&${co(ctx)}`);
    await logEvent(ctx, "invoice", cur.id, "updated", { lines: lines.length, ...diff(cur, fields, ["title", "issued_on", "from_name", "bill_to", "notes"]) });
  } else {
    const year = nowIso().slice(0, 4);
    // Next number after the highest this year (a count would repeat once a draft is deleted).
    const taken = await ctx.db.select(`finance_invoices?${co(ctx)}&number=like.${enc(`EXP-${year}-*`)}&select=number`);
    const next = taken.reduce((m, r) => Math.max(m, parseInt(String(r.number).slice(9), 10) || 0), 0) + 1;
    const number = `EXP-${year}-${String(next).padStart(4, "0")}`;
    [row] = await ctx.db.insert("finance_invoices", [{
      id: "fi_" + rid(), company_id: ctx.actor.companyId, budget_id: b.id, number, status: "DRAFT", ...fields, share_token: null,
      created_by: ctx.actor.id, created_by_name: ctx.actor.name, created_at: nowIso(), updated_at: nowIso(), finalized_at: null,
    }]);
    await logEvent(ctx, "invoice", row.id, "created", { number, budget_id: b.id, lines: lines.length });
  }
  const saved = await ctx.db.insert("finance_invoice_lines", lines.map((l) => ({ id: "fl_" + rid(), company_id: ctx.actor.companyId, invoice_id: row.id, is_final: false, ...l })));
  return { invoice: row, lines: saved };
}

const token = () => { const b = new Uint8Array(24); crypto.getRandomValues(b); return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(""); };

async function invoiceFinalize(ctx: Ctx, body: Row) {
  const cur = await one(ctx, "finance_invoices", body.invoiceId);
  if (cur.status !== "DRAFT") throw new Fail(409, "This statement is already final");
  const lines = await ctx.db.select(`finance_invoice_lines?invoice_id=eq.${enc(cur.id)}&${co(ctx)}&select=id`);
  if (!lines.length) throw new Fail(400, "Add at least one line before finalizing");
  await ctx.db.patch("finance_invoice_lines", `invoice_id=eq.${enc(cur.id)}&${co(ctx)}`, { is_final: true }); // the unique index guards double use
  const [row] = await ctx.db.patch("finance_invoices", `id=eq.${enc(cur.id)}&${co(ctx)}`, { status: "FINAL", finalized_at: nowIso(), updated_at: nowIso(), share_token: cur.share_token || token() });
  await logEvent(ctx, "invoice", cur.id, "finalized", { number: cur.number });
  return { invoice: row };
}

async function invoiceShare(ctx: Ctx, body: Row) {
  const cur = await one(ctx, "finance_invoices", body.invoiceId);
  const rotate = !cur.share_token || body.rotate === true;
  const row = rotate ? (await ctx.db.patch("finance_invoices", `id=eq.${enc(cur.id)}&${co(ctx)}`, { share_token: token(), updated_at: nowIso() }))[0] : cur;
  if (rotate) await logEvent(ctx, "invoice", cur.id, "shared", { rotated: !!cur.share_token });
  return { invoice: row, url: `${publicBase(ctx)}?share=${row.share_token}` };
}

// Final statements can be deleted too; their expenses become free to put on
// another statement (the lines go with the statement).
async function invoicesDelete(ctx: Ctx, ids: string[]) {
  const rows = await ctx.db.select(`finance_invoices?id=${inList(ids)}&${co(ctx)}&select=id,number,status`);
  if (!rows.length) throw new Fail(404, "Not found");
  const iids = rows.map((r) => r.id);
  await dropComments(ctx, "invoice", iids);
  await ctx.db.del("finance_invoices", `id=${inList(iids)}&${co(ctx)}`);
  for (const r of rows) await logEvent(ctx, "invoice", r.id, "deleted", { number: r.number, status: r.status });
  return { ok: true, deleted: iids.length };
}
const invoiceDelete = (ctx: Ctx, body: Row) => invoicesDelete(ctx, idList([body.invoiceId]));
const invoiceDeleteMany = (ctx: Ctx, body: Row) => invoicesDelete(ctx, idList(body.invoiceIds));

async function commentAdd(ctx: Ctx, body: Row) {
  const entityType = String(body.entityType || "");
  if (!ENTITY_TYPES.includes(entityType)) throw new Fail(400, "Unknown record type");
  const table = { budget: "finance_budgets", expense: "finance_expenses", invoice: "finance_invoices" }[entityType] as string;
  const target = await one(ctx, table, body.entityId);
  const text = str(body.body, 4000).trim();
  if (!text) throw new Fail(400, "Write something first");
  const mentions = Array.isArray(body.mentions) ? body.mentions.slice(0, 20).map((m: unknown) => str(m, 80)) : [];
  const attachments = Array.isArray(body.attachments) ? body.attachments.slice(0, 10).map((a: Row) => ({ path: str(a.path, 300), name: str(a.name, 160), mime: str(a.mime, 80), size: num(a.size) })) : [];
  const [row] = await ctx.db.insert("finance_comments", [{
    id: "fc_" + rid(), company_id: ctx.actor.companyId, entity_type: entityType, entity_id: target.id, body: text, mentions, attachments,
    user_id: ctx.actor.id, user_name: ctx.actor.name, created_at: nowIso(),
  }]);
  const name = target.title || target.number || target.description || entityType;
  await notify(ctx, mentions, "FINANCE_MENTION", `${ctx.actor.name || "Someone"} mentioned you on "${name}"`);
  return { comment: row };
}

async function fileUpload(ctx: Ctx, body: Row) {
  const mime = str(body.mime, 80);
  if (!UPLOAD_MIMES.includes(mime)) throw new Fail(400, "Only PNG, JPEG, WebP or PDF files");
  const data = String(body.data || "");
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  if (!bytes.length) throw new Fail(400, "The file is empty");
  if (bytes.length > MAX_UPLOAD) throw new Fail(413, "Files are limited to 10 MB");
  const safe = str(body.name, 120).replace(/[^\w.\-]+/g, "_") || "file";
  const path = `${ctx.actor.companyId}/${nowIso().slice(0, 4)}/${rid()}-${safe}`;
  await ctx.db.upload(path, bytes, mime);
  return { file: { path, name: str(body.name, 160) || safe, mime, size: bytes.length } };
}

async function fileUrl(ctx: Ctx, body: Row) {
  const path = str(body.path, 300);
  if (!path.startsWith(`${ctx.actor.companyId}/`)) throw new Fail(403, "That file belongs to another company");
  return { url: await ctx.db.signedUrl(path), expiresIn: SIGN_SECONDS };
}

const ACTIONS: Record<string, (ctx: Ctx, body: Row) => Promise<Row>> = {
  "load": load,
  "budget.save": budgetSave, "budget.delete": budgetDelete, "budget.deleteMany": budgetDeleteMany,
  "expense.save": expenseSave, "expense.delete": expenseDelete,
  "invoice.save": invoiceSave, "invoice.finalize": invoiceFinalize, "invoice.share": invoiceShare, "invoice.delete": invoiceDelete, "invoice.deleteMany": invoiceDeleteMany,
  "comment.add": commentAdd,
  "file.upload": fileUpload, "file.url": fileUrl,
};

// ── the public statement page (GET ?share=<token>) ───────────────────────────
// Drawn by Invoice-templates/index.js, the same renderer as the in-app preview.
async function sharePage(env: Env, tok: string): Promise<Response> {
  const db = new Db(env);
  const html = (body: string, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
  if (!/^[0-9a-f]{48}$/.test(tok)) return html("<p>This link is not valid.</p>", 404);
  const [inv] = await db.select(`finance_invoices?share_token=eq.${enc(tok)}&select=*`);
  if (!inv) return html("<p>This link is no longer valid.</p>", 404);
  const [lines, budgets] = await Promise.all([
    db.select(`finance_invoice_lines?invoice_id=eq.${enc(inv.id)}&select=*&order=position.asc`),
    db.select(`finance_budgets?id=eq.${enc(inv.budget_id)}&select=id,title`),
  ]);
  return html(renderStatement({
    number: inv.number, title: inv.title, status: inv.status, issuedOn: inv.issued_on, fromName: inv.from_name, billTo: inv.bill_to,
    notes: inv.notes, createdByName: inv.created_by_name, budgetTitle: budgets[0]?.title || "", layout: inv.layout || {},
    lines: lines.map((l) => ({ description: l.description, qty: l.qty, unitPrice: l.unit_price, extra: l.extra || {} })),
  }, { toolbar: true }));
}

// ── entry point ──────────────────────────────────────────────────────────────
export async function handleFinance(req: Request, env: Env): Promise<Response> {
  const cors = {
    "Access-Control-Allow-Origin": env.allowedOrigin || "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const reqUrl = new URL(req.url);
  if (req.method === "GET") {
    const tok = reqUrl.searchParams.get("share");
    if (tok) return sharePage(env, tok);
    return json({ error: "Method not allowed" }, 405);
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let body: Row;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  try {
    const db = new Db(env);
    const actor = await loadActor(db, body.userId);
    const fn = ACTIONS[String(body.action)];
    if (!fn) throw new Fail(400, "Unknown action");
    const out = await fn({ env, actor, db, reqUrl }, body);
    return json({ ok: true, ...out });
  } catch (e) {
    if (e instanceof Fail) return json({ error: e.message }, e.status);
    console.error("finance error", e);
    return json({ error: "Something went wrong" }, 500);
  }
}
