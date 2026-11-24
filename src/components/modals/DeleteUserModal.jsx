import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { getDB, unassignDeletedUser } from '../../lib/db.js';
import { deleteAccount } from '../../lib/accessAdmin.js';
import { useProjectToast } from '../project/projectToast.js';
import '../booking/ShopBooking.css';
import '../project/AddPropertyWizard.css';
import '../views/AccountsView.css';

export default function DeleteUserModal() {
  const { modal, closeModal, deleteUserId, setDeleteUserId, refreshDB, user, view } = useApp();
  const isOpen = modal === 'del-user';
  // Removing from Accounts → All accounts reports through goey-toast (top
  // centre), like Create all; from Users / Team the app's toast stays.
  const toast = useProjectToast({ always: view === 'accounts' });

  const db = getDB();
  const u = deleteUserId ? db.users.find(x => x.id === deleteUserId) : null;

  // The access-admin function removes the account and its sign-in; only then
  // are its cached leads unassigned and the tombstone written.
  const submit = async () => {
    if (!deleteUserId) return;
    const r = await deleteAccount(deleteUserId);
    if (!r.ok) { toast.error('Not removed', r.error); return; }
    unassignDeletedUser(deleteUserId, user);
    setDeleteUserId(null);
    closeModal();
    refreshDB();
    toast.success('User removed', u?.name ? `${u.name} can no longer sign in.` : undefined, 'User removed');
  };

  if (!isOpen) return null;
  return (
    <div className="pw-scrim" onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
      <div className="bk acx-modal acx-modal-sm" role="alertdialog" aria-modal="true" aria-labelledby="dum-t">
        <header className="pw-head">
          <div className="acx-mt"><span className="bk-eyebrow">Remove account</span><h3 id="dum-t">Remove {u?.name || 'this user'}?</h3></div>
          <button type="button" className="bk-close" aria-label="Close" onClick={closeModal}><Mi>close</Mi></button>
        </header>
        <div className="pw-body">
          <div className="pw-warn"><Mi>warning</Mi>This cannot be undone.</div>
          <p className="acx-p">Any leads they own become unassigned and stay in the company. If this is a Team Lead, their team is removed too. They can no longer sign in.</p>
        </div>
        <footer className="pw-foot">
          <span />
          <div className="pw-acts">
            <button type="button" className="bk-btn" onClick={closeModal}>Cancel</button>
            <button type="button" className="bk-btn acx-solid-bad" onClick={submit}><Mi>delete</Mi>Remove</button>
          </div>
        </footer>
      </div>
    </div>
  );
}
