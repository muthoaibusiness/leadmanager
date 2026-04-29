import { useState, useEffect } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { getDB, fwdLead } from '../../lib/db.js';
import { avc, ini, rlabel } from '../../lib/helpers.js';
import { ROLES } from '../../lib/constants.js';

export default function ForwardModal() {
  const { modal, closeModal, user, panLead, refreshDB, showToast } = useApp();
  const isMA = modal === 'forward-ma';
  const isTL = modal === 'forward-tl';
  const isOpen = isMA || isTL;

  const [selected, setSelected] = useState(null);
  const targetRole = isMA ? ROLES.MA : ROLES.TL;

  useEffect(() => {
    if (isOpen) setSelected(null);
  }, [isOpen]);

  const db = getDB();
  const targets = db.users.filter(u => u.role === targetRole && u.teamId === user?.teamId);

  const submit = () => {
    if (!selected || !panLead) return;
    const toUser = db.users.find(u => u.id === selected);
    if (!toUser) return;
    fwdLead(panLead, toUser, user);
    closeModal();
    refreshDB();
    showToast('Lead forwarded to ' + toUser.name, 'ok');
  };

  return (
    <div className={`mov${isOpen ? ' on' : ''}`} onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
      <div className="modal">
        <div className="m-hd">
          <div className="m-ttl">Forward to {rlabel(targetRole)}</div>
          <button className="m-x" onClick={closeModal}><Mi>close</Mi></button>
        </div>
        <div className="m-body">
          <div className="m-hint"><Mi>info</Mi>Select a {rlabel(targetRole)} to assign this lead.</div>
          <div className="ap-list">
            {targets.map(u => (
              <div key={u.id} className={`ap-item${selected === u.id ? ' sel' : ''}`} onClick={() => setSelected(u.id)}>
                <div className="ap-av" style={{ background: avc(u.name) }}>{ini(u.name)}</div>
                <div><div className="ap-n">{u.name}</div><div className="ap-r">{u.email}</div></div>
              </div>
            ))}
          </div>
        </div>
        <div className="m-ft">
          <button className="btn btn-g" onClick={closeModal}>Cancel</button>
          <button className="btn btn-p" disabled={!selected} onClick={submit}>Forward</button>
        </div>
      </div>
    </div>
  );
}
