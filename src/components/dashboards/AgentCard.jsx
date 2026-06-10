import Mi from '../Mi.jsx';
import Avatar from '../Avatar.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { getLeads, getTarget, achievement } from '../../lib/db.js';
import { rlabel, progColor } from '../../lib/helpers.js';

export default function AgentCard({ agent }) {
  const { setView, setAgentFilter, setTab, setSearch, openModal, setTgtUser, setEditUser } = useApp();
  const leads = getLeads(agent);
  const tgt = getTarget(agent.id);
  const ach = achievement(agent.id, agent.role);
  const tar = tgt ? tgt.value : 0;
  const pct = tar > 0 ? Math.min(100, Math.round(ach / tar * 100)) : 0;
  const col = progColor(pct);
  const kn = agent.role === 'INITIAL_AGENT' ? 'Meetings Set' : 'Site Visits Done';
  const calls = leads.reduce((s, l) => s + (l.callCount || 0), 0);
  const projLabel = agent.projects === 'ALL'
    ? 'All projects'
    : (Array.isArray(agent.projects) && agent.projects.length
      ? `${agent.projects.length} project${agent.projects.length > 1 ? 's' : ''}`
      : 'No projects');
  const projNone = projLabel === 'No projects';

  const editAgent = () => { setEditUser(agent); openModal('edit-agent'); };

  const viewAgentLeads = () => {
    setView('leads');
    setTab(0);
    setSearch('');
    setAgentFilter(agent.id);
  };

  const openTgt = () => {
    setTgtUser(agent.id);
    openModal('target');
  };

  return (
    <div className="agc">
      <div className="agc-hd">
        <Avatar name={agent.name} avatar={agent.avatar} className="agc-av" />
        <div>
          <div className="agc-n">{agent.name}</div>
          <div className="agc-r">{rlabel(agent.role)}</div>
        </div>
      </div>
      <div className="agc-kl">{kn}</div>
      <div className="agc-kn">
        <div className="agc-kc" style={{ color: col }}>{ach}</div>
        <div className="agc-kt">/ {tar || '—'}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '5px' }}>
        <span style={{ fontSize: '11px', color: 'var(--t2)' }}>Progress</span>
        <span className="agc-pct" style={{ color: col }}>{pct}%</span>
      </div>
      <div className="prog-track">
        <div className="prog-fill" style={{ width: pct + '%', background: col }} />
      </div>
      <div className="agc-stats">
        <div className="agc-s"><div className="agc-sv">{leads.length}</div><div className="agc-sl">Customers</div></div>
        <div className="agc-s"><div className="agc-sv">{calls}</div><div className="agc-sl">Calls</div></div>
        <div className="agc-s"><div className="agc-sv">{leads.filter(l => l.status === 'SITE_VISIT_DONE' || l.status === 'DEAL_CLOSED_WON').length}</div><div className="agc-sl">Converted</div></div>
      </div>
      <div className={`agc-proj${projNone ? ' none' : ''}`}>
        <Mi>apartment</Mi>
        <span>{projLabel}</span>
      </div>
      <div className="agc-act">
        <button className="btn btn-g btn-sm" onClick={openTgt}><Mi>target</Mi>Target</button>
        <button className="btn btn-g btn-sm" onClick={editAgent}><Mi>edit</Mi>Edit</button>
        <button className="btn btn-p btn-sm" onClick={viewAgentLeads}><Mi>list</Mi>Customers</button>
      </div>
    </div>
  );
}
