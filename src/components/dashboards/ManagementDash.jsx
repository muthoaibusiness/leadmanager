import { useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { getDB, getDeletionLog, calcPipelineValue, getBookings, bookingPaid, bookingDue, bookingNextDue } from '../../lib/db.js';
import KpiSheet from '../KpiSheet.jsx';
import DashGreeting from './DashGreeting.jsx';
import LiveActivity from './LiveActivity.jsx';
import CustomersTable from '../ui/customers-table.jsx';
import Mi from '../Mi.jsx';
import { fmtBDT, fmtDT, slabel } from '../../lib/helpers.js';
import { ROLES, STATUS_LABELS } from '../../lib/constants.js';
import StatTrend from '../StatTrend.jsx';
import useActWindow from '../../hooks/useActWindow.js';
import useLeadBook from '../../hooks/useLeadBook.js';

function sclass(s) { return 's-' + (s || '').toLowerCase(); }

export default function ManagementDash() {
  useLeadBook(); // this view reduces over every lead; leads are not in the boot load
  useActWindow(); // pull the recent-activity window; activities are not in the boot load
  const { user, setView, setTeamFilter, setAgentFilter, setTab, setSearch, setPropSel, openModal, dateRange, dbVersion, setPanLead } = useApp();
  const [activeTab, setActiveTab] = useState(0);
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
  const active = allLeads.filter(l => !['DEAL_CLOSED_WON', 'DEAL_CLOSED_LOST', 'NOT_INTERESTED'].includes(l.status));
  const rev = won.reduce((s, l) => s + (l.dealValue || 0), 0);
  const pipe = allLeads.filter(l => ['NEGOTIATING', 'SITE_VISIT_DONE'].includes(l.status)).reduce((s, l) => s + calcPipelineValue(l.id, db), 0);
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

  // Commerce pipeline (cart → checkout → payment → purchased)
  const carts = allLeads.map(l => l.cart).filter(Boolean);

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

  // Top projects — count units from the blocks (variants), matching the Projects
  // page (e.g. Block A 8 + Block B 8 = 16). Falls back to the legacy flat units /
  // stored totalUnits so older projects still show.
  const projStats = coProps.map(p => {
    const blockUnits = (p.variants || []).flatMap(v => v.units || []);
    const units = blockUnits.length ? blockUnits : (p.units || []);
    const total = units.length || p.totalUnits || 0;
    const pb = bookings.filter(b => b.propertyId === p.id);
    return {
      p,
      sold: units.filter(x => x.status === 'sold').length,
      booked: units.filter(x => ['booked', 'hold', 'locked'].includes(x.status)).length,
      total, carts: carts.filter(c => c.propertyId === p.id).length,
      rev: pb.reduce((s, b) => s + bookingPaid(b), 0),
    };
  }).sort((a, b) => b.rev - a.rev || b.sold - a.sold);

  // 14-day daily series for trend cards
  const days14 = Array.from({ length: 14 }, (_, i) => { const d = new Date(today0); d.setDate(d.getDate() - (13 - i)); const nx = new Date(d); nx.setDate(nx.getDate() + 1); return [d, nx]; });
  const revSeries = days14.map(([d, nx]) => coLeads.filter(l => l.status === 'DEAL_CLOSED_WON' && l.updatedAt && new Date(l.updatedAt) >= d && new Date(l.updatedAt) < nx).reduce((s, l) => s + (l.dealValue || 0), 0));
  const leadSeries = trend.map(t => t.value);
  const allPays = bookings.flatMap(b => b.payments || []);
  const collSeries = days14.map(([d, nx]) => allPays.filter(p => new Date(p.date) >= d && new Date(p.date) < nx).reduce((s, p) => s + (p.amount || 0), 0));
  const sDelta = arr => { const a = arr.slice(7).reduce((x, y) => x + y, 0), b = arr.slice(0, 7).reduce((x, y) => x + y, 0); return b ? Math.round((a - b) / b * 100) : (a ? 100 : 0); };

  // Lead/booking lists behind each admin KPI (for the click-through detail sheet).
  const closedList = [...won, ...lost];
  const collectedRows = bookings.filter(b => bookingPaid(b) > 0)
    .map(b => ({ leadId: b.leadId, title: b.leadName || b.clientName || 'Booking', sub: b.propertyName || '', right: fmtBDT(bookingPaid(b)) }));
  const trendCards = [
    { label: 'Revenue', value: fmtBDT(rev), delta: sDelta(revSeries), points: revSeries, color: 'var(--volt)', onClick: () => setDetail({ title: 'Revenue · Deals Won', leads: won }) },
    { label: 'New Customers', value: trendTotal, delta: trendDelta, points: leadSeries, color: '#F4EFE5', onClick: () => setDetail({ title: 'New Customers', leads: allLeads }) },
    { label: 'Collected', value: fmtBDT(collected), delta: sDelta(collSeries), points: collSeries, color: '#34D399', onClick: () => setDetail({ title: 'Collected · Bookings', rows: collectedRows }) },
    { label: 'Win Rate', value: wr + '%', delta: null, points: null, color: 'var(--gold)', onClick: () => setDetail({ title: 'Closed Deals (Won + Lost)', leads: closedList }) },
  ];

  // Needs-attention (live, ignores date range)
  const isStale = (iso, days) => iso && (Date.now() - new Date(iso)) > days * 86400000;
  const overdueBk = bookings.filter(b => { const nd = bookingNextDue(b); return nd && new Date(nd.dueDate) < new Date() && bookingDue(b) > 0; });
  const overdueAmt = overdueBk.reduce((s, b) => s + bookingDue(b), 0);
  const staleNeg = coLeads.filter(l => l.status === 'NEGOTIATING' && isStale(l.updatedAt || l.createdAt, 14)).length;
  const newUncontacted = coLeads.filter(l => l.status === 'NEW').length;
  const lowStock = coProps.filter(p => p.status !== 'SOLD_OUT' && (p.unitsAvailable || 0) > 0 && (p.unitsAvailable || 0) <= 3).length;
  const goLeads = () => { setView('leads'); setTab(0); setSearch(''); setAgentFilter(null); setTeamFilter(null); };
  const alerts = [
    { ico: 'hourglass_bottom', n: overdueBk.length, label: 'Overdue dues', sub: fmtBDT(overdueAmt), tone: 'red', onClick: () => setView('bookings') },
    { ico: 'schedule', n: staleNeg, label: 'Stale negotiations', sub: '>14 days idle', tone: 'orange', onClick: goLeads },
    { ico: 'fiber_new', n: newUncontacted, label: 'New / uncontacted', sub: 'need first touch', tone: 'volt', onClick: goLeads },
    { ico: 'inventory_2', n: lowStock, label: 'Low stock', sub: '≤3 units left', tone: 'gold', onClick: () => setView('properties') },
  ];

  const deletionLog = getDeletionLog();

  const tabs = ['Overview', <span key="la" className="la-tab"><span className="la-dot" />Live Activity</span>, 'Deletion Log'];

  return (
    <>
      <DashGreeting user={user} sub={`${active.length} active deals · ${fmtBDT(pipe)} in pipeline · ${wr}% win rate`} />

      {/* KPI row — revenue, customers, collections, win rate (with 14-day sparklines) */}
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
        <LiveActivity db={db} coLeads={coLeads} coUsers={coUsers} dbVersion={dbVersion} />
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

      {/* Clean dark customers table — real recent leads */}
      <div style={{ marginTop: 20 }}>
        <CustomersTable
          title="Latest Leads"
          subtitle="In your pipeline"
          rows={customerRows}
        />
      </div>
      <KpiSheet detail={detail} onClose={() => setDetail(null)} onLead={(id) => { setDetail(null); setPanLead && setPanLead(id); }} />
    </>
  );
}
