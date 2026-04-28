import { useRef, useEffect } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { getDB, getTarget, setTargetFn } from '../../lib/db.js';
import { ROLES } from '../../lib/constants.js';

export default function TargetModal() {
  const { modal, closeModal, tgtUser, refreshDB, showToast } = useApp();
  const isOpen = modal === 'target';
  const valRef = useRef();

  const db = getDB();
  const u = tgtUser ? db.users.find(x => x.id === tgtUser) : null;
  const tgt = tgtUser ? getTarget(tgtUser) : null;
  const kn = u?.role === ROLES.IA ? 'Meetings Set' : 'Site Visits Done';

  useEffect(() => {
    if (isOpen && valRef.current) {
      valRef.current.value = tgt ? tgt.value : '';
    }
  }, [isOpen, tgtUser]);

  const submit = () => {
    const v = valRef.current.value;
    if (!v || parseInt(v) < 1) { showToast('Enter a valid target', 'err'); return; }
    setTargetFn(tgtUser, v);
    closeModal();
    refreshDB();
    showToast('Target updated', 'ok');
  };

  return (
    <div className={`mov${isOpen ? ' on' : ''}`} onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
      <div className="modal">
        <div className="m-hd">
          <div className="m-ttl">Set Target — {u?.name}</div>
          <button className="m-x" onClick={closeModal}><Mi>close</Mi></button>
        </div>
        <div className="m-body">
          <div className="m-hint"><Mi>info</Mi>{kn} target for {new Date().toLocaleString('default', { month: 'long' })}</div>
          <div className="fg"><label>Target ({kn.toLowerCase()})</label><input className="fi" ref={valRef} type="number" min="1" max="200" placeholder="e.g. 15" /></div>
        </div>
        <div className="m-ft">
          <button className="btn btn-g" onClick={closeModal}>Cancel</button>
          <button className="btn btn-purple" onClick={submit}><Mi>target</Mi>Set Target</button>
        </div>
      </div>
    </div>
  );
}
