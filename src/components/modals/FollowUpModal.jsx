import { useState, useEffect } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { setFollowUpFn } from '../../lib/db.js';

export default function FollowUpModal() {
  const { modal, closeModal, user, panLead, refreshDB, showToast } = useApp();
  const isOpen = modal === 'follow-up';
  const [days, setDays] = useState('');

  useEffect(() => { if (isOpen) setDays(''); }, [isOpen]);

  const presets = [1, 3, 7, 14, 30];

  const submit = () => {
    const d = parseInt(days);
    if (!d || d < 1) { showToast('Enter valid number of days', 'err'); return; }
    setFollowUpFn(panLead, d, user);
    closeModal();
    refreshDB();
    showToast('Follow-up reminder set for ' + d + ' day' + (d === 1 ? '' : 's'), 'ok');
  };

  const dueDate = days && parseInt(days) > 0
    ? new Date(Date.now() + parseInt(days) * 86400000).toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long' })
    : null;

  return (
    <div className={`mov${isOpen ? ' on' : ''}`} onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
      <div className="modal">
        <div className="m-hd">
          <div className="m-ttl">Take Time — Set Follow-up</div>
          <button className="m-x" onClick={closeModal}><Mi>close</Mi></button>
        </div>
        <div className="m-body">
          <div className="m-hint"><Mi>alarm</Mi>You'll get a notification when the time is up.</div>
          <div className="fl" style={{ marginTop: '14px' }}>
            <label>Remind me after (days)</label>
            <input className="finp" type="number" min="1" max="365" placeholder="e.g. 7" value={days} onChange={e => setDays(e.target.value)} autoFocus />
            {dueDate && <div className="fi-hint">Reminder on {dueDate}</div>}
          </div>
          <div className="fu-presets">
            {presets.map(p => (
              <button key={p} className={`fu-chip${days == p ? ' active' : ''}`} onClick={() => setDays(String(p))}>
                {p}d
              </button>
            ))}
          </div>
        </div>
        <div className="m-ft">
          <button className="btn btn-g" onClick={closeModal}>Cancel</button>
          <button className="btn btn-warn" disabled={!days || parseInt(days) < 1} onClick={submit}>
            <Mi>alarm</Mi>Set Reminder
          </button>
        </div>
      </div>
    </div>
  );
}
