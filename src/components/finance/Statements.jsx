import { useEffect, useRef, useState } from 'react';
import Mi from '../Mi.jsx';
import useNavState from '../../hooks/useNavState.js';
import { usePageOverlay } from '../../hooks/useNavHistory.js';
import { fmtBDT, fmtAgo } from '../../lib/helpers.js';
import { useProjectToast } from '../project/projectToast.js';
import {
  byId, linesOf, statementTotalText, expensesOf, shareLinks, statementDoc, renderStatement, isArchived,
  paymentOf, staleLinesOf, categoryOf, CATEGORIES, OTHERS, PAYMENT_LABEL, EXPENSE_KIND,
} from '../../lib/finance.js';
import { StatementForm, Modal, SelectAll, SelectRow, BulkBar } from './forms.jsx';
import useSelection from './useSelection.js';
import { Discussion, History, FileLink } from './Discussion.jsx';
import DocPreview from './DocPreview.jsx';

// Expense statements (internal invoices): the list, and one statement as a
// document with print / finalize / share. The document is drawn by the shared
// renderer (finance-doc.js) in a DocPreview frame, the same page the share
// link serves, and Print / PDF prints that frame.
//
// Two separate states, never mixed: the document is Draft or Final; payment
// (Paid / Partially paid / Committed / Not linked) comes from the expenses the
// lines link to.

const PAY_TONE = { PAID: 't-good', PARTIAL: 't-warn', COMMITTED: 't-info' };
export const StatusPill = ({ status }) => <span className={`fin-pill ${status === 'FINAL' ? 't-good' : 't-muted'}`}>{status === 'FINAL' ? 'Final' : 'Draft'}</span>;
export const PaymentPill = ({ state }) => (state === 'NONE' ? <span className="m">{PAYMENT_LABEL.NONE}</span> : <span className={`fin-pill ${PAY_TONE[state]}`}>{PAYMENT_LABEL[state]}</span>);
export const KindPill = ({ kind }) => <span className={`fin-pill ${kind === 'COMMITTED' ? 't-warn' : 't-info'}`}>{EXPENSE_KIND[kind] || kind}</span>;

// The statement editor wired to the finance store: a new statement on
// `budget`, or the draft `inv` reopened with its saved values and category.
export function StatementEditor({ api, user, budget, inv, onClose, onSaved }) {
  const { fin, act } = api;
  const toast = useProjectToast({ always: true });
  const lines = inv ? linesOf(fin, inv.id) : [];
  const taken = new Set(fin.lines.filter(l => l.isFinal && l.expenseId && l.invoiceId !== inv?.id).map(l => l.expenseId));
  const doc = inv ? statementDoc({ invoice: inv, lines, budget }) : null;
  return (
    <StatementForm budget={budget} expenses={expensesOf(fin, budget.id)} takenExpenseIds={taken} preparedBy={user.name}
      initial={inv ? { ...inv, ...doc.layout, accent: doc.accent, showQty: doc.showQty, footer: doc.footer, template: doc.template, currency: doc.currency } : undefined} initialLines={lines} onClose={onClose}
      onSave={async (i) => {
        const r = await act('invoice.save', { invoice: { ...i, id: inv?.id, budgetId: budget.id } });
        toast.success(inv ? 'Draft saved' : 'Draft statement saved', r.invoice.number);
        onSaved?.(r.invoice);
      }} />
  );
}

export default function Statements({ api, user, invoiceId, setInvoiceId, onOpenBudget }) {
  const { fin } = api;
  const inv = invoiceId ? byId(fin.invoices, invoiceId) : null;
  useEffect(() => { if (invoiceId && !inv) setInvoiceId(null); }, [invoiceId, inv, setInvoiceId]);
  return (
    <>
      <StatementList api={api} user={user} onOpen={setInvoiceId} onOpenBudget={onOpenBudget} />
      {inv && <StatementDoc api={api} user={user} inv={inv} onClose={() => setInvoiceId(null)} onOpenBudget={onOpenBudget} />}
    </>
  );
}

function StatementList({ api, user, onOpen, onOpenBudget }) {
  const { fin } = api;
  // Kept in the history entry, so Back and a reload come back to the same list.
  const [q, setQ] = useNavState('inventory.stmt.q', '');
  const [catKey, setCatKey] = useNavState('inventory.stmt.cat', 'ALL'); // ALL | '' (uncategorised) | a fixed name | Others
  const [catName, setCatName] = useNavState('inventory.stmt.catName', ''); // under Others: one custom name, '' = all of them
  const [status, setStatus] = useNavState('inventory.stmt.status', 'ALL'); // ALL | DRAFT | FINAL
  const [pay, setPay] = useNavState('inventory.stmt.pay', 'ALL'); // ALL | PAID | PARTIAL | COMMITTED | NONE
  const [picking, setPicking] = useState(false);
  const [newFor, setNewFor] = useState(null); // the budget a new statement goes on
  const term = q.trim().toLowerCase();
  const customNames = [...new Set(fin.invoices.map(i => categoryOf(i.category)).filter(c => c.key === OTHERS && c.name).map(c => c.name))].sort((a, b) => a.localeCompare(b));
  const rows = fin.invoices.filter(i => {
    const c = categoryOf(i.category);
    if (catKey !== 'ALL' && c.key !== catKey) return false;
    if (catKey === OTHERS && catName && c.name !== catName) return false;
    if (status !== 'ALL' && i.status !== status) return false;
    if (pay !== 'ALL' && paymentOf(fin, i.id) !== pay) return false;
    return !term || [i.number, i.title, c.label, byId(fin.budgets, i.budgetId)?.title].some(s => (s || '').toLowerCase().includes(term));
  });
  const filtered = catKey !== 'ALL' || status !== 'ALL' || pay !== 'ALL' || !!term;
  const sel = useSelection(rows);
  const [busy, setBusy] = useState(false);
  const toast = useProjectToast({ always: true });
  // Only drafts can be deleted; final statements in the selection stay.
  const removeDrafts = () => {
    const ids = sel.selected;
    const finals = fin.invoices.filter(i => ids.includes(i.id) && i.status === 'FINAL').length;
    const drafts = ids.length - finals;
    if (!drafts) { toast.error('Nothing to delete', 'Final statements can’t be deleted.'); return; }
    toast.confirm({
      title: `Delete ${drafts} draft${drafts === 1 ? '' : 's'}?`,
      description: `${finals ? `${finals} final statement${finals === 1 ? '' : 's'} in the selection stay${finals === 1 ? 's' : ''}: final statements can’t be deleted. ` : ''}Their history and discussion are kept.`,
      confirmLabel: 'Delete drafts',
      onConfirm: () => { setBusy(true); return api.act('invoice.deleteMany', { invoiceIds: ids }).then(r => { sel.clear(); toast.success(`${r.deleted} draft${r.deleted === 1 ? '' : 's'} deleted`); }).catch(e => toast.error('Not deleted', e.message)).finally(() => setBusy(false)); },
    });
  };
  return (
    <>
      <div className="fin-tools">
        <div className="acc-search fin-search"><Mi>search</Mi><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search statements" aria-label="Search statements" /></div>
        <select className="fsel fin-filter" value={catKey} onChange={e => { setCatKey(e.target.value); setCatName(''); }} aria-label="Category">
          <option value="ALL">All categories</option>
          <option value="">Uncategorised</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          <option value={OTHERS}>{OTHERS}</option>
        </select>
        {catKey === OTHERS && (
          <select className="fsel fin-filter" value={catName} onChange={e => setCatName(e.target.value)} aria-label="Custom category">
            <option value="">Every custom name</option>
            {customNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        )}
        {/* Status, payment and New statement: one line on phones (finance.css). */}
        <div className="fin-tools-row">
          <div className="fin-chips" role="group" aria-label="Status">
            {[['ALL', 'All'], ['DRAFT', 'Draft'], ['FINAL', 'Final']].map(([k, l]) => <button key={k} type="button" className={`fin-chip${status === k ? ' on' : ''}`} onClick={() => setStatus(k)}>{l}</button>)}
          </div>
          <select className="fsel fin-filter" value={pay} onChange={e => setPay(e.target.value)} aria-label="Payment">
            <option value="ALL">Any payment</option>
            {Object.entries(PAYMENT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <span className="sp" />
          <button type="button" className="btn btn-p" onClick={() => setPicking(true)}><Mi>add</Mi>New statement</button>
        </div>
      </div>
      <BulkBar sel={sel} noun="statement" onAction={removeDrafts} busy={busy} actionLabel="Delete drafts" actionIcon="delete" />
      <div className="fin-card">
        {rows.length === 0 ? <div className="fin-empty">{filtered ? 'No statements match.' : 'No statements yet. Choose “New statement” to write one against a budget.'}</div> : (
          <div className="fin-scroll"><table className="fin-tbl">
            <thead><tr><SelectAll sel={sel} label="Select all statements" /><th>Number</th><th>Title</th><th>Category</th><th>Budget</th><th>Date</th><th>Status</th><th>Payment</th><th className="r">Total</th><th>By</th></tr></thead>
            <tbody>{rows.map(i => { const b = byId(fin.budgets, i.budgetId); return (
              <tr key={i.id} className={`click${sel.has(i.id) ? ' on' : ''}`} onClick={() => onOpen(i.id)}>
                <SelectRow sel={sel} id={i.id} label={`Select ${i.number}`} />
                <td className="w"><span className="fin-ttl">{i.number}</span></td><td>{i.title}</td>
                <td className="m">{categoryOf(i.category).label}</td>
                <td className="m"><button type="button" className="fin-back" onClick={e => { e.stopPropagation(); b && onOpenBudget(b.id); }}>{b?.title || '—'}</button></td>
                <td className="m w">{i.issuedOn || '—'}</td>
                <td><StatusPill status={i.status} /></td>
                <td><PaymentPill state={paymentOf(fin, i.id)} /></td>
                <td className="r">{statementTotalText(i, linesOf(fin, i.id))}</td>
                <td className="m">{i.createdByName || '—'}<span className="fin-sub">{fmtAgo(i.createdAt)}</span></td>
              </tr>); })}</tbody>
          </table></div>
        )}
      </div>
      {picking && <BudgetPicker fin={fin} onClose={() => setPicking(false)} onPick={(b) => { setPicking(false); setNewFor(b); }} />}
      {newFor && <StatementEditor api={api} user={user} budget={newFor} onClose={() => setNewFor(null)} onSaved={(r) => onOpen(r.id)} />}
    </>
  );
}

// Any budget in use takes statements (budget approval is off); archived ones don't.
function BudgetPicker({ fin, onClose, onPick }) {
  usePageOverlay(true, onClose);
  const list = fin.budgets.filter(b => !isArchived(b));
  return (
    <Modal title="New statement · choose a budget" onClose={onClose}>
      {list.length === 0 ? <div className="fin-empty">No budgets yet. Create one under Budgets first.</div> : (
        <div className="fin-pick fin-budget-pick">{list.map(b => { const f = fin.figures[b.id] || {}; return (
          <button key={b.id} type="button" onClick={() => onPick(b)}>
            <span><b>{b.title}</b><span className="fin-sub">{[b.propertyName, b.teamName].filter(Boolean).join(' · ') || 'No project'}</span></span>
            <span className="a">{fmtBDT(f.remaining || 0)} left</span>
          </button>); })}</div>
      )}
    </Modal>
  );
}

function StatementDoc({ api, user, inv, onClose, onOpenBudget }) {
  const { fin, act, call } = api;
  const lines = linesOf(fin, inv.id);
  const budget = byId(fin.budgets, inv.budgetId);
  const doc = statementDoc({ invoice: inv, lines, budget, expenses: fin.expenses });
  const pay = paymentOf(fin, inv.id);
  const stale = inv.status === 'DRAFT' ? staleLinesOf(fin, inv.id) : [];
  const linked = [...new Set(lines.map(l => l.expenseId).filter(Boolean))].map(id => byId(fin.expenses, id)).filter(Boolean);
  const [panel, setPanel] = useState(null); // 'edit' | 'share' | 'expenses' | 'discussion' | 'history'
  const [shareUrl, setShareUrl] = useState('');
  const toast = useProjectToast({ always: true });
  const frame = useRef(null);
  const print = () => frame.current?.print();
  // Ctrl/⌘+P prints the document frame too, not the app page around it.
  useEffect(() => {
    const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'p' && frame.current) { e.preventDefault(); frame.current.print(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Back and Esc close the share panel first, then the statement. The editor
  // registers its own (guarded) entry above this one.
  const closeTop = () => (panel === 'share' ? setPanel(null) : onClose());
  usePageOverlay(true, closeTop);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && panel !== 'edit' && !e.defaultPrevented) closeTop(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const finalize = () => toast.confirm({
    title: `Finalize ${inv.number}?`, description: 'A final statement can’t be edited or deleted, and its expenses can’t change. A share link is issued.', confirmLabel: 'Finalize',
    onConfirm: () => act('invoice.finalize', { invoiceId: inv.id }).then(() => toast.success('Statement finalized')).catch(e => toast.error('Not finalized', e.message)),
  });
  const del = () => toast.confirm({ title: `Delete draft ${inv.number}?`, description: 'The draft is removed.', confirmLabel: 'Delete',
    onConfirm: () => act('invoice.delete', { invoiceId: inv.id }).then(() => { toast.success('Draft deleted'); onClose(); }).catch(e => toast.error('Not deleted', e.message)) });
  const share = async (rotate = false) => {
    try { const r = await act('invoice.share', { invoiceId: inv.id, rotate }); setShareUrl(r.url); setPanel('share'); if (rotate) toast.success('New link issued', 'The old link no longer works.'); }
    catch (e) { toast.error('Could not share', e.message); }
  };
  const copy = () => { navigator.clipboard?.writeText(shareUrl); toast.success('Link copied'); };
  const links = shareLinks(shareUrl, `${inv.number} · ${inv.title}`);
  const togglePanel = (k) => setPanel(panel === k ? null : k);

  return (
    <>
      <div className="inv-ov" onClick={onClose}>
        <div className="inv-doc" onClick={e => e.stopPropagation()} style={{ width: 'min(760px, 96vw)' }}>
          <div className="inv-bar fin-docbar">
            <span className="inv-bar-t"><Mi>receipt_long</Mi>{inv.number}<StatusPill status={inv.status} />{pay !== 'NONE' && <PaymentPill state={pay} />}</span>
            <div className="inv-bar-a">
              <button type="button" className="btn btn-g btn-sm" onClick={print} title="Print or save as PDF"><Mi>print</Mi>Print / PDF</button>
              {inv.status === 'DRAFT' && budget && <button type="button" className="btn btn-g btn-sm" onClick={() => setPanel('edit')}><Mi>edit</Mi>Edit</button>}
              {inv.status === 'DRAFT' && <button type="button" className="btn btn-p btn-sm" onClick={finalize} disabled={stale.length > 0} title={stale.length ? 'Fix the out-of-date lines first' : undefined}><Mi>check_circle</Mi>Finalize</button>}
              <button type="button" className="btn btn-g btn-sm" onClick={() => (shareUrl ? setPanel('share') : share(false))}><Mi>link</Mi>Share</button>
              <button type="button" className="btn btn-g btn-sm" onClick={() => togglePanel('expenses')} title="Linked expenses"><Mi>payments</Mi></button>
              <button type="button" className="btn btn-g btn-sm" onClick={() => togglePanel('discussion')} title="Discussion"><Mi>forum</Mi></button>
              <button type="button" className="btn btn-g btn-sm" onClick={() => togglePanel('history')} title="History"><Mi>history</Mi></button>
              {inv.status === 'DRAFT' && <button type="button" className="btn btn-g btn-sm ui-del" onClick={del} title="Delete draft"><Mi>delete</Mi></button>}
              <button type="button" className="m-x" onClick={onClose} aria-label="Close"><Mi>close</Mi></button>
            </div>
          </div>
          <div style={{ overflowY: 'auto' }}>
            {stale.length > 0 && <div className="fin-warn fin-doc-warn"><Mi>error</Mi>{stale.length === 1 ? 'One line no longer matches' : `${stale.length} lines no longer match`} the linked expense. Edit the statement to fix {stale.length === 1 ? 'it' : 'them'} before finalizing.</div>}
            <DocPreview ref={frame} html={renderStatement(doc)} title={`${inv.number} · ${inv.title}`} />
            {panel === 'expenses' && (
              <div className="fin-card fin-doc-panel">
                <div className="fin-card-hd"><span><Mi>payments</Mi>Linked expenses</span><span className="sub"><PaymentPill state={pay} /></span></div>
                {linked.length === 0 ? <div className="fin-empty">No line on this statement links to an expense.</div> : (
                  <div className="fin-scroll"><table className="fin-tbl">
                    <thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Kind</th><th>Paid via</th><th>Receipts</th><th className="r">Amount</th></tr></thead>
                    <tbody>{linked.map(e => (
                      <tr key={e.id}>
                        <td className="w m">{e.spentOn}</td><td><span className="fin-ttl">{e.description || '—'}</span></td>
                        <td className="m">{categoryOf(e.category).label}</td><td><KindPill kind={e.kind} /></td><td className="m">{e.paymentMethod || '—'}</td>
                        <td>{e.attachments?.length ? <div className="fin-files">{e.attachments.map((a, i) => <FileLink key={i} file={a} call={call} />)}</div> : <span className="m">—</span>}</td>
                        <td className="r">{fmtBDT(e.amount)}</td>
                      </tr>))}</tbody>
                  </table></div>
                )}
                {budget && <div className="fin-doc-panel-ft"><button type="button" className="fin-back" onClick={() => { onClose(); onOpenBudget(budget.id); }}><Mi>account_balance_wallet</Mi>Open budget · {budget.title}</button></div>}
              </div>
            )}
            {panel === 'discussion' && <div className="fin-card fin-doc-panel"><div className="fin-card-hd"><span><Mi>forum</Mi>Discussion</span></div><Discussion api={api} user={user} type="invoice" id={inv.id} /></div>}
            {panel === 'history' && <div className="fin-card fin-doc-panel"><div className="fin-card-hd"><span><Mi>history</Mi>History</span></div><History api={api} type="invoice" id={inv.id} /></div>}
          </div>
        </div>
      </div>
      {panel === 'edit' && budget && <StatementEditor api={api} user={user} budget={budget} inv={inv} onClose={() => setPanel(null)} />}
      {panel === 'share' && (
        <Modal title={`Share ${inv.number}`} onClose={() => setPanel(null)}>
          <div className="fin-share">
            <div className="fin-help">Anyone with this link can view and print the statement. It is unguessable and can be replaced at any time.{inv.status !== 'FINAL' ? ' The page shows a DRAFT watermark until the statement is finalized.' : ''}</div>
            <div className="fin-share-url"><input className="fi" readOnly value={shareUrl} onFocus={e => e.target.select()} /><button type="button" className="btn btn-g btn-sm" onClick={copy}><Mi>content_copy</Mi>Copy</button></div>
            <div className="fin-share-row">
              <a className="btn btn-g btn-sm" href={links.mailto}><Mi>mail</Mi>Email</a>
              <a className="btn btn-g btn-sm" href={links.whatsapp} target="_blank" rel="noopener noreferrer"><Mi>chat</Mi>WhatsApp</a>
              <a className="btn btn-g btn-sm" href={shareUrl} target="_blank" rel="noopener noreferrer"><Mi>visibility</Mi>Open</a>
              <span className="sp" style={{ flex: 1 }} />
              <button type="button" className="btn btn-g btn-sm" onClick={() => share(true)}><Mi>sync</Mi>Replace link</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
