import Mi from '../Mi.jsx';
import BkSelect from './BkSelect.jsx';
import { useApp } from '../../context/AppContext.jsx';
import useNavState from '../../hooks/useNavState.js';
import { getHoldRequests } from '../../lib/db.js';
import { planProjects } from '../../lib/projects.js';
import { holdStats, PERIODS, fmtSpan, fmtHours } from '../../lib/holdStats.js';
import { fmtBDT, fmtAgo } from '../../lib/helpers.js';
import { ROLES } from '../../lib/constants.js';
import { Kpi, Delta, Row, RequestChart } from '../views/RequestsInsights.jsx';

// Booking → My dashboard: one agent's holds and booking requests. An agent sees their own; a team
// lead or manager can pick any agent. The numbers come from lib/holdStats.js (holdStats with an
// agent id), laid out with the same pieces as Requests → Insights.

const money = (n) => (n > 0 ? fmtBDT(n) : '—');
const WATCH = [ROLES.MGMT, ROLES.TL, ROLES.MASTER];

export default function AgentBookingDash({ onBook }) {
  const { user, dbVersion } = useApp();
  void dbVersion;
  const [pk, setPk] = useNavState('bookdash.period', '30');
  const [pick, setPick] = useNavState('bookdash.agent', '');
  const all = getHoldRequests();
  const watch = WATCH.includes(user?.role);

  // Everyone who has asked for a hold, busiest first; the signed-in agent is always in the list.
  const people = new Map();
  all.forEach(r => { if (r.agentId) people.set(r.agentId, { id: r.agentId, name: r.agentName || 'Agent', n: (people.get(r.agentId)?.n || 0) + 1 }); });
  if (!watch && user && !people.has(user.id)) people.set(user.id, { id: user.id, name: user.name, n: 0 });
  const list = [...people.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  const aid = watch ? (list.some(p => p.id === pick) ? pick : list[0]?.id || '') : user?.id;
  const who = list.find(p => p.id === aid);
  const mine = aid === user?.id;

  const st = aid ? holdStats(all, planProjects(), pk, undefined, aid) : null;

  if (!st) {
    return (
      <div className="bk-empty bk-empty-lg"><Mi>insights</Mi><b>No agent to show yet</b><span>Once an agent asks for a hold, their dashboard appears here.</span></div>
    );
  }
  const { cur, queue, holds } = st;
  const pend = queue.list;

  const notes = [];
  if (holds.overdue.length) notes.push({ tone: 'bad', icon: 'event_busy', text: `${holds.overdue.length} hold${holds.overdue.length > 1 ? 's are' : ' is'} past the hold date. ${mine ? 'Ask for an extension or release the unit.' : 'The unit is still blocked.'}` });
  if (holds.soon.length) notes.push({ tone: 'warn', icon: 'hourglass_top', text: `${holds.soon.length} hold${holds.soon.length > 1 ? 's end' : ' ends'} within 24 hours. ${mine ? 'Call the client to close it.' : ''}`.trim() });
  if (pend.length) notes.push({ tone: 'info', icon: 'schedule', text: `${pend.length} request${pend.length > 1 ? 's are' : ' is'} waiting for management${queue.oldest ? `, the oldest for ${fmtSpan(queue.oldest)}` : ''}.` });
  if (cur.rate != null && cur.approved + cur.rejected >= 4 && cur.rate < 50) notes.push({ tone: 'warn', icon: 'thumb_down', text: `Only ${cur.rate}% of decided requests were approved. Check availability before asking for a hold.` });
  if (!notes.length) notes.push({ tone: 'good', icon: 'check_circle', text: cur.total ? 'Nothing needs attention.' : 'No requests in this period yet.' });

  return (
    <div className="rqi-wrap bkd">
      <div className="rqi-bar">
        {watch ? (
          <BkSelect label="Agent" value={aid} onChange={setPick} options={list.map(p => ({ value: p.id, label: `${p.name}${p.n ? ` (${p.n})` : ''}` }))} />
        ) : <b className="bkd-name">{mine ? 'My booking dashboard' : who?.name}</b>}
        <div className="rqx-chips" role="group" aria-label="Period">
          {PERIODS.map(p => <button key={p.key} type="button" className="bk-chip" aria-pressed={pk === p.key} onClick={() => setPk(p.key)}>{p.label}</button>)}
        </div>
        {mine && <button type="button" className="bk-btn primary bkd-go" onClick={onBook}><Mi>event_seat</Mi>Book a unit</button>}
      </div>

      <section className="rqi-notes" aria-label="Needs attention">
        {notes.map((n, i) => <div key={i} className={`rqi-n ${n.tone}`}><Mi>{n.icon}</Mi><span>{n.text}</span></div>)}
      </section>

      <div className="rqi-kpis">
        <Kpi icon="lock_clock" label="Units on hold" value={holds.all.length} tone={holds.overdue.length ? 'bad' : holds.soon.length ? 'warn' : ''}
          sub={holds.all.length ? `${holds.soon.length} end within 24 h · ${holds.overdue.length} overdue` : 'No unit is held'} />
        <Kpi icon="inbox" label="Waiting for approval" value={queue.count} sub={queue.count ? `${money(queue.value)} · oldest ${fmtSpan(queue.oldest)}` : 'Nothing waiting'} />
        <Kpi icon="add_task" label="Requests" value={cur.total} sub={st.requestsDelta != null ? 'vs the period before ' : 'in this period'}><Delta v={st.requestsDelta} /></Kpi>
        <Kpi icon="thumb_up" label="Approval rate" value={cur.rate == null ? '—' : `${cur.rate}%`} sub={`${cur.approved} approved · ${cur.rejected} rejected`}>
          {st.before.rate != null && cur.rate != null && <Delta v={cur.rate - st.before.rate} />}
        </Kpi>
        <Kpi icon="payments" label="Approved value" value={money(cur.approvedValue)} sub={cur.avgWait != null ? `decided in ${fmtHours(cur.medWait)} typically` : 'no decisions yet'} />
        <Kpi icon="sell" label="Units sold" value={st.sold?.n ?? 0} sub={st.sold?.area ? `${Math.round(st.sold.area).toLocaleString('en-IN')} sq ft` : (mine ? 'from your requests' : 'from their requests')} />
      </div>

      <div className="rqi-two">
        <section className="rqi-card" aria-label="Requests over time">
          <header><h3>Requests over time</h3>
            <span className="rqi-leg"><i className="a" />Approved<i className="r" />Rejected<i className="p" />Pending</span></header>
          <RequestChart st={st} />
        </section>

        <section className="rqi-card" aria-label="Holds">
          <header><h3>{mine ? 'My holds' : 'Holds'}</h3><span className="bk-cap">{holds.all.length} live</span></header>
          {holds.all.length === 0 ? <div className="rqi-none"><Mi>lock_open</Mi>No unit is on hold.</div> : (
            <ul className="rqi-list">
              {holds.all.slice(0, 7).map(h => (
                <Row key={h.key} tone={h.left != null && h.left < 0 ? 'bad' : h.left != null && h.left <= 86400000 ? 'warn' : ''}
                  t={`${h.unit} · ${h.project}`} s={h.client || h.type}
                  r={h.left == null ? 'awaiting approval' : h.left < 0 ? `${fmtSpan(h.left)} over` : `${fmtSpan(h.left)} left`} />
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="rqi-two">
        <section className="rqi-card" aria-label="Recent requests">
          <header><h3>Recent requests</h3><span className="bk-cap">latest {st.recent.length}</span></header>
          {st.recent.length === 0 ? <div className="rqi-none"><Mi>inbox</Mi>No requests in this period.</div> : (
            <ul className="rqi-list">
              {st.recent.map(r => (
                <li key={r.id}>
                  <span><b>{r.unitId} · {r.propertyName}</b><i>{r.clientName || '—'} · {fmtAgo(r.createdAt)}</i></span>
                  <span className="bkd-end">{r.dealTotal ? <em>{fmtBDT(r.dealTotal)}</em> : null}<span className={`bk-pill rqx-st-${r.status}`}><i className="bk-dot" />{r.status}</span></span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rqi-card" aria-label="By project">
          <header><h3>By project</h3><span className="bk-cap">where the requests went</span></header>
          <div className="rqi-scroll">
            <table className="rqx-table rqi-table">
              <thead><tr><th>Project</th><th className="r">Requests</th><th className="r">Approved</th><th className="r">Value</th></tr></thead>
              <tbody>
                {st.byProject.filter(p => p.total > 0).map(p => (
                  <tr key={p.id}>
                    <td><b className="rqx-client">{p.name}</b></td>
                    <td className="r rqx-mono">{p.total}</td>
                    <td className="r rqx-mono">{p.rate == null ? '—' : `${p.rate}%`}</td>
                    <td className="r rqx-mono">{money(p.approvedValue)}</td>
                  </tr>
                ))}
                {!st.byProject.some(p => p.total > 0) && <tr><td colSpan={4} className="rqi-empty">No requests in this period.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
