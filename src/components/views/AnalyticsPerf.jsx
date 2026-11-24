import { useMemo } from 'react';
import Mi from '../Mi.jsx';
import BkSelect from '../booking/BkSelect.jsx';
import useNavState from '../../hooks/useNavState.js';
import useLeadBook from '../../hooks/useLeadBook.js';
import { useApp } from '../../context/AppContext.jsx';
import { getDB } from '../../lib/db.js';
import { ROLES } from '../../lib/constants.js';
import { buildAgentPerf, ROLE_VIEWS } from '../../lib/agentPerf.js';
import { PERIODS, periodStart } from '../../lib/analyticsPeriod.js';
import { ini, avc } from '../../lib/helpers.js';

// Analytics › Performance: one scorecard per agent. The period chips decide which leads count as
// sourced (their created date); a Team Lead sees their own team only, others can pick a team. The
// table is paged. Funnels, outcome pills and conversion bars are gone: the numbers sit in the rows.

const SIZES = [10, 25, 50];
const SORTS = [
  { value: 'best', label: 'Best conversion' },
  { value: 'sourced', label: 'Most sourced' },
  { value: 'score', label: 'Highest score' },
  { value: 'alpha', label: 'Name A–Z' },
];
const tier = (c) => (c >= 50 ? 'good' : c >= 25 ? 'warn' : 'bad');

function Spark({ pts }) {
  const w = 84, h = 26;
  const arr = pts.some(p => p) ? pts : pts.map(() => 0);
  const mx = Math.max(...arr, 1), step = w / (arr.length - 1);
  const c = arr.map((p, i) => `${(i * step).toFixed(1)},${(h - 2 - (p / mx) * (h - 4)).toFixed(1)}`);
  return (
    <svg className="anx-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={c.join(' ')} fill="none" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function AnalyticsPerf() {
  useLeadBook(); // this view reduces over every lead; leads are not in the boot load
  const { user, dbVersion } = useApp();
  void dbVersion;
  const db = getDB();
  const [pk, setPk] = useNavState('analytics.period', '30');
  const [team, setTeam] = useNavState('analytics.team', 'ALL');
  const [q, setQ] = useNavState('analytics.q', '');
  const [sort, setSort] = useNavState('analytics.sort', 'best');
  const [size, setSize] = useNavState('analytics.size', 10);
  const [page, setPage] = useNavState('analytics.page', 0);

  const mine = user.role === ROLES.TL ? user.teamId : null; // a Team Lead sees their own team only
  const teams = (db.teams || []).filter(t => !user.companyId || !t.companyId || t.companyId === user.companyId);
  const teamId = mine || (team === 'ALL' ? null : team);
  const start = periodStart(pk);

  const rows = useMemo(
    () => buildAgentPerf(db, { start, end: null, periodDays: 0, teamId }).filter(r => r.u.role === ROLES.AGENT),
    [db, start, teamId, dbVersion] // eslint-disable-line react-hooks/exhaustive-deps -- db mutates in place; dbVersion is the change signal
  );

  // 7-day lead volume per agent, for the row's sparkline.
  const sparkOf = useMemo(() => {
    const days = 7, now = new Date(); now.setHours(0, 0, 0, 0);
    const map = {};
    (db.leads || []).forEach(l => {
      [l.assignedTo, ...(l.previousAssignees || [])].forEach(id => {
        if (!id) return;
        if (!map[id]) map[id] = Array(days).fill(0);
        const dd = Math.floor((now - new Date(new Date(l.createdAt).setHours(0, 0, 0, 0))) / 864e5);
        if (dd >= 0 && dd < days) map[id][days - 1 - dd]++;
      });
    });
    return id => map[id] || Array(days).fill(0);
  }, [db, dbVersion]); // eslint-disable-line react-hooks/exhaustive-deps -- db mutates in place; dbVersion is the change signal

  const agg = rows.reduce((a, r) => { ['sourced', 'contacted', 'untouched', 'calls', 'talkMins', 'followups', 'meetingsSet', 'visitsSched', 'visitsDone', 'sentTL'].forEach(k => { a[k] = (a[k] || 0) + r[k]; }); return a; }, {});
  const kpis = ROLE_VIEWS[ROLES.AGENT].kpis(agg);
  const rate = agg.sourced ? Math.round((agg.contacted / agg.sourced) * 100) : 0;

  const needle = q.trim().toLowerCase();
  const list = rows
    .filter(r => !needle || (r.u.name || '').toLowerCase().includes(needle))
    .sort((a, b) => (sort === 'alpha' ? (a.u.name || '').localeCompare(b.u.name || '')
      : sort === 'sourced' ? b.sourced - a.sourced
      : sort === 'score' ? b.score - a.score
      : b.contactRate - a.contactRate || b.sourced - a.sourced));
  const teamName = (u) => (teams.find(t => t.id === u.teamId) || {}).name || '—';

  const pages = Math.max(1, Math.ceil(list.length / size));
  const cur = Math.min(page, pages - 1);
  const shown = list.slice(cur * size, cur * size + size);
  const from = list.length ? cur * size + 1 : 0;
  const setF = (fn) => (v) => { fn(v); setPage(0); };

  return (
    <>
      <div className="rqx-bar">
        <label className="bk-search rqx-search">
          <Mi>search</Mi>
          <input value={q} onChange={e => setF(setQ)(e.target.value)} placeholder="Search agent" aria-label="Search agents" />
          {q && <button type="button" className="bk-close" aria-label="Clear search" onClick={() => setF(setQ)('')}><Mi>close</Mi></button>}
        </label>
        <div className="rqx-chips" role="group" aria-label="Leads sourced in">
          {PERIODS.map(p => <button key={p.key} type="button" className="bk-chip" aria-pressed={pk === p.key} onClick={() => setF(setPk)(p.key)}>{p.label}</button>)}
        </div>
        <div className="rqx-sels">
          {!mine && <BkSelect label="Team" value={team} onChange={setF(setTeam)} options={[{ value: 'ALL', label: 'All teams' }, ...teams.map(t => ({ value: t.id, label: t.name }))]} />}
          <BkSelect label="Sort by" value={sort} onChange={setF(setSort)} align="right" options={SORTS} />
        </div>
      </div>
      <span className="bk-cap anx-note">Leads sourced {pk === 'all' ? 'since the start' : `in the last ${PERIODS.find(p => p.key === pk)?.label}`} · {list.length} agent{list.length === 1 ? '' : 's'}</span>

      <div className="rqi-kpis">
        {kpis.map((k, i) => (
          <div key={i} className="rqi-k"><span className="bk-cap">{k.label}</span><b>{Number(k.val).toLocaleString()}</b><span className="rqi-ks">{k.sub}</span></div>
        ))}
        <div className="rqi-k"><span className="bk-cap">Contact rate</span><b>{rate}%</b><span className="rqi-ks">{agg.contacted || 0} of {agg.sourced || 0} contacted</span></div>
      </div>

      <section className="rqx-card anx-card" aria-label="Agents">
        {shown.length === 0 ? (
          <div className="bk-empty bk-empty-lg"><Mi>search_off</Mi><b>No agent matches</b><span>Try another word, team or period.</span></div>
        ) : (
          <div className="rqx-scroll">
            <table className="rqx-table anx-table">
              <thead>
                <tr><th>Agent</th><th>Team</th><th className="r">Sourced</th><th className="r">Contacted</th><th className="r">Meetings</th><th className="r">Visits done</th><th className="r">Sent to TL</th><th>Contact rate</th><th>7 days</th><th className="r">Score</th></tr>
              </thead>
              <tbody>
                {shown.map(r => {
                  const c = r.contactRate, t = tier(c), sp = sparkOf(r.u.id);
                  return (
                    <tr key={r.u.id}>
                      <td><span className="acx-who"><span className="lt-av" style={{ background: avc(r.u.name) }}>{ini(r.u.name)}</span><b className="rqx-client">{r.u.name}</b></span>
                        {r.untouched > 0 && <span className="rqx-sub">{r.untouched} untouched</span>}</td>
                      <td className="acx-muted">{teamName(r.u)}</td>
                      <td className="r rqx-mono">{r.sourced}</td>
                      <td className="r rqx-mono">{r.contacted}</td>
                      <td className="r rqx-mono">{r.meetingsSet}</td>
                      <td className="r rqx-mono">{r.visitsDone}<span className="rqx-sub">of {r.visitsSched}</span></td>
                      <td className="r rqx-mono">{r.sentTL}</td>
                      <td><span className={`anx-rate ${t}`}><i style={{ width: `${Math.min(100, c)}%` }} /></span><span className={`rqx-sub anx-pc ${t}`}>{Math.round(c)}%</span></td>
                      <td><Spark pts={sp} /></td>
                      <td className="r rqx-mono"><span className={`anx-score ${r.score >= 70 ? 'good' : r.score < 30 ? 'bad' : ''}`}>{r.score}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="rqx-foot">
          <span className="bk-cap">{list.length ? `${from}–${from + shown.length - 1} of ${list.length}` : '0 agents'}</span>
          <label className="rqx-size bk-cap">Rows
            <BkSelect label="Rows per page" value={size} onChange={v => { setSize(Number(v)); setPage(0); }} options={SIZES.map(n => ({ value: n, label: String(n) }))} />
          </label>
          <div className="rqx-pager" role="group" aria-label="Pages">
            <button type="button" className="bk-zbtn" aria-label="Previous page" disabled={cur === 0} onClick={() => setPage(cur - 1)}><Mi>chevron_left</Mi></button>
            <span className="bk-zbtn wide rqx-pg">{cur + 1} / {pages}</span>
            <button type="button" className="bk-zbtn" aria-label="Next page" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}><Mi>chevron_right</Mi></button>
          </div>
        </div>
      </section>
    </>
  );
}
