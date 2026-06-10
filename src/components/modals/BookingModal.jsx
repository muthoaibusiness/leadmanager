import { useState } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { getBooking, recordPayment, setBookingStatus, bookingPaid, bookingDue } from '../../lib/db.js';
import { fmtBDT, fmtD, fmtDT } from '../../lib/helpers.js';

const METHODS = ['Cash', 'bKash', 'Nagad', 'Bank transfer', 'Cheque', 'Card'];

export default function BookingModal() {
  const { modal, closeModal, bookSel, user, refreshDB, showToast } = useApp();
  const isOpen = modal === 'booking';
  const [amt, setAmt] = useState('');
  const [method, setMethod] = useState('Cash');
  const [ref, setRef] = useState('');
  const [schedIdx, setSchedIdx] = useState('');

  if (!isOpen) return <div className="mov" onClick={closeModal} />;
  const b = bookSel ? getBooking(bookSel) : null;
  if (!b) return <div className="mov on" onClick={closeModal} />;

  const paid = bookingPaid(b), due = bookingDue(b);
  const pct = b.total ? Math.round(paid / b.total * 100) : 0;

  const payInstalment = (i) => { recordPayment(b.id, { amount: b.schedule[i].amount, method: 'Cash', ref: '', scheduleIdx: i }, user); refreshDB(); showToast('Instalment marked paid', 'ok'); };
  const submitPayment = () => {
    const a = parseFloat(amt) || 0;
    if (a <= 0) { showToast('Enter an amount', 'err'); return; }
    recordPayment(b.id, { amount: a, method, ref, scheduleIdx: schedIdx === '' ? null : Number(schedIdx) }, user);
    refreshDB(); showToast('Payment of ' + fmtBDT(a) + ' recorded', 'ok');
    setAmt(''); setRef(''); setSchedIdx('');
  };

  return (
    <div className="mov on" onClick={closeModal}>
      <div className="modal bk-modal" onClick={e => e.stopPropagation()}>
        <div className="m-hd">
          <div>
            <div className="m-ttl">{b.leadName}</div>
            <div className="ub-sub">{b.propertyName}{b.unitNo ? ' · Unit ' + b.unitNo.replace('U-', '') : ''}</div>
          </div>
          <button className="m-x" onClick={closeModal}><Mi>close</Mi></button>
        </div>

        <div className="m-body">
          <div className="bk-summary">
            <div className="bk-sum-row">
              <div><div className="bk-sum-l">Total</div><div className="bk-sum-v">{fmtBDT(b.total)}</div></div>
              <div><div className="bk-sum-l">Collected</div><div className="bk-sum-v" style={{ color: 'var(--green)' }}>{fmtBDT(paid)}</div></div>
              <div><div className="bk-sum-l">Due</div><div className="bk-sum-v" style={{ color: due > 0 ? 'var(--orange)' : 'var(--t3)' }}>{fmtBDT(due)}</div></div>
            </div>
            <div className="bk-track lg"><div className="bk-fill" style={{ width: pct + '%' }} /></div>
            <div className="bk-pct">
              {pct}% paid · agent {b.agentName}
              {b.offerPrice ? ' · offer ' + fmtBDT(b.offerPrice) : ''}
              {b.status === 'HOLD' && b.holdUntil ? ' · hold until ' + fmtD(b.holdUntil) : ''}
            </div>
          </div>

          <div className="pv-sec-hd" style={{ marginTop: '6px' }}><Mi>calendar_month</Mi>Payment schedule</div>
          <div className="bk-sched">
            {b.schedule.map((s, i) => (
              <div key={i} className={`bk-srow${s.paid ? ' paid' : ''}`}>
                <div className="bk-s-lbl">{s.label}<span className="bk-s-due">due {fmtD(s.dueDate)}</span></div>
                <div className="bk-s-amt">{fmtBDT(s.amount)}</div>
                {s.paid
                  ? <span className="bdg bs-done">Paid</span>
                  : <button className="btn btn-p btn-sm" onClick={() => payInstalment(i)}>Mark Paid</button>}
              </div>
            ))}
          </div>

          <div className="pv-sec-hd" style={{ marginTop: '16px' }}><Mi>add_card</Mi>Record a payment</div>
          <div className="bk-payform">
            <input className="fi" type="number" placeholder="Amount ৳" value={amt} onChange={e => setAmt(e.target.value)} />
            <select className="fi" value={method} onChange={e => setMethod(e.target.value)}>
              {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <input className="fi" placeholder="Ref / Txn ID (optional)" value={ref} onChange={e => setRef(e.target.value)} />
            <button className="btn btn-p" onClick={submitPayment}><Mi>check</Mi>Record</button>
          </div>

          {b.payments?.length > 0 && (
            <>
              <div className="pv-sec-hd" style={{ marginTop: '16px' }}><Mi>receipt</Mi>Receipts</div>
              <div className="bk-receipts">
                {b.payments.map(p => (
                  <div key={p.id} className="bk-rcpt">
                    <Mi>check_circle</Mi>
                    <div style={{ flex: 1 }}>
                      <div className="bk-rcpt-top"><strong>{fmtBDT(p.amount)}</strong><span>{p.method}</span></div>
                      <div className="bk-rcpt-sub">{fmtDT(p.date)} · {p.by}{p.ref ? ' · ' + p.ref : ''}</div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="m-ft">
          {b.status !== 'CANCELLED'
            ? <button className="btn btn-g" onClick={() => { setBookingStatus(b.id, 'CANCELLED'); refreshDB(); showToast('Booking cancelled', 'warn'); }}>Cancel Booking</button>
            : <button className="btn btn-g" onClick={() => { setBookingStatus(b.id, 'ACTIVE'); refreshDB(); }}>Reactivate</button>}
          <button className="btn btn-p" onClick={() => window.print()}><Mi>print</Mi>Print</button>
        </div>
      </div>
    </div>
  );
}
