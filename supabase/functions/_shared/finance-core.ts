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
// Budget approval is turned off (decision of 2026-10-14). A budget is usable as
// soon as it is created; budget.submit / budget.decide answer 410. Approval
// records written before then are kept and never changed: a budget approved
// back then keeps its approved amount as its limit (see limitOf).
//
// Permissions inside Inventory: a budget is changed (edited, archived,
// restored) by its creator, or by a holder of the 'finance_approve' grant,
// labelled "Manage all budgets" in the app. That grant lets its holder edit and
// archive budgets other people created, and add correction entries to the
// history. It gives nothing else.

import { renderStatement, statementDoc, staleLines, adSetExtra, TEMPLATES, CURRENCIES } from "./finance-doc.js";

export type Env = { url: string; serviceKey: string; allowedOrigin?: string };

type Row = Record<string, any>;
type Actor = { id: string; name: string; role: string; companyId: string; manageAll: boolean };
type Ctx = { env: Env; actor: Actor; db: Db; reqUrl: URL };

const EXPENSE_KINDS = ["COMMITTED", "PAID"];
const ENTITY_TYPES = ["budget", "expense", "invoice"];
const UPLOAD_MIMES = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
const MAX_UPLOAD = 10 * 1024 * 1024;
const BUCKET = "finance-media";
const SIGN_SECONDS = 3600;

// `extra` travels to the browser beside the message (e.g. which drafts block a delete).
class Fail extends Error {
  status: number;
  extra: Row;
  constructor(status: number, message: string, extra: Row = {}) { super(message); this.status = status; this.extra = extra; }
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
  // 'finance_approve' is the "Manage all budgets" grant (see the header).
  return { id: u.id, name: u.name || "", role: u.role, companyId: u.company_id, manageAll: !!af && af.includes("finance_approve") };
}

// ── figures: the one definition of each number ───────────────────────────────
// The limit is the budget's own amount (draft_amount). A budget whose status is
// still APPROVED from before approval was turned off keeps the amount its
// latest approval set; the first edit moves it to ACTIVE with the amount the
// editor saw (budgetSave), so the limit carries over unchanged.
export function limitOf(budget: Row, approvals: Row[]): { amount: number; source: "approval" | "budget" } {
  if (budget.status === "APPROVED") {
    const app = approvals.filter((a) => a.budget_id === budget.id && a.decision === "APPROVED")
      .sort((a, b) => String(b.decided_at).localeCompare(String(a.decided_at)))[0];
    if (app) return { amount: num(app.approved_amount), source: "approval" };
  }
  return { amount: num(budget.draft_amount), source: "budget" };
}

export type Figures = { amount: number; source: "approval" | "budget"; committed: number; spent: number; remaining: number; overrun: boolean };
export function figuresFor(budget: Row, approvals: Row[], expenses: Row[]): Figures {
  const { amount, source } = limitOf(budget, approvals);
  let committed = 0, spent = 0;
  for (const e of expenses) {
    if (e.budget_id !== budget.id) continue;
    if (e.kind === "COMMITTED") committed += num(e.amount); else spent += num(e.amount);
  }
  const remaining = amount - committed - spent;
  return { amount, source, committed, spent, remaining, overrun: committed + spent > amount };
}

// ── helpers ──────────────────────────────────────────────────────────────────
const co = (ctx: Ctx) => `company_id=eq.${enc(ctx.actor.companyId)}`;
// The share links point at this function's public address. req.url inside the
// Edge runtime is the internal one (http, no /functions/v1), so build from env.
const publicBase = (ctx: Ctx) => ctx.env.url ? `${ctx.env.url.replace(/\/+$/, "")}/functions/v1/finance` : `${ctx.reqUrl.origin}${ctx.reqUrl.pathname}`;
// Ids from a bulk request: strings only, de-duplicated, capped.
function idList(raw: unknown): string[] {
  const ids = [...new Set((Array.isArray(raw) ? raw : []).filter((x) => typeof x === "string" && x).map((x) => str(x, 80)))];
  if (!ids.length) throw new Fail(400, "Nothing selected");
  if (ids.length > 200) throw new Fail(400, "Select at most 200 at a time");
  return ids;
}
const inList = (ids: string[]) => `in.(${ids.map(enc).join(",")})`;

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

// A budget is changed by its creator or a "Manage all budgets" holder.
function canManage(ctx: Ctx, b: Row) {
  if (b.created_by !== ctx.actor.id && !ctx.actor.manageAll) throw new Fail(403, "Only its creator or someone with Manage all budgets can change this budget");
}
// An archived budget is read-only and takes no new expenses or statements.
function notArchived(b: Row) {
  if (b.archived_at) throw new Fail(409, "This budget is archived. Restore it first.");
}

const diff = (before: Row, after: Row, keys: string[]) => {
  const d: Row = {};
  for (const k of keys) if (JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null)) d[k] = { from: before[k] ?? null, to: after[k] ?? null };
  return d;
};

// ── actions ──────────────────────────────────────────────────────────────────
async function load(ctx: Ctx) {
  const c = co(ctx);
  const [budgets, requests, approvals, expenses, invoices, lines, comments, events] = await Promise.all([
    ctx.db.select(`finance_budgets?${c}&select=*&order=created_at.desc`),
    ctx.db.select(`finance_budget_requests?${c}&select=*&order=submitted_at.desc`),
    ctx.db.select(`finance_budget_approvals?${c}&select=*&order=decided_at.desc`),
    ctx.db.select(`finance_expenses?${c}&select=*&order=spent_on.desc`),
    ctx.db.select(`finance_invoices?${c}&select=*&order=created_at.desc`),
    ctx.db.select(`finance_invoice_lines?${c}&select=*&order=position.asc`),
    ctx.db.select(`finance_comments?${c}&select=*&order=created_at.asc`),
    ctx.db.select(`finance_events?${c}&select=*&order=at.desc&limit=1000`),
  ]);
  const figures: Record<string, Figures> = {};
  for (const b of budgets) figures[b.id] = figuresFor(b, approvals, expenses);
  const shareBase = publicBase(ctx);
  // requests / approvals are history from before approval was turned off: read, never written.
  return { actor: { id: ctx.actor.id, manageAll: ctx.actor.manageAll }, budgets, requests, approvals, expenses, invoices, lines, comments, events, figures, shareBase };
}

const BUDGET_FIELDS = ["title", "purpose", "notes", "projects", "team_id", "team_name", "draft_amount"];
function budgetPatchFrom(b: Row): Row {
  const title = str(b.title, 160).trim();
  if (!title) throw new Fail(400, "A budget needs a title");
  const draft_amount = num(b.draftAmount);
  if (!(draft_amount > 0)) throw new Fail(400, "The budget amount must be above zero");
  // Several projects per budget (migration 0024); property_id / property_name
  // keep the first one, for older readers.
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
    canManage(ctx, cur);
    notArchived(cur);
    // The editor sends the limit it showed (baseAmount). If that is no longer
    // the limit (another edit, or an approved budget whose approval sets it),
    // nothing is saved: the limit never moves without the editor seeing it.
    const approvals = await ctx.db.select(`finance_budget_approvals?budget_id=eq.${enc(cur.id)}&${co(ctx)}&select=*`);
    const limit = limitOf(cur, approvals);
    if (b.baseAmount == null || num(b.baseAmount) !== limit.amount) throw new Fail(409, "This budget changed since you opened it. Reload and try again.");
    const [row] = await ctx.db.patch("finance_budgets", `id=eq.${enc(cur.id)}&${co(ctx)}`, { ...patch, status: "ACTIVE", updated_at: nowIso() });
    // Compared with the limit in force, not the stored draft_amount.
    const changes = diff({ ...cur, draft_amount: limit.amount }, patch, BUDGET_FIELDS);
    if (cur.status !== "ACTIVE") changes.status = { from: cur.status, to: "ACTIVE" };
    await logEvent(ctx, "budget", cur.id, "updated", changes);
    return { budget: row };
  }
  const [row] = await ctx.db.insert("finance_budgets", [{
    id: "fb_" + rid(), company_id: ctx.actor.companyId, ...patch, status: "ACTIVE",
    created_by: ctx.actor.id, created_by_name: ctx.actor.name, created_at: nowIso(), updated_at: nowIso(),
  }]);
  await logEvent(ctx, "budget", row.id, "created", { title: row.title, draft_amount: row.draft_amount });
  return { budget: row };
}

// Budgets are never deleted: creating one already writes history (the
// "created" event), and history must not point at a budget that is gone.
// Archiving hides it instead. Only a budget with no expenses and no statements
// can be archived; its history, comments and approval records stay with it.
async function budgetArchive(ctx: Ctx, body: Row) {
  const b = await one(ctx, "finance_budgets", body.budgetId);
  canManage(ctx, b);
  if (b.archived_at) throw new Fail(409, "This budget is already archived");
  const f = `budget_id=eq.${enc(b.id)}&${co(ctx)}&select=id&limit=1`;
  const [ex, inv] = await Promise.all([ctx.db.select(`finance_expenses?${f}`), ctx.db.select(`finance_invoices?${f}`)]);
  if (ex.length || inv.length) throw new Fail(409, "A budget with expenses or statements can't be archived");
  const [row] = await ctx.db.patch("finance_budgets", `id=eq.${enc(b.id)}&${co(ctx)}`, { archived_at: nowIso(), updated_at: nowIso() });
  await logEvent(ctx, "budget", b.id, "archived", { title: b.title });
  return { budget: row };
}

// Archive several at once: each budget the actor may change and that is
// empty (no expenses, no statements) is archived; the rest are reported back
// untouched, with the reason.
async function budgetArchiveMany(ctx: Ctx, body: Row) {
  const ids = idList(body.budgetIds);
  const budgets = await ctx.db.select(`finance_budgets?id=${inList(ids)}&${co(ctx)}&select=*`);
  if (!budgets.length) throw new Fail(404, "Not found");
  const f = `budget_id=${inList(budgets.map((b) => b.id))}&${co(ctx)}&select=budget_id`;
  const [ex, inv] = await Promise.all([ctx.db.select(`finance_expenses?${f}`), ctx.db.select(`finance_invoices?${f}`)]);
  const used = new Set([...ex, ...inv].map((r) => r.budget_id));
  const archived: string[] = [], skipped: Row[] = [];
  for (const b of budgets) {
    const why = b.archived_at ? "already archived"
      : b.created_by !== ctx.actor.id && !ctx.actor.manageAll ? "not yours (needs Manage all budgets)"
      : used.has(b.id) ? "has expenses or statements" : "";
    if (why) { skipped.push({ id: b.id, title: b.title, why }); continue; }
    await ctx.db.patch("finance_budgets", `id=eq.${enc(b.id)}&${co(ctx)}`, { archived_at: nowIso(), updated_at: nowIso() });
    await logEvent(ctx, "budget", b.id, "archived", { title: b.title });
    archived.push(b.id);
  }
  return { archived, skipped };
}

async function budgetRestore(ctx: Ctx, body: Row) {
  const b = await one(ctx, "finance_budgets", body.budgetId);
  canManage(ctx, b);
  if (!b.archived_at) throw new Fail(409, "This budget is not archived");
  const [row] = await ctx.db.patch("finance_budgets", `id=eq.${enc(b.id)}&${co(ctx)}`, { archived_at: null, updated_at: nowIso() });
  await logEvent(ctx, "budget", b.id, "restored", { title: b.title });
  return { budget: row };
}

// Retired actions answer clearly instead of "Unknown action", and write nothing.
const retired = (message: string) => async () => { throw new Fail(410, message); };

const EXPENSE_FIELDS = ["amount", "spent_on", "category", "description", "payment_method", "kind", "spent_by", "property_id", "attachments"];
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
    property_id: e.propertyId ? str(e.propertyId, 80) : null, property_name: str(e.propertyName, 160), attachments,
  };
}
async function onFinalStatement(ctx: Ctx, expenseId: string) {
  const rows = await ctx.db.select(`finance_invoice_lines?expense_id=eq.${enc(expenseId)}&is_final=eq.true&${co(ctx)}&select=id`);
  return rows.length > 0;
}
async function budgetFigures(ctx: Ctx, budgetId: string) {
  const [b] = await ctx.db.select(`finance_budgets?id=eq.${enc(budgetId)}&${co(ctx)}&select=*`);
  const f = `budget_id=eq.${enc(budgetId)}&${co(ctx)}&select=*`;
  const [approvals, expenses] = await Promise.all([ctx.db.select(`finance_budget_approvals?${f}`), ctx.db.select(`finance_expenses?${f}`)]);
  return figuresFor(b, approvals, expenses);
}

async function expenseSave(ctx: Ctx, body: Row) {
  const e = body.expense || {};
  const b = await one(ctx, "finance_budgets", e.budgetId);
  notArchived(b);
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

// An expense on a draft statement is not deleted silently: the database would
// turn its lines into free lines that keep the old amount. The first call
// names the drafts (409, code ON_DRAFTS); a second call with removeFromDrafts
// takes its lines off those drafts, each draft's history noting it.
async function expenseDelete(ctx: Ctx, body: Row) {
  const cur = await one(ctx, "finance_expenses", body.expenseId);
  if (await onFinalStatement(ctx, cur.id)) throw new Fail(409, "This expense is on a final statement and can't be deleted");
  const onDrafts = await ctx.db.select(`finance_invoice_lines?expense_id=eq.${enc(cur.id)}&is_final=eq.false&${co(ctx)}&select=id,invoice_id`);
  if (onDrafts.length) {
    const ids = [...new Set(onDrafts.map((l) => l.invoice_id as string))];
    const drafts = await ctx.db.select(`finance_invoices?id=in.(${ids.map(enc).join(",")})&${co(ctx)}&select=id,number`);
    if (body.removeFromDrafts !== true) {
      throw new Fail(409, `This expense is on draft statement${drafts.length === 1 ? "" : "s"} ${drafts.map((d) => d.number).join(", ")}`, { code: "ON_DRAFTS", drafts: drafts.map((d) => d.number) });
    }
    await ctx.db.del("finance_invoice_lines", `expense_id=eq.${enc(cur.id)}&is_final=eq.false&${co(ctx)}`);
    for (const d of drafts) {
      await logEvent(ctx, "invoice", d.id, "updated", { removed_expense: cur.id, removed_lines: onDrafts.filter((l) => l.invoice_id === d.id).length, note: `Expense "${cur.description || cur.category || cur.id}" was deleted` });
    }
  }
  await ctx.db.del("finance_expenses", `id=eq.${enc(cur.id)}&${co(ctx)}`);
  await logEvent(ctx, "expense", cur.id, "deleted", { budget_id: cur.budget_id, amount: cur.amount, description: cur.description });
  return { ok: true, figures: await budgetFigures(ctx, cur.budget_id) };
}

// `cpm`: the statement CPM on a Meta (ad spend) statement, else null. Its ad
// sets' impressions are worked out here as well as in the editor, so a stored
// estimate always matches the stored amount and CPM.
function linesFrom(raw: unknown, cpm: number | null): Row[] {
  if (!Array.isArray(raw) || !raw.length) throw new Fail(400, "A statement needs at least one line");
  return raw.slice(0, 200).map((l: Row, i: number) => {
    const qty = num(l.qty ?? 1), unit_price = num(l.unitPrice);
    if (qty < 0 || unit_price < 0) throw new Fail(400, `Line ${i + 1}: quantity and price can't be negative`);
    // Template-specific columns (a Meta line's campaign, impressions and CPM).
    const x = (typeof l.extra === "object" && l.extra) ? l.extra : {};
    let extra: Row = {};
    if (x.impressions != null && x.impressions !== "") extra.impressions = Math.max(0, Math.round(num(x.impressions)));
    if (x.cpm != null && x.cpm !== "") extra.cpm = Math.max(0, num(x.cpm));
    if (x.campaign) extra.campaign = str(x.campaign, 200);
    if (x.cid) extra.cid = str(x.cid, 24); // the editor's campaign card
    // est true: impressions estimated from the CPM; false: typed from the vendor receipt.
    if (typeof x.est === "boolean") extra.est = x.est;
    if (cpm !== null) extra = adSetExtra(extra, qty * unit_price, cpm);
    return { expense_id: l.expenseId ? str(l.expenseId, 80) : null, position: i, description: str(l.description, 500), qty, unit_price, extra };
  });
}
// The statement's look: which template (finance-doc.js), its currency, the
// service period, and the vendor fields a vendor template shows.
function layoutFrom(raw: unknown): Row {
  const l = (typeof raw === "object" && raw ? raw : {}) as Row;
  const template = Object.hasOwn(TEMPLATES, str(l.template, 40)) ? str(l.template, 40) : "default";
  const currency = CURRENCIES.includes(str(l.currency, 8)) ? str(l.currency, 8) : (TEMPLATES as Row)[template].currency;
  const date = (v: unknown) => { const d = str(v, 10); return isDate(d) ? d : ""; };
  const periodFrom = date(l.periodFrom), periodTo = date(l.periodTo);
  if (periodFrom && periodTo && periodTo < periodFrom) throw new Fail(400, "The period ends before it starts");
  const time = (v: unknown) => (/^\d{2}:\d{2}$/.test(str(v, 5)) ? str(v, 5) : "");
  return {
    template, currency, accent: str(l.accent, 20), showQty: l.showQty !== false, footer: str(l.footer, 300),
    vendorRef: str(l.vendorRef, 80), paidOn: date(l.paidOn), periodFrom, periodTo,
    // Payment block of an ad-spend template (Meta).
    paidTime: time(l.paidTime), accountId: str(l.accountId, 60), paymentMethod: str(l.paymentMethod, 80), paymentRef: str(l.paymentRef, 60), productType: str(l.productType, 60),
    cpm: Math.max(0, num(l.cpm)), billingAmount: Math.max(0, num(l.billingAmount)), periodToTime: time(l.periodToTime),
  };
}
// Any budget that is not archived takes statements (approval is off). Every
// linked expense must belong to that budget.
async function invoiceSave(ctx: Ctx, body: Row) {
  const inv = body.invoice || {};
  const b = await one(ctx, "finance_budgets", inv.budgetId);
  notArchived(b);
  const layout = layoutFrom(inv.layout);
  const lines = linesFrom(inv.lines, (TEMPLATES as Row)[layout.template].columns === "impressions" ? layout.cpm : null);
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
    // Stored as given (trimmed): a fixed name or custom text, see categoryOf in finance-doc.js.
    category: str(inv.category, 80).trim(),
    layout,
  };
  if (!fields.category) throw new Fail(400, "Pick a category for this statement");
  let row: Row;
  if (inv.id) {
    const cur = await one(ctx, "finance_invoices", inv.id);
    if (cur.status !== "DRAFT") throw new Fail(409, "A final statement can't be edited");
    [row] = await ctx.db.patch("finance_invoices", `id=eq.${enc(cur.id)}&${co(ctx)}`, { ...fields, updated_at: nowIso() });
    await ctx.db.del("finance_invoice_lines", `invoice_id=eq.${enc(cur.id)}&${co(ctx)}`);
    await logEvent(ctx, "invoice", cur.id, "updated", { lines: lines.length, ...diff(cur, fields, ["title", "issued_on", "category", "from_name", "bill_to", "notes"]) });
  } else {
    const year = nowIso().slice(0, 4);
    // Next number after the highest this year (a count would repeat once a draft
    // is deleted); migration 0025's unique index turns a same-moment clash into
    // a 409 instead of a duplicate.
    const taken = await ctx.db.select(`finance_invoices?${co(ctx)}&number=like.${enc(`EXP-${year}-*`)}&select=number`);
    const next = taken.reduce((m, r) => Math.max(m, parseInt(String(r.number).slice(9), 10) || 0), 0) + 1;
    const number = `EXP-${year}-${String(next).padStart(4, "0")}`;
    [row] = await ctx.db.insert("finance_invoices", [{
      id: "fi_" + rid(), company_id: ctx.actor.companyId, budget_id: b.id, number, status: "DRAFT", ...fields, share_token: null,
      created_by: ctx.actor.id, created_by_name: ctx.actor.name, created_at: nowIso(), updated_at: nowIso(), finalized_at: null,
    }]);
    await logEvent(ctx, "invoice", row.id, "created", { number, budget_id: b.id, lines: lines.length, category: fields.category });
  }
  const saved = await ctx.db.insert("finance_invoice_lines", lines.map((l) => ({ id: "fl_" + rid(), company_id: ctx.actor.companyId, invoice_id: row.id, is_final: false, ...l })));
  return { invoice: row, lines: saved };
}

const token = () => { const b = new Uint8Array(24); crypto.getRandomValues(b); return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(""); };

async function invoiceFinalize(ctx: Ctx, body: Row) {
  const cur = await one(ctx, "finance_invoices", body.invoiceId);
  if (cur.status !== "DRAFT") throw new Fail(409, "This statement is already final");
  const lines = await ctx.db.select(`finance_invoice_lines?invoice_id=eq.${enc(cur.id)}&${co(ctx)}&select=*&order=position.asc`);
  if (!lines.length) throw new Fail(400, "Add at least one line before finalizing");
  // A final statement never disagrees with the expenses it lists.
  const ids = [...new Set(lines.map((l) => l.expense_id).filter(Boolean))] as string[];
  if (ids.length) {
    const expenses = await ctx.db.select(`finance_expenses?id=in.(${ids.map(enc).join(",")})&${co(ctx)}&select=id,amount`);
    const stale = staleLines(lines, expenses, cur.layout?.currency || "BDT");
    if (stale.length) throw new Fail(409, `Line${stale.length === 1 ? "" : "s"} ${stale.map((s) => s.index + 1).join(", ")} no longer match${stale.length === 1 ? "es" : ""} the linked expense. Edit the statement first.`, { code: "STALE_LINES", lines: stale.map((s) => s.index + 1) });
  }
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

async function invoiceDelete(ctx: Ctx, body: Row) {
  const cur = await one(ctx, "finance_invoices", body.invoiceId);
  if (cur.status !== "DRAFT") throw new Fail(409, "A final statement can't be deleted");
  await ctx.db.del("finance_invoices", `id=eq.${enc(cur.id)}&${co(ctx)}`);
  await logEvent(ctx, "invoice", cur.id, "deleted", { number: cur.number });
  return { ok: true };
}
// Several at once: drafts are deleted; final statements stay (they can't be
// deleted) and are reported back. Comments and history are kept.
async function invoiceDeleteMany(ctx: Ctx, body: Row) {
  const rows = await ctx.db.select(`finance_invoices?id=${inList(idList(body.invoiceIds))}&${co(ctx)}&select=id,number,status`);
  if (!rows.length) throw new Fail(404, "Not found");
  const drafts = rows.filter((r) => r.status === "DRAFT");
  if (drafts.length) await ctx.db.del("finance_invoices", `id=${inList(drafts.map((r) => r.id))}&${co(ctx)}`);
  for (const r of drafts) await logEvent(ctx, "invoice", r.id, "deleted", { number: r.number });
  return { deleted: drafts.length, skipped: rows.filter((r) => r.status !== "DRAFT").map((r) => ({ id: r.id, number: r.number, why: "final" })) };
}

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

// History is append-only (migration 0024 enforces it in the database). A
// mistake in it is answered by a new "corrected" entry that points at the
// original and says what was wrong; the original stays as it was.
async function historyCorrect(ctx: Ctx, body: Row) {
  if (!ctx.actor.manageAll) throw new Fail(403, "Only someone with Manage all budgets can add a correction");
  const ev = await one(ctx, "finance_events", body.eventId);
  if (ev.action === "corrected") throw new Fail(400, "Add the correction to the original entry");
  const note = str(body.note, 1000).trim();
  if (!note) throw new Fail(400, "Say what the correction is");
  await logEvent(ctx, ev.entity_type, ev.entity_id, "corrected", { corrects: ev.id, corrects_action: ev.action, corrects_at: ev.at, note });
  return { ok: true };
}

const ACTIONS: Record<string, (ctx: Ctx, body: Row) => Promise<Row>> = {
  "load": load,
  "budget.save": budgetSave, "budget.archive": budgetArchive, "budget.archiveMany": budgetArchiveMany, "budget.restore": budgetRestore,
  "budget.deleteMany": retired("Budgets can't be deleted. Archive them instead."),
  "budget.submit": retired("Budget approval is turned off. Budgets can be used as soon as they are created."),
  "budget.decide": retired("Budget approval is turned off. Budgets can be used as soon as they are created."),
  "budget.delete": retired("Budgets can't be deleted. Archive the budget instead."),
  "expense.save": expenseSave, "expense.delete": expenseDelete,
  "invoice.save": invoiceSave, "invoice.finalize": invoiceFinalize, "invoice.share": invoiceShare, "invoice.delete": invoiceDelete, "invoice.deleteMany": invoiceDeleteMany,
  "comment.add": commentAdd, "history.correct": historyCorrect,
  "file.upload": fileUpload, "file.url": fileUrl,
};

// ── the public statement page (GET ?share=<token>) ───────────────────────────
// Rendered by finance-doc.js, the same renderer as the app's preview and print.
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
  // Paid / committed of the linked expenses, for the Payment line.
  const ids = [...new Set(lines.map((l) => l.expense_id).filter(Boolean))] as string[];
  const expenses = ids.length ? await db.select(`finance_expenses?id=in.(${ids.map(enc).join(",")})&company_id=eq.${enc(inv.company_id)}&select=id,kind`) : [];
  return html(renderStatement(statementDoc({ invoice: inv, lines, budget: budgets[0] || null, expenses }), { chrome: true }));
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
    if (e instanceof Fail) return json({ ...e.extra, error: e.message }, e.status);
    console.error("finance error", e);
    return json({ error: "Something went wrong" }, 500);
  }
}
