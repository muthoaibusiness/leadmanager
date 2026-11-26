import { useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { getDB, getBookings } from '../../lib/db.js';
import DashGreeting from './DashGreeting.jsx';
import Mi from '../Mi.jsx';
import { fmtBDT } from '../../lib/helpers.js';
import { canSee } from '../../lib/constants.js';
import { projectInventory } from '../../lib/projects.js';
import useIsPhone from '../../hooks/useIsPhone.js';
import useProjectNav from '../../hooks/useProjectNav.js';
import { Meter, SecHead } from './MobileBits.jsx';
import KpiRow from './KpiRow.jsx';
import ContactTracker from './ContactTracker.jsx';
import LeadSourcesCard from './LeadSourcesCard.jsx';
import { PeriodSelect } from '../ui/metric-controls.jsx';
import { CONTACT_PERIODS } from '../../lib/contactPerf.js';
import useActWindow from '../../hooks/useActWindow.js';
import useLeadBook from '../../hooks/useLeadBook.js';

// Phone Home › Performance Overview: one period for both its cards, named by
// its span ("24 hours", "7 days", …).
const OVERVIEW_PERIODS = CONTACT_PERIODS.map(p => ({ label: p.span, period: p }));

export default function ManagementDash() {
  useLeadBook(); // this view reduces over every lead; leads are not in the boot load
  useActWindow(); // pull the recent-activity window; activities are not in the boot load
  const { user, nav } = useApp();
  const phone = useIsPhone();
  const pnav = useProjectNav();
  const [perfPeriod, setPerfPeriod] = useState(CONTACT_PERIODS[0]); // phone: Performance Overview
  const db = getDB();
  // company sandbox — management only sees their own tenant
  const cid = user.companyId;
  // tolerate missing companyId (unsynced/legacy rows) so data never disappears
  const sameCo = (x) => !cid || !x || x === cid;
  const coLeads = db.leads.filter(l => sameCo(l.companyId));
  const coLeadIds = new Set(coLeads.map(l => l.id));
  const coProps = (db.properties || []).filter(p => sameCo(p.companyId));

  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  // Bookings & collections
  const allBookings = getBookings().filter(b => !cid || b.companyId === cid || coLeadIds.has(b.leadId));
  const bookings = allBookings.filter(b => !['EXPIRED', 'CANCELLED'].includes(b.status) && coProps.some(p => p.id === b.propertyId));


  // ── Phone (<768px): the soft Home. Same data as below, laid out as cards:
  // summary, contacts, sources and projects. Desktop and tablet keep the layout further down.
  if (phone) {
    // Per project: what is booked on it (the live bookings above) and its units.
    const projCards = coProps.map(p => ({
      id: p.id,
      name: p.name || 'Untitled project',
      inv: projectInventory(p),
      booked: bookings.filter(b => b.propertyId === p.id).reduce((s, b) => s + (b.total || 0), 0),
    })).sort((a, b) => b.booked - a.booked || b.inv.sold - a.inv.sold).slice(0, 8);
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
                  <button key={p.id} type="button" className="mh-card mh-proj" onClick={() => pnav.openUnits(p.id)}>
                    <span className="mh-proj-well" aria-hidden="true">
                      {bars.map(([lbl, v]) => (
                        <span key={lbl} className="mh-proj-col">
                          <span className="mh-proj-v">{v}</span>
                          <span className={`mh-proj-bar${lbl === 'Sold' && v > 0 ? ' hi' : ''}`} style={{ height: Math.max(5, Math.round(v / top * 40)) + 'px' }} />
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
      </div>


    </>
  );
}
