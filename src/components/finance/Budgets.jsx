import { useState } from 'react';
import Mi from '../Mi.jsx';
import { fmtBDT, fmtAgo } from '../../lib/helpers.js';
import { useProjectToast } from '../project/projectToast.js';
import { BUDGET_STATUS, EXPENSE_KIND, byId, latestRequest, approvalsOf, expensesOf, linesOf, statementTotal } from '../../lib/finance.js';
import { BudgetForm, SubmitForm, DecideForm, ExpenseForm, StatementForm } from './forms.jsx';
import { Discussion, History, FileLink } from './Discussion.jsx';

const Pill = ({ status }) => <span className={`fin-pill t-${BUDGET_STATUS[status]?.tone || 'muted'}`}>{BUDGET_STATUS[status]?.label || status}</span>;
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
  const [status, setStatus] = useState('ALL');
  const [form, setForm] = useState(false);
  const toast = useProjectToast({ always: true });
  const term = q.trim().toLowerCase();
  const rows = fin.budgets.filter(b => (status === 'ALL' || b.status === status) && (!term || [b.title, b.purpose, b.propertyName, b.teamName, b.createdByName].some(s => (s || '').toLowerCase().includes(term))));
  const counts = fin.budgets.reduce((m, b) => { m[b.status] = (m[b.status] || 0) + 1; return m; }, {});
  return (
    <>
      <div className="fin-tools">
        <div className="acc-search fin-search"><Mi>search</Mi><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search budgets" aria-label="Search budgets" /></div>
        <div className="fin-chips">
          <button type="button" className={`fin-chip${status === 'ALL' ? ' on' : ''}`} onClick={() => setStatus('ALL')}>All {fin.budgets.length}</button>
          {Object.entries(BUDGET_STATUS).map(([k, v]) => <button key={k} type="button" className={`fin-chip${status === k ? ' on' : ''}`} onClick={() => setStatus(k)}>{v.label} {counts[k] || 0}</button>)}
        </div>
        <span className="sp" />
        <button type="button" className="btn btn-p" onClick={() => setForm(true)}><Mi>add</Mi>New budget</button>
      </div>
      <div className="fin-card">
        {rows.length === 0 ? <div className="fin-empty">{fin.budgets.length ? 'No budgets match.' : 'No budgets yet. Create the first one.'}</div> : (
          <div className="fin-scroll"><table className="fin-tbl">
            <thead><tr><th>Budget</th><th>Project</th><th>Team</th><th>Status</th><th className="r">Requested</th><th className="r">Approved</th><th className="r">Committed</th><th className="r">Spent</th><th className="r">Remaining</th></tr></thead>
            <tbody>{rows.map(b => { const f = fin.figures[b.id] || {}; return (
              <tr key={b.id} className="click" onClick={() => onOpen(b.id)}>
                <td><span className="fin-ttl">{b.title}</span><span className="fin-sub">{b.createdByName || '—'} · {fmtAgo(b.updatedAt)}</span></td>
                <td className="m">{b.propertyName || '—'}</td><td className="m">{b.teamName || '—'}</td>
                <td><Pill status={b.status} /></td>
                <td className="r">{fmtBDT(f.requested || 0)}</td>
                <td className="r">{b.status === 'APPROVED' ? fmtBDT(f.approved) : <span className="m">—</span>}</td>
                <td className="r">{f.committed ? fmtBDT(f.committed) : <span className="m">—</span>}</td>
                <td className="r">{f.spent ? fmtBDT(f.spent) : <span className="m">—</span>}</td>
                <td className={`r${f.overrun ? ' over' : ''}`}>{b.status === 'APPROVED' ? <>{f.overrun && <Mi style={{ fontSize: 15, verticalAlign: -3 }}>warning</Mi>} {fmtBDT(f.remaining)}</> : <span className="m">—</span>}</td>
              </tr>); })}</tbody>
          </table></div>
        )}
      </div>
      {form && <BudgetForm onClose={() => setForm(false)} onSave={async (b) => { const r = await act('budget.save', { budget: b }); toast.success('Draft created', `${r.budget.title} is ready to submit.`); onOpen(r.budget.id); }} />}
    </>
  );
}

function BudgetDetail({ api, user, budget, onBack, onOpenStatement }) {
  const { fin, act, call } = api;
  const f = fin.figures[budget.id] || {};
  const req = latestRequest(fin, budget.id);
  const decisions = approvalsOf(fin, budget.id);
  const expenses = expensesOf(fin, budget.id);
  const statements = fin.invoices.filter(i => i.budgetId === budget.id);
  const approver = !!fin.actor?.approver;
  const mine = budget.createdBy === user.id;
  const editable = ['DRAFT', 'REVISION'].includes(budget.status) && (mine || approver);
  const canDecide = approver && budget.status === 'SUBMITTED' && !mine && req?.submittedBy !== user.id;
  const [sub, setSub] = useState('expenses');
  const [modal, setModal] = useState(null); // { kind, data }
  const toast = useProjectToast({ always: true });
  const finalIds = new Set(fin.lines.filter(l => l.isFinal && l.expenseId).map(l => l.expenseId));
  const remove = (kind, id) => toast.confirm({
    title: kind === 'budget' ? 'Delete this draft?' : 'Delete this expense?', description: kind === 'budget' ? 'The draft and its discussion are removed.' : 'The amount comes off the budget.', confirmLabel: 'Delete',
    onConfirm: () => (kind === 'budget' ? act('budget.delete', { budgetId: id }).then(onBack) : act('expense.delete', { expenseId: id })).catch(e => toast.error('Not deleted', e.message)),
  });
  const TABS = [['expenses', 'Expenses', expenses.length], ['statements', 'Statements', statements.length], ['discussion', 'Discussion', fin.comments.filter(c => c.entityType === 'budget' && c.entityId === budget.id).length], ['history', 'History', null]];
  return (
    <>
      <button type="button" className="fin-back" onClick={onBack}><Mi>arrow_back</Mi>All budgets</button>
      <div className="fin-dhd">
        <div>
          <h2>{budget.title}<Pill status={budget.status} /></h2>
          <div className="fin-dmeta">
            {budget.propertyName && <span><Mi>apartment</Mi>{budget.propertyName}</span>}
            {budget.teamName && <span><Mi>groups</Mi>{budget.teamName}</span>}
            <span><Mi>person</Mi>{budget.createdByName || '—'}</span>
            <span><Mi>schedule</Mi>{fmtAgo(budget.updatedAt)}</span>
            {budget.purpose && <span><Mi>description</Mi>{budget.purpose}</span>}
          </div>
        </div>
        <div className="fin-dacts">
          {editable && <button type="button" className="btn btn-g btn-sm" onClick={() => setModal({ kind: 'edit' })}><Mi>edit</Mi>Edit</button>}
          {editable && <button type="button" className="btn btn-p btn-sm" onClick={() => setModal({ kind: 'submit' })}><Mi>send</Mi>Submit for approval</button>}
          {budget.status === 'DRAFT' && (mine || approver) && <button type="button" className="btn btn-g btn-sm ui-del" onClick={() => remove('budget', budget.id)} title="Delete draft"><Mi>delete</Mi></button>}
          {canDecide && <button type="button" className="btn btn-p btn-sm" onClick={() => setModal({ kind: 'decide' })}><Mi>task_alt</Mi>Decide</button>}
          {budget.status === 'APPROVED' && <button type="button" className="btn btn-p btn-sm" onClick={() => setModal({ kind: 'expense' })}><Mi>add</Mi>Record expense</button>}
          {budget.status === 'APPROVED' && <button type="button" className="btn btn-g btn-sm" onClick={() => setModal({ kind: 'statement' })}><Mi>receipt_long</Mi>New statement</button>}
        </div>
      </div>

      <div className="fin-kpis">
        <div className="fin-kpi"><div className="l">Requested</div><div className="v">{fmtBDT(f.requested || 0)}</div><div className="s">{req ? `v${req.version} · ${req.submittedByName || ''} · ${fmtAgo(req.submittedAt)}` : 'not submitted yet'}</div></div>
        <div className="fin-kpi t-good"><div className="l">Approved</div><div className="v">{budget.status === 'APPROVED' ? fmtBDT(f.approved) : '—'}</div><div className="s">{decisions[0] ? `${decisions[0].decidedByName || ''} · ${fmtAgo(decisions[0].decidedAt)}` : 'no decision yet'}</div></div>
        <div className="fin-kpi t-warn"><div className="l">Committed</div><div className="v">{fmtBDT(f.committed || 0)}</div><div className="s">ordered, not yet paid</div></div>
        <div className="fin-kpi"><div className="l">Spent · actual</div><div className="v">{fmtBDT(f.spent || 0)}</div><div className="s">paid out</div></div>
        <div className={`fin-kpi${f.overrun ? ' t-bad' : ''}`}><div className="v" style={{ marginTop: 0 }}>{budget.status === 'APPROVED' ? fmtBDT(f.remaining) : '—'}</div><div className="l" style={{ marginTop: 6 }}>Remaining</div><div className="s">approved − committed − spent</div></div>
      </div>
      {f.overrun && <div className="fin-warn"><Mi>warning</Mi>Over budget by {fmtBDT(-f.remaining)}: committed and spent exceed the approved amount.</div>}
      {budget.status === 'SUBMITTED' && !canDecide && <div className="fin-info"><Mi>schedule</Mi>Waiting for an approver{mine || req?.submittedBy === user.id ? ' — you can’t decide your own request' : ''}.</div>}
      {budget.status === 'REVISION' && decisions[0]?.note && <div className="fin-info"><Mi>undo</Mi>Revision requested: “{decisions[0].note}”</div>}
      {budget.status === 'REJECTED' && <div className="fin-warn"><Mi>cancel</Mi>Rejected{decisions[0]?.note ? `: “${decisions[0].note}”` : ''}.</div>}
      {budget.notes && <div className="fin-note">{budget.notes}</div>}

      <div className="fin-card">
        <div className="fin-subtabs">{TABS.map(([k, l, n]) => <button key={k} type="button" className={sub === k ? 'on' : ''} onClick={() => setSub(k)}>{l}{n != null && <span className="n">{n}</span>}</button>)}</div>
        {sub === 'expenses' && (expenses.length === 0 ? <div className="fin-empty">{budget.status === 'APPROVED' ? 'No expenses recorded yet.' : 'Expenses can be recorded once the budget is approved.'}</div> : (
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
                <td className="r">{fmtBDT(statementTotal(lines))}</td>
              </tr>); })}</tbody>
          </table></div>
        ))}
        {sub === 'discussion' && <Discussion api={api} user={user} type="budget" id={budget.id} />}
        {sub === 'history' && <History api={api} type="budget" id={budget.id} />}
      </div>

      {modal?.kind === 'edit' && <BudgetForm initial={budget} onClose={() => setModal(null)} onSave={(b) => act('budget.save', { budget: { ...b, id: budget.id } }).then(() => toast.success('Budget saved'))} />}
      {modal?.kind === 'submit' && <SubmitForm budget={budget} onClose={() => setModal(null)} onSubmit={(note) => act('budget.submit', { budgetId: budget.id, note }).then(() => toast.success('Submitted', 'Approvers have been notified.'))} />}
      {modal?.kind === 'decide' && <DecideForm budget={budget} figures={f} request={req} onClose={() => setModal(null)} onDecide={(d) => act('budget.decide', { budgetId: budget.id, ...d }).then(() => toast.success('Decision recorded'))} />}
      {modal?.kind === 'expense' && <ExpenseForm budget={budget} initial={modal.data} upload={(p) => call('file.upload', p)} onClose={() => setModal(null)}
        onSave={(e) => act('expense.save', { expense: { ...e, id: modal.data?.id, budgetId: budget.id } }).then(r => (r.figures.overrun ? toast.warning('Recorded · over budget', `Remaining is now ${fmtBDT(r.figures.remaining)}.`) : toast.success('Expense recorded')))} />}
      {modal?.kind === 'statement' && <StatementForm budget={budget} expenses={expenses} takenExpenseIds={finalIds} onClose={() => setModal(null)}
        onSave={(inv) => act('invoice.save', { invoice: { ...inv, budgetId: budget.id } }).then(r => { toast.success('Draft statement saved', r.invoice.number); onOpenStatement(r.invoice.id); })} />}
    </>
  );
}
