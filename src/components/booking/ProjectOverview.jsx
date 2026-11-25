import { useEffect, useState } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { countLeads, getHoldRequests } from '../../lib/db.js';
import { unitSize, unitPrice } from '../../lib/projects.js';
import { loadProjectDocLog } from '../../lib/shopDocs.js';
import { fmtBDT } from '../../lib/helpers.js';

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
    countLeads({ user, involved: true, project: project.name }).then(n => { if (live) setLeads(n); });
    loadProjectDocLog(user?.companyId, project.id).then(r => { if (live) setDocs(r.log.length); }).catch(() => { if (live) setDocs(0); });
    return () => { live = false; };
  }, [user, project.id, project.name]);

  const units = (project.variants || []).flatMap(v => (v.units || []).map(u => ({ ...u, type: v.name, size: unitSize(u, v), price: unitPrice(u, v) })));
  const land = units.filter(u => u.tag === 'st-landowner');
  const sold = units.filter(u => u.status === 'sold' && u.tag !== 'st-landowner');
  const held = units.filter(u => u.status === 'hold');
  const open = units.filter(u => u.status === 'available');
  const reqs = getHoldRequests().filter(r => r.propertyId === project.id);
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
    ['Available', open.length, 'ok'],
    ['On hold', held.length, 'gold'],
    ['Sold', sold.length, '', soldSft ? `${soldSft.toLocaleString('en-IN')} sft` : ''],
    ['Landowner', land.length, 'pl'],
    ['Top offer', top ? `৳${Math.round(top.offerRate).toLocaleString('en-IN')}` : '—', 'gold', top ? `${top.clientName} · ${top.unitId}` : 'per sft'],
    ['Docs sent', docs == null ? '…' : docs, ''],
  ];

  return (
    <div className="pov">
      <div className="pov-k">
        {k.map(([l, v, tone, sub]) => <div key={l}><span>{l}</span><b className={tone}>{v}</b>{sub && <em>{sub}</em>}</div>)}
      </div>

      <section className="pov-sec">
        <h3>Customers <i>{sold.length}</i></h3>
        {sold.length === 0 ? <p className="pov-none">No unit sold yet.</p> : (
          <div className="pov-scroll"><table className="pov-t">
            <thead><tr><th>Unit</th><th>Customer</th><th>Contact</th><th>Booked</th><th>Paid</th><th className="r">Size</th><th className="r">Price</th></tr></thead>
            <tbody>
              {sold.map(u => (
                <tr key={u.id}>
                  <td><span className="pov-u">{u.id}</span></td>
                  <td>{u.clientName || <span className="pov-mu">Not recorded</span>}</td>
                  <td className="mono">{u.clientPhone || u.sheet?.phone || '—'}</td>
                  <td className="mono pov-mu">{day(u.bookingDate || u.sheet?.bookingDate)}</td>
                  <td className="mono pov-mu">{day(u.paymentDate || u.sheet?.paymentDate)}</td>
                  <td className="mono r">{u.size ? u.size.toLocaleString('en-IN') : '—'}</td>
                  <td className="mono r">{u.price ? fmtBDT(u.price) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </section>

      <section className="pov-sec">
        <h3>On hold <i>{held.length}</i><small>agent holds end after 28 h · admin holds stay</small></h3>
        {holds.length === 0 ? <p className="pov-none">No unit is on hold.</p> : (
          <div className="pov-scroll"><table className="pov-t">
            <thead><tr><th>Unit</th><th>Customer</th><th>Held by</th><th>Since</th><th>Left</th></tr></thead>
            <tbody>
              {holds.map(h => (
                <tr key={h.id}>
                  <td><span className="pov-u">{h.id}</span></td>
                  <td>{h.client || <span className="pov-mu">—</span>}</td>
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
      </section>
    </div>
  );
}
