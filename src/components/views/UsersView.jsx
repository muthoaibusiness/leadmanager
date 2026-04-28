import { useApp } from '../../context/AppContext.jsx';
import { getDB } from '../../lib/db.js';
import Mi from '../Mi.jsx';
import { avc, ini, rlabel } from '../../lib/helpers.js';
import { ROLES } from '../../lib/constants.js';

function UserRow({ u, showDelete }) {
  const { setDeleteUserId, openModal } = useApp();
  const c = avc(u.name);
  const roleTag = u.role === ROLES.IA
    ? <span className="bdg s-new">Initial Agent</span>
    : u.role === ROLES.MA
    ? <span className="bdg s-site_visit_done">Meeting Agent</span>
    : null;

  return (
    <div className="ui-row">
      <div className="ui-av ui-sm" style={{ background: c }}>{ini(u.name)}</div>
      <div className="ui-info">
        <div className="ui-n">{u.name}</div>
        <div className="ui-e">{u.email}</div>
      </div>
      {roleTag}
      <span className="ui-ph">{u.phone || '—'}</span>
      {showDelete && (
        <button className="btn btn-g btn-sm ui-del" onClick={() => { setDeleteUserId(u.id); openModal('del-user'); }}>
          <Mi>delete</Mi>
        </button>
      )}
    </div>
  );
}

export default function UsersView() {
  const { user, dbVersion } = useApp();
  const db = getDB();

  if (user.role !== ROLES.MGMT) return null;

  const teams = db.teams || [];
  if (!teams.length) {
    return <div className="empty"><Mi>manage_accounts</Mi><p>No teams yet. Add a Team Lead to start.</p></div>;
  }

  return (
    <div className="tg-list">
      {teams.map(team => {
        const tl = db.users.find(u => u.id === team.leadId);
        if (!tl) return null;
        const c = avc(tl.name);
        const agents = db.users.filter(u => (u.role === ROLES.IA || u.role === ROLES.MA) && u.teamId === team.id);
        const ia = agents.filter(u => u.role === ROLES.IA);
        const ma = agents.filter(u => u.role === ROLES.MA);
        const won = db.leads.filter(l => l.teamId === team.id && l.status === 'DEAL_CLOSED_WON').length;
        const active = db.leads.filter(l => l.teamId === team.id && !['DEAL_CLOSED_WON', 'DEAL_CLOSED_LOST', 'NOT_INTERESTED'].includes(l.status)).length;

        return (
          <div key={team.id} className="tg">
            <div className="tg-hd">
              <div className="ui-av" style={{ background: c }}>{ini(tl.name)}</div>
              <div className="ui-info">
                <div className="ui-n" style={{ fontSize: '15px' }}>
                  {tl.name}
                  <span className="bdg s-negotiating" style={{ marginLeft: '8px', fontSize: '10px' }}>Team Lead</span>
                </div>
                <div className="ui-e">{tl.email}{tl.phone ? ' · ' + tl.phone : ''}</div>
              </div>
              <div className="tg-stats">
                <div className="tg-stat"><div className="tg-sv">{ia.length}</div><div className="tg-sl">Initial</div></div>
                <div className="tg-stat"><div className="tg-sv">{ma.length}</div><div className="tg-sl">Meeting</div></div>
                <div className="tg-stat"><div className="tg-sv">{active}</div><div className="tg-sl">Active Leads</div></div>
                <div className="tg-stat"><div className="tg-sv" style={{ color: 'var(--green)' }}>{won}</div><div className="tg-sl">Won</div></div>
              </div>
              <DeleteTLBtn tl={tl} />
            </div>
            <div className="tg-agents">
              {agents.length
                ? agents.map(u => <UserRow key={u.id} u={u} showDelete={true} />)
                : <div className="ui-empty">No agents yet</div>
              }
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DeleteTLBtn({ tl }) {
  const { setDeleteUserId, openModal } = useApp();
  return (
    <button className="btn btn-g btn-sm" onClick={() => { setDeleteUserId(tl.id); openModal('del-user'); }}>
      <Mi>delete</Mi>
    </button>
  );
}
