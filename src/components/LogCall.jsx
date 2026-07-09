import { useState } from 'react';
import Mi from './Mi.jsx';
import { useApp } from '../context/AppContext.jsx';
import { updLead, addAct, getLead } from '../lib/db.js';

// Shared call-duration tracker — single source of truth used by Leads (LeadPanel)
// and Contacts (ClientsView) so the UX stays identical everywhere.
const PRESETS = [1, 3, 5, 10, 15, 30];

export default function LogCall({ leadId, triggerClassName = 'btn btn-full', triggerStyle, triggerLabel = 'Log Call' }) {
  const { user, refreshDB, showToast } = useApp();
  const [open, setOpen] = useState(false);

  const log = (mins) => {
    const secs = Math.round(mins * 60);
    const lead = getLead(leadId);
    const total = (lead?.callCount || 0) + 1;
    updLead(leadId, { callCount: total });
    addAct(leadId, {
      type: 'CALL',
      description: 'Call logged · ' + mins + ' min (total: ' + total + ')',
      userId: user.id, userName: user.name, durationSeconds: secs,
    });
    refreshDB();
    showToast('Call logged · ' + mins + ' min', 'ok');
    setOpen(false);
  };

  return (
    <div className="logcall">
      <button className={triggerClassName} style={triggerStyle} onClick={() => setOpen(v => !v)}>
        <Mi>call</Mi>{triggerLabel}
      </button>
      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div className="modal" style={{ maxWidth: '400px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-hd">
              <span className="modal-ttl"><Mi>call</Mi> Call duration</span>
              <button className="icon-btn" onClick={() => setOpen(false)}><Mi>close</Mi></button>
            </div>
            <div className="modal-bd">
              <div className="logcall-chips" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                {PRESETS.map(m => (
                  <button key={m} className="btn" onClick={() => log(m)}>{m} min</button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
