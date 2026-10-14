import { useState } from 'react';
import Mi from '../Mi.jsx';
import { fmtBDT, fmtAgo } from '../../lib/helpers.js';
import { useProjectToast } from '../project/projectToast.js';
import { EXPENSE_KIND, byId, expensesOf, linesOf, statementTotalText, projectNames } from '../../lib/finance.js';
import { BudgetForm, ExpenseForm, StatementForm, SelectAll, SelectRow, BulkBar } from './forms.jsx';
import useSelection from './useSelection.js';
import { Discussion, History, FileLink } from './Discussion.jsx';

const KindPill = ({ kind }) => <span className={`fin-pill ${kind === 'COMMITTED' ? 't-warn' : 't-info'}`}>{EXPENSE_KIND[kind] || kind}</span>;

export default function Budgets({ api, user, budgetId, setBudgetId, onOpenStatement }) {
  const { fin } = api;
  const budget = budgetId ? byId(fin.budgets, budgetId) : null;
  if (budgetId && !budget) setBudgetId(null);
  return budget
    ? <BudgetDetail api={api} user={user} budget={budget} onBack={() => setBudgetId(null)} onOpenStatement={onOpenStatement} />
    : <BudgetList api={api} user={user} onOpen={setBudgetId} />;
}

function BudgetList({ api, onOpen }) {
  const { fin, act } = api;
  const [q, setQ] = useState('');
  const [form, setForm] = useState(false);
  const toast = useProjectToast({ always: true });
  const term = q.trim().toLowerCase();
  const rows = fin.budgets.filter(b => !term || [b.title, b.purpose, projectNames(b), b.teamName, b.createdByName].some(s => (s || '').toLowerCase().includes(term)));
  const sel = useSelection(rows);
  const [busy, setBusy] = useState(false);
  const removeSelected = () => {
    const ids = sel.selected;
    const ex = fin.expenses.filter(e => ids.includes(e.budgetId)).length;
    const st = fin.invoices.filter(i => ids.includes(i.budgetId)).length;
    const parts = [ex && `${ex} expense${ex === 1 ? '' : 's'}`, st && `${st} statement${st === 1 ? '' : 's'}`].filter(Boolean);
    toast.confirm({
      title: `Delete ${ids.length} budget${ids.length === 1 ? '' : 's'}?`,
      description: `${parts.length ? `Their ${parts.join(' and ')} are deleted too. ` : ''}This can't be undone.`,
      confirmLabel: 'Delete',
      onConfirm: () => { setBusy(true); return act('budget.deleteMany', { budgetIds: ids }).then(r => { sel.clear(); toast.success(`${r.deleted} budget${r.deleted === 1 ? '' : 's'} deleted`); }).catch(e => toast.error('Not deleted', e.message)).finally(() => setBusy(false)); },
    });
  };
  return (
    <>
      <div className="fin-tools">
        <div className="acc-search fin-search"><Mi>search</Mi><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search budgets" aria-label="Search budgets" /></div>
        <span className="sp" />
        <button type="button" className="btn btn-p" onClick={() => setForm(true)}><Mi>add</Mi>New budget</button>
      </div>
      <BulkBar sel={sel} noun="budget" onDelete={removeSelected} busy={busy} />
      <div className="fin-card">
        {rows.length === 0 ? <div className="fin-empty">{fin.budgets.length ? 'No budgets match.' : 'No budgets yet. Create the first one.'}</div> : (
          <div className="fin-scroll"><table className="fin-tbl">
            <thead><tr><SelectAll sel={sel} label="Select all budgets" /><th>Budget</th><th>Projects</th><th>Team</th><th className="r">Amount</th><th className="r">Committed</th><th className="r">Spent</th><th className="r">Remaining</th></tr></thead>
            <tbody>{rows.map(b => { const f = fin.figures[b.id] || {}; return (
              <tr key={b.id} className={`click${sel.has(b.id) ? ' on' : ''}`} onClick={() => onOpen(b.id)}>
                <SelectRow sel={sel} id={b.id} label={`Select ${b.title}`} />
                <td><span className="fin-ttl">{b.title}</span><span className="fin-sub">{b.createdByName || '—'} · {fmtAgo(b.updatedAt)}</span></td>
                <td className="m">{projectNames(b) || '—'}</td><td className="m">{b.teamName || '—'}</td>
                <td className="r">{fmtBDT(f.amount || 0)}</td>
                <td className="r">{f.committed ? fmtBDT(f.committed) : <span className="m">—</span>}</td>
                <td className="r">{f.spent ? fmtBDT(f.spent) : <span className="m">—</span>}</td>
                <td className={`r${f.overrun ? ' over' : ''}`}>{f.overrun && <Mi style={{ fontSize: 15, verticalAlign: -3 }}>warning</Mi>} {fmtBDT(f.remaining || 0)}</td>
              </tr>); })}</tbody>
          </table></div>
        )}
      </div>
      {form && <BudgetForm onClose={() => setForm(false)} onSave={async (b) => { const r = await act('budget.save', { budget: b }); toast.success('Budget created', r.budget.title); onOpen(r.budget.id); }} />}
    </>
  );
}

function BudgetDetail({ api, user, budget, onBack, onOpenStatement }) {
  const { fin, act, call } = api;
  const f = fin.figures[budget.id] || {};
  const expenses = expensesOf(fin, budget.id);
  const statements = fin.invoices.filter(i => i.budgetId === budget.id);
  const [sub, setSub] = useState('expenses');
  const [modal, setModal] = useState(null); // { kind, data }
  const toast = useProjectToast({ always: true });
  const finalIds = new Set(fin.lines.filter(l => l.isFinal && l.expenseId).map(l => l.expenseId));
  const remove = (kind, id) => toast.confirm({
    title: kind === 'budget' ? 'Delete this budget?' : 'Delete this expense?',
    description: kind === 'budget'
      ? `${expenses.length || statements.length ? `Its ${[expenses.length && `${expenses.length} expense${expenses.length === 1 ? '' : 's'}`, statements.length && `${statements.length} statement${statements.length === 1 ? '' : 's'}`].filter(Boolean).join(' and ')} are deleted too. ` : ''}This can't be undone.`
      : 'The amount comes off the budget.',
    confirmLabel: 'Delete',
    onConfirm: () => (kind === 'budget' ? act('budget.delete', { budgetId: id }).then(onBack) : act('expense.delete', { expenseId: id })).catch(e => toast.error('Not deleted', e.message)),
  });
  const TABS = [['expenses', 'Expenses', expenses.length], ['statements', 'Statements', statements.length], ['discussion', 'Discussion', fin.comments.filter(c => c.entityType === 'budget' && c.entityId === budget.id).length], ['history', 'History', null]];
  return (
    <>
      <button type="button" className="fin-back" onClick={onBack}><Mi>arrow_back</Mi>All budgets</button>
      <div className="fin-dhd">
        <div>
          <h2>{budget.title}</h2>
          <div className="fin-dmeta">
            {projectNames(budget) && <span><Mi>apartment</Mi>{projectNames(budget)}</span>}
            {budget.teamName && <span><Mi>groups</Mi>{budget.teamName}</span>}
            <span><Mi>person</Mi>{budget.createdByName || '—'}</span>
            <span><Mi>schedule</Mi>{fmtAgo(budget.updatedAt)}</span>
            {budget.purpose && <span><Mi>description</Mi>{budget.purpose}</span>}
          </div>
        </div>
        <div className="fin-dacts">
          <button type="button" className="btn btn-g btn-sm" onClick={() => setModal({ kind: 'edit' })}><Mi>edit</Mi>Edit</button>
          <button type="button" className="btn btn-g btn-sm ui-del" onClick={() => remove('budget', budget.id)} title="Delete budget"><Mi>delete</Mi></button>
          <button type="button" className="btn btn-p btn-sm" onClick={() => setModal({ kind: 'expense' })}><Mi>add</Mi>Record expense</button>
          <button type="button" className="btn btn-g btn-sm" onClick={() => setModal({ kind: 'statement' })}><Mi>receipt_long</Mi>New statement</button>
        </div>
      </div>

      <div className="fin-kpis">
        <div className="fin-kpi t-good"><div className="l">Budget</div><div className="v">{fmtBDT(f.amount || 0)}</div><div className="s">{budget.createdByName || '—'} · {fmtAgo(budget.createdAt)}</div></div>
        <div className="fin-kpi t-warn"><div className="l">Committed</div><div className="v">{fmtBDT(f.committed || 0)}</div><div className="s">ordered, not yet paid</div></div>
        <div className="fin-kpi"><div className="l">Spent · actual</div><div className="v">{fmtBDT(f.spent || 0)}</div><div className="s">paid out</div></div>
        <div className={`fin-kpi${f.overrun ? ' t-bad' : ''}`}><div className="v" style={{ marginTop: 0 }}>{fmtBDT(f.remaining || 0)}</div><div className="l" style={{ marginTop: 6 }}>Remaining</div><div className="s">budget − committed − spent</div></div>
      </div>
      {f.overrun && <div className="fin-warn"><Mi>warning</Mi>Over budget by {fmtBDT(-f.remaining)}: committed and spent exceed the budget.</div>}
      {budget.notes && <div className="fin-note">{budget.notes}</div>}

      <div className="fin-card">
        <div className="fin-subtabs">{TABS.map(([k, l, n]) => <button key={k} type="button" className={sub === k ? 'on' : ''} onClick={() => setSub(k)}>{l}{n != null && <span className="n">{n}</span>}</button>)}</div>
        {sub === 'expenses' && (expenses.length === 0 ? <div className="fin-empty">No expenses recorded yet.</div> : (
          <div className="fin-scroll"><table className="fin-tbl">
            <thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Kind</th><th>By</th><th>Paid via</th><th>Receipts</th><th className="r">Amount</th><th /></tr></thead>
            <tbody>{expenses.map(e => { const locked = finalIds.has(e.id); return (
              <tr key={e.id}>
                <td className="w m">{e.spentOn}</td>
                <td><span className="fin-ttl">{e.description || '—'}</span>{(e.leadName || e.propertyName) && <span className="fin-sub">{[e.propertyName, e.leadName].filter(Boolean).join(' · ')}</span>}</td>
                <td className="m">{e.category || '—'}</td><td><KindPill kind={e.kind} /></td><td className="m">{e.spentByName || '—'}</td><td className="m">{e.paymentMethod || '—'}</td>
                <td>{e.attachments?.length ? <div className="fin-files">{e.attachments.map((a, i) => <FileLink key={i} file={a} call={call} />)}</div> : <span className="m">—</span>}</td>
                <td className="r">{fmtBDT(e.amount)}</td>
                <td><div className="acts">
                  <button type="button" className="btn btn-g btn-sm" disabled={locked} title={locked ? 'On a final statement' : 'Edit'} onClick={() => setModal({ kind: 'expense', data: e })}><Mi>edit</Mi></button>
                  <button type="button" className="btn btn-g btn-sm ui-del" disabled={locked} title={locked ? 'On a final statement' : 'Delete'} onClick={() => remove('expense', e.id)}><Mi>delete</Mi></button>
                </div></td>
              </tr>); })}</tbody>
          </table></div>
        ))}
        {sub === 'statements' && (statements.length === 0 ? <div className="fin-empty">No statements for this budget.</div> : (
          <div className="fin-scroll"><table className="fin-tbl">
            <thead><tr><th>Number</th><th>Title</th><th>Date</th><th>Status</th><th className="r">Total</th></tr></thead>
            <tbody>{statements.map(i => { const lines = linesOf(fin, i.id); return (
              <tr key={i.id} className="click" onClick={() => onOpenStatement(i.id)}>
                <td className="w"><span className="fin-ttl">{i.number}</span></td><td>{i.title}</td><td className="m w">{i.issuedOn || '—'}</td>
                <td><span className={`fin-pill ${i.status === 'FINAL' ? 't-good' : 't-muted'}`}>{i.status === 'FINAL' ? 'Final' : 'Draft'}</span></td>
                <td className="r">{statementTotalText(i, lines)}</td>
              </tr>); })}</tbody>
          </table></div>
        ))}
        {sub === 'discussion' && <Discussion api={api} user={user} type="budget" id={budget.id} />}
        {sub === 'history' && <History api={api} type="budget" id={budget.id} />}
      </div>

      {modal?.kind === 'edit' && <BudgetForm initial={budget} onClose={() => setModal(null)} onSave={(b) => act('budget.save', { budget: { ...b, id: budget.id } }).then(() => toast.success('Budget saved'))} />}
      {modal?.kind === 'expense' && <ExpenseForm budget={budget} initial={modal.data} upload={(p) => call('file.upload', p)} onClose={() => setModal(null)}
        onSave={(e) => act('expense.save', { expense: { ...e, id: modal.data?.id, budgetId: budget.id } }).then(r => (r.figures.overrun ? toast.warning('Recorded · over budget', `Remaining is now ${fmtBDT(r.figures.remaining)}.`) : toast.success('Expense recorded')))} />}
      {modal?.kind === 'statement' && <StatementForm budget={budget} expenses={expenses} takenExpenseIds={finalIds} onClose={() => setModal(null)}
        onSave={(inv) => act('invoice.save', { invoice: { ...inv, budgetId: budget.id } }).then(r => { toast.success('Draft statement saved', r.invoice.number); onOpenStatement(r.invoice.id); })} />}
    </>
  );
}
