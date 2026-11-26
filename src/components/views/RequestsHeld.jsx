import { useState } from 'react';
import Mi from '../Mi.jsx';
import BkSelect from '../booking/BkSelect.jsx';
import { listProjects, unitSize, setUnitStatus, maskProject } from '../../lib/projects.js';
import { decideHoldRequest } from '../../lib/db.js';

// Requests › Held units: every unit on hold in every project, however it got there (an approved
// request, a hold placed on the Booking page, or one entered by management / the sheet import),
// with an Unhold button. Unholding frees the unit and closes any open request for it.

const HOLD_MS = 28 * 3600000; // an agent's hold ends 28 h after it starts; an admin hold has no end
const day = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');
const span = (ms) => { const h = Math.floor(Math.abs(ms) / 3600000); return h >= 24 ? `${Math.floor(h / 24)} d ${h % 24} h` : `${h} h`; };
const stamp = () => Date.now();
const KINDS = [['', 'All holds'], ['admin', 'Admin holds'], ['agent', 'Agent holds']];

// All held units, newest request first per unit, soonest to expire first.
function heldUnits(requests, now, access) {
  return listProjects().map(p => maskProject(p, access)).flatMap(p => (p.variants || []).flatMap(v => (v.units || []).filter(u => u.status === 'hold').map(u => {
    const req = requests.filter(r => r.propertyId === p.id && r.unitId === u.id && r.status !== 'rejected')
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
    const start = u.at || req?.decidedAt || req?.createdAt || null;
    const end = u.adminHold ? null : u.holdUntil ? new Date(u.holdUntil).getTime() : start ? new Date(start).getTime() + HOLD_MS : null;
    return {
      key: `${p.id}:${u.id}`, projectId: p.id, project: p.name, variantId: v.id, type: v.name, unitId: u.id, size: unitSize(u, v),
      admin: !!u.adminHold, by: u.adminHold ? 'Management' : (u.heldByName || req?.agentName || '—'),
      client: u.clientName || req?.clientName || (access.customers === false ? 'Hidden' : ''), phone: u.clientPhone || req?.clientPhone || '', note: u.note || '',
      start, left: end == null ? null : end - now, req,
    };
  }))).sort((a, b) => (a.left ?? Infinity) - (b.left ?? Infinity) || a.project.localeCompare(b.project) || String(a.unitId).localeCompare(String(b.unitId), undefined, { numeric: true }));
}

export default function RequestsHeld({ all, user, refreshDB, showToast, onOpen, access = {}, mayStatus = true }) {
  const [now] = useState(stamp);
  const [q, setQ] = useState('');
  const [project, setProject] = useState('');
  const [kind, setKind] = useState('');
  const [ask, setAsk] = useState(null); // the row whose Unhold is waiting for a confirm

  const held = heldUnits(all, now, access);
  const projects = [...new Set(held.map(h => h.project))].sort();
  const needle = q.trim().toLowerCase();
  const rows = held
    .filter(h => !project || h.project === project)
    .filter(h => !kind || (kind === 'admin') === h.admin)
    .filter(h => !needle || [h.unitId, h.project, h.client, h.phone, h.by, h.note].some(v => String(v || '').toLowerCase().includes(needle)));
  const nAdmin = held.filter(h => h.admin).length;

  const unhold = (h) => {
    setUnitStatus(h.projectId, h.variantId, h.unitId, 'available', { user });
    // an open request for the unit would otherwise still sit in the queue
    all.filter(r => r.propertyId === h.projectId && r.unitId === h.unitId && r.status === 'pending').forEach(r => decideHoldRequest(r.id, false, user));
    setAsk(null);
    refreshDB();
    showToast(`Unit ${h.unitId} is available again`, 'ok');
  };

  return (
    <>
      <div className="rqx-bar">
        <label className="bk-search rqx-search">
          <Mi>search</Mi>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search unit, project, customer or who held it" aria-label="Search held units" />
          {q && <button type="button" className="bk-close" aria-label="Clear search" onClick={() => setQ('')}><Mi>close</Mi></button>}
        </label>
        <div className="rqx-chips" role="group" aria-label="Hold type">
          {KINDS.map(([k, l]) => (
            <button key={k} type="button" className="bk-chip" aria-pressed={kind === k} onClick={() => setKind(k)}>
              {l}<i>{k === 'admin' ? nAdmin : k === 'agent' ? held.length - nAdmin : held.length}</i>
            </button>
          ))}
        </div>
        <div className="rqx-sels">
          <BkSelect label="Project" value={project} onChange={setProject} align="right" options={[{ value: '', label: 'All projects' }, ...projects.map(p => ({ value: p, label: p }))]} />
        </div>
      </div>

      <section className="rqx-card" aria-label="Held units">
        {rows.length === 0 ? (
          <div className="bk-empty bk-empty-lg">
            <Mi>{held.length ? 'search_off' : 'lock_open'}</Mi>
            <b>{held.length ? 'No held unit matches' : 'No unit is on hold'}</b>
            <span>{held.length ? 'Try a different word or filter.' : 'Units put on hold from Booking or approved requests show up here.'}</span>
          </div>
        ) : (
          <div className="rqx-scroll">
            <table className="rqx-table">
              <thead>
                <tr><th>Unit</th><th>Customer</th><th>Held by</th><th>Since</th><th>Time left</th><th aria-label="Actions" /></tr>
              </thead>
              <tbody>
                {rows.map(h => (
                  <tr key={h.key} onClick={() => onOpen(h)}>
                    <td>
                      <b className="rqx-mono">{h.unitId}</b>
                      <span className="rqx-sub">{h.project}{h.type ? ` · ${h.type}` : ''}{h.size ? ` · ${h.size.toLocaleString('en-IN')} sft` : ''}</span>
                    </td>
                    <td>
                      <b className="rqx-client">{h.client || '—'}</b>
                      {(h.phone || h.note) && <span className="rqx-sub">{h.phone || h.note}</span>}
                    </td>
                    <td>{h.by}{h.admin && <span className="rqh-tag">Admin</span>}</td>
                    <td className="rqx-mono">{day(h.start)}</td>
                    <td className={`rqx-mono ${h.left == null ? 'rqh-mu' : h.left < 4 * 3600000 ? 'rqh-bad' : 'rqh-ok'}`}>
                      {h.left == null ? (h.admin ? <span className="rqh-lock"><Mi>lock</Mi>No end</span> : '—') : h.left < 0 ? `${span(h.left)} over` : span(h.left)}
                    </td>
                    <td className="rqx-acts" onClick={e => e.stopPropagation()}>
                      {!mayStatus ? null : ask === h.key ? (
                        <>
                          <button type="button" className="bk-btn rqx-b" onClick={() => setAsk(null)}><Mi>undo</Mi>Keep</button>
                          <button type="button" className="bk-btn primary rqx-b" onClick={() => unhold(h)}><Mi>lock_open</Mi>Confirm</button>
                        </>
                      ) : (
                        <button type="button" className="bk-btn rqx-b" onClick={() => setAsk(h.key)}><Mi>lock_open</Mi>Unhold</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="rqx-foot">
          <span className="bk-cap">{rows.length} of {held.length} held unit{held.length === 1 ? '' : 's'} · agent holds end after 28 h · admin holds stay until unheld</span>
        </div>
      </section>
    </>
  );
}
