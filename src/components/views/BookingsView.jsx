import { useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { getBookings, getDB, bookingPaid, bookingDue } from '../../lib/db.js';
import { fmtBDT, fmtD } from '../../lib/helpers.js';
import { ROLES } from '../../lib/constants.js';
import Mi from '../Mi.jsx';

const ST = { HOLD: 'On Hold', ACTIVE: 'Active', COMPLETED: 'Completed', EXPIRED: 'Expired', CANCELLED: 'Cancelled' };
const stClass = s => ({ HOLD: 'bs-hold', ACTIVE: 'bs-active', COMPLETED: 'bs-done', EXPIRED: 'bs-cancel', CANCELLED: 'bs-cancel' }[s] || '');

export default function BookingsView() {
  const { user, openModal, setBookSel, dbVersion } = useApp();
  const db = getDB();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('ALL');

  let bks = getBookings();
  if (user.role === ROLES.IA || user.role === ROLES.MA) bks = bks.filter(b => b.agentId === user.id);
  else if (user.role === ROLES.TL) {
    const team = new Set(db.users.filter(u => u.teamId === user.teamId).map(u => u.id));
    bks = bks.filter(b => team.has(b.agentId));
  }

  if (status !== 'ALL') bks = bks.filter(b => b.status === status);
  if (q) { const s = q.toLowerCase(); bks = bks.filter(b => (b.leadName + ' ' + b.propertyName + ' ' + (b.unitNo || '')).toLowerCase().includes(s)); }

  const contracted = bks.reduce((s, b) => s + (b.total || 0), 0);
  const collected = bks.reduce((s, b) => s + bookingPaid(b), 0);
  const outstanding = bks.reduce((s, b) => s + bookingDue(b), 0);
  const activeCt = bks.filter(b => b.status === 'ACTIVE').length;

  const open = (id) => { setBookSel(id); openModal('booking'); };

  return (
    <>
      <div className="grid-4" style={{ marginBottom: '18px' }}>
        <div className="mc"><div className="mc-top"><div className="mc-ico" style={{ background: '#2DD4BF' }}><Mi>description</Mi></div></div><div className="mc-v">{fmtBDT(contracted)}</div><div className="mc-l">Contracted Value</div></div>
        <div className="mc"><div className="mc-top"><div className="mc-ico" style={{ background: '#34D399' }}><Mi>payments</Mi></div></div><div className="mc-v">{fmtBDT(collected)}</div><div className="mc-l">Collected</div></div>
        <div className="mc"><div className="mc-top"><div className="mc-ico" style={{ background: '#F0A92B' }}><Mi>hourglass_bottom</Mi></div></div><div className="mc-v">{fmtBDT(outstanding)}</div><div className="mc-l">Outstanding Dues</div></div>
        <div className="mc"><div className="mc-top"><div className="mc-ico" style={{ background: '#FFFFFF' }}><Mi>receipt_long</Mi></div></div><div className="mc-v">{activeCt}</div><div className="mc-l">Active Bookings</div></div>
      </div>

      <div className="prop-toolbar">
        <div className="pt-search">
          <Mi>search</Mi>
          <input placeholder="Search client, project, unit..." value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <select className="fsel" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="ALL">All status</option>
          {Object.entries(ST).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <span className="fcount">{bks.length} booking{bks.length === 1 ? '' : 's'}</span>
      </div>

      {bks.length === 0 ? (
        <div className="empty"><Mi>receipt_long</Mi><p>No bookings yet. Move a lead's cart to <strong>Payment</strong> to open a booking.</p></div>
      ) : (
        <div className="lt">
          <div className="lt-hdr bk-grid"><div>Client</div><div>Project / Unit</div><div>Total</div><div>Collected</div><div>Due</div><div>Status</div></div>
          {bks.map(b => {
            const paid = bookingPaid(b), due = bookingDue(b);
            const pct = b.total ? Math.round(paid / b.total * 100) : 0;
            return (
              <div key={b.id} className="lt-row bk-grid" onClick={() => open(b.id)}>
                <div className="lt-cell"><div style={{ minWidth: 0 }}><div className="lt-n">{b.leadName}</div><div className="lt-sub">by {b.agentName}</div></div></div>
                <div className="lt-cell"><div style={{ minWidth: 0 }}><div className="lt-prop">{b.propertyName}</div><div className="lt-sub">{b.unitNo ? 'Unit ' + b.unitNo.replace('U-', '') : '—'}</div></div></div>
                <div className="lt-cell"><span className="bk-amt">{fmtBDT(b.total)}</span></div>
                <div className="lt-cell">
                  <div style={{ minWidth: 0, width: '100%' }}>
                    <span className="bk-amt" style={{ color: 'var(--green)' }}>{fmtBDT(paid)}</span>
                    <div className="bk-track"><div className="bk-fill" style={{ width: pct + '%' }} /></div>
                  </div>
                </div>
                <div className="lt-cell"><span className="bk-amt" style={{ color: due > 0 ? 'var(--orange)' : 'var(--t3)' }}>{fmtBDT(due)}</span></div>
                <div className="lt-cell"><span className={`bdg ${stClass(b.status)}`}>{ST[b.status] || b.status}</span></div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
