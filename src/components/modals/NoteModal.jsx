import { useRef } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { addNote } from '../../lib/db.js';

export default function NoteModal() {
  const { modal, closeModal, user, panLead, refreshDB, showToast } = useApp();
  const isOpen = modal === 'note';
  const txtRef = useRef();

  const submit = () => {
    const t = txtRef.current.value.trim();
    if (!t) { showToast('Please write a note', 'err'); return; }
    addNote(panLead, t, user);
    txtRef.current.value = '';
    closeModal();
    refreshDB();
    showToast('Note saved', 'ok');
  };

  return (
    <div className={`mov${isOpen ? ' on' : ''}`} onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
      <div className="modal">
        <div className="m-hd">
          <div className="m-ttl">Add Note</div>
          <button className="m-x" onClick={closeModal}><Mi>close</Mi></button>
        </div>
        <div className="m-body">
          <div className="fg"><label>Note</label><textarea className="fi" ref={txtRef} placeholder="Write your note..." /></div>
        </div>
        <div className="m-ft">
          <button className="btn btn-g" onClick={closeModal}>Cancel</button>
          <button className="btn btn-p" onClick={submit}>Save Note</button>
        </div>
      </div>
    </div>
  );
}
