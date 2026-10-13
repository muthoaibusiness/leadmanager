// Finance core — every read and write of the finance_* tables, behind one
// request handler. Web-standard code only (fetch, Request, Response, crypto):
// no Deno globals, so the same file runs in the Edge Function and under Node
// in the test harness.
//
// Trust model: the caller names a userId; the users table says whether that
// account may use Inventory (role MANAGEMENT, or an allowed_features grant of
// 'inventory') and whether it may decide requests ('finance_approve'). Every
// row is read and written with the service role and scoped to the actor's
// company. Figures (requested / approved / committed / spent / remaining) are
// computed HERE, from the separate record types, and handed to the browser
// ready-made, so there is one definition of each number.

export type Env = { url: string; serviceKey: string; allowedOrigin?: string };

type Row = Record<string, any>;
type Actor = { id: string; name: string; role: string; companyId: string; approver: boolean };
type Ctx = { env: Env; actor: Actor; db: Db; reqUrl: URL };

const BUDGET_STATUS = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "REVISION"] as const;
const DECISIONS: Record<string, string> = { APPROVED: "APPROVED", REJECTED: "REJECTED", REVISION: "REVISION" };
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
  return /one_final_per_expense/.test(t) ? "One of these expenses is already on a final statement" : "That change conflicts with an existing record";
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
  return { id: u.id, name: u.name || "", role: u.role, companyId: u.company_id, approver: !!af && af.includes("finance_approve") };
}

// ── figures: the one definition of each number ───────────────────────────────
export type Figures = { requested: number; approved: number; committed: number; spent: number; remaining: number; overrun: boolean; version: number };
export function figuresFor(budget: Row, requests: Row[], approvals: Row[], expenses: Row[]): Figures {
  const reqs = requests.filter((r) => r.budget_id === budget.id).sort((a, b) => num(b.version) - num(a.version));
  const requested = reqs.length ? num(reqs[0].requested_amount) : num(budget.draft_amount);
  // Approved comes ONLY from an approval record, and only while the budget is approved.
  const apps = approvals.filter((a) => a.budget_id === budget.id && a.decision === "APPROVED")
    .sort((a, b) => String(b.decided_at).localeCompare(String(a.decided_at)));
  const approved = budget.status === "APPROVED" && apps.length ? num(apps[0].approved_amount) : 0;
  let committed = 0, spent = 0;
  for (const e of expenses) {
    if (e.budget_id !== budget.id) continue;
    if (e.kind === "COMMITTED") committed += num(e.amount); else spent += num(e.amount);
  }
  const remaining = approved - committed - spent;
  return { requested, approved, committed, spent, remaining, overrun: committed + spent > approved, version: reqs.length ? num(reqs[0].version) : 0 };
}

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

async function approverIds(ctx: Ctx): Promise<string[]> {
  const rows = await ctx.db.select(`users?${co(ctx)}&allowed_features=cs.${enc('["finance_approve"]')}&select=id,is_active`);
  return rows.filter((u) => u.is_active !== false).map((u) => u.id);
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
  for (const b of budgets) figures[b.id] = figuresFor(b, requests, approvals, expenses);
  // The share links are built from this function's own address.
  const shareBase = `${ctx.reqUrl.origin}${ctx.reqUrl.pathname}`;
  return { actor: { id: ctx.actor.id, approver: ctx.actor.approver }, budgets, requests, approvals, expenses, invoices, lines, comments, events, figures, shareBase };
}

const BUDGET_FIELDS = ["title", "purpose", "notes", "property_id", "property_name", "team_id", "team_name", "draft_amount"];
function budgetPatchFrom(b: Row): Row {
  const title = str(b.title, 160).trim();
  if (!title) throw new Fail(400, "A budget needs a title");
  const draft_amount = num(b.draftAmount);
  if (draft_amount < 0) throw new Fail(400, "The amount can't be negative");
  return {
    title, purpose: str(b.purpose), notes: str(b.notes, 4000), draft_amount,
    property_id: b.propertyId ? str(b.propertyId, 80) : null, property_name: str(b.propertyName, 160),
    team_id: b.teamId ? str(b.teamId, 80) : null, team_name: str(b.teamName, 160),
  };
}
function canEditBudget(ctx: Ctx, b: Row) {
  if (!["DRAFT", "REVISION"].includes(b.status)) throw new Fail(409, `A ${label(b.status)} budget can't be edited`);
  if (b.created_by !== ctx.actor.id && !ctx.actor.approver) throw new Fail(403, "Only its creator or an approver can edit this budget");
}
const label = (s: string) => ({ DRAFT: "draft", SUBMITTED: "submitted", APPROVED: "approved", REJECTED: "rejected", REVISION: "revision-requested" } as Row)[s] || s.toLowerCase();

async function budgetSave(ctx: Ctx, body: Row) {
  const b = body.budget || {};
  const patch = budgetPatchFrom(b);
  if (b.id) {
    const cur = await one(ctx, "finance_budgets", b.id);
    canEditBudget(ctx, cur);
    const [row] = await ctx.db.patch("finance_budgets", `id=eq.${enc(cur.id)}&${co(ctx)}`, { ...patch, updated_at: nowIso() });
    await logEvent(ctx, "budget", cur.id, "updated", diff(cur, patch, BUDGET_FIELDS));
    return { budget: row };
  }
  const [row] = await ctx.db.insert("finance_budgets", [{
    id: "fb_" + rid(), company_id: ctx.actor.companyId, ...patch, status: "DRAFT",
    created_by: ctx.actor.id, created_by_name: ctx.actor.name, created_at: nowIso(), updated_at: nowIso(),
  }]);
  await logEvent(ctx, "budget", row.id, "created", { title: row.title, draft_amount: row.draft_amount });
  return { budget: row };
}

async function budgetSubmit(ctx: Ctx, body: Row) {
  const b = await one(ctx, "finance_budgets", body.budgetId);
  canEditBudget(ctx, b);
  if (num(b.draft_amount) <= 0) throw new Fail(400, "Set an amount before submitting");
  const prev = await ctx.db.select(`finance_budget_requests?budget_id=eq.${enc(b.id)}&${co(ctx)}&select=version`);
  const version = prev.reduce((m, r) => Math.max(m, num(r.version)), 0) + 1;
  const [req] = await ctx.db.insert("finance_budget_requests", [{
    id: "fr_" + rid(), company_id: ctx.actor.companyId, budget_id: b.id, version, requested_amount: num(b.draft_amount),
    note: str(body.note), submitted_by: ctx.actor.id, submitted_by_name: ctx.actor.name, submitted_at: nowIso(),
  }]);
  const [row] = await ctx.db.patch("finance_budgets", `id=eq.${enc(b.id)}&${co(ctx)}`, { status: "SUBMITTED", updated_at: nowIso() });
  await logEvent(ctx, "budget", b.id, "submitted", { version, requested_amount: req.requested_amount, note: req.note });
  await notify(ctx, await approverIds(ctx), "BUDGET_REQUEST", `${ctx.actor.name || "Someone"} submitted "${b.title}" (v${version}) for approval`);
  return { budget: row, request: req };
}

async function budgetDecide(ctx: Ctx, body: Row) {
  if (!ctx.actor.approver) throw new Fail(403, "Only an approver can decide a budget request");
  const b = await one(ctx, "finance_budgets", body.budgetId);
  if (b.status !== "SUBMITTED") throw new Fail(409, "Only a submitted budget can be decided");
  const decision = DECISIONS[String(body.decision)];
  if (!decision) throw new Fail(400, "Decision must be APPROVED, REJECTED or REVISION");
  const reqs = await ctx.db.select(`finance_budget_requests?budget_id=eq.${enc(b.id)}&${co(ctx)}&select=*&order=version.desc&limit=1`);
  const req = reqs[0];
  if (!req) throw new Fail(409, "This budget has no submitted request");
  if (b.created_by === ctx.actor.id || req.submitted_by === ctx.actor.id) throw new Fail(403, "You can't decide your own request");
  const approved_amount = decision === "APPROVED" ? num(body.approvedAmount ?? req.requested_amount) : null;
  if (decision === "APPROVED" && (approved_amount as number) <= 0) throw new Fail(400, "The approved amount must be above zero");
  const [app] = await ctx.db.insert("finance_budget_approvals", [{
    id: "fa_" + rid(), company_id: ctx.actor.companyId, budget_id: b.id, request_id: req.id, decision, approved_amount,
    note: str(body.note), decided_by: ctx.actor.id, decided_by_name: ctx.actor.name, decided_at: nowIso(),
  }]);
  const [row] = await ctx.db.patch("finance_budgets", `id=eq.${enc(b.id)}&${co(ctx)}`, { status: decision, updated_at: nowIso() });
  await logEvent(ctx, "budget", b.id, "decided", { decision, version: req.version, requested_amount: req.requested_amount, approved_amount, note: app.note });
  const what = decision === "APPROVED" ? "approved" : decision === "REJECTED" ? "rejected" : "sent back for revision";
  await notify(ctx, [b.created_by, req.submitted_by], "BUDGET_DECISION", `"${b.title}" was ${what} by ${ctx.actor.name || "an approver"}`);
  return { budget: row, approval: app };
}

async function budgetDelete(ctx: Ctx, body: Row) {
  const b = await one(ctx, "finance_budgets", body.budgetId);
  if (b.status !== "DRAFT") throw new Fail(409, "Only a draft can be deleted");
  if (b.created_by !== ctx.actor.id && !ctx.actor.approver) throw new Fail(403, "Only its creator or an approver can delete this draft");
  await ctx.db.del("finance_budgets", `id=eq.${enc(b.id)}&${co(ctx)}`);
  await logEvent(ctx, "budget", b.id, "deleted", { title: b.title });
  return { ok: true };
}

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
  const [b] = await ctx.db.select(`finance_budgets?id=eq.${enc(budgetId)}&${co(ctx)}&select=*`);
  const f = `budget_id=eq.${enc(budgetId)}&${co(ctx)}&select=*`;
  const [requests, approvals, expenses] = await Promise.all([
    ctx.db.select(`finance_budget_requests?${f}`), ctx.db.select(`finance_budget_approvals?${f}`), ctx.db.select(`finance_expenses?${f}`),
  ]);
  return figuresFor(b, requests, approvals, expenses);
}

async function expenseSave(ctx: Ctx, body: Row) {
  const e = body.expense || {};
  const b = await one(ctx, "finance_budgets", e.budgetId);
  if (b.status !== "APPROVED") throw new Fail(409, "Expenses can only be recorded against an approved budget");
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
    return { expense_id: l.expenseId ? str(l.expenseId, 80) : null, position: i, description: str(l.description, 500), qty, unit_price };
  });
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
    layout: typeof inv.layout === "object" && inv.layout ? { accent: str(inv.layout.accent, 20), showQty: inv.layout.showQty !== false, footer: str(inv.layout.footer, 300) } : {},
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
    const mine = await ctx.db.select(`finance_invoices?${co(ctx)}&select=id`);
    const number = `EXP-${year}-${String(mine.length + 1).padStart(4, "0")}`;
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
  return { invoice: row, url: `${ctx.reqUrl.origin}${ctx.reqUrl.pathname}?share=${row.share_token}` };
}

async function invoiceDelete(ctx: Ctx, body: Row) {
  const cur = await one(ctx, "finance_invoices", body.invoiceId);
  if (cur.status !== "DRAFT") throw new Fail(409, "A final statement can't be deleted");
  await ctx.db.del("finance_invoices", `id=eq.${enc(cur.id)}&${co(ctx)}`);
  await logEvent(ctx, "invoice", cur.id, "deleted", { number: cur.number });
  return { ok: true };
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

const ACTIONS: Record<string, (ctx: Ctx, body: Row) => Promise<Row>> = {
  "load": load,
  "budget.save": budgetSave, "budget.submit": budgetSubmit, "budget.decide": budgetDecide, "budget.delete": budgetDelete,
  "expense.save": expenseSave, "expense.delete": expenseDelete,
  "invoice.save": invoiceSave, "invoice.finalize": invoiceFinalize, "invoice.share": invoiceShare, "invoice.delete": invoiceDelete,
  "comment.add": commentAdd,
  "file.upload": fileUpload, "file.url": fileUrl,
};

// ── the public statement page (GET ?share=<token>) ───────────────────────────
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Row)[c]);
const money = (n: number) => "BDT " + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

export function statementHtml(inv: Row, lines: Row[], budget: Row | null): string {
  const total = lines.reduce((s, l) => s + num(l.qty) * num(l.unit_price), 0);
  const accent = /^#[0-9a-f]{3,8}$/i.test(inv.layout?.accent || "") ? inv.layout.accent : "#1F6FEB";
  const showQty = inv.layout?.showQty !== false;
  const rows = lines.map((l) => `<tr><td>${esc(l.description) || "—"}</td>${showQty ? `<td class="c">${num(l.qty)}</td><td class="r">${money(num(l.unit_price))}</td>` : ""}<td class="r">${money(num(l.qty) * num(l.unit_price))}</td></tr>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(inv.number)} · ${esc(inv.title)}</title>
<style>
  :root{color-scheme:light}body{margin:0;background:#eef0f3;font:14px/1.5 -apple-system,Segoe UI,Inter,sans-serif;color:#1a1d23}
  .wrap{max-width:720px;margin:24px auto;padding:0 16px}.bar{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:8px;flex-wrap:wrap}
  .btn{border:1px solid #cfd3d9;background:#fff;border-radius:8px;padding:8px 14px;font:inherit;font-weight:600;cursor:pointer}.btn.p{background:${accent};border-color:${accent};color:#fff}
  .sheet{background:#fff;border-radius:12px;padding:40px 44px;box-shadow:0 10px 30px rgba(0,0,0,.08);position:relative;overflow:hidden}
  .top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}h1{margin:0;font-size:26px;letter-spacing:-.3px}.logo{font-weight:900;font-size:20px;color:${accent}}
  .keys{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:24px 0;padding:14px 0;border-top:1px solid #e6e8eb;border-bottom:1px solid #e6e8eb}.keys span{display:block;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.08em}.keys b{font-size:14px}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:22px;font-size:13.5px;white-space:pre-line}.cols b{display:block;margin-bottom:4px}
  table{width:100%;border-collapse:collapse}th{text-align:left;font-size:12px;font-weight:500;color:#6b7280;padding:0 0 10px;border-bottom:1px solid #e6e8eb}td{padding:12px 0;border-bottom:1px solid #eef0f2;vertical-align:top}.c{text-align:center}.r{text-align:right;white-space:nowrap}
  .tot{display:flex;justify-content:flex-end;gap:40px;padding:16px 0;font-weight:800;font-size:17px}.tot b{color:${accent}}.notes{font-size:12.5px;color:#4b5563;white-space:pre-line}.foot{margin-top:28px;font-size:12px;color:#6b7280}
  .draft{position:absolute;right:-40px;top:28px;transform:rotate(35deg);background:#f59e0b;color:#111;font-weight:800;letter-spacing:.2em;padding:6px 60px;font-size:12px}
  @media print{body{background:#fff}.wrap{margin:0;padding:0;max-width:none}.bar{display:none}.sheet{box-shadow:none;border-radius:0;padding:0}}
</style></head><body><div class="wrap">
<div class="bar"><span>${esc(inv.number)} · ${inv.status === "FINAL" ? "Final" : "Draft"} statement</span><span><button class="btn p" onclick="window.print()">Print / Save as PDF</button></span></div>
<div class="sheet">${inv.status === "FINAL" ? "" : '<div class="draft">DRAFT</div>'}
<div class="top"><div><h1>${esc(inv.title)}</h1><div style="color:#6b7280">Internal expense statement</div></div><div class="logo">WEPRO</div></div>
<div class="keys"><div><span>Number</span><b>${esc(inv.number)}</b></div><div><span>Date</span><b>${esc(inv.issued_on || "")}</b></div><div><span>Budget</span><b>${esc(budget?.title || "")}</b></div></div>
<div class="cols"><div><b>From</b>${esc(inv.from_name) || "—"}</div><div><b>To</b>${esc(inv.bill_to) || "—"}</div></div>
<table><thead><tr><th>Description</th>${showQty ? '<th class="c">Qty</th><th class="r">Unit price</th>' : ""}<th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>
<div class="tot"><span>Total</span><b>${money(total)}</b></div>
${inv.notes ? `<div class="notes">${esc(inv.notes)}</div>` : ""}
<div class="foot">${esc(inv.layout?.footer || "")}${inv.layout?.footer ? " · " : ""}Prepared by ${esc(inv.created_by_name)} · This is an internal expense statement, not a tax invoice.</div>
</div></div>${inv.status === "FINAL" && /[?&]print=1/.test("") ? "" : ""}</body></html>`;
}

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
  return html(statementHtml(inv, lines, budgets[0] || null));
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
