import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';

export default function CredsModal() {
  const { modal, closeModal, credInfo, showToast } = useApp();
  const isOpen = modal === 'creds';

  const copyCreds = () => {
    if (!credInfo) return;
    navigator.clipboard?.writeText('Email: ' + credInfo.email + '\nPassword: ' + credInfo.pass)
      .then(() => showToast('Copied to clipboard', 'ok'))
      .catch(() => showToast('Copy manually', 'warn'));
  };

  return (
    <div className={`mov${isOpen ? ' on' : ''}`} onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
      <div className="modal">
        <div className="m-hd">
          <div className="m-ttl">Account Created</div>
          <button className="m-x" onClick={closeModal}><Mi>close</Mi></button>
        </div>
        <div className="m-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
            <span className="mi" style={{ fontSize: '28px', color: 'var(--green)' }}>check_circle</span>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 700 }}>{credInfo?.name}</div>
              <div style={{ fontSize: '12px', color: 'var(--t2)' }}>{credInfo?.roleLabel}</div>
            </div>
          </div>
          <p style={{ fontSize: '13px', color: 'var(--t2)', marginTop: '6px' }}>Share these login credentials with the new team member.</p>
          <div className="cred-box">
            <div className="cred-row"><span className="cred-lbl">Email</span><span className="cred-val">{credInfo?.email}</span></div>
            <div style={{ height: '1px', background: 'var(--bd)' }} />
            <div className="cred-row"><span className="cred-lbl">Password</span><span className="cred-val">{credInfo?.pass}</span></div>
          </div>
        </div>
        <div className="m-ft">
          <button className="btn btn-g" onClick={copyCreds}><Mi>content_copy</Mi>Copy Credentials</button>
          <button className="btn btn-p" onClick={closeModal}>Done</button>
        </div>
      </div>
    </div>
  );
}
