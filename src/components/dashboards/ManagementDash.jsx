import { useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { getDB, getDeletionLog, calcPipelineValue, getBookings, bookingPaid, bookingDue, bookingNextDue } from '../../lib/db.js';
import StatCard from '../StatCard.jsx';
import Mi from '../Mi.jsx';
import { fmtBDT, avc, ini, fmtAgo, fmtDT, startOfMonth, rlabel } from '../../lib/helpers.js';
import { ROLES, STATUS_LABELS, SRC_LABELS } from '../../lib/constants.js';
import { Funnel } from '../charts/Charts.jsx';
import StatTrend from '../StatTrend.jsx';

function sclass(s) { return 's-' + (s || '').toLowerCase(); }

function AgentActivityRow({ agent, leads, acts }) {
  const myLeads = leads.filter(l => l.assignedTo === agent.id || l.previousAssignees.includes(agent.id));
  const myActs = acts.filter(a => a.userId === agent.id);
  const recentAct = [...myActs].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
  const won = myLeads.filter(l => l.status === 'DEAL_CLOSED_WON').length;
  const active = myLeads.filter(l => !['DEAL_CLOSED_WON', 'DEAL_CLOSED_LOST', 'NOT_INTERESTED'].includes(l.status)).length;
  const calls = myLeads.reduce((s, l) => s + (l.callCount || 0), 0);
  return (
    <div className="aa-row">
      <div className="aa-av" style={{ background: avc(agent.name) }}>{ini(agent.name)}</div>
      <div className="aa-info">
        <div className="aa-name">{agent.name}</div>
        <div className="aa-role">{rlabel(agent.role)}</div>
      </div>
      <div className="aa-stats">
        <div className="aa-stat"><div className="aa-sv">{myLeads.length}</div><div className="aa-sl">Customers</div></div>
        <div className="aa-stat"><div className="aa-sv">{active}</div><div className="aa-sl">Active</div></div>
        <div className="aa-stat"><div className="aa-sv">{calls}</div><div className="aa-sl">Calls</div></div>
        <div className="aa-stat"><div className="aa-sv" style={{ color: 'var(--green)' }}>{won}</div><div className="aa-sl">Won</div></div>
      </div>
      <div className="aa-last">
        {recentAct
          ? <><div className="aa-act">{recentAct.description}</div><div className="aa-time">{fmtAgo(recentAct.timestamp)}</div></>
          : <div className="aa-time">No activity</div>}
      </div>
    </div>
  );
}

export default function ManagementDash() {
  const { setView, setTeamFilter, setAgentFilter, setTab, setSearch, setPropSel, openModal, dateRange } = useApp();
  const [activeTab, setActiveTab] = useState(0);
  const db = getDB();
  const sm = startOfMonth();

  const filterByDate = (arr) => {
    if (!dateRange?.range) return arr;
    const { start, end } = dateRange.range;
    return arr.filter(l => { const d = new Date(l.createdAt); return d >= start && d <= end; });
  };

  const allLeads = filterByDate(db.leads);
  const allAgents = db.users.filter(u => u.role === ROLES.IA || u.role === ROLES.MA || u.role === ROLES.TL);
  const allActs = Object.values(db.activities || {}).flat();

  const won = allLeads.filter(l => l.status === 'DEAL_CLOSED_WON');
  const lost = allLeads.filter(l => l.status === 'DEAL_CLOSED_LOST');
  const active = allLeads.filter(l => !['DEAL_CLOSED_WON', 'DEAL_CLOSED_LOST', 'NOT_INTERESTED'].includes(l.status));
  const rev = won.reduce((s, l) => s + (l.dealValue || 0), 0);
  const pipe = allLeads.filter(l => ['NEGOTIATING', 'SITE_VISIT_DONE'].includes(l.status)).reduce((s, l) => s + calcPipelineValue(l.id, db), 0);
  const wr = won.length + lost.length > 0 ? Math.round(won.length / (won.length + lost.length) * 100) : 0;
  const newThisMonth = allLeads.filter(l => new Date(l.createdAt) >= sm).length;

  const srcCounts = {};
  allLeads.forEach(l => { srcCounts[l.source] = (srcCounts[l.source] || 0) + 1; });
  const srcColors = { META_ADS: '#C8FF00', WHATSAPP_ADS: '#34D399', LINKEDIN: '#DDB948', HOTLINE: '#F0A92B', PERSONAL: '#2DD4BF', WEBSITE: '#F87171' };

  const statusCounts = {};
  allLeads.forEach(l => { statusCounts[l.status] = (statusCounts[l.status] || 0) + 1; });

  // Chart data
  const srcData = Object.entries(srcCounts).sort((a, b) => b[1] - a[1])
    .map(([s, c]) => ({ label: SRC_LABELS[s] || s, value: c, color: srcColors[s] || '#9CA3AF' }));

  const FUNNEL = [
    ['NEW', 'New', '#C8FF00'], ['CONTACTED', 'Contacted', '#A6D400'], ['INTERESTED', 'Interested', '#DDB948'],
    ['MEETING_SET', 'Meeting Set', '#F0A92B'], ['SITE_VISIT_DONE', 'Visit Done', '#2DD4BF'],
    ['NEGOTIATING', 'Negotiating', '#34D399'], ['DEAL_CLOSED_WON', 'Won', '#34D399'],
  ];
  const funnelData = FUNNEL.map(([k, l, c]) => ({ label: l, value: statusCounts[k] || 0, color: c }));

  // 14-day new-lead trend
  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const trend = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today0); d.setDate(d.getDate() - i);
    const nx = new Date(d); nx.setDate(nx.getDate() + 1);
    const cnt = db.leads.filter(l => { const c = new Date(l.createdAt); return c >= d && c < nx; }).length;
    trend.push({ label: String(d.getDate()), value: cnt });
  }
  const trendTotal = trend.reduce((s, t) => s + t.value, 0);
  const last7 = trend.slice(7).reduce((s, t) => s + t.value, 0);
  const prev7 = trend.slice(0, 7).reduce((s, t) => s + t.value, 0);
  const trendDelta = prev7 ? Math.round((last7 - prev7) / prev7 * 100) : (last7 ? 100 : 0);

  // Commerce pipeline (cart → checkout → payment → purchased)
  const carts = allLeads.map(l => l.cart).filter(Boolean);
  const propPrice = id => (db.properties || []).find(p => p.id === id)?.askingPrice || 0;
  const cartVal = c => c.value || propPrice(c.propertyId);
  const inStage = (...ss) => carts.filter(c => ss.includes(c.stage));
  const commerceFunnel = [
    { label: 'In Cart', value: carts.length, color: '#C8FF00' },
    { label: 'Checkout · Offer', value: inStage('CHECKOUT', 'PAYMENT', 'PURCHASED').length, color: '#DDB948' },
    { label: 'Payment · Lock', value: inStage('PAYMENT', 'PURCHASED').length, color: '#2DD4BF' },
    { label: 'Purchased', value: inStage('PURCHASED').length, color: '#34D399' },
  ];
  const cartPipelineValue = inStage('CART', 'CHECKOUT', 'PAYMENT').reduce((s, c) => s + cartVal(c), 0);
  const purchasedValue = inStage('PURCHASED').reduce((s, c) => s + cartVal(c), 0);
  const cartConv = carts.length ? Math.round(inStage('PURCHASED').length / carts.length * 100) : 0;

  // Bookings & collections
  const bookings = getBookings();
  const collected = bookings.reduce((s, b) => s + bookingPaid(b), 0);
  const outstanding = bookings.reduce((s, b) => s + bookingDue(b), 0);
  const unitsSold = (db.properties || []).reduce((s, p) => s + (p.units || []).filter(u => u.status === 'sold').length, 0);

  // Agent leaderboard
  const agentStats = allAgents.map(a => {
    const aLeads = db.leads.filter(l => l.assignedTo === a.id || (l.previousAssignees || []).includes(a.id));
    const aWon = aLeads.filter(l => l.status === 'DEAL_CLOSED_WON');
    const aClosed = aLeads.filter(l => ['DEAL_CLOSED_WON', 'DEAL_CLOSED_LOST'].includes(l.status)).length;
    return { a, leads: aLeads.length, won: aWon.length, rev: aWon.reduce((s, l) => s + (l.dealValue || 0), 0), conv: aClosed ? Math.round(aWon.length / aClosed * 100) : 0 };
  }).sort((x, y) => y.rev - x.rev || y.won - x.won);
  const maxAgentRev = Math.max(...agentStats.map(s => s.rev), 1);

  // Top projects
  const projStats = (db.properties || []).map(p => {
    const u = p.units || [];
    const pb = bookings.filter(b => b.propertyId === p.id);
    return {
      p, sold: u.filter(x => x.status === 'sold').length, booked: u.filter(x => x.status === 'booked').length,
      total: p.totalUnits || u.length, carts: carts.filter(c => c.propertyId === p.id).length,
      rev: pb.reduce((s, b) => s + bookingPaid(b), 0),
    };
  }).sort((a, b) => b.rev - a.rev || b.sold - a.sold);

  // Source performance
  const srcStats = Object.keys(srcCounts).map(s => {
    const sl = allLeads.filter(l => l.source === s);
    const sWon = sl.filter(l => l.status === 'DEAL_CLOSED_WON');
    const sClosed = sl.filter(l => ['DEAL_CLOSED_WON', 'DEAL_CLOSED_LOST'].includes(l.status)).length;
    return { s, leads: sl.length, won: sWon.length, conv: sClosed ? Math.round(sWon.length / sClosed * 100) : 0, rev: sWon.reduce((a, l) => a + (l.dealValue || 0), 0), color: srcColors[s] || '#9CA3AF' };
  }).sort((a, b) => b.leads - a.leads);
  const maxSrc = Math.max(...srcStats.map(s => s.leads), 1);

  // 14-day daily series for trend cards
  const days14 = Array.from({ length: 14 }, (_, i) => { const d = new Date(today0); d.setDate(d.getDate() - (13 - i)); const nx = new Date(d); nx.setDate(nx.getDate() + 1); return [d, nx]; });
  const revSeries = days14.map(([d, nx]) => db.leads.filter(l => l.status === 'DEAL_CLOSED_WON' && l.updatedAt && new Date(l.updatedAt) >= d && new Date(l.updatedAt) < nx).reduce((s, l) => s + (l.dealValue || 0), 0));
  const leadSeries = trend.map(t => t.value);
  const allPays = bookings.flatMap(b => b.payments || []);
  const collSeries = days14.map(([d, nx]) => allPays.filter(p => new Date(p.date) >= d && new Date(p.date) < nx).reduce((s, p) => s + (p.amount || 0), 0));
  const sDelta = arr => { const a = arr.slice(7).reduce((x, y) => x + y, 0), b = arr.slice(0, 7).reduce((x, y) => x + y, 0); return b ? Math.round((a - b) / b * 100) : (a ? 100 : 0); };

  const trendCards = [
    { label: 'Revenue', value: fmtBDT(rev), delta: sDelta(revSeries), points: revSeries, color: 'var(--volt)' },
    { label: 'New Customers', value: trendTotal, delta: trendDelta, points: leadSeries, color: '#F4EFE5' },
    { label: 'Collected', value: fmtBDT(collected), delta: sDelta(collSeries), points: collSeries, color: '#34D399' },
    { label: 'Win Rate', value: wr + '%', delta: null, points: null, color: 'var(--gold)' },
  ];

  // Needs-attention (live, ignores date range)
  const isStale = (iso, days) => iso && (Date.now() - new Date(iso)) > days * 86400000;
  const overdueBk = bookings.filter(b => { const nd = bookingNextDue(b); return nd && new Date(nd.dueDate) < new Date() && bookingDue(b) > 0; });
  const overdueAmt = overdueBk.reduce((s, b) => s + bookingDue(b), 0);
  const staleNeg = db.leads.filter(l => l.status === 'NEGOTIATING' && isStale(l.updatedAt || l.createdAt, 14)).length;
  const newUncontacted = db.leads.filter(l => l.status === 'NEW').length;
  const lowStock = (db.properties || []).filter(p => p.status !== 'SOLD_OUT' && (p.unitsAvailable || 0) > 0 && (p.unitsAvailable || 0) <= 3).length;
  const goLeads = () => { setView('leads'); setTab(0); setSearch(''); setAgentFilter(null); setTeamFilter(null); };
  const alerts = [
    { ico: 'hourglass_bottom', n: overdueBk.length, label: 'Overdue dues', sub: fmtBDT(overdueAmt), tone: 'red', onClick: () => setView('bookings') },
    { ico: 'schedule', n: staleNeg, label: 'Stale negotiations', sub: '>14 days idle', tone: 'orange', onClick: goLeads },
    { ico: 'fiber_new', n: newUncontacted, label: 'New / uncontacted', sub: 'need first touch', tone: 'volt', onClick: goLeads },
    { ico: 'inventory_2', n: lowStock, label: 'Low stock', sub: '≤3 units left', tone: 'gold', onClick: () => setView('properties') },
  ];

  // Team performance comparison
  const teamStats = db.users.filter(u => u.role === ROLES.TL).map(tl => {
    const tLeads = filterByDate(db.leads.filter(l => l.teamId === tl.teamId));
    const tWon = tLeads.filter(l => l.status === 'DEAL_CLOSED_WON');
    const tLost = tLeads.filter(l => l.status === 'DEAL_CLOSED_LOST');
    const tActive = tLeads.filter(l => !['DEAL_CLOSED_WON', 'DEAL_CLOSED_LOST', 'NOT_INTERESTED'].includes(l.status));
    const tAgents = db.users.filter(u => (u.role === ROLES.IA || u.role === ROLES.MA) && u.teamId === tl.teamId);
    return {
      tl, leads: tLeads.length, active: tActive.length, won: tWon.length,
      rev: tWon.reduce((s, l) => s + (l.dealValue || 0), 0), agents: tAgents.length,
      win: tWon.length + tLost.length ? Math.round(tWon.length / (tWon.length + tLost.length) * 100) : 0,
    };
  }).sort((a, b) => b.rev - a.rev);
  const maxTeamRev = Math.max(...teamStats.map(t => t.rev), 1);

  const deletionLog = getDeletionLog();

  const viewTeamLeads = (teamId) => { setView('leads'); setTab(0); setSearch(''); setAgentFilter(null); setTeamFilter(teamId); };

  const tabs = ['Overview', 'Agent Activity', 'Deletion Log'];

  return (
    <>
      <div className="grid-4" style={{ marginBottom: '22px' }}>
        {trendCards.map((c, i) => <StatTrend key={i} {...c} />)}
      </div>

      <div className="fbar" style={{ marginBottom: '16px' }}>
        <div className="ftabs">
          {tabs.map((t, i) => <div key={i} className={`ftab${activeTab === i ? ' on' : ''}`} onClick={() => setActiveTab(i)}>{t}</div>)}
        </div>
      </div>

      {activeTab === 0 && (
        <>
          <div className="alert-strip">
            {alerts.map((a, i) => (
              <button key={i} className={`alert-card${a.n > 0 ? ' on a-' + a.tone : ''}`} onClick={a.onClick}>
                <Mi>{a.n > 0 ? a.ico : 'check_circle'}</Mi>
                <div className="alert-bd">
                  <div className="alert-n">{a.n}</div>
                  <div className="alert-l">{a.label}</div>
                  <div className="alert-s">{a.n > 0 ? a.sub : 'all clear'}</div>
                </div>
              </button>
            ))}
          </div>

          <div style={{ marginBottom: '16px' }}>
            <div className="analytics-card">
              <div className="ac-hd"><Mi>apartment</Mi>Top Projects</div>
              <div className="dt dt-proj">
                <div className="dt-h"><div>Project</div><div>Sold</div><div>Carts</div><div>Collected</div></div>
                {projStats.slice(0, 6).map(s => (
                  <div key={s.p.id} className="dt-r" onClick={() => { setPropSel(s.p.id); openModal('property-view'); }}>
                    <div className="dt-proj-n"><div className="dt-n">{s.p.name}</div><div className="dt-sub">{s.p.district}</div></div>
                    <div className="dt-num">{s.sold}/{s.total}</div>
                    <div className="dt-num">{s.carts}</div>
                    <div className="dt-num dt-amt">{fmtBDT(s.rev)}</div>
                  </div>
                ))}
                {projStats.length === 0 && <div className="cm-empty">No projects</div>}
              </div>
            </div>
          </div>
        </>
      )}

      {activeTab === 1 && (
        <>
          <div className="sec-hd"><div className="sec-t"><Mi>manage_accounts</Mi>Agent Activity</div></div>
          <div className="analytics-card" style={{ marginBottom: '16px', overflowX: 'auto' }}>
            {allAgents.length === 0 && <div className="empty"><Mi>person_off</Mi><p>No agents</p></div>}
            {allAgents.map(agent => (
              <AgentActivityRow key={agent.id} agent={agent} leads={db.leads} acts={allActs} />
            ))}
          </div>
        </>
      )}

      {activeTab === 2 && (
        <>
          <div className="sec-hd"><div className="sec-t"><Mi>history</Mi>Deletion Log</div></div>
          <div className="analytics-card" style={{ overflowX: 'auto' }}>
            {deletionLog.length === 0 && <div className="empty"><Mi>check_circle</Mi><p>No deletions recorded</p></div>}
            {deletionLog.length > 0 && (
              <div className="del-log">
                <div className="dl-hdr"><div>Lead</div><div>Status</div><div>Deleted By</div><div>When</div></div>
                {deletionLog.map((d, i) => (
                  <div key={i} className="dl-row">
                    <div><div className="dl-name">{d.name}</div><div className="dl-phone">{d.phone}</div></div>
                    <div><span className={`bdg ${sclass(d.status)}`}>{STATUS_LABELS[d.status] || d.status}</span></div>
                    <div className="dl-by">{d.deletedBy}</div>
                    <div className="dl-when">{fmtDT(d.deletedAt)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
