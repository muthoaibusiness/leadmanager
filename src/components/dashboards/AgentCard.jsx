import { useEffect, useState } from 'react';
import Mi from '../Mi.jsx';
import Avatar from '../Avatar.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { getLeads, getTarget, achievement, agentLeadStats } from '../../lib/db.js';
import { rlabel, progColor, startOfMonth } from '../../lib/helpers.js';
import { useOpenUserLeads } from '../UserRow.jsx';

export default function AgentCard({ agent }) {
  const { user, openModal, setTgtUser, setEditUser } = useApp();
  // Customers / Calls / Converted used to be an Array.reduce over this agent's
  // whole book. `calls` is a SUM, which PostgREST cannot do here, so it comes
  // from the agent_lead_stats function (migration 0011). Without that migration
  // `stats` stays null and the numbers fall back to the in-memory book, exactly
  // as before — see the note above dashboardRollup in db.js.
  const [stats, setStats] = useState(null);
  useEffect(() => {
    let alive = true;
    agentLeadStats(user, [agent.id], { monthStart: startOfMonth() })
      .then(rows => { if (alive && rows && rows.length) setStats(rows[0]); });
    return () => { alive = false; };
  }, [user, agent.id]);

  const leads = stats ? null : getLeads(agent);
  const tgt = getTarget(agent.id);
  const isIA = agent.role === 'INITIAL_AGENT';
  const ach = stats ? (isIA ? stats.meetingsSet : stats.visitsDone) : achievement(agent.id, agent.role);
  const tar = tgt ? tgt.value : 0;
  const pct = tar > 0 ? Math.min(100, Math.round(ach / tar * 100)) : 0;
  const col = progColor(pct);
  const kn = isIA ? 'Meetings Set' : 'Site Visits Done';
  const calls = stats ? stats.calls : leads.reduce((s, l) => s + (l.callCount || 0), 0);
  const leadCount = stats ? stats.leads : leads.length;
  const converted = stats
    ? stats.converted
    : leads.filter(l => l.status === 'SITE_VISIT_DONE' || l.status === 'DEAL_CLOSED_WON').length;
  const projLabel = agent.projects === 'ALL'
    ? 'All projects'
    : (Array.isArray(agent.projects) && agent.projects.length
      ? `${agent.projects.length} project${agent.projects.length > 1 ? 's' : ''}`
      : 'No projects');
  const projNone = projLabel === 'No projects';

  const editAgent = () => { setEditUser(agent); openModal('edit-agent'); };

  // Shared with the roster rows so the card and the row open the same thing:
  // an app-wide agent drill-down, which LeadsView turns into a server-side
  // `assigned_to = <them>` and pages 15 at a time.
  const openLeads = useOpenUserLeads();
  const viewAgentLeads = () => openLeads(agent.id);

  const openTgt = () => {
    setTgtUser(agent.id);
    openModal('target');
  };

  return (
    <div className="agc">
      <div className="agc-hd">
        <Avatar name={agent.name} avatar={agent.avatar} className="agc-av" />
        <div>
          <button className="agc-n ui-link" onClick={viewAgentLeads} title={`Open ${agent.name}'s customers`}>{agent.name}</button>
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
        <div className="agc-s"><div className="agc-sv">{leadCount}</div><div className="agc-sl">Customers</div></div>
        <div className="agc-s"><div className="agc-sv">{calls}</div><div className="agc-sl">Calls</div></div>
        <div className="agc-s"><div className="agc-sv">{converted}</div><div className="agc-sl">Converted</div></div>
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
