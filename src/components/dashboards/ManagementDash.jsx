import { useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { getDB, getBookings } from '../../lib/db.js';
import DashGreeting from './DashGreeting.jsx';
import CustomersTable from '../ui/customers-table.jsx';
import Mi from '../Mi.jsx';
import { fmtBDT, slabel, srclabel, ini } from '../../lib/helpers.js';
import { ROLES, canSee } from '../../lib/constants.js';
import { projectInventory } from '../../lib/projects.js';
import useIsPhone from '../../hooks/useIsPhone.js';
import useProjectNav from '../../hooks/useProjectNav.js';
import { Meter, SecHead } from './MobileBits.jsx';
import KpiRow from './KpiRow.jsx';
import ContactTracker from './ContactTracker.jsx';
import LeadSourcesCard from './LeadSourcesCard.jsx';
import { PeriodSelect } from '../ui/metric-controls.jsx';
import { CONTACT_PERIODS } from '../../lib/contactPerf.js';
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

// Phone Home › Performance Overview: one period for both its cards, named by
// its span ("24 hours", "7 days", …).
const OVERVIEW_PERIODS = CONTACT_PERIODS.map(p => ({ label: p.span, period: p }));

export default function ManagementDash() {
  useLeadBook(); // this view reduces over every lead; leads are not in the boot load
  useActWindow(); // pull the recent-activity window; activities are not in the boot load
  const { user, nav, setPanLead } = useApp();
  const phone = useIsPhone();
  const pnav = useProjectNav();
  const [perfPeriod, setPerfPeriod] = useState(CONTACT_PERIODS[0]); // phone: Performance Overview
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

  // ── Phone (<768px): the soft Home. Same data as below, laid out as cards:
  // summary, contacts, sources, projects, the money trend, and the
  // latest leads. Desktop and tablet keep the layout further down.
  if (phone) {
    // Per project: what is booked on it (the live bookings above) and its units.
    const projCards = coProps.map(p => ({
      id: p.id,
      name: p.name || 'Untitled project',
      inv: projectInventory(p),
      booked: bookings.filter(b => b.propertyId === p.id).reduce((s, b) => s + (b.total || 0), 0),
    })).sort((a, b) => b.booked - a.booked || b.inv.sold - a.inv.sold).slice(0, 8);
    const latest = [...coLeads].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);
    const whenOf = (iso) => {
      if (!iso) return '';
      const d = new Date(iso);
      return d >= today0
        ? 'Today, ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
        : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    };
    const todayLine = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

    return (
      <div className="mh">
        <DashGreeting user={user} sub={todayLine} />
        <KpiRow variant="hero" />

        {/* Performance Overview: Prospects contacted | Lead sources, side by side */}
        <section className="mh-sec" aria-label="Performance overview">
          <SecHead title="Performance Overview">
            <PeriodSelect value={perfPeriod.span} options={OVERVIEW_PERIODS} onChange={o => setPerfPeriod(o.period)} />
          </SecHead>
          <div className="mh-pair">
            <ContactTracker variant="soft" period={perfPeriod} />
            <LeadSourcesCard leads={coLeads} variant="soft" period={perfPeriod} />
          </div>
        </section>

        {projCards.length > 0 && (
          <section className="mh-sec" aria-label="Projects">
            <SecHead title="Projects" action={canSee(user, 'properties') ? 'See all' : null} onAction={() => nav('properties')} />
            <div className="mh-hscroll">
              {projCards.map(p => {
                const { total, available, hold, sold } = p.inv;
                const top = Math.max(available, hold, sold, 1);
                const soldPct = total ? Math.round(sold / total * 100) : 0;
                const bars = [['Available', available], ['On hold', hold], ['Sold', sold]];
                return (
                  <button key={p.id} type="button" className="mh-card mh-proj" onClick={() => pnav.openConsole(p.id, false)}>
                    <span className="mh-proj-well" aria-hidden="true">
                      {bars.map(([lbl, v]) => (
                        <span key={lbl} className="mh-proj-col">
                          <span className="mh-proj-v">{v}</span>
                          <span className={`mh-proj-bar${lbl === 'Sold' && v > 0 ? ' hi' : ''}`} style={{ height: Math.max(6, Math.round(v / top * 64)) + 'px' }} />
                          <span className="mh-proj-l">{lbl}</span>
                        </span>
                      ))}
                    </span>
                    <span className="mh-proj-name">{p.name}</span>
                    <span className="mh-proj-sub">{p.booked ? `Booked ${fmtBDT(p.booked)}` : 'Nothing booked yet'} · {total} {total === 1 ? 'unit' : 'units'}</span>
                    <Meter label="Sold" value={total ? `${soldPct}%` : 'No units yet'} pct={soldPct} />
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <section className="mh-card mh-trend" aria-label="Revenue and collections, 14 days">
          <div className="mh-sec-hd mh-sec-hd-in"><h2>Revenue &amp; collections</h2><span className="mh-chip">14 days</span></div>
          <TrendChart series={moneyTrend} labels={dayLabels} labelEvery={2} />
        </section>

        <section className="mh-sec" aria-label="Latest leads">
          <SecHead title="Latest leads" action={canSee(user, 'leads') ? 'See all' : null} onAction={() => nav('leads')} />
          {latest.length === 0 ? <p className="mh-note">No leads yet.</p> : latest.map(l => {
            const agent = usersById[l.assignedTo]?.name || 'Unassigned';
            const project = l.dealProjectName || l.propertyInterest;
            return (
              <button key={l.id} type="button" className="mh-card mh-lead" onClick={() => setPanLead(l.id)}>
                <span className="mh-lead-top">
                  <span className="mh-lead-tx">
                    <span className="mh-lead-name">{l.name || 'Unnamed'}</span>
                    <span className="mh-lead-meta">{[project, l.source ? srclabel(l.source) : null].filter(Boolean).join(' · ') || '—'}</span>
                  </span>
                  <span className={`mh-status ${statusTone(l.status)}`}>{slabel(l.status)}</span>
                </span>
                <span className="mh-lead-foot">
                  <span className="mh-agent"><span className="mh-av" aria-hidden="true">{ini(agent)}</span>{agent}</span>
                  <span className="mh-when">{whenOf(l.createdAt)}</span>
                </span>
              </button>
            );
          })}
        </section>
      </div>
    );
  }

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
