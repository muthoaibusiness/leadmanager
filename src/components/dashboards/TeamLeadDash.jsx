import { useApp } from '../../context/AppContext.jsx';
import { getLeads, getDB, calcPipelineValue } from '../../lib/db.js';
import StatCard from '../StatCard.jsx';
import Mi from '../Mi.jsx';
import { fmtBDT, scoreLead, scoreLabel, avc, ini, fmtAgo } from '../../lib/helpers.js';
import { STATUS_LABELS } from '../../lib/constants.js';

function ScoredPipeline({ leads, db, onOpen }) {
  if (!leads.length) return <div className="empty"><Mi>inbox</Mi><p>No leads here</p></div>;
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

  const tabs = ['To Close', 'Negotiating', 'Won'];
  let disp = tab === 1 ? neg : tab === 2 ? won : toClose;
  if (dateRange?.range) { const { start, end } = dateRange.range; disp = disp.filter(l => { const d = new Date(l.createdAt); return d >= start && d <= end; }); }

  return (
    <>
      <div className="grid-4" style={{ marginBottom: '14px' }}>
        <StatCard val={fmtBDT(rev)} label={hasRange ? 'Revenue' : 'Revenue This Month'} ico="payments" bg="#16A34A" />
        <StatCard val={fmtBDT(pipe)} label="Pipeline Value" ico="trending_up" bg="#2563EB" />
        <StatCard val={won.length + '/' + (won.length + lost.length)} label="Deals Won/Closed" ico="emoji_events" bg="#D97706" />
        <StatCard val={wr + '%'} label="Win Rate" ico="percent" bg="#7C3AED" />
      </div>
      <div className="grid-4" style={{ marginBottom: '20px' }}>
        <StatCard val={newLeads} label={hasRange ? 'New Leads' : 'New Leads This Month'} ico="person_add" bg="#0891B2" />
        <StatCard val={siteVisits} label="Site Visits Done" ico="location_on" bg="#16A34A" />
        <StatCard val={offersSent} label="Proposals Sent" ico="price_check" bg="#7C3AED" />
        <StatCard val={talkMins + ' min'} label="Team Talk Time" ico="schedule" bg="#D97706" />
      </div>
      <div className="pipeline-banner">
        <div className="pipeline-banner-icon"><Mi>psychology</Mi></div>
        <div className="pipeline-banner-body">
          <div className="pipeline-banner-title">Pipeline · AI Score</div>
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
