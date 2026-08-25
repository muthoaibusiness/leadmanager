import { useApp } from '../../context/AppContext.jsx';
import { getDB } from '../../lib/db.js';
import Mi from '../Mi.jsx';
import Avatar from '../Avatar.jsx';
import { ROLES } from '../../lib/constants.js';
import UserRow, { EditBtn, DelBtn, useOpenUserLeads } from '../UserRow.jsx';
import useLeadCounts from '../../hooks/useLeadCounts.js';
import { eq } from '../../lib/leadQuery.js';
import { useMemo } from 'react';

export default function UsersView() {
  const { user, dbVersion } = useApp();
  void dbVersion;
  const db = getDB();
  const openLeads = useOpenUserLeads();

  const inCo = (x) => !user.companyId || !x.companyId || x.companyId === user.companyId;
  const teams = (db.teams || []).filter(inCo);
  const teamIds = new Set(teams.map(t => t.id));

  // Won / Active per team. These were two Array.filter passes over the whole
  // company's leads, which is why this page used to download them all; they are
  // two counts per team now, and the page holds no lead rows at all.
  const teamQ = useMemo(() => {
    const spec = {};
    teams.forEach(t => {
      spec['won:' + t.id] = { user, involved: true, extra: [eq('team_id', t.id), eq('status', 'DEAL_CLOSED_WON')] };
      spec['act:' + t.id] = { user, involved: true, extra: [eq('team_id', t.id), 'status.not.in.(DEAL_CLOSED_WON,DEAL_CLOSED_LOST,NOT_INTERESTED)'] };
    });
    return spec;
  }, [user, teams.map(t => t.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useLeadCounts(teamQ);
  const num = (k) => (counts[k] == null ? '—' : counts[k]);
  // Executives belong to a team now and render inside its card, next to the agents.
  // Only the ones with no team left over land here: accounts made back when Management
  // created them (and had no team to stamp), or whose team has since been deleted.
  const looseExecs = (db.users || []).filter(u => u.role === ROLES.EXEC && inCo(u) && !teamIds.has(u.teamId));

  // Declared after the hooks above — hooks must run in the same order on every
  // render, so no early return may sit above them.
  if (user.role !== ROLES.MGMT) return null;

  if (!teams.length && !looseExecs.length) {
    return <div className="empty"><Mi>manage_accounts</Mi><p>No teams yet. Add a Team Lead to start.</p></div>;
  }

  return (
    <div className="tg-list">
      {teams.map(team => {
        const tl = db.users.find(u => u.id === team.leadId);
        if (!tl) return null;
        const members = db.users.filter(u => [ROLES.IA, ROLES.MA, ROLES.EXEC].includes(u.role) && u.teamId === team.id);
        const ia = members.filter(u => u.role === ROLES.IA);
        const ma = members.filter(u => u.role === ROLES.MA);
        const ex = members.filter(u => u.role === ROLES.EXEC);

        return (
          <div key={team.id} className="tg">
            <div className="tg-hd">
              <Avatar name={tl.name} avatar={tl.avatar} className="ui-av" />
              <div className="ui-info">
                <div className="ui-n" style={{ fontSize: '15px' }}>
                  <button className="ui-link" onClick={() => openLeads(tl.id)} title={`Open ${tl.name}'s customers`}>{tl.name}</button>
                  <span className="bdg s-negotiating" style={{ marginLeft: '8px', fontSize: '10px' }}>Team Lead</span>
                </div>
                <div className="ui-e">{tl.email}{tl.phone ? ' · ' + tl.phone : ''}</div>
              </div>
              <div className="tg-stats">
                <div className="tg-stat"><div className="tg-sv">{ia.length}</div><div className="tg-sl">Initial</div></div>
                <div className="tg-stat"><div className="tg-sv">{ma.length}</div><div className="tg-sl">Meeting</div></div>
                {ex.length > 0 && <div className="tg-stat"><div className="tg-sv">{ex.length}</div><div className="tg-sl">Executive</div></div>}
                <div className="tg-stat"><div className="tg-sv">{num('act:' + team.id)}</div><div className="tg-sl">Active Customers</div></div>
                <div className="tg-stat"><div className="tg-sv" style={{ color: 'var(--green)' }}>{num('won:' + team.id)}</div><div className="tg-sl">Won</div></div>
              </div>
              <EditBtn u={tl} />
              <DelBtn id={tl.id} />
            </div>
            <div className="tg-agents">
              {members.length
                ? [...ia, ...ma, ...ex].map(u => <UserRow key={u.id} u={u} showDelete={true} />)
                : <div className="ui-empty">No agents yet</div>
              }
            </div>
          </div>
        );
      })}

      {looseExecs.length > 0 && (
        <div className="tg">
          <div className="tg-hd">
            <div className="ui-info">
              <div className="ui-n" style={{ fontSize: '15px' }}>
                Executives
                <span className="bdg s-negotiating" style={{ marginLeft: '8px', fontSize: '10px' }}>{looseExecs.length}</span>
              </div>
              <div className="ui-e">Custom-access accounts · not in a team</div>
            </div>
          </div>
          <div className="tg-agents">
            {looseExecs.map(u => <UserRow key={u.id} u={u} showDelete={true} />)}
          </div>
        </div>
      )}
    </div>
  );
}
