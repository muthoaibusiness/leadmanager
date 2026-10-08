import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { quotaLockedUntil, LEAD_LIMIT } from '../../lib/leadQuota.js';
import useNow from '../../hooks/useNow.js';

function remaining(ms) {
  const m = Math.max(0, Math.ceil(ms / 60000));
  return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
}

export default function UpgradePlanModal() {
  const { modal, closeModal, user } = useApp();
  const isOpen = modal === 'upgrade-plan';
  const now = useNow(30000, isOpen);
  const left = isOpen ? quotaLockedUntil(user) - now : 0;

  return (
    <div className={`mov${isOpen ? ' on' : ''}`} onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
      <div className="modal">
        <div className="m-hd">
          <div className="m-ttl">Daily limit reached</div>
          <button className="m-x" onClick={closeModal}><Mi>close</Mi></button>
        </div>
        <div className="m-body" style={{ textAlign: 'center' }}>
          <p>Your plan allows working on {LEAD_LIMIT} leads per day. Upgrade your plan to work on more leads right now.</p>
          {left > 0 && <p style={{ opacity: .7 }}>Or wait {remaining(left)} for the lock to open.</p>}
          <button className="btn btn-p" onClick={closeModal}><Mi>workspace_premium</Mi>Upgrade Plan</button>
        </div>
      </div>
    </div>
  );
}
