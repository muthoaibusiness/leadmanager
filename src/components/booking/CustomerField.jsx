import { useState } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { getLeads } from '../../lib/db.js';

const initials = (n) => (n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();

// Pick the customer once for a shop: search the user's own leads (as the
// project console does). Booking and Documents both read the pick.
export default function CustomerField({ client, setClient }) {
  const { user } = useApp();
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const matches = term
    ? getLeads(user).filter(l => `${l.name || ''} ${l.phone || ''}`.toLowerCase().includes(term)).slice(0, 6)
    : [];

  return (
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
  );
}
