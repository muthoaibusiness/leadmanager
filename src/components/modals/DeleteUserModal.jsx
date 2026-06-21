import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { getDB, deleteUserFn } from '../../lib/db.js';

export default function DeleteUserModal() {
  const { modal, closeModal, deleteUserId, setDeleteUserId, refreshDB, showToast, user } = useApp();
  const isOpen = modal === 'del-user';

  const db = getDB();
  const u = deleteUserId ? db.users.find(x => x.id === deleteUserId) : null;

  const submit = () => {
    if (!deleteUserId) return;
    const db2 = getDB();
    const hasLeads = db2.leads.some(l => l.assignedTo === deleteUserId);
    if (hasLeads) { closeModal(); showToast('Cannot delete — user has active leads assigned', 'err'); return; }
    deleteUserFn(deleteUserId, user); // tombstone + cloud delete so it stays gone after refresh
    setDeleteUserId(null);
    closeModal();
    refreshDB();
    showToast('User removed', 'ok');
  };

  return (
    <div className={`mov${isOpen ? ' on' : ''}`} onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
      <div className="modal">
        <div className="m-hd">
          <div className="m-ttl">Remove User</div>
          <button className="m-x" onClick={closeModal}><Mi>close</Mi></button>
        </div>
        <div className="m-body">
          <p style={{ fontSize: '14px', color: 'var(--t1)' }}>Remove <strong>{u?.name}</strong> from the system?</p>
          <p style={{ fontSize: '13px', color: 'var(--t2)', marginTop: '8px' }}>Users with active leads cannot be removed. This action cannot be undone.</p>
        </div>
        <div className="m-ft">
          <button className="btn btn-g" onClick={closeModal}>Cancel</button>
          <button className="btn btn-danger" onClick={submit}><Mi>delete</Mi>Remove</button>
        </div>
      </div>
    </div>
  );
}
