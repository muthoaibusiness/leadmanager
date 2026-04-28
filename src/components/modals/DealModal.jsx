import { useRef } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { closeDealFn } from '../../lib/db.js';

export default function DealModal() {
  const { modal, closeModal, user, panLead, refreshDB, showToast } = useApp();
  const isOpen = modal === 'deal';
  const valRef = useRef();

  const submit = (won) => {
    const v = valRef.current.value;
    if (won && !v) { showToast('Enter deal value', 'err'); return; }
    closeDealFn(panLead, won, v, user);
    closeModal();
    refreshDB();
    showToast(won ? 'Deal closed — WON!' : 'Deal marked as lost', 'ok');
  };

  return (
    <div className={`mov${isOpen ? ' on' : ''}`} onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
      <div className="modal">
        <div className="m-hd">
          <div className="m-ttl">Close Deal</div>
          <button className="m-x" onClick={closeModal}><Mi>close</Mi></button>
        </div>
        <div className="m-body">
          <div className="fg"><label>Deal Value (BDT)</label><input className="fi" ref={valRef} type="number" min="0" placeholder="e.g. 4500000" /></div>
          <div className="do-btns">
            <button className="do-btn do-won" onClick={() => submit(true)}><Mi>emoji_events</Mi>Closed Won</button>
            <button className="do-btn do-lost" onClick={() => submit(false)}><Mi>thumb_down</Mi>Closed Lost</button>
          </div>
        </div>
      </div>
    </div>
  );
}
