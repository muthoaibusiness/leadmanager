import { useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { getDB, getBookings, bookingPaid } from '../../lib/db.js';
import KpiSheet from '../KpiSheet.jsx';
import DashGreeting from './DashGreeting.jsx';
import CustomersTable from '../ui/customers-table.jsx';
import Mi from '../Mi.jsx';
import { fmtBDT, slabel, srclabel } from '../../lib/helpers.js';
import { ROLES } from '../../lib/constants.js';
import StatTrend from '../StatTrend.jsx';
import { Donut } from '../charts/Charts.jsx';
import TrendChart from '../charts/TrendChart.jsx';
import { CHART_COLORS } from '../charts/chartColors.js';
import useActWindow from '../../hooks/useActWindow.js';
import useLeadBook from '../../hooks/useLeadBook.js';

function MoneyBars({ data }) {
  const max = Math.max(...data.map(d => d.value), 1);
  if (!data.length) return <div className="rep-empty">No data yet.</div>;
  return (
    <div className="chart-hbars">
      {data.map((d, i) => (
        <div key={i} className="chb-row">
          <div className="chb-lbl">{d.label}</div>
          <div className="chb-track"><div className="chb-fill" style={{ width: Math.max(4, Math.round(d.value / max * 100)) + '%', background: d.color || 'var(--volt)' }} /></div>
          <div className="chb-ct">{fmtBDT(d.value)}</div>
        </div>
      ))}
    </div>
  );
}

export default function ManagementDash() {
  useLeadBook(); // this view reduces over every lead; leads are not in the boot load
  useActWindow(); // pull the recent-activity window; activities are not in the boot load
  const { user, dateRange, setPanLead } = useApp();
  const [detail, setDetail] = useState(null);
  const db = getDB();
  // company sandbox — management only sees their own tenant
  const cid = user.companyId;
  // tolerate missing companyId (unsynced/legacy rows) so data never disappears
  const sameCo = (x) => !cid || !x || x === cid;
  const coLeads = db.leads.filter(l => sameCo(l.companyId));
  const coUsers = db.users.filter(u => sameCo(u.companyId) && u.role !== ROLES.MASTER);
  const coLeadIds = new Set(coLeads.map(l => l.id));
  const coProps = (db.properties || []).filter(p => sameCo(p.companyId));

  const filterByDate = (arr) => {
    if (!dateRange?.range) return arr;
    const { start, end } = dateRange.range;
    return arr.filter(l => { const d = new Date(l.createdAt); return d >= start && d <= end; });
  };

  const allLeads = filterByDate(coLeads);

  const won = allLeads.filter(l => l.status === 'DEAL_CLOSED_WON');
  const lost = allLeads.filter(l => l.status === 'DEAL_CLOSED_LOST');
  const rev = won.reduce((s, l) => s + (l.dealValue || 0), 0);
  const wr = won.length + lost.length > 0 ? Math.round(won.length / (won.length + lost.length) * 100) : 0;

  // 14-day new-lead trend
  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const trend = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today0); d.setDate(d.getDate() - i);
    const nx = new Date(d); nx.setDate(nx.getDate() + 1);
    const cnt = coLeads.filter(l => { const c = new Date(l.createdAt); return c >= d && c < nx; }).length;
    trend.push({ label: String(d.getDate()), value: cnt });
  }
  const trendTotal = trend.reduce((s, t) => s + t.value, 0);
  const last7 = trend.slice(7).reduce((s, t) => s + t.value, 0);
  const prev7 = trend.slice(0, 7).reduce((s, t) => s + t.value, 0);
  const trendDelta = prev7 ? Math.round((last7 - prev7) / prev7 * 100) : (last7 ? 100 : 0);

  // Bookings & collections
  const allBookings = getBookings().filter(b => !cid || b.companyId === cid || coLeadIds.has(b.leadId));
  const bookings = allBookings.filter(b => !['EXPIRED', 'CANCELLED'].includes(b.status) && coProps.some(p => p.id === b.propertyId));
  const collected = bookings.reduce((s, b) => s + bookingPaid(b), 0);

  // Customers table rows (real recent leads) for the clean dark table
  const statusTone = (s) => s === 'DEAL_CLOSED_WON' ? 'won' : (s === 'DEAL_CLOSED_LOST' || s === 'NOT_INTERESTED') ? 'lost' : 'open';
  const usersById = {}; coUsers.forEach(u => { usersById[u.id] = u; });
  const customerRows = [...coLeads]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 8)
    .map(l => ({
      id: l.id,
      name: l.name,
      phone: l.phone,
      project: l.dealProjectName || l.propertyInterest || '—',
      agent: usersById[l.assignedTo]?.name || 'Unassigned',
      status: slabel(l.status),
      tone: statusTone(l.status),
      value: fmtBDT(l.dealValue || l.budget || 0),
    }));

  // 14-day daily series for trend cards
  const days14 = Array.from({ length: 14 }, (_, i) => { const d = new Date(today0); d.setDate(d.getDate() - (13 - i)); const nx = new Date(d); nx.setDate(nx.getDate() + 1); return [d, nx]; });
  const revSeries = days14.map(([d, nx]) => coLeads.filter(l => l.status === 'DEAL_CLOSED_WON' && l.updatedAt && new Date(l.updatedAt) >= d && new Date(l.updatedAt) < nx).reduce((s, l) => s + (l.dealValue || 0), 0));
  const leadSeries = trend.map(t => t.value);
  const allPays = bookings.flatMap(b => b.payments || []);
  const collSeries = days14.map(([d, nx]) => allPays.filter(p => new Date(p.date) >= d && new Date(p.date) < nx).reduce((s, p) => s + (p.amount || 0), 0));
  const sDelta = arr => { const a = arr.slice(7).reduce((x, y) => x + y, 0), b = arr.slice(0, 7).reduce((x, y) => x + y, 0); return b ? Math.round((a - b) / b * 100) : (a ? 100 : 0); };

  // ── Reports charts (merged in from the old standalone Reports page) ──────
  const byProj = {};
  bookings.forEach(b => { byProj[b.propertyName || '—'] = (byProj[b.propertyName || '—'] || 0) + (b.total || 0); });
  const salesByProject = Object.entries(byProj).map(([label, value], i) => ({ label, value, color: CHART_COLORS[i % CHART_COLORS.length] }))
    .sort((a, b) => b.value - a.value).slice(0, 6);

  const bySrc = {};
  coLeads.forEach(l => { const k = srclabel(l.source); bySrc[k] = (bySrc[k] || 0) + 1; });
  const leadSources = Object.entries(bySrc).map(([label, value], i) => ({ label, value, color: CHART_COLORS[i % CHART_COLORS.length] }));

  // Two trend charts, split by scale (money vs. count) rather than sharing one
  // axis — a lead-count line would flatten to near-zero next to revenue figures.
  const dayLabels = trend.map(t => t.label);
  const moneyTrend = [
    { key: 'rev', label: 'Revenue', color: CHART_COLORS[0], points: revSeries },
    { key: 'coll', label: 'Collected', color: CHART_COLORS[2], points: collSeries },
  ];
  const leadTrend = [{ key: 'leads', label: 'New Leads', color: CHART_COLORS[1], points: leadSeries }];

  // Lead/booking lists behind each admin KPI (for the click-through detail sheet).
  const closedList = [...won, ...lost];
  const collectedRows = bookings.filter(b => bookingPaid(b) > 0)
    .map(b => ({ leadId: b.leadId, title: b.leadName || b.clientName || 'Booking', sub: b.propertyName || '', right: fmtBDT(bookingPaid(b)) }));
  const trendCards = [
    { label: 'Revenue', value: fmtBDT(rev), delta: sDelta(revSeries), points: revSeries, color: 'var(--volt)', icon: 'payments', onClick: () => setDetail({ title: 'Revenue · Deals Won', leads: won }) },
    { label: 'New Customers', value: trendTotal, delta: trendDelta, points: leadSeries, color: '#60A5FA', icon: 'group_add', onClick: () => setDetail({ title: 'New Customers', leads: allLeads }) },
    { label: 'Collected', value: fmtBDT(collected), delta: sDelta(collSeries), points: collSeries, color: '#34D399', icon: 'account_balance_wallet', onClick: () => setDetail({ title: 'Collected · Bookings', rows: collectedRows }) },
    { label: 'Win Rate', value: wr + '%', delta: null, points: null, color: 'var(--gold)', icon: 'emoji_events', onClick: () => setDetail({ title: 'Closed Deals (Won + Lost)', leads: closedList }) },
  ];

  return (
    <>
      <DashGreeting user={user} />

      {/* KPI row — revenue, customers, collections, win rate (with 14-day sparklines) */}
      <div className="grid-4" style={{ marginBottom: '22px' }}>
        {trendCards.map((c, i) => <StatTrend key={i} {...c} />)}
      </div>

      <div className="sec-hd"><div className="sec-t"><Mi>bar_chart</Mi>Performance Reports</div></div>
      <div className="rep-grid" style={{ marginBottom: '20px' }}>
        <div className="rep-card" style={{ '--rep-accent': CHART_COLORS[0] }}>
          <div className="rep-hd"><Mi>trending_up</Mi>Revenue &amp; collections <span className="rep-hd-sub">14 days</span></div>
          <div className="rep-body"><TrendChart series={moneyTrend} labels={dayLabels} labelEvery={2} /></div>
        </div>
        <div className="rep-card" style={{ '--rep-accent': CHART_COLORS[1] }}>
          <div className="rep-hd"><Mi>person_add</Mi>New leads <span className="rep-hd-sub">14 days</span></div>
          <div className="rep-body"><TrendChart series={leadTrend} labels={dayLabels} labelEvery={2} /></div>
        </div>
        <div className="rep-card" style={{ '--rep-accent': CHART_COLORS[2] }}>
          <div className="rep-hd"><Mi>apartment</Mi>Sales by project</div>
          <div className="rep-body"><MoneyBars data={salesByProject} /></div>
        </div>
        <div className="rep-card" style={{ '--rep-accent': CHART_COLORS[4] }}>
          <div className="rep-hd"><Mi>donut_small</Mi>Lead sources</div>
          <div className="rep-body">{leadSources.length ? <Donut data={leadSources} centerVal={coLeads.length} centerSub="leads" /> : <div className="rep-empty">No leads yet.</div>}</div>
        </div>
      </div>

      <CustomersTable title="Latest Leads" subtitle="In your pipeline" rows={customerRows} />

      <KpiSheet detail={detail} onClose={() => setDetail(null)} onLead={(id) => { setDetail(null); setPanLead && setPanLead(id); }} />
    </>
  );
}
