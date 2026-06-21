import { useState, useEffect } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { getProperty, genUnits, unitsFromCodes, setUnitStatus, getLeads } from '../../lib/db.js';
import { fmtBDT } from '../../lib/helpers.js';
import { ROLES } from '../../lib/constants.js';

const LABEL = { available: 'Available', locked: 'On Hold', booked: 'Booked', sold: 'Sold' };

export default function UnitBookingModal() {
  const { modal, closeModal, propSel, user, refreshDB, showToast, dbVersion } = useApp();
  const isOpen = modal === 'units';
  const [sel, setSel] = useState(null);
  const [cq, setCq] = useState('');
  const [client, setClient] = useState(null);
  const [offer, setOffer] = useState('');
  const [days, setDays] = useState('7');
  const [est, setEst] = useState('');

  useEffect(() => { setSel(null); }, [propSel, isOpen]);
  useEffect(() => { setCq(''); setClient(null); setOffer(''); setDays('7'); setEst(''); }, [sel]);

  if (!isOpen) return <div className="mov" onClick={closeModal} />;
  const p = propSel ? getProperty(propSel) : null;
  if (!p) return <div className="mov on" onClick={closeModal} />;

  const isAdmin = user?.role === ROLES.MGMT;
  // Saleable codes are authoritative for the grid — derive from them (keeping any
  // existing hold/booked/sold status by matching code). Else use existing/generated.
  const units = (p.saleableUnits && p.saleableUnits.trim())
    ? unitsFromCodes(p.saleableUnits, p.totalUnits, p.units)
    : ((p.units && p.units.length) ? p.units : genUnits(p));
  const counts = units.reduce((a, u) => { a[u.status] = (a[u.status] || 0) + 1; return a; }, {});
  const selUnit = sel ? units.find(u => u.no === sel) : null;
  const mine = selUnit && selUnit.heldBy === user.id;

  // agent's own lead list (TL/MGMT get team/all)
  const myLeads = getLeads(user);
  const matches = cq.trim()
    ? myLeads.filter(l => (l.name + ' ' + l.phone).toLowerCase().includes(cq.toLowerCase())).slice(0, 6)
    : [];

  const num = v => parseFloat(v) || 0;
  const act = (action, lead, meta) => {
    setUnitStatus(p.id, sel, action, user, lead, meta || {});
    refreshDB();
    const verb = { lock: 'held for ' + (lead?.name || 'client'), book: 'booked', sold: 'sold', available: 'released' }[action];
    showToast('Unit ' + sel.replace('U-', '') + ' ' + verb, 'ok');
    setCq(''); setClient(null); setOffer(''); setDays('7'); setEst('');
  };
  const hold = () => {
    if (!client) return;
    act('lock', client, { offerPrice: num(offer), holdDays: num(days) || 7, estValue: num(est) || p.askingPrice || num(offer) });
  };
  const unitLead = selUnit && selUnit.clientId ? { id: selUnit.clientId, name: selUnit.clientName } : null;
  const fmtDays = u => u.holdUntil ? Math.max(0, Math.ceil((new Date(u.holdUntil) - new Date()) / 86400000)) : null;

  return (
    <div className="mov on" onClick={closeModal}>
      <div className="modal ub-modal" onClick={e => e.stopPropagation()}>
        <div className="m-hd">
          <div>
            <div className="m-ttl">Book a Unit · {p.name}</div>
            <div className="ub-sub">Search a client, then hold or book a unit</div>
          </div>
          <button className="m-x" onClick={closeModal}><Mi>close</Mi></button>
        </div>

        <div className="ub-legend">
          <span><i className="ubL ubL-available" />Available {counts.available || 0}</span>
          <span><i className="ubL ubL-locked" />On hold {counts.locked || 0}</span>
          <span><i className="ubL ubL-booked" />Booked {counts.booked || 0}</span>
          <span><i className="ubL ubL-sold" />Sold {counts.sold || 0}</span>
        </div>

        <div className="m-body ub-body">
          {units.length === 0 ? (
            <div className="empty"><Mi>event_seat</Mi><p>No units configured. Set "Total units" on the property.</p></div>
          ) : (
            <div className="ub-grid">
              {units.map(u => {
                const n = u.no.replace('U-', '');
                // Held/booked/sold units can't be picked by an agent (admin still can,
                // to manage them). Hovering shows the full info: who/client/days/offer.
                const blocked = u.status !== 'available' && !isAdmin;
                const dleft = u.holdUntil ? Math.max(0, Math.ceil((new Date(u.holdUntil) - new Date()) / 86400000)) : null;
                const parts = [LABEL[u.status]];
                if (u.clientName) parts.push('Client: ' + u.clientName);
                if (u.heldByName) parts.push('By: ' + u.heldByName);
                if (u.status === 'locked' && dleft != null) parts.push(dleft + ' day' + (dleft === 1 ? '' : 's') + ' left');
                if (u.offerPrice) parts.push('Offer ' + fmtBDT(u.offerPrice));
                return (
                  <button
                    key={u.no}
                    className={`ub-seat ub-${u.status}${sel === u.no ? ' ub-sel' : ''}${blocked ? ' ub-blocked' : ''}`}
                    title={parts.join('\n')}
                    aria-disabled={blocked}
                    onClick={() => { if (!blocked) setSel(u.no); }}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="ub-foot">
          {!selUnit ? (
            <div className="ub-hint">Select a unit to act</div>
          ) : (
            <>
              <div className="ub-selinfo">
                <div className="ub-selno">Unit {selUnit.no.replace('U-', '')}</div>
                <div className={`ub-selstatus ub-t-${selUnit.status}`}>
                  {LABEL[selUnit.status]}{selUnit.clientName ? ` · ${selUnit.clientName}` : ''}
                  {selUnit.holdUntil && fmtDays(selUnit) != null ? ` · ${fmtDays(selUnit)}d left` : ''}
                  {selUnit.offerPrice ? ` · offer ${fmtBDT(selUnit.offerPrice)}` : ''}
                </div>
              </div>

              {selUnit.status === 'available' ? (
                <div className="ub-book">
                  <div className="ub-clientpick">
                    <Mi>search</Mi>
                    <input
                      placeholder="Search client name / phone…"
                      value={client ? client.name : cq}
                      onChange={e => { setClient(null); setCq(e.target.value); }}
                    />
                    {client && <button className="ub-cl-clear" onClick={() => { setClient(null); setCq(''); }}><Mi>close</Mi></button>}
                    {!client && matches.length > 0 && (
                      <div className="ub-cl-list">
                        {matches.map(l => (
                          <div key={l.id} className="ub-cl-item" onClick={() => { setClient(l); setCq(''); }}>
                            <div className="ub-cl-n">{l.name}</div><div className="ub-cl-p">{l.phone}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    {!client && cq.trim() && matches.length === 0 && <div className="ub-cl-list"><div className="ub-cl-empty">No client in your leads</div></div>}
                  </div>
                  {client && (
                    <div className="ub-holdform">
                      <label>Offer ৳<input type="number" value={offer} onChange={e => setOffer(e.target.value)} placeholder="0" /></label>
                      <label>Hold<input type="number" value={days} onChange={e => setDays(e.target.value)} /><span>days</span></label>
                      <label>Est. ৳<input type="number" value={est} onChange={e => setEst(e.target.value)} placeholder={p.askingPrice || 0} /></label>
                    </div>
                  )}
                  <button className="btn btn-p" disabled={!client} onClick={hold}>
                    <Mi>lock</Mi>Hold for client
                  </button>
                </div>
              ) : (
                <div className="ub-actions">
                  {selUnit.status === 'locked' && (mine || isAdmin) && (
                    <>
                      <button className="btn btn-g" onClick={() => act('available')}>Release</button>
                      <button className="btn btn-p" onClick={() => act('book', unitLead)}><Mi>check</Mi>Confirm Booking</button>
                    </>
                  )}
                  {selUnit.status === 'locked' && !mine && !isAdmin && <div className="ub-hint">Held by {selUnit.heldByName}</div>}
                  {selUnit.status === 'booked' && (mine || isAdmin) && (
                    <>
                      <button className="btn btn-g" onClick={() => act('available')}>Release</button>
                      <button className="btn btn-success" onClick={() => act('sold', unitLead)}><Mi>sell</Mi>Mark Sold</button>
                    </>
                  )}
                  {selUnit.status === 'booked' && !mine && !isAdmin && <div className="ub-hint">Booked by {selUnit.heldByName}</div>}
                  {selUnit.status === 'sold' && (
                    isAdmin
                      ? <button className="btn btn-g" onClick={() => act('available')}>Release</button>
                      : <div className="ub-hint">Sold by {selUnit.heldByName}</div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
