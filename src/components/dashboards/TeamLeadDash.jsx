import { useApp } from '../../context/AppContext.jsx';
import { getLeads, getDB, calcPipelineValue } from '../../lib/db.js';
import StatCard from '../StatCard.jsx';
import LeadTable from '../LeadTable.jsx';
import AgentCard from './AgentCard.jsx';
import Mi from '../Mi.jsx';
import { fmtBDT } from '../../lib/helpers.js';
import { ROLES } from '../../lib/constants.js';

export default function TeamLeadDash() {
  const { user, tab, setTab, dbVersion, dateRange } = useApp();
  const db = getDB();
  const leads = getLeads(user);
  const agents = db.users.filter(u => (u.role === ROLES.IA || u.role === ROLES.MA) && u.teamId === user.teamId);
  const won = leads.filter(l => l.status === 'DEAL_CLOSED_WON');
  const lost = leads.filter(l => l.status === 'DEAL_CLOSED_LOST');
  const neg = leads.filter(l => l.status === 'NEGOTIATING');
  const toClose = leads.filter(l => l.status === 'SITE_VISIT_DONE');
  const rev = won.reduce((s, l) => s + (l.dealValue || 0), 0);
  const pipe = leads.filter(l => ['NEGOTIATING', 'SITE_VISIT_DONE'].includes(l.status)).reduce((s, l) => s + calcPipelineValue(l.id, db), 0);
  const wr = won.length + lost.length > 0 ? Math.round(won.length / (won.length + lost.length) * 100) : 0;

  const tabs = ['To Close', 'Negotiating', 'Won'];
  let disp = tab === 1 ? neg : tab === 2 ? won : toClose;
  if (dateRange?.range) { const { start, end } = dateRange.range; disp = disp.filter(l => { const d = new Date(l.createdAt); return d >= start && d <= end; }); }

  const iaCards = agents.filter(u => u.role === ROLES.IA);
  const maCards = agents.filter(u => u.role === ROLES.MA);

  return (
    <>
      <div className="grid-4" style={{ marginBottom: '20px' }}>
        <StatCard val={fmtBDT(rev)} label="Revenue This Month" ico="payments" bg="#16A34A" />
        <StatCard val={fmtBDT(pipe)} label="Pipeline Value" ico="trending_up" bg="#2563EB" />
        <StatCard val={won.length + '/' + (won.length + lost.length)} label="Deals (Won/Closed)" ico="emoji_events" bg="#D97706" />
        <StatCard val={wr + '%'} label="Win Rate" ico="percent" bg="#7C3AED" />
      </div>
      <div className="sec-hd"><div className="sec-t"><Mi>groups</Mi>Initial Agents</div></div>
      <div className="grid-2" style={{ marginBottom: '20px' }}>
        {iaCards.length ? iaCards.map(a => <AgentCard key={a.id} agent={a} />) : <p style={{ color: 'var(--t3)' }}>No initial agents</p>}
      </div>
      <div className="sec-hd"><div className="sec-t"><Mi>handshake</Mi>Meeting Agents</div></div>
      <div className="grid-2" style={{ marginBottom: '20px' }}>
        {maCards.length ? maCards.map(a => <AgentCard key={a.id} agent={a} />) : <p style={{ color: 'var(--t3)' }}>No meeting agents</p>}
      </div>
      <div className="sec-hd">
        <div className="sec-t"><Mi>manage_accounts</Mi>My Pipeline</div>
        <div className="ftabs">
          {tabs.map((t, i) => (
            <div key={i} className={`ftab${tab === i ? ' on' : ''}`} onClick={() => setTab(i)}>{t}</div>
          ))}
        </div>
      </div>
      <LeadTable leads={disp} />
    </>
  );
}
