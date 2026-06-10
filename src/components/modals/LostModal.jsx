import { useState, useEffect } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { markLostFn } from '../../lib/db.js';

export default function LostModal() {
  const { modal, closeModal, user, panLead, refreshDB, showToast } = useApp();
  const isOpen = modal === 'lost';
  const [reason, setReason] = useState('');

  useEffect(() => { if (isOpen) setReason(''); }, [isOpen]);

  const submit = () => {
    if (!reason.trim()) { showToast('Please provide a loss summary', 'err'); return; }
    markLostFn(panLead, reason.trim(), user);
    closeModal();
    refreshDB();
    showToast('Lead marked as lost', 'warn');
  };

  return (
    <div className={`mov${isOpen ? ' on' : ''}`} onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
      <div className="modal">
        <div className="m-hd">
          <div className="m-ttl">Mark as Lost</div>
          <button className="m-x" onClick={closeModal}><Mi>close</Mi></button>
        </div>
        <div className="m-body">
          <div className="m-hint" style={{ borderColor: 'var(--red)', background: 'var(--red-l)', color: 'var(--red)' }}>
            <Mi>warning</Mi>This will close the lead as lost. Please provide a reason so the team can learn and improve.
          </div>
          <div className="fl" style={{ marginTop: '14px' }}>
            <label>Why was this lead lost? *</label>
            <textarea
              className="finp"
              rows={4}
              placeholder="e.g. Price too high, client chose competitor, not ready to buy yet…"
              value={reason}
              onChange={e => setReason(e.target.value)}
              autoFocus
            />
          </div>
          <div className="lost-hints">
            <div className="lost-hints-label">Common reasons:</div>
            {['Price too high', 'Chose competitor', 'Not ready to buy', 'Budget issue', 'Location mismatch'].map(s => (
              <button key={s} className="fu-chip" onClick={() => setReason(r => r ? r + ', ' + s : s)}>{s}</button>
            ))}
          </div>
        </div>
        <div className="m-ft">
          <button className="btn btn-g" onClick={closeModal}>Cancel</button>
          <button className="btn" style={{ background: 'var(--red-l)', color: 'var(--red)' }} disabled={!reason.trim()} onClick={submit}>
            <Mi>thumb_down</Mi>Confirm Lost
          </button>
        </div>
      </div>
    </div>
  );
}
