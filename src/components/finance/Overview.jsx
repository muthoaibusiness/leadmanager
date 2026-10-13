import Mi from '../Mi.jsx';
import { fmtBDT } from '../../lib/helpers.js';
import { overviewOf, BUDGET_STATUS } from '../../lib/finance.js';

// Spent and committed per group as proportional bars, longest first.
function Bars({ rows, empty }) {
  return rows.length === 0 ? <div className="fin-empty">{empty}</div> : (
  <div className="fin-bars">
    {rows.slice(0, 8).map((r, i) => {
      const max = (rows[0].spent + rows[0].committed) || 1, tot = r.spent + r.committed;
      return (
        <div key={i} className="fin-bar-row">
          <span className="n">{r.name}</span>
          <span className="a">{fmtBDT(tot)}{r.committed > 0 && <> · <em style={{ color: 'var(--orange)', fontStyle: 'normal' }}>{fmtBDT(r.committed)} committed</em></>}</span>
          <span className="t"><i style={{ width: `${r.spent / max * 100}%` }} /><i className="c" style={{ width: `${r.committed / max * 100}%` }} /></span>
        </div>
      );
    })}
  </div>
);
}

// Financial dashboard. Requested, approved, committed and spent are four
// separate figures and are labelled as such; nothing here is added across them.
export default function Overview({ fin, range, onOpenBudget }) {
  const o = overviewOf(fin, range);
  const period = range ? 'in the selected period' : 'all time';
  return (
    <>
      <div className="fin-kpis">
        <div className="fin-kpi"><div className="l">Requested · pending</div><div className="v">{fmtBDT(o.requested)}</div><div className="s">{o.pending.length} request{o.pending.length === 1 ? '' : 's'} awaiting a decision</div></div>
        <div className="fin-kpi t-good"><div className="l">Approved</div><div className="v">{fmtBDT(o.approved)}</div><div className="s">across approved budgets</div></div>
        <div className="fin-kpi t-warn"><div className="l">Committed</div><div className="v">{fmtBDT(o.committed)}</div><div className="s">ordered, not yet paid</div></div>
        <div className="fin-kpi"><div className="l">Spent · actual</div><div className="v">{fmtBDT(o.spent)}</div><div className="s">paid out</div></div>
        <div className={`fin-kpi${o.remaining < 0 ? ' t-bad' : ''}`}><div className="l">Remaining</div><div className="v">{fmtBDT(o.remaining)}</div><div className="s">{o.overruns ? `${o.overruns} budget${o.overruns === 1 ? '' : 's'} over` : 'approved − committed − spent'}</div></div>
      </div>

      <div className="fin-card">
        <div className="fin-card-hd"><span><Mi>inbox</Mi>Pending budget requests</span><span className="sub">{o.pending.length}</span></div>
        {o.pending.length === 0 ? <div className="fin-empty">No requests waiting.</div> : (
          <div className="fin-scroll"><table className="fin-tbl">
            <thead><tr><th>Budget</th><th>Project</th><th>Team</th><th>Requested by</th><th className="r">Requested</th><th>Status</th></tr></thead>
            <tbody>{o.pending.map(b => {
              const f = fin.figures[b.id] || {};
              return (
                <tr key={b.id} className="click" onClick={() => onOpenBudget(b.id)}>
                  <td><span className="fin-ttl">{b.title}</span>{b.purpose && <span className="fin-sub">{b.purpose}</span>}</td>
                  <td className="m">{b.propertyName || '—'}</td><td className="m">{b.teamName || '—'}</td><td className="m">{b.createdByName || '—'}</td>
                  <td className="r">{fmtBDT(f.requested || 0)}<span className="fin-sub">v{f.version || 1}</span></td>
                  <td><span className={`fin-pill t-${BUDGET_STATUS[b.status].tone}`}>{BUDGET_STATUS[b.status].label}</span></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </div>

      <div className="fin-grid3">
        <div className="fin-card"><div className="fin-card-hd"><span><Mi>apartment</Mi>Expenses by project</span><span className="sub">{period}</span></div><div className="fin-card-bd"><Bars rows={o.byProject} empty="No expenses yet." /></div></div>
        <div className="fin-card"><div className="fin-card-hd"><span><Mi>description</Mi>Expenses by category</span><span className="sub">{period}</span></div><div className="fin-card-bd"><Bars rows={o.byCategory} empty="No expenses yet." /></div></div>
        <div className="fin-card"><div className="fin-card-hd"><span><Mi>person</Mi>Expenses by team member</span><span className="sub">{period}</span></div><div className="fin-card-bd"><Bars rows={o.byMember} empty="No expenses yet." /></div></div>
      </div>
    </>
  );
}
