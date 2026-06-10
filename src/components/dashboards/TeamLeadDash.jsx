import { useApp } from '../../context/AppContext.jsx';
import { getLeads, getDB, calcPipelineValue } from '../../lib/db.js';
import StatCard from '../StatCard.jsx';
import Mi from '../Mi.jsx';
import { fmtBDT, scoreLead, scoreLabel, avc, ini, fmtAgo } from '../../lib/helpers.js';
import { STATUS_LABELS, SRC_LABELS } from '../../lib/constants.js';
import { Donut, Funnel, Ring } from '../charts/Charts.jsx';

function ScoredPipeline({ leads, db, onOpen }) {
  if (!leads.length) return <div className="empty"><Mi>inbox</Mi><p>No customers here</p></div>;
  const scored = leads
    .map(l => ({ l, score: scoreLead(l, db.activities?.[l.id] || []) }))
    .sort((a, b) => b.score - a.score);
  return (
    <div className="sp-list">
      {scored.map(({ l, score }) => {
        const { label, color, bg } = scoreLabel(score);
        const pipe = calcPipelineValue(l.id, db);
        return (
          <div key={l.id} className="sp-row" onClick={() => onOpen(l.id)}>
            <div className="sp-av" style={{ background: avc(l.name) }}>{ini(l.name)}</div>
            <div className="sp-info">
              <div className="sp-name">{l.name}</div>
              <div className="sp-meta">{STATUS_LABELS[l.status] || l.status}{pipe > 0 ? ' · ' + fmtBDT(pipe) : ''}</div>
              {l.propertyInterest && <div className="sp-prop">{l.propertyInterest}</div>}
            </div>
            <div className="sp-score-wrap">
              <div className="sp-score-bar-track">
                <div className="sp-score-bar-fill" style={{ width: score + '%', background: color }} />
              </div>
              <div className="sp-score-badge" style={{ background: bg, color }}>
                <Mi>psychology</Mi>{score} · {label}
              </div>
            </div>
            <div className="sp-ago">{fmtAgo(l.updatedAt)}</div>
            <Mi style={{ color: 'var(--t3)', fontSize: '18px' }}>chevron_right</Mi>
          </div>
        );
      })}
    </div>
  );
}

export default function TeamLeadDash() {
  const { user, tab, setTab, dateRange, setPanLead } = useApp();
  const db = getDB();
  const leads = getLeads(user);

  const hasRange = !!dateRange?.range;
  const rangeStart = dateRange?.range?.start || (() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d; })();
  const rangeEnd = dateRange?.range?.end || new Date();
  const inRange = iso => { const d = new Date(iso); return d >= rangeStart && d <= rangeEnd; };

  const allActs = Object.values(db.activities || {}).flat();
  const teamUserIds = db.users.filter(u => u.teamId === user.teamId).map(u => u.id);

  const won = leads.filter(l => l.status === 'DEAL_CLOSED_WON' && inRange(l.updatedAt));
  const lost = leads.filter(l => l.status === 'DEAL_CLOSED_LOST' && inRange(l.updatedAt));
  const neg = leads.filter(l => l.status === 'NEGOTIATING');
  const toClose = leads.filter(l => l.status === 'SITE_VISIT_DONE');
  const rev = won.reduce((s, l) => s + (l.dealValue || 0), 0);
  const pipe = leads.filter(l => ['NEGOTIATING', 'SITE_VISIT_DONE'].includes(l.status)).reduce((s, l) => s + calcPipelineValue(l.id, db), 0);
  const wr = won.length + lost.length > 0 ? Math.round(won.length / (won.length + lost.length) * 100) : 0;

  const teamActs = allActs.filter(a => teamUserIds.includes(a.userId) && inRange(a.timestamp));
  const siteVisits = leads.filter(l => l.siteVisitDoneDate && inRange(l.siteVisitDoneDate)).length;
  const talkSecs = teamActs.filter(a => a.type === 'CALL').reduce((s, a) => s + (a.durationSeconds || 0), 0);
  const talkMins = Math.round(talkSecs / 60);
  const offersSent = allActs.filter(a => a.type === 'OFFER' && inRange(a.timestamp)).length;
  const newLeads = leads.filter(l => inRange(l.createdAt)).length;

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

  const tabs = ['To Close', 'Negotiating', 'Won'];
  let disp = tab === 1 ? neg : tab === 2 ? won : toClose;
  if (dateRange?.range) { const { start, end } = dateRange.range; disp = disp.filter(l => { const d = new Date(l.createdAt); return d >= start && d <= end; }); }

  return (
    <>
      <div className="grid-4" style={{ marginBottom: '14px' }}>
        <StatCard val={fmtBDT(rev)} label={hasRange ? 'Revenue' : 'Revenue This Month'} ico="payments" bg="#34D399" />
        <StatCard val={fmtBDT(pipe)} label="Pipeline Value" ico="trending_up" bg="#C8FF00" />
        <StatCard val={won.length + '/' + (won.length + lost.length)} label="Deals Won/Closed" ico="emoji_events" bg="#F0A92B" />
        <StatCard val={wr + '%'} label="Win Rate" ico="percent" bg="#DDB948" />
      </div>
      <div className="grid-4" style={{ marginBottom: '20px' }}>
        <StatCard val={newLeads} label={hasRange ? 'New Customers' : 'New Customers This Month'} ico="person_add" bg="#2DD4BF" />
        <StatCard val={siteVisits} label="Site Visits Done" ico="location_on" bg="#34D399" />
        <StatCard val={offersSent} label="Proposals Sent" ico="price_check" bg="#DDB948" />
        <StatCard val={talkMins + ' min'} label="Team Talk Time" ico="schedule" bg="#F0A92B" />
      </div>
      <div className="grid-3" style={{ marginBottom: '20px' }}>
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
      <div className="pipeline-banner">
        <div className="pipeline-banner-body">
          <div className="pipeline-banner-msg">
            <strong>{user?.name?.split(' ')[0]}</strong>, some amazing deals are waiting to close. Best of luck! 🎯
          </div>
        </div>
        <div className="ftabs" style={{ flexShrink: 0 }}>
          {tabs.map((t, i) => (
            <div key={i} className={`ftab${tab === i ? ' on' : ''}`} onClick={() => setTab(i)}>{t}</div>
          ))}
        </div>
      </div>
      <ScoredPipeline leads={disp} db={db} onOpen={setPanLead} />
    </>
  );
}
