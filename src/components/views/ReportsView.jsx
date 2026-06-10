import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { getLeads, getProperties, getBookings, bookingPaid, bookingDue } from '../../lib/db.js';
import { fmtBDT, srclabel } from '../../lib/helpers.js';
import { Donut, HBars, CHART_COLORS } from '../charts/Charts.jsx';

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

export default function ReportsView() {
  const { user } = useApp();
  const leads = getLeads(user);
  const props = getProperties();
  const bookings = getBookings();

  // KPIs
  const totalBooked = bookings.reduce((s, b) => s + (b.total || 0), 0);
  const collected = bookings.reduce((s, b) => s + bookingPaid(b), 0);
  const outstanding = bookings.reduce((s, b) => s + bookingDue(b), 0);
  const unitsAvail = props.reduce((s, p) => s + (p.unitsAvailable || 0), 0);
  const kpis = [
    { l: 'Total Booked', v: fmtBDT(totalBooked) },
    { l: 'Collected', v: fmtBDT(collected), c: 'var(--green)' },
    { l: 'Outstanding', v: fmtBDT(outstanding), c: 'var(--orange)' },
    { l: 'Units Available', v: unitsAvail, c: 'var(--volt)' },
  ];

  // Sales by project (money)
  const byProj = {};
  bookings.forEach(b => { byProj[b.propertyName || '—'] = (byProj[b.propertyName || '—'] || 0) + (b.total || 0); });
  const salesByProject = Object.entries(byProj).map(([label, value], i) => ({ label, value, color: CHART_COLORS[i % CHART_COLORS.length] }))
    .sort((a, b) => b.value - a.value).slice(0, 6);

  // Lead sources (donut)
  const bySrc = {};
  leads.forEach(l => { const k = srclabel(l.source); bySrc[k] = (bySrc[k] || 0) + 1; });
  const leadSources = Object.entries(bySrc).map(([label, value], i) => ({ label, value, color: CHART_COLORS[i % CHART_COLORS.length] }));

  // Agent performance (deals won)
  const byAgent = {};
  leads.filter(l => l.status === 'DEAL_CLOSED_WON').forEach(l => { const k = l.assignedToName || '—'; byAgent[k] = (byAgent[k] || 0) + 1; });
  const agentPerf = Object.entries(byAgent).map(([label, value], i) => ({ label, value, color: CHART_COLORS[i % CHART_COLORS.length] }))
    .sort((a, b) => b.value - a.value).slice(0, 6);

  // Unit status overview
  let avail = 0, reserved = 0, sold = 0;
  props.forEach(p => {
    if (p.units && p.units.length) {
      p.units.forEach(u => {
        if (u.status === 'available') avail++;
        else if (u.status === 'locked') reserved++;
        else sold++; // sold / booked
      });
    } else {
      avail += p.unitsAvailable || 0;
      sold += Math.max(0, (p.totalUnits || 0) - (p.unitsAvailable || 0));
    }
  });
  const unitStatus = [
    { label: 'Available', value: avail, color: 'var(--green)' },
    { label: 'Reserved', value: reserved, color: 'var(--gold)' },
    { label: 'Sold / Booked', value: sold, color: 'var(--grey)' },
  ];

  return (
    <div className="rep-wrap">
      <div className="inv-strip">
        {kpis.map((k, i) => (
          <div key={i} className="inv-tile">
            <div className="inv-v" style={k.c ? { color: k.c } : null}>{k.v}</div>
            <div className="inv-l">{k.l}</div>
          </div>
        ))}
      </div>

      <div className="rep-grid">
        <div className="rep-card">
          <div className="rep-hd"><Mi>apartment</Mi>Sales by project</div>
          <MoneyBars data={salesByProject} />
        </div>
        <div className="rep-card">
          <div className="rep-hd"><Mi>donut_small</Mi>Lead sources</div>
          {leadSources.length ? <Donut data={leadSources} centerVal={leads.length} centerSub="leads" /> : <div className="rep-empty">No leads yet.</div>}
        </div>
        <div className="rep-card">
          <div className="rep-hd"><Mi>workspace_premium</Mi>Agent performance <span className="rep-hd-sub">deals won</span></div>
          {agentPerf.length ? <HBars data={agentPerf} /> : <div className="rep-empty">No closed deals yet.</div>}
        </div>
        <div className="rep-card">
          <div className="rep-hd"><Mi>meeting_room</Mi>Unit status overview</div>
          <HBars data={unitStatus} />
        </div>
      </div>
    </div>
  );
}
