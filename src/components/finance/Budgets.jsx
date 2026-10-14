import { useEffect, useState } from 'react';
import Mi from '../Mi.jsx';
import useNavState from '../../hooks/useNavState.js';
import { fmtBDT, fmtAgo } from '../../lib/helpers.js';
import { useProjectToast } from '../project/projectToast.js';
import { byId, approvalsOf, expensesOf, linesOf, statementTotalText, isArchived, paymentOf, staleLinesOf, categoryOf, projectNames } from '../../lib/finance.js';
import { BudgetForm, ExpenseForm, SelectAll, SelectRow, BulkBar } from './forms.jsx';
import useSelection from './useSelection.js';
import { Discussion, History, FileLink } from './Discussion.jsx';
import { StatementEditor, StatusPill, PaymentPill, KindPill } from './Statements.jsx';

// Budgets: usable as soon as they are created (budget approval is off). The
// figures (amount, committed, spent, remaining, overrun) come ready-made from
// the finance function, the same numbers the Overview sums. A budget is edited,
// archived and restored by its creator or a "Manage all budgets" holder; the
// function checks that again.
export default function Budgets({ api, user, budgetId, setBudgetId, onOpenStatement }) {
  const { fin } = api;
  const budget = budgetId ? byId(fin.budgets, budgetId) : null;
  useEffect(() => { if (budgetId && !budget) setBudgetId(null); }, [budgetId, budget, setBudgetId]);
  return budget
    ? <BudgetDetail api={api} user={user} budget={budget} onBack={() => setBudgetId(null)} onOpenStatement={onOpenStatement} />
    : <BudgetList api={api} user={user} onOpen={setBudgetId} />;
}

function BudgetList({ api, onOpen }) {
  const { fin, act } = api;
  const [q, setQ] = useState('');
  const [showArchived, setShowArchived] = useNavState('inventory.budgets.archived', false);
  const [form, setForm] = useState(false);
  const toast = useProjectToast({ always: true });
  const term = q.trim().toLowerCase();
  const archived = fin.budgets.filter(isArchived).length;
  const rows = fin.budgets.filter(b => (showArchived || !isArchived(b)) && (!term || [b.title, b.purpose, projectNames(b), b.teamName, b.createdByName].some(s => (s || '').toLowerCase().includes(term))));
  // Archive several at once. The function archives only the empty budgets this
  // account may change (its own, or any with Manage all budgets) and says which
  // it left alone.
  const sel = useSelection(rows);
  const [busy, setBusy] = useState(false);
  const archiveSelected = () => {
    const ids = sel.selected;
    toast.confirm({
      title: `Archive ${ids.length} budget${ids.length === 1 ? '' : 's'}?`,
      description: 'Only empty budgets (no expenses or statements) that you may change are archived. Their history, discussion and approval records stay, and each can be restored.',
      confirmLabel: 'Archive',
      onConfirm: () => { setBusy(true); return act('budget.archiveMany', { budgetIds: ids }).then(r => {
        sel.clear();
        const n = r.archived.length, k = r.skipped.length;
        (n ? toast.success : toast.error)(`${n} budget${n === 1 ? '' : 's'} archived`, k ? `Left as they are: ${r.skipped.map(x => `${x.title} (${x.why})`).join('; ')}` : undefined);
      }).catch(e => toast.error('Not archived', e.message)).finally(() => setBusy(false)); },
    });
  };
  return (
    <>
      <div className="fin-tools">
        <div className="acc-search fin-search"><Mi>search</Mi><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search budgets" aria-label="Search budgets" /></div>
        {archived > 0 && <label className="fin-check"><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />Show archived ({archived})</label>}
        <span className="sp" />
        <button type="button" className="btn btn-p" onClick={() => setForm(true)}><Mi>add</Mi>New budget</button>
      </div>
      <BulkBar sel={sel} noun="budget" onAction={archiveSelected} busy={busy} actionLabel="Archive" actionIcon="inventory_2" />
      <div className="fin-card">
        {rows.length === 0 ? <div className="fin-empty">{fin.budgets.length ? 'No budgets match.' : 'No budgets yet. Create the first one.'}</div> : (
          <div className="fin-scroll"><table className="fin-tbl">
            <thead><tr><SelectAll sel={sel} label="Select all budgets" /><th>Budget</th><th>Projects</th><th>Team</th><th className="r">Amount</th><th className="r">Committed</th><th className="r">Spent</th><th className="r">Remaining</th></tr></thead>
            <tbody>{rows.map(b => { const f = fin.figures[b.id] || {}; return (
              <tr key={b.id} className={`click${isArchived(b) ? ' fin-row-archived' : ''}${sel.has(b.id) ? ' on' : ''}`} onClick={() => onOpen(b.id)}>
                <SelectRow sel={sel} id={b.id} label={`Select ${b.title}`} />
                <td><span className="fin-ttl">{b.title}{isArchived(b) && <span className="fin-pill t-muted" style={{ marginLeft: 8 }}>Archived</span>}</span><span className="fin-sub">{b.createdByName || '—'} · {fmtAgo(b.updatedAt)}</span></td>
                <td className="m">{projectNames(b) || '—'}</td><td className="m">{b.teamName || '—'}</td>
                <td className="r">{fmtBDT(f.amount || 0)}</td>
                <td className="r">{f.committed ? fmtBDT(f.committed) : <span className="m">—</span>}</td>
                <td className="r">{f.spent ? fmtBDT(f.spent) : <span className="m">—</span>}</td>
                <td className={`r${f.overrun ? ' over' : ''}`}>{f.overrun && <Mi style={{ fontSize: 15, verticalAlign: -3 }}>warning</Mi>} {fmtBDT(f.remaining || 0)}</td>
              </tr>); })}</tbody>
          </table></div>
        )}
      </div>
      {form && <BudgetForm onClose={() => setForm(false)} onSave={async (b) => { const r = await act('budget.save', { budget: b }); toast.success('Budget created', `${r.budget.title} is ready to use.`); onOpen(r.budget.id); }} />}
    </>
  );
}

function BudgetDetail({ api, user, budget, onBack, onOpenStatement }) {
  const { fin, act, call } = api;
  const f = fin.figures[budget.id] || {};
  const expenses = expensesOf(fin, budget.id);
  // Drafts first, then newest.
  const statements = fin.invoices.filter(i => i.budgetId === budget.id)
    .sort((a, b) => (a.status === 'DRAFT' ? 0 : 1) - (b.status === 'DRAFT' ? 0 : 1) || String(b.createdAt).localeCompare(String(a.createdAt)));
  const drafts = statements.filter(i => i.status === 'DRAFT').length;
  const canManage = budget.createdBy === user.id || !!fin.actor?.manageAll;
  const archived = isArchived(budget);
  const canArchive = canManage && !archived && expenses.length === 0 && statements.length === 0;
  // A budget approved before approval was turned off keeps that amount as its limit.
  const approval = f.source === 'approval' ? approvalsOf(fin, budget.id).find(a => a.decision === 'APPROVED') : null;
  const [sub, setSub] = useState('expenses');
  const [modal, setModal] = useState(null); // { kind: 'edit' | 'expense' | 'statement', data }
  const toast = useProjectToast({ always: true });
  const finalIds = new Set(fin.lines.filter(l => l.isFinal && l.expenseId).map(l => l.expenseId));

  // An expense on a draft statement is only deleted after a second "yes": its
  // lines then come off those drafts too (the server names them).
  const removeExpense = (e) => toast.confirm({
    title: 'Delete this expense?', description: 'The amount comes off the budget.', confirmLabel: 'Delete',
    onConfirm: () => act('expense.delete', { expenseId: e.id }).then(() => toast.success('Expense deleted')).catch(err => {
      if (err.data?.code !== 'ON_DRAFTS') { toast.error('Not deleted', err.message); return; }
      toast.confirm({
        title: 'It is on a draft statement', description: `${err.message}. Delete it and take its lines off ${err.data.drafts.length === 1 ? 'that draft' : 'those drafts'}? Each draft’s history will say so.`, confirmLabel: 'Delete and remove lines',
        onConfirm: () => act('expense.delete', { expenseId: e.id, removeFromDrafts: true }).then(() => toast.success('Expense deleted', 'Its lines were taken off the drafts.')).catch(x => toast.error('Not deleted', x.message)),
      });
    }),
  });
  const archive = () => toast.confirm({
    title: `Archive “${budget.title}”?`, description: 'It leaves the budget list and the overview. Its history, discussion and any approval record stay with it, and it can be restored.', confirmLabel: 'Archive',
    onConfirm: () => act('budget.archive', { budgetId: budget.id }).then(() => toast.success('Budget archived')).catch(e => toast.error('Not archived', e.message)),
  });
  const restore = () => act('budget.restore', { budgetId: budget.id }).then(() => toast.success('Budget restored')).catch(e => toast.error('Not restored', e.message));

  const TABS = [['expenses', 'Expenses', expenses.length], ['statements', 'Statements', statements.length, drafts], ['discussion', 'Discussion', fin.comments.filter(c => c.entityType === 'budget' && c.entityId === budget.id).length], ['history', 'History', null]];
  return (
    <>
      <button type="button" className="fin-back" onClick={onBack}><Mi>arrow_back</Mi>All budgets</button>
      <div className="fin-dhd">
        <div>
          <h2>{budget.title}{archived && <span className="fin-pill t-muted">Archived</span>}</h2>
          <div className="fin-dmeta">
            {projectNames(budget) && <span><Mi>apartment</Mi>{projectNames(budget)}</span>}
            {budget.teamName && <span><Mi>groups</Mi>{budget.teamName}</span>}
            <span><Mi>person</Mi>{budget.createdByName || '—'}</span>
            <span><Mi>schedule</Mi>{fmtAgo(budget.updatedAt)}</span>
            {budget.purpose && <span><Mi>description</Mi>{budget.purpose}</span>}
          </div>
        </div>
        <div className="fin-dacts">
          {canManage && !archived && <button type="button" className="btn btn-g btn-sm" onClick={() => setModal({ kind: 'edit' })}><Mi>edit</Mi>Edit</button>}
          {!archived && <button type="button" className="btn btn-p btn-sm" onClick={() => setModal({ kind: 'expense' })}><Mi>add</Mi>Record expense</button>}
          {!archived && <button type="button" className="btn btn-g btn-sm" onClick={() => setModal({ kind: 'statement' })}><Mi>receipt_long</Mi>New statement</button>}
          {canArchive && <button type="button" className="btn btn-g btn-sm" onClick={archive} title="Archive this budget"><Mi>inventory_2</Mi>Archive</button>}
          {canManage && archived && <button type="button" className="btn btn-p btn-sm" onClick={restore}><Mi>unarchive</Mi>Restore</button>}
        </div>
      </div>

      <div className="fin-kpis">
        <div className="fin-kpi"><div className="l">Amount</div><div className="v">{fmtBDT(f.amount || 0)}</div><div className="s">{approval ? `approved by ${approval.decidedByName || '—'} · ${fmtAgo(approval.decidedAt)}` : 'spending limit'}</div></div>
        <div className="fin-kpi t-warn"><div className="l">Committed</div><div className="v">{fmtBDT(f.committed || 0)}</div><div className="s">ordered, not yet paid</div></div>
        <div className="fin-kpi"><div className="l">Spent · actual</div><div className="v">{fmtBDT(f.spent || 0)}</div><div className="s">paid out</div></div>
        <div className={`fin-kpi${f.overrun ? ' t-bad' : ''}`}><div className="l">Remaining</div><div className="v">{fmtBDT(f.remaining || 0)}</div><div className="s">amount − committed − spent</div></div>
      </div>
      {f.overrun && <div className="fin-warn"><Mi>warning</Mi>Over budget by {fmtBDT(-f.remaining)}: committed and spent exceed the budget amount.</div>}
      {approval && <div className="fin-info"><Mi>verified</Mi>Approved for {fmtBDT(approval.approvedAmount)} by {approval.decidedByName || '—'} before budget approval was turned off. That amount is this budget’s limit; editing the budget keeps it unless you change it.</div>}
      {archived && <div className="fin-info"><Mi>inventory_2</Mi>Archived {fmtAgo(budget.archivedAt)}. {canManage ? 'Restore it to record expenses or statements.' : 'Its creator or someone with Manage all budgets can restore it.'}</div>}
      {!canManage && !archived && <div className="fin-help" style={{ marginBottom: 10 }}>Only its creator or someone with Manage all budgets can edit or archive this budget.</div>}
      {budget.notes && <div className="fin-note">{budget.notes}</div>}

      <div className="fin-card">
        <div className="fin-subtabs">{TABS.map(([k, l, n, d]) => <button key={k} type="button" className={sub === k ? 'on' : ''} onClick={() => setSub(k)}>{l}{n != null && <span className="n">{n}</span>}{d > 0 && <span className="n fin-n-draft">{d} draft{d === 1 ? '' : 's'}</span>}</button>)}</div>
        {sub === 'expenses' && (expenses.length === 0 ? <div className="fin-empty">{archived ? 'Archived budgets take no expenses.' : 'No expenses recorded yet.'}</div> : (
          <div className="fin-scroll"><table className="fin-tbl">
            <thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Kind</th><th>By</th><th>Paid via</th><th>Receipts</th><th className="r">Amount</th><th /></tr></thead>
            <tbody>{expenses.map(e => { const locked = finalIds.has(e.id); return (
              <tr key={e.id}>
                <td className="w m">{e.spentOn}</td>
                <td><span className="fin-ttl">{e.description || '—'}</span>{e.propertyName && <span className="fin-sub">{e.propertyName}</span>}</td>
                <td className="m">{categoryOf(e.category).label}</td><td><KindPill kind={e.kind} /></td><td className="m">{e.spentByName || '—'}</td><td className="m">{e.paymentMethod || '—'}</td>
                <td>{e.attachments?.length ? <div className="fin-files">{e.attachments.map((a, i) => <FileLink key={i} file={a} call={call} />)}</div> : <span className="m">—</span>}</td>
                <td className="r">{fmtBDT(e.amount)}</td>
                <td><div className="acts">
                  <button type="button" className="btn btn-g btn-sm" disabled={locked || archived} title={locked ? 'On a final statement' : 'Edit'} onClick={() => setModal({ kind: 'expense', data: e })}><Mi>edit</Mi></button>
                  <button type="button" className="btn btn-g btn-sm ui-del" disabled={locked} title={locked ? 'On a final statement' : 'Delete'} onClick={() => removeExpense(e)}><Mi>delete</Mi></button>
                </div></td>
              </tr>); })}</tbody>
          </table></div>
        ))}
        {sub === 'statements' && (statements.length === 0 ? <div className="fin-empty">No statements for this budget.</div> : (
          <div className="fin-scroll"><table className="fin-tbl">
            <thead><tr><th>Number</th><th>Title</th><th>Category</th><th>Date</th><th>Status</th><th>Payment</th><th className="r">Total</th><th /></tr></thead>
            <tbody>{statements.map(i => { const stale = i.status === 'DRAFT' && staleLinesOf(fin, i.id).length > 0; return (
              <tr key={i.id} className="click" onClick={() => onOpenStatement(i.id)}>
                <td className="w"><span className="fin-ttl">{i.number}</span></td>
                <td>{i.title}{stale && <span className="fin-sub fin-stale"><Mi>error</Mi>Out of date</span>}</td>
                <td className="m">{categoryOf(i.category).label}</td>
                <td className="m w">{i.issuedOn || '—'}</td>
                <td><StatusPill status={i.status} /></td>
                <td><PaymentPill state={paymentOf(fin, i.id)} /></td>
                <td className="r">{statementTotalText(i, linesOf(fin, i.id))}</td>
                <td>{i.status === 'DRAFT' && !archived && <button type="button" className="btn btn-g btn-sm" onClick={e => { e.stopPropagation(); setModal({ kind: 'statement', data: i }); }}><Mi>edit</Mi>Edit draft</button>}</td>
              </tr>); })}</tbody>
          </table></div>
        ))}
        {sub === 'discussion' && <Discussion api={api} user={user} type="budget" id={budget.id} />}
        {sub === 'history' && <History api={api} type="budget" id={budget.id} />}
      </div>

      {modal?.kind === 'edit' && <BudgetForm initial={{ ...budget, draftAmount: f.amount }} onClose={() => setModal(null)} onSave={(b) => act('budget.save', { budget: { ...b, id: budget.id, baseAmount: f.amount } }).then(() => toast.success('Budget saved'))} />}
      {modal?.kind === 'expense' && <ExpenseForm budget={budget} initial={modal.data} upload={(p) => call('file.upload', p)} onClose={() => setModal(null)}
        onSave={(e) => act('expense.save', { expense: { ...e, id: modal.data?.id, budgetId: budget.id } }).then(r => (r.figures.overrun ? toast.warning('Recorded · over budget', `Remaining is now ${fmtBDT(r.figures.remaining)}.`) : toast.success('Expense recorded')))} />}
      {modal?.kind === 'statement' && <StatementEditor api={api} user={user} budget={budget} inv={modal.data} onClose={() => setModal(null)} onSaved={(r) => { if (!modal.data) onOpenStatement(r.id); }} />}
    </>
  );
}
