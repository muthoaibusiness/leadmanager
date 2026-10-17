import { useApp } from '../../context/AppContext.jsx';
import { getDB, getBookings } from '../../lib/db.js';
import DashGreeting from './DashGreeting.jsx';
import CustomersTable from '../ui/customers-table.jsx';
import Mi from '../Mi.jsx';
import { fmtBDT, slabel } from '../../lib/helpers.js';
import { ROLES } from '../../lib/constants.js';
import KpiRow from './KpiRow.jsx';
import ContactTracker from './ContactTracker.jsx';
import LeadSourcesCard from './LeadSourcesCard.jsx';
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
  const { user } = useApp();
  const db = getDB();
  // company sandbox — management only sees their own tenant
  const cid = user.companyId;
  // tolerate missing companyId (unsynced/legacy rows) so data never disappears
  const sameCo = (x) => !cid || !x || x === cid;
  const coLeads = db.leads.filter(l => sameCo(l.companyId));
  const coUsers = db.users.filter(u => sameCo(u.companyId) && u.role !== ROLES.MASTER);
  const coLeadIds = new Set(coLeads.map(l => l.id));
  const coProps = (db.properties || []).filter(p => sameCo(p.companyId));

  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  // Bookings & collections
  const allBookings = getBookings().filter(b => !cid || b.companyId === cid || coLeadIds.has(b.leadId));
  const bookings = allBookings.filter(b => !['EXPIRED', 'CANCELLED'].includes(b.status) && coProps.some(p => p.id === b.propertyId));


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
  const allPays = bookings.flatMap(b => b.payments || []);
  const collSeries = days14.map(([d, nx]) => allPays.filter(p => new Date(p.date) >= d && new Date(p.date) < nx).reduce((s, p) => s + (p.amount || 0), 0));


  // ── Reports charts (merged in from the old standalone Reports page) ──────
  const byProj = {};
  bookings.forEach(b => { byProj[b.propertyName || '—'] = (byProj[b.propertyName || '—'] || 0) + (b.total || 0); });
  const salesByProject = Object.entries(byProj).map(([label, value], i) => ({ label, value, color: CHART_COLORS[i % CHART_COLORS.length] }))
    .sort((a, b) => b.value - a.value).slice(0, 6);


  // Money gets its own chart; the prospect-contact count sits in ContactTracker,
  // on its own scale — a count line would flatten to near-zero next to revenue.
  const dayLabels = days14.map(([d]) => String(d.getDate()));
  const moneyTrend = [
    { key: 'rev', label: 'Revenue', color: CHART_COLORS[0], points: revSeries },
    { key: 'coll', label: 'Collected', color: CHART_COLORS[2], points: collSeries },
  ];

  return (
    <>
      <DashGreeting user={user} />

      {/* KPI row — revenue, customers, collections, win rate (shared with every dashboard) */}
      <KpiRow />

      <div className="sec-hd"><div className="sec-t"><Mi>bar_chart</Mi>Performance Reports</div></div>
      {/* Two columns, row by row: contacts | sources, then sales | revenue.
          Phones stack them in this same order. */}
      <div className="rep-grid" style={{ marginBottom: '20px' }}>
        <ContactTracker />
        <LeadSourcesCard leads={coLeads} />
        <div className="rep-card" style={{ '--rep-accent': CHART_COLORS[2] }}>
          <div className="rep-hd"><Mi>apartment</Mi>Sales by project</div>
          <div className="rep-body"><MoneyBars data={salesByProject} /></div>
        </div>
        <div className="rep-card" style={{ '--rep-accent': CHART_COLORS[0] }}>
          <div className="rep-hd"><Mi>trending_up</Mi>Revenue &amp; collections <span className="rep-hd-sub">14 days</span></div>
          <div className="rep-body"><TrendChart series={moneyTrend} labels={dayLabels} labelEvery={2} /></div>
        </div>
      </div>

      <CustomersTable title="Latest Leads" subtitle="In your pipeline" rows={customerRows} />

    </>
  );
}
