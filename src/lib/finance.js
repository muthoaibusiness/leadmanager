import { useEffect, useState } from 'react';
import { SB_URL, SB_KEY } from './supabase.js';
import { categoryOf, paymentStatus, staleLines, fmtMoney } from '../../supabase/functions/_shared/finance-doc.js';

// Admin → Inventory: budgets, expenses and expense statements. Internal money,
// not property inventory and not customer billing.
//
// The browser never reads the finance_* tables over PostgREST (they carry no
// anon policy). Everything goes through the `finance` Edge Function
// (supabase/functions/finance), which checks the acting user against the users
// table and computes every figure. This file is the client of that function
// plus a small in-memory store: nothing here is cached in localStorage.

export const FIN_URL = `${SB_URL}/functions/v1/finance`;

// Budget approval is turned off: a budget is usable as soon as it exists.
// Approval records from before stay readable (History, and the note on a
// budget that was approved); the app no longer writes them.
export const EXPENSE_KIND = { COMMITTED: 'Committed', PAID: 'Paid' };
export const PAY_METHODS = ['Cash', 'Bank transfer', 'Card', 'bKash / Nagad', 'Cheque'];
export const ACTION_LABELS = {
  created: 'Created', updated: 'Edited', submitted: 'Submitted for approval', decided: 'Decision', deleted: 'Deleted',
  overrun: 'Budget overrun', finalized: 'Finalized', shared: 'Share link issued',
  archived: 'Archived', restored: 'Restored', corrected: 'Correction',
};

// Shared with the Edge Function's share page, so both sides agree: the
// renderer, categories (stored text → label), and payment / stale-line rules.
export {
  statementDoc, renderStatement, money as docMoney, fmtMoney,
  CATEGORIES, OTHERS, categoryOf, categoryValue,
  PAYMENT_LABEL, paymentStatus, staleLines,
  TEMPLATES, TEMPLATE_LIST, templateOf, templateForCategory, CURRENCIES, periodEnd, impressionsFor, adSetExtra, paginateDoc,
  docDate, time12, newReferenceId, newTransactionId, newInvoiceNo,
} from '../../supabase/functions/_shared/finance-doc.js';

// snake_case rows → camelCase, recursively. Map keys that are ids (figures) are
// kept as they are by the caller.
export const camel = (v) => (Array.isArray(v) ? v.map(camel)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase()), camel(x)]))
  : v);

// One call to the function. Throws an Error carrying the server's message;
// `error.data` holds the rest of the answer (e.g. { code: 'ON_DRAFTS', drafts }).
export async function finCall(user, action, payload = {}) {
  let r;
  try {
    r = await fetch(FIN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SB_KEY }, body: JSON.stringify({ userId: user?.id || null, action, ...payload }) });
  } catch {
    // A missing function answers 404 without CORS headers, which the browser reports as a network failure.
    throw new Error('Could not reach the finance service. Either you are offline, or the `finance` function is not deployed to this Supabase project yet.');
  }
  let j = null;
  try { j = await r.json(); } catch { /* not JSON */ }
  if (!r.ok) {
    if (r.status === 404 && !j?.error) throw new Error('The finance service is not deployed yet (supabase functions deploy finance).');
    const err = new Error(j?.error || `Request failed (HTTP ${r.status})`);
    err.data = j || {};
    throw err;
  }
  const { figures, ...rest } = j || {};
  return { ...camel(rest), ...(figures ? { figures } : {}) };
}

// ── store ──
let _c = { key: null, data: null, error: null, loading: null };
const subs = new Set();
const emit = () => subs.forEach(f => f());

export function loadFinance(user, force = false) {
  if (!user?.id) return Promise.resolve(null);
  if (!force && _c.key === user.id && (_c.data || _c.loading)) return _c.loading || Promise.resolve(_c.data);
  const key = user.id;
  const p = finCall(user, 'load')
    .then(d => { if (_c.key === key) { _c.data = d; _c.error = null; } })
    .catch(e => { if (_c.key === key) _c.error = e.message; })
    .finally(() => { if (_c.key === key) _c.loading = null; emit(); });
  _c = { key, data: _c.key === key ? _c.data : null, error: null, loading: p };
  emit();
  return p;
}
export function clearFinance() { _c = { key: null, data: null, error: null, loading: null }; emit(); }

// `fin` is the loaded state (null until the first load lands), `act` runs an
// action and reloads, `call` runs one without reloading (file links).
export function useFinance(user) {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick(x => x + 1);
    subs.add(f);
    loadFinance(user);
    return () => { subs.delete(f); };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- keyed on the account, not the object
  const mine = _c.key === user?.id;
  return {
    fin: mine ? _c.data : null,
    error: mine ? _c.error : null,
    loading: mine && !!_c.loading,
    reload: () => loadFinance(user, true),
    act: async (action, payload) => { const r = await finCall(user, action, payload); await loadFinance(user, true); return r; },
    call: (action, payload) => finCall(user, action, payload),
  };
}

// ── derived, display only (every money figure comes from the function) ──
export const byId = (rows, id) => (rows || []).find(r => r.id === id) || null;
export const approvalsOf = (fin, budgetId) => (fin?.approvals || []).filter(a => a.budgetId === budgetId).sort((a, b) => String(b.decidedAt).localeCompare(String(a.decidedAt)));
export const expensesOf = (fin, budgetId) => (fin?.expenses || []).filter(e => e.budgetId === budgetId);
export const linesOf = (fin, invoiceId) => (fin?.lines || []).filter(l => l.invoiceId === invoiceId).sort((a, b) => a.position - b.position);
export const statementTotal = (lines) => lines.reduce((s, l) => s + Number(l.qty || 0) * Number(l.unitPrice || 0), 0);
export const commentsOf = (fin, type, id) => (fin?.comments || []).filter(c => c.entityType === type && c.entityId === id);
export const eventsOf = (fin, type, id) => (fin?.events || []).filter(e => e.entityType === type && e.entityId === id);
export const isArchived = (b) => !!b?.archivedAt;
// A statement's payment, from the expenses its lines link to (shared rule).
export const paymentOf = (fin, invoiceId) => paymentStatus(linesOf(fin, invoiceId), fin?.expenses);
export const staleLinesOf = (fin, invoiceId) => staleLines(linesOf(fin, invoiceId), fin?.expenses, byId(fin?.invoices, invoiceId)?.layout?.currency || 'BDT');
// A budget's projects as one label. Budgets saved before 0024 have only propertyName.
export const projectNames = (b) => (b?.projects?.length ? b.projects.map(p => p.name).filter(Boolean).join(', ') : b?.propertyName || '');
// A statement's total in its own currency (a vendor template may bill in USD).
export const statementTotalText = (inv, lines) => fmtMoney(statementTotal(lines), inv?.layout?.currency || 'BDT');

// Overview totals: the per-budget figures from the function, summed over the
// budgets in use (archived ones hold no expenses). The breakdowns count
// expenses whose date falls in the picked range.
export function overviewOf(fin, range) {
  const out = { amount: 0, committed: 0, spent: 0, remaining: 0, budgets: 0, overruns: 0, byProject: [], byCategory: [], byMember: [] };
  if (!fin) return out;
  for (const b of fin.budgets) {
    if (isArchived(b)) continue;
    const f = fin.figures[b.id] || {};
    out.budgets++;
    out.amount += f.amount || 0; out.committed += f.committed || 0; out.spent += f.spent || 0; out.remaining += f.remaining || 0;
    if (f.overrun) out.overruns++;
  }
  const inRange = (e) => { if (!range) return true; const d = new Date(e.spentOn + 'T00:00:00'); return d >= range.start && d <= range.end; };
  const group = (key, name) => {
    const m = new Map();
    for (const e of fin.expenses) {
      if (!inRange(e)) continue;
      const k = key(e) || '—';
      const row = m.get(k) || { name: name(e) || '—', committed: 0, spent: 0 };
      if (e.kind === 'COMMITTED') row.committed += Number(e.amount); else row.spent += Number(e.amount);
      m.set(k, row);
    }
    return [...m.values()].sort((a, b) => (b.spent + b.committed) - (a.spent + a.committed));
  };
  const budgetOf = (e) => byId(fin.budgets, e.budgetId);
  // An expense without its own project counts under its budget's projects (joined, when several).
  out.byProject = group(e => e.propertyId || (budgetOf(e)?.projects || []).map(p => p.id).join('+') || budgetOf(e)?.propertyId, e => e.propertyName || projectNames(budgetOf(e)) || 'No project');
  out.byCategory = group(e => categoryOf(e.category).label, e => categoryOf(e.category).label);
  out.byMember = group(e => e.spentBy, e => e.spentByName || 'Unassigned');
  return out;
}

// Files: the browser sends base64; the function stores it and signs reads.
export const readAsBase64 = (file) => new Promise((res, rej) => {
  const fr = new FileReader();
  fr.onload = () => res(String(fr.result).split(',')[1] || '');
  fr.onerror = () => rej(new Error('Could not read the file'));
  fr.readAsDataURL(file);
});

// Share: a mail draft and a WhatsApp message carrying the statement link.
export const shareLinks = (url, title) => ({
  mailto: `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(`${title}\n${url}`)}`,
  whatsapp: `https://wa.me/?text=${encodeURIComponent(`${title}\n${url}`)}`,
});
