import { useMemo } from 'react';
import Mi from '../Mi.jsx';
import useNavState from '../../hooks/useNavState.js';
import useCampaignData from '../../hooks/useCampaignData.js';
import { useApp } from '../../context/AppContext.jsx';
import { getDB } from '../../lib/db.js';
import { avc, ini, fmtBDT } from '../../lib/helpers.js';
import { buildCampaign, PERIODS, CAMPAIGN_TITLE } from '../../lib/campaignStats.js';
import '../campaign/campaign.css';

// Campaign dashboard: the running ad campaign (Citizen Avenue) across both
// WhatsApp numbers, for the business manager — how many people wrote in, how
// many became leads, how the leads were handed out, and how each agent is doing
// with what they were given. Numbers come from lib/campaignStats.js.

const STATUS_LABEL = {
  NEW: 'New', CONTACTED: 'Contacted', INTERESTED: 'Interested', MEETING_SET: 'Meeting set',
  SITE_VISIT_SCHEDULED: 'Visit scheduled', SITE_VISIT_DONE: 'Visit done', NEGOTIATING: 'Negotiating',
  DEAL_CLOSED_WON: 'Won', DEAL_CLOSED_LOST: 'Lost', NOT_INTERESTED: 'Not interested',
};
const STATUS_TONE = {
  NEW: 'var(--t3)', CONTACTED: 'var(--chart-1)', INTERESTED: 'var(--chart-7)', MEETING_SET: 'var(--chart-4)',
  SITE_VISIT_SCHEDULED: 'var(--chart-4)', SITE_VISIT_DONE: 'var(--chart-3)', NEGOTIATING: 'var(--chart-3)',
  DEAL_CLOSED_WON: 'var(--green)', DEAL_CLOSED_LOST: 'var(--red)', NOT_INTERESTED: 'var(--chart-8)',
};
const ROLE_LABEL = { AGENT: 'Agent', MEETING_AGENT: 'Meeting agent', TEAM_LEAD: 'Team lead', MANAGEMENT: 'Management' };
const fmt = (n) => Number(n || 0).toLocaleString('en-US');

function Delta({ now, prev }) {
  if (prev == null) return null;
  if (!prev && !now) return <span className="cmp-delta flat">no change</span>;
  const d = prev ? Math.round(((now - prev) / prev) * 100) : 100;
  const tone = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
  return <span className={`cmp-delta ${tone}`}><Mi>{d > 0 ? 'arrow_upward' : d < 0 ? 'arrow_downward' : 'remove'}</Mi>{Math.abs(d)}% vs before</span>;
}

function Kpi({ icon, label, value, sub, tone, children }) {
  return (
    <div className="cmp-card cmp-kpi" style={tone ? { '--tone': tone } : undefined}>
      <div className="cmp-kpi-top"><span className="cmp-kpi-ico"><Mi>{icon}</Mi></span><span className="cmp-kpi-lbl">{label}</span></div>
      <div className="cmp-kpi-val">{value}</div>
      <div className="cmp-kpi-sub">{sub}{children}</div>
    </div>
  );
}

function Funnel({ steps }) {
  const top = Math.max(1, steps[0]?.value || 1);
  return (
    <ol className="cmp-funnel">
      {steps.map((s, i) => {
        const prev = i ? steps[i - 1].value : null;
        const keep = prev ? Math.round((s.value / prev) * 100) : null;
        return (
          <li key={s.key}>
            <div className="cmp-fn-head">
              <span className="cmp-fn-lbl">{s.label}<small>{s.note}</small></span>
              <span className="cmp-fn-val">{fmt(s.value)}{keep != null && <em title="of the step before">{keep}%</em>}</span>
            </div>
            <div className="cmp-bar"><i style={{ width: `${Math.max(s.value ? 2 : 0, (s.value / top) * 100)}%`, opacity: 1 - i * 0.09 }} /></div>
          </li>
        );
      })}
    </ol>
  );
}

// Daily inquiries by number as stacked columns.
function Inflow({ series }) {
  const max = Math.max(1, ...series.map(d => d.dubai + d.eyad));
  const many = series.length > 14;
  const lbl = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return (
    <div>
      <div className="cmp-cols" style={{ '--n': series.length }}>
        {series.map(d => {
          const tot = d.dubai + d.eyad;
          return (
            <div className="cmp-col" key={d.t} title={`${lbl(d.t)} · ${d.dubai} Dubai · ${d.eyad} Eyad · ${d.leads} leads`}>
              <span className="cmp-col-n">{tot || ''}</span>
              <div className="cmp-col-stack" style={{ height: `${(tot / max) * 100}%` }}>
                <i className="eyad" style={{ flex: d.eyad }} /><i className="dubai" style={{ flex: d.dubai }} />
              </div>
              {(!many || series.indexOf(d) % 5 === 0) && <span className="cmp-col-d">{lbl(d.t)}</span>}
            </div>
          );
        })}
      </div>
      <div className="cmp-legend"><span><i className="dubai" />Dubai number</span><span><i className="eyad" />Eyad number</span></div>
    </div>
  );
}

function Channel({ c }) {
  return (
    <div className={`cmp-chan ${c.key}`}>
      <div className="cmp-chan-h"><span className="cmp-dot" />{c.label}</div>
      <div className="cmp-chan-grid">
        <div><b>{fmt(c.inquiries)}</b><span>Inquiries</span></div>
        <div><b>{fmt(c.leads)}</b><span>Leads</span></div>
        <div><b>{fmt(c.contacted)}</b><span>Contacted</span></div>
        <div><b>{fmt(c.interested)}</b><span>Interested</span></div>
        <div><b>{fmt(c.won)}</b><span>Won</span></div>
        <div><b>{c.forwardRate}%</b><span>Became leads</span></div>
      </div>
    </div>
  );
}

const COLS = [
  { k: 'received', l: 'Received', tip: 'Leads that came to this person (first owner or handed to them)' },
  { k: 'holding', l: 'Holding', tip: 'Leads they hold now' },
  { k: 'handed', l: 'Handed on', tip: 'Leads they passed to someone else' },
  { k: 'touchRate', l: 'Contacted', tip: 'Share of held leads that were contacted', pct: true },
  { k: 'interested', l: 'Interested' },
  { k: 'meetings', l: 'Meetings' },
  { k: 'won', l: 'Won' },
  { k: 'untouched', l: 'Untouched', tip: 'Held and never touched (stale = over an hour)', warn: true },
  { k: 'score', l: 'Score', tip: 'Contacted 45% · Interested 30% · Meetings 25%' },
];

function AgentTable({ agents }) {
  const [sort, setSort] = useNavState('campaign.sort', 'received');
  const rows = useMemo(() => agents.slice().sort((a, b) => (b[sort] ?? 0) - (a[sort] ?? 0)), [agents, sort]);
  const peak = Math.max(1, ...agents.map(a => a.received));
  if (!agents.length) return <div className="cmp-empty"><Mi>group_off</Mi>No leads handed out in this period.</div>;
  return (
    <div className="cmp-table-wrap">
      <table className="cmp-table">
        <thead>
          <tr>
            <th className="l">Agent</th>
            {COLS.map(c => (
              <th key={c.k} className={sort === c.k ? 'on' : ''} title={c.tip}>
                <button onClick={() => setSort(c.k)}>{c.l}{sort === c.k && <Mi>arrow_downward</Mi>}</button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(a => (
            <tr key={a.id}>
              <td className="l">
                <div className="cmp-ag">
                  <span className="cmp-av" style={{ background: avc(a.name) }}>{ini(a.name)}</span>
                  <span><b>{a.name}</b><small>{[ROLE_LABEL[a.role], a.team].filter(Boolean).join(' · ')}</small></span>
                </div>
              </td>
              <td><div className="cmp-share"><i style={{ width: `${(a.received / peak) * 100}%` }} /><b>{a.received}</b></div></td>
              <td>{a.holding}</td>
              <td>{a.handed || <span className="mut">0</span>}</td>
              <td>{a.holding ? `${a.touchRate}%` : <span className="mut">—</span>}</td>
              <td>{a.interested}</td>
              <td>{a.meetings}</td>
              <td>{a.won}</td>
              <td className={a.stale ? 'warn' : ''}>{a.untouched}{a.stale > 0 && <small> ({a.stale} stale)</small>}</td>
              <td><span className={`cmp-score ${a.score >= 60 ? 'hi' : a.score >= 30 ? 'mid' : 'lo'}`}>{a.holding ? a.score : '—'}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function CampaignView() {
  const { dbVersion } = useApp();
  const [period, setPeriod] = useNavState('campaign.period', '7d');
  const { leads, preleads, loading, error, at, reload } = useCampaignData();
  const db = getDB();

  const data = useMemo(
    () => buildCampaign({ leads, preleads, users: db.users || [], teams: db.teams || [], period }),
    [leads, preleads, period, dbVersion] // eslint-disable-line react-hooks/exhaustive-deps -- db mutates in place; dbVersion is the change signal
  );
  const { kpi, funnel, channels, series, bot, agents, flows, statusMix } = data;
  const statusRows = Object.entries(statusMix).sort((a, b) => b[1] - a[1]);
  const statusTotal = statusRows.reduce((s, [, n]) => s + n, 0);
  const botTotal = bot.reduce((s, b) => s + b.value, 0);
  const flowMax = Math.max(1, ...flows.map(f => f.n));
  const stale = agents.reduce((s, a) => s + a.stale, 0);

  return (
    <div className="cmp">
      <header className="cmp-top">
        <div>
          <h2 className="cmp-title">{CAMPAIGN_TITLE} <span>campaign</span></h2>
          <p className="cmp-sub">
            <span className="cmp-live"><i />Live</span>
            Dubai + Eyad WhatsApp numbers
            {at && <> · updated {at.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</>}
          </p>
        </div>
        <div className="cmp-ctl">
          <div className="cmp-seg" role="group" aria-label="Period">
            {PERIODS.map(p => <button key={p.key} className={period === p.key ? 'on' : ''} onClick={() => setPeriod(p.key)}>{p.label}</button>)}
          </div>
          <button className="cmp-ic" onClick={reload} title="Refresh" aria-label="Refresh"><Mi>refresh</Mi></button>
        </div>
      </header>

      {error && <div className="cmp-err"><Mi>error_outline</Mi>{error}<button onClick={reload}>Retry</button></div>}
      {loading && !leads.length && !preleads.length && <div className="cmp-empty"><Mi>hourglass_top</Mi>Loading the campaign…</div>}

      {stale > 0 && (
        <div className="cmp-alert"><Mi>notification_important</Mi>
          <span><b>{stale} lead{stale === 1 ? '' : 's'}</b> waiting over an hour with no contact — see the Untouched column below.</span>
        </div>
      )}

      <section className="cmp-kpis">
        <Kpi icon="forum" label="Inquiries" value={fmt(kpi.inquiries)} sub="wrote in on WhatsApp"><Delta now={kpi.inquiries} prev={kpi.inquiriesPrev} /></Kpi>
        <Kpi icon="person_add" label="Leads in CRM" value={fmt(kpi.leads)} sub={`${kpi.inquiries ? Math.round((kpi.leads / kpi.inquiries) * 100) : 0}% of inquiries`} tone="var(--chart-1)"><Delta now={kpi.leads} prev={kpi.leadsPrev} /></Kpi>
        <Kpi icon="share" label="Distributed" value={`${fmt(kpi.distributed)}/${fmt(kpi.leads)}`} sub={kpi.unassigned ? `${kpi.unassigned} not assigned yet` : 'every lead has an owner'} tone="var(--chart-7)" />
        <Kpi icon="call" label="Contacted" value={`${kpi.contactRate}%`} sub={`${fmt(kpi.contacted)} of ${fmt(kpi.leads)} leads · ${fmt(kpi.untouched)} untouched`} tone="var(--chart-4)" />
        <Kpi icon="thumb_up" label="Interested" value={fmt(kpi.interested)} sub={`${fmt(kpi.meetings)} reached a meeting`} tone="var(--chart-3)" />
        <Kpi icon="emoji_events" label="Won" value={fmt(kpi.won)} sub={kpi.revenue ? fmtBDT(kpi.revenue) : 'no revenue yet'} tone="var(--green)" />
      </section>

      <section className="cmp-grid two">
        <div className="cmp-card"><h3>Funnel<small>where inquiries go</small></h3><Funnel steps={funnel} /></div>
        <div className="cmp-card"><h3>Inquiries per day<small>by WhatsApp number</small></h3><Inflow series={series} /></div>
      </section>

      <section className="cmp-grid two">
        <div className="cmp-card">
          <h3>By WhatsApp number<small>Eyad vs Dubai</small></h3>
          <div className="cmp-chans">{channels.map(c => <Channel key={c.key} c={c} />)}</div>
        </div>
        <div className="cmp-card">
          <h3>Bot script<small>how far inquiries got on their own</small></h3>
          <ul className="cmp-bot">
            {bot.map(b => (
              <li key={b.key} title={b.hint}>
                <span>{b.label}</span>
                <div className="cmp-bar"><i style={{ width: `${botTotal ? (b.value / botTotal) * 100 : 0}%` }} /></div>
                <b>{fmt(b.value)}</b>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="cmp-card">
        <h3>Distribution &amp; performance<small>who received the leads and what they did with them</small></h3>
        <AgentTable agents={agents} />
      </section>

      <section className="cmp-grid two">
        <div className="cmp-card">
          <h3>Who handed to whom<small>lead hand-offs</small></h3>
          {flows.length ? (
            <ul className="cmp-flows">
              {flows.slice(0, 10).map((f, i) => (
                <li key={i}>
                  <span className="cmp-flow-n"><b>{f.from}</b><Mi>arrow_forward</Mi><b>{f.to}</b></span>
                  <div className="cmp-bar"><i style={{ width: `${(f.n / flowMax) * 100}%` }} /></div>
                  <em>{f.n}</em>
                </li>
              ))}
            </ul>
          ) : <div className="cmp-empty"><Mi>swap_horiz</Mi>No hand-offs yet — leads are still with their first owner.</div>}
        </div>
        <div className="cmp-card">
          <h3>Lead status<small>where the leads stand now</small></h3>
          {statusTotal ? (
            <>
              <div className="cmp-stack">
                {statusRows.map(([s, n]) => <i key={s} style={{ flex: n, background: STATUS_TONE[s] || 'var(--t3)' }} title={`${STATUS_LABEL[s] || s}: ${n}`} />)}
              </div>
              <ul className="cmp-status">
                {statusRows.map(([s, n]) => (
                  <li key={s}><i style={{ background: STATUS_TONE[s] || 'var(--t3)' }} /><span>{STATUS_LABEL[s] || s}</span><b>{n}</b><em>{Math.round((n / statusTotal) * 100)}%</em></li>
                ))}
              </ul>
            </>
          ) : <div className="cmp-empty"><Mi>inbox</Mi>No leads in this period.</div>}
        </div>
      </section>
    </div>
  );
}
