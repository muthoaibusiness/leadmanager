import Mi from '../Mi.jsx';
import useNavState from '../../hooks/useNavState.js';
import { planProjects } from '../../lib/projects.js';
import { holdStats, PERIODS, fmtSpan, fmtHours } from '../../lib/holdStats.js';
import { fmtBDT } from '../../lib/helpers.js';

// Requests → Insights: how the hold and booking queue is doing. Management looks here to see what
// needs a decision now, how fast and how often requests are approved, which projects and agents
// bring them, and which holds are about to run out. All numbers come from lib/holdStats.js.

const day = (t) => new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
const money = (n) => (n > 0 ? fmtBDT(n) : '—');
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function Delta({ v, goodUp = true }) {
  if (v == null) return null;
  const up = v > 0;
  const good = v === 0 ? null : up === goodUp;
  return <i className={`rqi-d${good == null ? '' : good ? ' good' : ' bad'}`}><Mi>{v === 0 ? 'remove' : up ? 'arrow_upward' : 'arrow_downward'}</Mi>{Math.abs(v)}%</i>;
}

export function Kpi({ icon, label, value, sub, tone, children }) {
  return (
    <div className={`rqi-k${tone ? ` ${tone}` : ''}`}>
      <span className="rqi-ki"><Mi>{icon}</Mi></span>
      <span className="bk-cap">{label}</span>
      <b>{value}</b>
      <span className="rqi-ks">{sub}{children}</span>
    </div>
  );
}

// The "needs a decision" and "running out" lists share one row shape.
export function Row({ t, s, r, tone }) {
  return <li className={tone}><span><b>{t}</b><i>{s}</i></span><em>{r}</em></li>;
}

// The bars: one per day (or week), stacked by outcome, with the axis under them.
export function RequestChart({ st }) {
  const { cur } = st;
  const max = Math.max(1, ...st.series.buckets.map(b => b.approved + b.rejected + b.pending));
  return (
    <>
      <div className="rqi-chart" role="img" aria-label={`${cur.total} requests, ${cur.approved} approved, ${cur.rejected} rejected, ${cur.pending} pending`}>
        {st.series.buckets.map((b, i) => {
          const n = b.approved + b.rejected + b.pending;
          return (
            <div key={i} className="rqi-col" title={`${day(b.to)}: ${n} request${n === 1 ? '' : 's'} (${b.approved} approved, ${b.rejected} rejected, ${b.pending} pending)`}>
              <span className="rqi-stack" style={{ height: `${(n / max) * 100}%` }}>
                {b.pending > 0 && <i className="p" style={{ flex: b.pending }} />}
                {b.rejected > 0 && <i className="r" style={{ flex: b.rejected }} />}
                {b.approved > 0 && <i className="a" style={{ flex: b.approved }} />}
              </span>
            </div>
          );
        })}
      </div>
      <div className="rqi-axis"><span>{day(st.series.buckets[0].from + 1)}</span><span>{st.series.weekly ? 'one bar a week' : 'one bar a day'}</span><span>{day(st.series.buckets[st.series.buckets.length - 1].to)}</span></div>
    </>
  );
}

export default function RequestsInsights({ all, onQueue }) {
  const [pk, setPk] = useNavState('requests.period', '30');
  const st = holdStats(all, planProjects(), pk);
  const { cur, queue, holds } = st;
  const wmax = Math.max(1, ...st.weekday);
  const busiest = st.weekday.some(n => n) ? WD[st.weekday.indexOf(Math.max(...st.weekday))] : null;

  // Plain sentences, worst news first.
  const notes = [];
  if (queue.stale.length) notes.push({ tone: 'bad', icon: 'schedule', text: `${queue.stale.length} request${queue.stale.length > 1 ? 's have' : ' has'} waited over a day. The oldest has waited ${fmtSpan(queue.oldest)}.` });
  if (holds.overdue.length) notes.push({ tone: 'bad', icon: 'event_busy', text: `${holds.overdue.length} hold${holds.overdue.length > 1 ? 's are' : ' is'} past the hold date and still blocking the unit.` });
  if (holds.soon.length) notes.push({ tone: 'warn', icon: 'hourglass_top', text: `${holds.soon.length} hold${holds.soon.length > 1 ? 's end' : ' ends'} within 24 hours.` });
  if (cur.rate != null && cur.approved + cur.rejected >= 5 && cur.rate < 50) notes.push({ tone: 'warn', icon: 'thumb_down', text: `Only ${cur.rate}% of decided requests were approved this period.` });
  if (st.hot[0]) notes.push({ tone: 'info', icon: 'local_fire_department', text: `${st.hot[0].project} · ${st.hot[0].unit} was requested ${st.hot[0].n} times${st.hot[0].agents > 1 ? ` by ${st.hot[0].agents} agents` : ''}.` });
  if (!notes.length) notes.push({ tone: 'good', icon: 'check_circle', text: 'Nothing needs attention. The queue is clear and no hold is running out.' });

  if (!all.length) {
    return (
      <div className="rqi-wrap">
        <div className="bk-empty bk-empty-lg"><Mi>insights</Mi><b>No hold requests yet</b><span>Once agents request holds from the Booking page, their numbers show up here.</span></div>
      </div>
    );
  }

  return (
    <div className="rqi-wrap">
      <div className="rqi-bar">
        <div className="rqx-chips" role="group" aria-label="Period">
          {PERIODS.map(p => <button key={p.key} type="button" className="bk-chip" aria-pressed={pk === p.key} onClick={() => setPk(p.key)}>{p.label}</button>)}
        </div>
        <span className="bk-cap">Requests made {pk === 'all' ? 'since the start' : `in the last ${st.period.label}`}</span>
      </div>

      <section className="rqi-notes" aria-label="Needs attention">
        {notes.map((n, i) => <div key={i} className={`rqi-n ${n.tone}`}><Mi>{n.icon}</Mi><span>{n.text}</span></div>)}
        {queue.count > 0 && <button type="button" className="bk-btn primary rqi-go" onClick={() => onQueue('pending')}>Review {queue.count} pending<Mi>arrow_forward</Mi></button>}
      </section>

      <div className="rqi-kpis">
        <Kpi icon="inbox" label="Waiting for a decision" value={queue.count} tone={queue.stale.length ? 'bad' : ''}
          sub={queue.count ? `${money(queue.value)} · oldest ${fmtSpan(queue.oldest)}` : 'Queue is clear'} />
        <Kpi icon="add_task" label="Requests" value={cur.total} sub={st.requestsDelta != null ? 'vs the period before ' : 'in this period'}>
          <Delta v={st.requestsDelta} />
        </Kpi>
        <Kpi icon="thumb_up" label="Approval rate" value={cur.rate == null ? '—' : `${cur.rate}%`}
          sub={`${cur.approved} approved · ${cur.rejected} rejected`}>
          {st.before.rate != null && cur.rate != null && <Delta v={cur.rate - st.before.rate} />}
        </Kpi>
        <Kpi icon="timer" label="Time to decide" value={fmtHours(cur.medWait)} sub={cur.avgWait != null ? `typical · average ${fmtHours(cur.avgWait)}` : 'no decisions yet'} />
        <Kpi icon="payments" label="Approved value" value={money(cur.approvedValue)} sub={cur.pendingValue ? `${money(cur.pendingValue)} still pending` : 'nothing pending'} />
        <Kpi icon="lock_clock" label="Units on hold now" value={holds.all.length} tone={holds.overdue.length ? 'warn' : ''}
          sub={holds.all.length ? `${holds.soon.length} end within 24 h · ${holds.overdue.length} overdue` : 'No unit is held'} />
      </div>

      <div className="rqi-two">
        <section className="rqi-card" aria-label="Requests over time">
          <header><h3>Requests over time</h3>
            <span className="rqi-leg"><i className="a" />Approved<i className="r" />Rejected<i className="p" />Pending</span></header>
          <RequestChart st={st} />
          <div className="rqi-wd" aria-label="Requests by weekday">
            {WD.map((d, i) => (
              <span key={d} className={st.weekday[i] === wmax && wmax > 0 ? 'top' : ''}><i style={{ height: `${(st.weekday[i] / wmax) * 100}%` }} /><b>{d}</b></span>
            ))}
            <em className="bk-cap">{busiest ? `${busiest} is the busiest day` : 'No requests'}</em>
          </div>
        </section>

        <section className="rqi-card" aria-label="Holds running out">
          <header><h3>Holds running out</h3><span className="bk-cap">{holds.all.length} live</span></header>
          {holds.all.length === 0 ? <div className="rqi-none"><Mi>lock_open</Mi>No unit is on hold.</div> : (
            <ul className="rqi-list">
              {holds.all.slice(0, 7).map(h => (
                <Row key={h.key} tone={h.left != null && h.left < 0 ? 'bad' : h.left != null && h.left <= 86400000 ? 'warn' : ''}
                  t={`${h.unit} · ${h.project}`} s={[h.client, h.by && `held by ${h.by}`].filter(Boolean).join(' · ') || h.type}
                  r={h.left == null ? 'no end date' : h.left < 0 ? `${fmtSpan(h.left)} over` : `${fmtSpan(h.left)} left`} />
              ))}
            </ul>
          )}
          {holds.all.length > 7 && <span className="bk-cap rqi-more">and {holds.all.length - 7} more, ending later</span>}
        </section>
      </div>

      <section className="rqi-card" aria-label="By project">
        <header><h3>By project</h3><span className="bk-cap">requests this period next to the live stock</span></header>
        <div className="rqi-scroll">
          <table className="rqx-table rqi-table">
            <thead><tr><th>Project</th><th className="r">Requests</th><th className="r">Approved</th><th className="r">Value</th><th>Stock now</th><th className="r">Sold</th></tr></thead>
            <tbody>
              {st.byProject.map(p => (
                <tr key={p.id}>
                  <td><b className="rqx-client">{p.name}</b><span className="rqx-sub">{p.pending ? `${p.pending} waiting` : 'none waiting'}</span></td>
                  <td className="r rqx-mono">{p.total}</td>
                  <td className="r rqx-mono">{p.rate == null ? '—' : `${p.rate}%`}</td>
                  <td className="r rqx-mono">{money(p.approvedValue)}</td>
                  <td>
                    <span className="rqi-bar3" title={`${p.inv.available} open · ${p.inv.hold} held · ${p.inv.sold} sold`}>
                      <i className="o" style={{ flex: p.inv.available }} /><i className="h" style={{ flex: p.inv.hold }} /><i className="s" style={{ flex: p.inv.sold }} />
                    </span>
                    <span className="rqx-sub">{p.inv.available} open · {p.inv.hold} held · {p.inv.sold} sold</span>
                  </td>
                  <td className="r rqx-mono">{p.sell == null ? '—' : `${p.sell}%`}</td>
                </tr>
              ))}
              {!st.byProject.length && <tr><td colSpan={6} className="rqi-empty">No project had a request in this period.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <div className="rqi-two">
        <section className="rqi-card" aria-label="By agent">
          <header><h3>By agent</h3><span className="bk-cap">who asks, and how often it is approved</span></header>
          <div className="rqi-scroll">
            <table className="rqx-table rqi-table">
              <thead><tr><th>Agent</th><th className="r">Requests</th><th className="r">Approved</th><th className="r">Rejected</th><th className="r">Value</th></tr></thead>
              <tbody>
                {st.byAgent.slice(0, 8).map(a => (
                  <tr key={a.name}>
                    <td><b className="rqx-client">{a.name}</b>{a.pending > 0 && <span className="rqx-sub">{a.pending} waiting</span>}</td>
                    <td className="r rqx-mono">{a.total}</td>
                    <td className="r rqx-mono">{a.approved}{a.rate != null ? <span className="rqi-pc"> {a.rate}%</span> : null}</td>
                    <td className="r rqx-mono">{a.rejected}</td>
                    <td className="r rqx-mono">{money(a.approvedValue)}</td>
                  </tr>
                ))}
                {!st.byAgent.length && <tr><td colSpan={5} className="rqi-empty">No agent made a request in this period.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rqi-card" aria-label="Most requested units">
          <header><h3>Most requested units</h3><span className="bk-cap">asked for more than once</span></header>
          {st.hot.length === 0 ? <div className="rqi-none"><Mi>swap_calls</Mi>No unit was requested twice.</div> : (
            <ul className="rqi-list">
              {st.hot.map(u => (
                <Row key={u.key} t={`${u.unit} · ${u.project}`} s={`${u.agents} agent${u.agents > 1 ? 's' : ''}${u.rejected ? ` · ${u.rejected} rejected` : ''}`} r={`${u.n} requests`} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
