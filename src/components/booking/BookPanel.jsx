import { useState } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { setUnitStatus } from '../../lib/projects.js';
import { createHoldRequest } from '../../lib/db.js';

// Quick customer-price steps below the list price.
const STEPS = [0, 2, 5, 10];

// Set the customer's price, then book the shop for the customer picked above
// (CustomerField, shared with Documents). Booking = hold request to management,
// exactly what the console's "Hold unit" does; the shop goes on hold until it
// is decided. Used by the desktop card and the phone sheet. `onDone` runs after
// a booking is sent (the phone sheet closes itself).
export default function BookPanel({ project, shop, client, onDone }) {
  const { user, refreshDB, showToast } = useApp();
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

  const price = parseFloat(offer) || 0;
  const perSqft = shop.size > 0 && price > 0 ? price / shop.size : 0;
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
      </div>

      <button type="button" className="bk-btn primary" disabled={!ready} onClick={book}>Book shop {shop.code}</button>
      <div className="bk-hint">{!client ? 'Choose a customer above to continue.' : price > 0 ? 'Sent to management for approval; the shop is held meanwhile.' : 'Enter the customer price.'}</div>
    </div>
  );
}
