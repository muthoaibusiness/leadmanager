import { useApp } from '../context/AppContext.jsx';
import Mi from './Mi.jsx';
import Avatar from './Avatar.jsx';
import { ROLES } from '../lib/constants.js';

// One person as a compact row: avatar, name/email, role badge, phone, actions.
// Shared by UsersView (admin, company-wide) and TeamView (Team Lead, own team) so the
// two rosters cannot drift apart.

export function EditBtn({ u }) {
  const { setEditUser, openModal } = useApp();
  return (
    <button className="btn btn-g btn-sm" title="Edit access" onClick={() => { setEditUser(u); openModal('edit-agent'); }}>
      <Mi>tune</Mi>
    </button>
  );
}

export function DelBtn({ id }) {
  const { setDeleteUserId, openModal } = useApp();
  return (
    <button className="btn btn-g btn-sm ui-del" onClick={() => { setDeleteUserId(id); openModal('del-user'); }}>
      <Mi>delete</Mi>
    </button>
  );
}

// showDelete is opt-in: Management deletes accounts, a Team Lead does not.
export default function UserRow({ u, showDelete }) {
  const roleTag = u.role === ROLES.IA
    ? <span className="bdg s-new">Initial Agent</span>
    : u.role === ROLES.MA
    ? <span className="bdg s-site_visit_done">Meeting Agent</span>
    : u.role === ROLES.EXEC
    ? <span className="bdg s-negotiating">Executive</span>
    : null;

  return (
    <div className="ui-row">
      <Avatar name={u.name} avatar={u.avatar} className="ui-av ui-sm" />
      <div className="ui-info">
        <div className="ui-n">{u.name}</div>
        <div className="ui-e">{u.email}</div>
      </div>
      {roleTag}
      <span className="ui-ph">{u.phone || '—'}</span>
      <EditBtn u={u} />
      {showDelete && <DelBtn id={u.id} />}
    </div>
  );
}
