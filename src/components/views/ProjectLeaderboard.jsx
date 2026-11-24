import { useMemo } from 'react';
import Mi from '../Mi.jsx';
import BkSelect from '../booking/BkSelect.jsx';
import useNavState from '../../hooks/useNavState.js';
import useLeadBook from '../../hooks/useLeadBook.js';
import { useApp } from '../../context/AppContext.jsx';
import { getDB } from '../../lib/db.js';
import { buildAgentPerf } from '../../lib/agentPerf.js';
import { PERIODS, periodStart } from '../../lib/analyticsPeriod.js';
import { fmtBDT, ini, avc, rlabel } from '../../lib/helpers.js';

// Analytics › Leaderboard: who is doing best on one project. Only the leads that name the project
// count (its interest, or the project a deal closed on), so an agent's rank here is their work on it.
// Ranked by deals won, then revenue, visits done, meetings set and leads sourced.

const MEDAL = ['#E0B84A', '#B8C0CC', '#C98A5A'];
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

export default function ProjectLeaderboard() {
  useLeadBook(); // this view reduces over every lead; leads are not in the boot load
  const { user, dbVersion } = useApp();
  void dbVersion;
  const db = getDB();
  const [pk, setPk] = useNavState('analytics.period', '30');
  const [proj, setProj] = useNavState('analytics.project', '');

  const cid = user.companyId;
  const coLeads = (db.leads || []).filter(l => !cid || !l.companyId || l.companyId === cid);
  // Projects, busiest first: those in the catalog, plus any name a lead carries.
  const names = useMemo(() => {
    const count = new Map();
    (db.properties || []).filter(p => !cid || !p.companyId || p.companyId === cid).forEach(p => { if (p.name) count.set(p.name, 0); });
    coLeads.forEach(l => {
      const n = (l.dealProjectName || l.propertyInterest || '').trim();
      if (!n) return;
      const k = [...count.keys()].find(x => same(x, n)) || n;
      count.set(k, (count.get(k) || 0) + 1);
    });
    return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([n, c]) => ({ name: n, n: c }));
  }, [db, dbVersion]); // eslint-disable-line react-hooks/exhaustive-deps -- db mutates in place; dbVersion is the change signal
  const picked = names.find(n => same(n.name, proj))?.name || names[0]?.name || '';
  const start = periodStart(pk);

  const { rows, totals } = useMemo(() => {
    const leads = coLeads.filter(l => same(l.dealProjectName || l.propertyInterest, picked));
    const all = buildAgentPerf({ ...db, leads }, { start, end: null, periodDays: 0, teamId: null });
    const rs = all.filter(r => r.sourced || r.won || r.lost || r.negotiation || r.proposals || r.meetingsSet || r.visitsDone)
      .sort((a, b) => b.won - a.won || b.revenue - a.revenue || b.visitsDone - a.visitsDone || b.meetingsSet - a.meetingsSet || b.sourced - a.sourced);
    const t = rs.reduce((a, r) => ({ leads: a.leads + r.sourced, contacted: a.contacted + r.contacted, visits: a.visits + r.visitsDone, won: a.won + r.won, revenue: a.revenue + r.revenue }), { leads: 0, contacted: 0, visits: 0, won: 0, revenue: 0 });
    return { rows: rs, totals: t };
  }, [db, picked, start, dbVersion]); // eslint-disable-line react-hooks/exhaustive-deps -- db mutates in place; dbVersion is the change signal
  const teamOf = (u) => (db.teams || []).find(t => t.id === u.teamId || t.leadId === u.id)?.name || '';

  if (!names.length) {
    return <div className="bk-empty bk-empty-lg"><Mi>emoji_events</Mi><b>No projects yet</b><span>Add a project, and leads that name it are ranked here.</span></div>;
  }

  return (
    <>
      <div className="rqx-bar">
        <BkSelect label="Project" value={picked} onChange={setProj} options={names.map(n => ({ value: n.name, label: `${n.name} (${n.n})` }))} />
        <div className="rqx-chips" role="group" aria-label="Period">
          {PERIODS.map(p => <button key={p.key} type="button" className="bk-chip" aria-pressed={pk === p.key} onClick={() => setPk(p.key)}>{p.label}</button>)}
        </div>
      </div>

      <div className="rqi-kpis">
        <div className="rqi-k"><span className="bk-cap">Leads</span><b>{totals.leads}</b><span className="rqi-ks">{totals.contacted} contacted</span></div>
        <div className="rqi-k"><span className="bk-cap">Visits done</span><b>{totals.visits}</b><span className="rqi-ks">site visits</span></div>
        <div className="rqi-k"><span className="bk-cap">Deals won</span><b>{totals.won}</b><span className="rqi-ks">{totals.revenue ? fmtBDT(totals.revenue) : 'no revenue yet'}</span></div>
      </div>

      {rows.length === 0 ? (
        <div className="bk-empty bk-empty-lg"><Mi>leaderboard</Mi><b>Nobody has worked {picked} yet</b><span>Try a longer period.</span></div>
      ) : (
        <>
          <div className="anx-podium">
            {rows.slice(0, 3).map((r, i) => (
              <div key={r.u.id} className={`anx-pod p${i + 1}`}>
                <span className="anx-medal" style={{ background: MEDAL[i] }}>{i + 1}</span>
                <span className="lt-av lg" style={{ background: avc(r.u.name) }}>{ini(r.u.name)}</span>
                <b>{r.u.name}</b>
                <span className="rqx-sub">{rlabel(r.u.role)}{teamOf(r.u) ? ` · ${teamOf(r.u)}` : ''}</span>
                <span className="anx-pod-n"><em>{r.won}</em> won · <em>{r.visitsDone}</em> visits · <em>{r.sourced}</em> leads</span>
              </div>
            ))}
          </div>

          <section className="rqx-card anx-card" aria-label={`${picked} leaderboard`}>
            <div className="rqx-scroll">
              <table className="rqx-table anx-table">
                <thead><tr><th className="r">Rank</th><th>Person</th><th>Team</th><th className="r">Leads</th><th className="r">Contacted</th><th className="r">Meetings</th><th className="r">Visits done</th><th className="r">Won</th><th className="r">Revenue</th></tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.u.id}>
                      <td className="r rqx-mono"><span className={`anx-rank${i < 3 ? ` top t${i + 1}` : ''}`}>{i + 1}</span></td>
                      <td><span className="acx-who"><span className="lt-av" style={{ background: avc(r.u.name) }}>{ini(r.u.name)}</span><b className="rqx-client">{r.u.name}</b></span><span className="rqx-sub">{rlabel(r.u.role)}</span></td>
                      <td className="acx-muted">{teamOf(r.u) || '—'}</td>
                      <td className="r rqx-mono">{r.sourced || '—'}</td>
                      <td className="r rqx-mono">{r.contacted || '—'}</td>
                      <td className="r rqx-mono">{r.meetingsSet || '—'}</td>
                      <td className="r rqx-mono">{r.visitsDone || '—'}</td>
                      <td className="r rqx-mono">{r.won || '—'}</td>
                      <td className="r rqx-mono">{r.revenue ? fmtBDT(r.revenue) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
