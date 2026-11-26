import { useEffect, useState } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { countLeads, getHoldRequests } from '../../lib/db.js';
import { unitSize, unitPrice, projectKey, maskRequest } from '../../lib/projects.js';
import { canCustomers, canPrices } from '../../lib/constants.js';
import { loadProjectDocLog } from '../../lib/shopDocs.js';
import { shortCode } from '../../lib/floorText.js';
import Pager from './Pager.jsx';
import usePage from '../../hooks/usePage.js';

// Booking › a project › Overview: the project at a glance. Figures on top, then who bought the
// sold units, and the units on hold with how long each has left. Compact on purpose.

const HOLD_MS = 28 * 3600000; // an agent's hold ends 28 h after it starts; an admin hold has no end
const day = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');
const span = (ms) => { const h = Math.floor(Math.abs(ms) / 3600000); return h >= 24 ? `${Math.floor(h / 24)} d ${h % 24} h` : `${h} h`; };
const stamp = () => Date.now();

export default function ProjectOverview({ project }) {
  const { user, dbVersion } = useApp();
  void dbVersion;
  const [leads, setLeads] = useState(null);
  const [docs, setDocs] = useState(null);
  const [now] = useState(stamp);

  useEffect(() => {
    let live = true;
    countLeads({ user, involved: true, project: projectKey(project.name) }).then(n => { if (live) setLeads(n); });
    loadProjectDocLog(user?.companyId, project.id).then(r => { if (live) setDocs(r.log.length); }).catch(() => { if (live) setDocs(0); });
    return () => { live = false; };
  }, [user, project.id, project.name]);

  const units = (project.variants || []).flatMap(v => (v.units || []).map(u => ({ ...u, type: v.name, size: unitSize(u, v), price: unitPrice(u, v) })));
  const land = units.filter(u => u.tag === 'st-landowner');
  const sold = units.filter(u => u.status === 'sold' && u.tag !== 'st-landowner');
  const held = units.filter(u => u.status === 'hold');
  const open = units.filter(u => u.status === 'available');
  const seeCust = canCustomers(user), seePrice = canPrices(user);
  const reqs = getHoldRequests().filter(r => r.propertyId === project.id).map(r => maskRequest(r, { customers: seeCust, prices: seePrice }));
  const top = reqs.filter(r => r.offerRate > 0).sort((a, b) => b.offerRate - a.offerRate)[0];
  const soldSft = sold.reduce((s, u) => s + (u.size || 0), 0);

  const holds = held.map(u => {
    const req = reqs.filter(r => r.unitId === u.id && r.status !== 'rejected').sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
    const start = req?.createdAt || u.at || null;
    const end = u.adminHold ? null : (u.holdUntil ? new Date(u.holdUntil).getTime() : start ? new Date(start).getTime() + HOLD_MS : null);
    return { ...u, by: u.adminHold ? 'Management' : (req?.agentName || u.heldByName || '—'), client: u.clientName || req?.clientName || '', start, left: end == null ? null : end - now };
  }).sort((a, b) => (a.left ?? Infinity) - (b.left ?? Infinity));

  const k = [
    ['Leads', leads == null ? '…' : leads, ''],
    ['Available Units', open.length, 'ok'],
    ['On Hold Units', held.length, 'gold'],
    ['Sold Units', sold.length, '', soldSft ? `${soldSft.toLocaleString('en-IN')} sft` : ''],
    ['Landowner Units', land.length, 'pl'],
    ...(seePrice ? [['Top offer', top ? `৳${Math.round(top.offerRate).toLocaleString('en-IN')}` : '—', 'gold', top ? `${seeCust ? top.clientName + ' · ' : ''}${top.unitId}` : 'per sft']] : []),
    ['Docs sent', docs == null ? '…' : docs, ''],
  ];

  return <OverviewBody k={k} sold={sold} held={held} holds={holds} seeCust={seeCust} />;
}

// The figures and the two tables, each table 10 rows a page.
function OverviewBody({ k, sold, held, holds, seeCust }) {
  const soldPg = usePage(sold);
  const holdPg = usePage(holds);
  return (
    <div className="pov">
      <div className="pov-k">
        {k.map(([l, v, tone, sub]) => <div key={l}><span>{l}</span><b className={tone}>{v}</b>{sub && <em>{sub}</em>}</div>)}
      </div>

      {seeCust && <section className="pov-sec">
        <h3>Customers <i>{sold.length}</i></h3>
        {sold.length === 0 ? <p className="pov-none">No unit sold yet.</p> : (
          <div className="pov-scroll"><table className="pov-t">
            <thead><tr><th>Unit</th><th>Customer</th><th>Contact</th><th>Booked</th><th>Paid</th><th className="r">Size</th></tr></thead>
            <tbody>
              {soldPg.rows.map(u => (
                <tr key={u.id}>
                  <td><span className="pov-u" title={u.id}>{shortCode(u.id)}</span></td>
                  <td>{u.clientName || <span className="pov-mu">Not recorded</span>}</td>
                  <td className="mono">{u.clientPhone || u.sheet?.phone || '—'}</td>
                  <td className="mono pov-mu">{day(u.bookingDate || u.sheet?.bookingDate)}</td>
                  <td className="mono pov-mu">{day(u.paymentDate || u.sheet?.paymentDate)}</td>
                  <td className="mono r">{u.size ? u.size.toLocaleString('en-IN') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        <Pager pg={soldPg} />
      </section>}

      <section className="pov-sec">
        <h3>On hold <i>{held.length}</i><small>agent holds end after 28 h · admin holds stay</small></h3>
        {holds.length === 0 ? <p className="pov-none">No unit is on hold.</p> : (
          <div className="pov-scroll"><table className="pov-t">
            <thead><tr><th>Unit</th>{seeCust && <th>Customer</th>}<th>Held by</th><th>Since</th><th>Left</th></tr></thead>
            <tbody>
              {holdPg.rows.map(h => (
                <tr key={h.id}>
                  <td><span className="pov-u" title={h.id}>{shortCode(h.id)}</span></td>
                  {seeCust && <td>{h.client || <span className="pov-mu">—</span>}</td>}
                  <td>{h.by}{h.adminHold && <span className="pov-tag">Admin</span>}</td>
                  <td className="mono pov-mu">{day(h.start)}</td>
                  <td className={`mono ${h.left == null ? 'pov-mu' : h.left < 4 * 3600000 ? 'bad' : 'ok'}`}>
                    {h.left == null ? (h.adminHold ? <><Mi>lock</Mi>No end</> : '—') : h.left < 0 ? `${span(h.left)} over` : `${span(h.left)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        <Pager pg={holdPg} />
      </section>
    </div>
  );
}
