import { useState } from 'react';
import Mi from '../Mi.jsx';
import { fmtBDT, fmtAgo } from '../../lib/helpers.js';
import { useProjectToast } from '../project/projectToast.js';
import { latestRequest, byId } from '../../lib/finance.js';
import { DecideForm } from './forms.jsx';

// Approver queue: submitted budgets, newest request first, then recent decisions.
export default function RequestQueue({ api, user, onOpenBudget }) {
  const { fin, act } = api;
  const [decide, setDecide] = useState(null); // { budget, preset }
  const toast = useProjectToast({ always: true });
  const pending = fin.budgets.filter(b => b.status === 'SUBMITTED').map(b => ({ b, r: latestRequest(fin, b.id), f: fin.figures[b.id] || {} }))
    .sort((x, y) => String(y.r?.submittedAt || '').localeCompare(String(x.r?.submittedAt || '')));
  const recent = fin.approvals.slice(0, 20);
  const own = (b, r) => b.createdBy === user.id || r?.submittedBy === user.id;
  return (
    <div className="rq">
      <div className="rq-sec-hd"><Mi>inbox</Mi>Pending budget requests <span className="rq-ct">{pending.length}</span></div>
      {pending.length === 0 ? <div className="empty"><Mi>check_circle</Mi><p>No requests waiting</p></div> : (
        <div className="rq-list">{pending.map(({ b, r, f }) => (
          <div key={b.id} className="rq-card rq-pending">
            <div className="rq-main" onClick={() => onOpenBudget(b.id)}>
              <div className="rq-top"><span className="rq-client">{b.title}</span><span className="rq-tag rq-tag-pending">v{r?.version || 1}</span></div>
              <div className="rq-meta">{[b.propertyName, b.teamName, b.purpose].filter(Boolean).join(' · ') || 'No project or team'}</div>
              <div className="rq-meta2">
                <span><Mi>person</Mi>{r?.submittedByName || b.createdByName || '—'}</span>
                <span><Mi>payments</Mi>{fmtBDT(f.requested || 0)}</span>
                <span><Mi>schedule</Mi>{fmtAgo(r?.submittedAt || b.updatedAt)}</span>
              </div>
              {r?.note && <div className="fin-note" style={{ marginTop: 8 }}>“{r.note}”</div>}
            </div>
            {own(b, r)
              ? <div className="fin-help">Your own request — another approver has to decide it.</div>
              : <div className="rq-acts">
                  <button type="button" className="btn btn-g btn-sm" onClick={() => setDecide({ budget: b, preset: 'REJECTED' })}><Mi>close</Mi>Reject</button>
                  <button type="button" className="btn btn-g btn-sm" onClick={() => setDecide({ budget: b, preset: 'REVISION' })}><Mi>undo</Mi>Revise</button>
                  <button type="button" className="btn btn-p btn-sm" onClick={() => setDecide({ budget: b, preset: 'APPROVED' })}><Mi>check</Mi>Approve</button>
                </div>}
          </div>
        ))}</div>
      )}
      {recent.length > 0 && (
        <>
          <div className="rq-sec-hd rq-sec-hd2"><Mi>history</Mi>Recent decisions</div>
          <div className="fin-card"><div className="fin-scroll"><table className="fin-tbl">
            <thead><tr><th>Budget</th><th>Decision</th><th className="r">Requested</th><th className="r">Approved</th><th>By</th><th>When</th></tr></thead>
            <tbody>{recent.map(a => { const b = byId(fin.budgets, a.budgetId); const r = byId(fin.requests, a.requestId); const tone = a.decision === 'APPROVED' ? 'good' : a.decision === 'REJECTED' ? 'bad' : 'warn'; return (
              <tr key={a.id} className="click" onClick={() => b && onOpenBudget(b.id)}>
                <td><span className="fin-ttl">{b?.title || '—'}</span>{a.note && <span className="fin-sub">“{a.note}”</span>}</td>
                <td><span className={`fin-pill t-${tone}`}>{a.decision === 'REVISION' ? 'Revision' : a.decision.toLowerCase()}</span></td>
                <td className="r">{r ? fmtBDT(r.requestedAmount) : '—'}</td>
                <td className="r">{a.approvedAmount != null ? fmtBDT(a.approvedAmount) : <span className="m">—</span>}</td>
                <td className="m">{a.decidedByName || '—'}</td><td className="m w">{fmtAgo(a.decidedAt)}</td>
              </tr>); })}</tbody>
          </table></div></div>
        </>
      )}
      {decide && <DecideForm budget={decide.budget} preset={decide.preset} figures={fin.figures[decide.budget.id]} request={latestRequest(fin, decide.budget.id)} onClose={() => setDecide(null)}
        onDecide={(d) => act('budget.decide', { budgetId: decide.budget.id, ...d }).then(() => toast.success('Decision recorded', 'The requester has been notified.'))} />}
    </div>
  );
}
