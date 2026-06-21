import { useApp } from '../../context/AppContext.jsx';
import { getLeads, getDB, calcPipelineValue } from '../../lib/db.js';
import StatCard from '../StatCard.jsx';
import TargetCard from './TargetCard.jsx';
import DashGreeting from './DashGreeting.jsx';
import SuccessGauge from '../SuccessGauge.jsx';
import Mi from '../Mi.jsx';
import { fmtBDT, scoreLead, scoreLabel, fmtAgo } from '../../lib/helpers.js';
import { STATUS_LABELS, SRC_LABELS, ROLES } from '../../lib/constants.js';
import { Donut, Funnel, Ring } from '../charts/Charts.jsx';

function ScoredPipeline({ leads, db, onOpen }) {
  if (!leads.length) return <div className="iad-q-empty"><Mi>check_circle</Mi><b>Nothing to close</b><span>No deals in negotiation or ready to close.</span></div>;
  const scored = leads
    .map(l => ({ l, score: scoreLead(l, db.activities?.[l.id] || []) }))
    .sort((a, b) => b.score - a.score);
  return (
    <div className="iad-q-list">
      {scored.map(({ l, score }) => {
        const sl = scoreLabel(score);
        const pipe = calcPipelineValue(l.id, db);
        return (
          <div key={l.id} className="iad-q-row" onClick={() => onOpen(l.id)}>
            <div className="iad-q-info">
              <div className="iad-q-name">{l.name}</div>
              <div className="iad-q-meta">{STATUS_LABELS[l.status] || l.status}{pipe > 0 ? ' · ' + fmtBDT(pipe) : ''} · {fmtAgo(l.updatedAt)}</div>
            </div>
            <span className="iad-q-score" style={{ color: sl.color }}>{sl.label}</span>
            <a className="iad-q-call" href={`tel:${l.phone}`} title="Call" onClick={e => e.stopPropagation()}><Mi>call</Mi></a>
          </div>
        );
      })}
    </div>
  );
}

export default function TeamLeadDash() {
  const { user, dateRange, setPanLead } = useApp();
  const db = getDB();
  const leads = getLeads(user);

  const hasRange = !!dateRange?.range;
  const rangeStart = dateRange?.range?.start || (() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; })();
  const rangeEnd = dateRange?.range?.end || new Date();
  const inRange = iso => { const d = new Date(iso); return d >= rangeStart && d <= rangeEnd; };

  const allActs = Object.values(db.activities || {}).flat();
  const teamUsers = db.users.filter(u => u.teamId === user.teamId);
  const teamUserIds = teamUsers.map(u => u.id);

  const won = leads.filter(l => l.status === 'DEAL_CLOSED_WON' && inRange(l.updatedAt));
  const lost = leads.filter(l => l.status === 'DEAL_CLOSED_LOST' && inRange(l.updatedAt));
  const neg = leads.filter(l => l.status === 'NEGOTIATING');
  const toClose = leads.filter(l => l.status === 'SITE_VISIT_DONE');
  const closing = [...neg, ...toClose]; // deals to close — primary work list
  const rev = won.reduce((s, l) => s + (l.dealValue || 0), 0);
  const pipe = closing.reduce((s, l) => s + calcPipelineValue(l.id, db), 0);
  const wr = won.length + lost.length > 0 ? Math.round(won.length / (won.length + lost.length) * 100) : 0;

  const teamActs = allActs.filter(a => teamUserIds.includes(a.userId) && inRange(a.timestamp));
  const siteVisits = leads.filter(l => l.siteVisitDoneDate && inRange(l.siteVisitDoneDate)).length;
  const talkSecs = teamActs.filter(a => a.type === 'CALL').reduce((s, a) => s + (a.durationSeconds || 0), 0);
  const talkMins = Math.round(talkSecs / 60);
  const offersSent = allActs.filter(a => a.type === 'OFFER' && inRange(a.timestamp)).length;
  const newLeads = leads.filter(l => inRange(l.createdAt)).length;

  // Top performers in this team (by deals won, then revenue).
  const perf = teamUsers
    .filter(u => [ROLES.IA, ROLES.MA, ROLES.TL].includes(u.role))
    .map(u => {
      const uLeads = leads.filter(l => l.assignedTo === u.id || (l.previousAssignees || []).includes(u.id));
      const uWon = uLeads.filter(l => l.status === 'DEAL_CLOSED_WON');
      return { u, won: uWon.length, rev: uWon.reduce((s, l) => s + (l.dealValue || 0), 0) };
    })
    .filter(p => p.won > 0 || p.rev > 0)
    .sort((a, b) => b.won - a.won || b.rev - a.rev)
    .slice(0, 5);

  // Chart data (team)
  const sc = {}; leads.forEach(l => { sc[l.status] = (sc[l.status] || 0) + 1; });
  const FUN = [
    ['NEW', 'New', '#C8FF00'], ['CONTACTED', 'Contacted', '#A6D400'], ['INTERESTED', 'Interested', '#DDB948'],
    ['MEETING_SET', 'Meeting Set', '#F0A92B'], ['SITE_VISIT_DONE', 'Visit Done', '#2DD4BF'],
    ['NEGOTIATING', 'Negotiating', '#34D399'], ['DEAL_CLOSED_WON', 'Won', '#34D399'],
  ];
  const funnelData = FUN.map(([k, l, c]) => ({ label: l, value: sc[k] || 0, color: c }));
  const srcC = {}; leads.forEach(l => { srcC[l.source] = (srcC[l.source] || 0) + 1; });
  const srcColors = { META_ADS: '#C8FF00', WHATSAPP_ADS: '#34D399', LINKEDIN: '#DDB948', HOTLINE: '#F0A92B', PERSONAL: '#2DD4BF', WEBSITE: '#F87171' };
  const srcData = Object.entries(srcC).sort((a, b) => b[1] - a[1]).map(([s, c]) => ({ label: SRC_LABELS[s] || s, value: c, color: srcColors[s] || '#9CA3AF' }));

  return (
    <div className="iad-page">
      <DashGreeting user={user} sub={closing.length > 0
        ? `${closing.length} ${closing.length === 1 ? 'deal' : 'deals'} to close · ${fmtBDT(pipe)} in pipeline`
        : 'No deals waiting to close right now.'} />

      <div className="grid-4">
        <StatCard val={fmtBDT(rev)} label={hasRange ? 'Revenue' : 'Revenue This Month'} tone="good" sub="closed won" />
        <StatCard val={fmtBDT(pipe)} label="Pipeline Value" tone="accent" sub="to close" />
        <StatCard val={won.length + '/' + (won.length + lost.length)} label="Deals Won/Closed" sub="this period" />
        <StatCard val={wr + '%'} label="Win Rate" tone={wr >= 50 ? 'good' : ''} sub="closed won" />
      </div>
      <div className="grid-4">
        <StatCard val={newLeads} label={hasRange ? 'New Customers' : 'New This Month'} sub="leads in" />
        <StatCard val={siteVisits} label="Site Visits Done" sub="this period" />
        <StatCard val={offersSent} label="Proposals Sent" sub="offers" />
        <StatCard val={talkMins + ' min'} label="Team Talk Time" sub="on calls" />
      </div>

      <div className="iad-layout">
        {/* Primary: deals to close */}
        <div className="iad-main">
          <div className="iad-queue">
            <div className="iad-q-hd">
              <span className="iad-q-ttl">Deals to close</span>
              {closing.length > 0 && <span className="iad-q-ct">{closing.length}</span>}
            </div>
            <ScoredPipeline leads={closing} db={db} onOpen={setPanLead} />
          </div>
        </div>

        {/* Rail: target + top performers */}
        <aside className="iad-rail">
          <TargetCard user={user} />
          <SuccessGauge user={user} />
          <div className="iad-queue">
            <div className="iad-q-hd">
              <span className="iad-q-ttl">Top performers</span>
            </div>
            {perf.length === 0 ? (
              <div className="iad-q-empty iad-q-empty-quiet"><span>No closed deals yet.</span></div>
            ) : (
              <div className="iad-q-list">
                {perf.map((p, i) => (
                  <div key={p.u.id} className="iad-q-row">
                    <div className="iad-mt-time">#{i + 1}</div>
                    <div className="iad-q-info">
                      <div className="iad-q-name">{p.u.name}</div>
                      <div className="iad-q-meta">{p.won} won · {fmtBDT(p.rev)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Team analytics */}
      <div className="grid-3" style={{ marginTop: '4px' }}>
        <div className="analytics-card">
          <div className="ac-hd"><Mi>filter_alt</Mi>Team Funnel</div>
          <div className="ac-body"><Funnel stages={funnelData} /></div>
        </div>
        <div className="analytics-card">
          <div className="ac-hd"><Mi>donut_large</Mi>Leads by Source</div>
          <div className="ac-body"><Donut data={srcData} centerVal={leads.length} centerSub="leads" /></div>
        </div>
        <div className="analytics-card">
          <div className="ac-hd"><Mi>military_tech</Mi>Win Rate</div>
          <div className="ac-body" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <Ring pct={wr} size={120} thickness={12} label="closed won" />
          </div>
        </div>
      </div>
    </div>
  );
}
