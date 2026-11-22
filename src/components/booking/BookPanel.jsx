import { useState } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { setUnitStatus } from '../../lib/projects.js';
import { getLeads, createHoldRequest } from '../../lib/db.js';
import { taka } from '../../lib/floorPlan.js';

const initials = (n) => (n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
// Quick customer-price steps below the list price.
const STEPS = [0, 2, 5, 10];

// Search a customer (the user's own leads, as in the project console), set the
// customer's price, then book the shop for them. Booking = hold request to
// management, exactly what the console's "Hold unit" does; the shop goes on
// hold until it is decided. Used by the desktop card and the phone sheet.
// `onDone` runs after a booking is sent (the phone sheet closes itself).
export default function BookPanel({ project, shop, onDone }) {
  const { user, refreshDB, showToast } = useApp();
  const [q, setQ] = useState('');
  const [client, setClient] = useState(null);
  const [offer, setOffer] = useState(shop.price > 0 ? String(Math.round(shop.price)) : '');

  if (shop.status !== 'available') {
    return (
      <div className="bk-book">
        <div className="bk-taken">
          <Mi>{shop.status === 'hold' ? 'hourglass_top' : 'cancel'}</Mi>
          <div>
            <b>{shop.status === 'hold' ? 'On hold' : 'Not available'}</b>
            <span>{shop.clientName ? `For ${shop.clientName}` : 'No customer recorded'}{shop.heldByName ? ` · by ${shop.heldByName}` : ''}</span>
          </div>
        </div>
      </div>
    );
  }

  const term = q.trim().toLowerCase();
  const matches = term
    ? getLeads(user).filter(l => `${l.name || ''} ${l.phone || ''}`.toLowerCase().includes(term)).slice(0, 6)
    : [];

  const price = parseFloat(offer) || 0;
  const perSqft = shop.size > 0 && price > 0 ? price / shop.size : 0;
  const diff = shop.price > 0 && price > 0 ? (price - shop.price) / shop.price * 100 : null;
  const ready = !!client && price > 0;

  const book = () => {
    if (!ready) return;
    setUnitStatus(project.id, shop.variantId, shop.code, 'hold', { user, client: { id: client.id, name: client.name }, note: 'Hold requested' });
    createHoldRequest({
      propertyId: project.id, propertyName: project.name, variantId: shop.variantId, variantName: shop.type, unitId: shop.code,
      clientName: client.name, clientPhone: client.phone, dealTotal: price, offerRate: perSqft,
    }, user);
    refreshDB();
    showToast(`Shop ${shop.code} booking sent to management for ${client.name}`, 'ok');
    onDone?.();
  };

  return (
    <div className="bk-book">
      <div className="bk-field">
        <label className="bk-cap" htmlFor="bk-cust">Customer</label>
        {client ? (
          <div className="bk-chosen">
            <span className="bk-av">{initials(client.name)}</span>
            <div><b>{client.name}</b><span>{client.phone || 'No phone'}</span></div>
            <button type="button" className="bk-x" aria-label="Change customer" onClick={() => { setClient(null); setQ(''); }}><Mi>close</Mi></button>
          </div>
        ) : (
          <div className="bk-search">
            <Mi>search</Mi>
            <input id="bk-cust" value={q} placeholder="Search by name or phone" autoComplete="off" onChange={e => setQ(e.target.value)} />
            {term && (
              <div className="bk-drop">
                {matches.length ? matches.map(l => (
                  <button key={l.id} type="button" className="bk-opt" onClick={() => { setClient(l); setQ(''); }}>
                    <span className="bk-av sm">{initials(l.name)}</span>
                    <span className="bk-opt-n">{l.name}</span><span className="bk-opt-p">{l.phone}</span>
                  </button>
                )) : <div className="bk-hint">No customer found. Add them in Leads first.</div>}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bk-field">
        <label className="bk-cap" htmlFor="bk-offer">Customer price</label>
        <div className="bk-money">
          <span>৳</span>
          <input id="bk-offer" type="number" inputMode="numeric" min="0" value={offer} placeholder={shop.price > 0 ? String(Math.round(shop.price)) : '0'} onChange={e => setOffer(e.target.value)} />
        </div>
        {shop.price > 0 && (
          <div className="bk-steps" role="group" aria-label="Set customer price from the list price">
            {STEPS.map(p => (
              <button key={p} type="button" className="bk-chip" aria-pressed={Math.round(shop.price * (1 - p / 100)) === Math.round(price)}
                onClick={() => setOffer(String(Math.round(shop.price * (1 - p / 100))))}>{p === 0 ? 'List' : `−${p}%`}</button>
            ))}
          </div>
        )}
        {price > 0 && (
          <div className="bk-calc">
            {perSqft > 0 && <span>{taka(perSqft)} / sq ft</span>}
            {diff != null && <span className={diff < 0 ? 'neg' : diff > 0 ? 'pos' : ''}>{Math.abs(diff) < 0.05 ? 'At list price' : `${Math.abs(diff).toFixed(1)}% ${diff < 0 ? 'below' : 'above'} list`}</span>}
          </div>
        )}
      </div>

      <button type="button" className="bk-btn primary" disabled={!ready} onClick={book}>Book shop {shop.code}</button>
      <div className="bk-hint">{!client ? 'Choose a customer to continue.' : price > 0 ? 'Sent to management for approval; the shop is held meanwhile.' : 'Enter the customer price.'}</div>
    </div>
  );
}
