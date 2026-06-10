import { useState } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { getLeads, getBookings } from '../../lib/db.js';
import { fmtBDT, fmtD, ini, avc } from '../../lib/helpers.js';

// Clients = leads that booked a unit or closed won. Clicking one opens the
// shared LeadPanel customer detail (same design used everywhere).
export default function ClientsView() {
  const { user, setPanLead, dbVersion } = useApp();
  void dbVersion;
  const [q, setQ] = useState('');

  const leads = getLeads(user);
  const bkByLead = {};
  getBookings().forEach(b => { if (!bkByLead[b.leadId]) bkByLead[b.leadId] = b; });

  const clients = leads
    .filter(l => bkByLead[l.id] || l.status === 'DEAL_CLOSED_WON')
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  if (clients.length === 0) {
    return <div className="empty"><Mi>diversity_3</Mi><p>No clients yet — they appear here once a lead books a unit or a deal is won.</p></div>;
  }

  const filtered = clients.filter(c => (c.name + ' ' + c.phone + ' ' + (c.email || '')).toLowerCase().includes(q.toLowerCase().trim()));

  return (
    <div className="cl-page">
      <div className="cl-search">
        <Mi>search</Mi>
        <input placeholder="Search clients by name, phone, email..." value={q} onChange={e => setQ(e.target.value)} />
        <span className="cl-count">{filtered.length}</span>
      </div>
      <div className="cl-grid">
        {filtered.map(c => {
          const cbk = bkByLead[c.id];
          return (
            <button key={c.id} className="cl-card" onClick={() => setPanLead(c.id)}>
              <span className="cl-av" style={{ background: avc(c.name) }}>{ini(c.name)}</span>
              <div className="cl-it-bd">
                <div className="cl-it-n">{c.name}</div>
                <div className="cl-it-s">{cbk?.propertyName || c.propertyInterest || c.phone}</div>
              </div>
              <div className="cl-card-r">
                {cbk ? <span className="cl-it-v">{fmtBDT(cbk.total)}</span> : null}
                <span className="cl-since">Since {fmtD(c.createdAt)}</span>
              </div>
            </button>
          );
        })}
        {filtered.length === 0 && <div className="cl-none">No match</div>}
      </div>
    </div>
  );
}
