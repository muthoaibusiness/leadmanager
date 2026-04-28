import { useApp } from '../../context/AppContext.jsx';
import { getLeads, getDB } from '../../lib/db.js';
import AgentCard from '../dashboards/AgentCard.jsx';
import Mi from '../Mi.jsx';
import { actIcon, actClr, fmtAgo } from '../../lib/helpers.js';
import { ROLES } from '../../lib/constants.js';

export default function TeamView() {
  const { user, dbVersion } = useApp();
  const db = getDB();
  const leads = getLeads(user);
  const agents = db.users.filter(u => (u.role === ROLES.IA || u.role === ROLES.MA) && u.teamId === user.teamId);
  const iAgents = agents.filter(u => u.role === ROLES.IA);
  const mAgents = agents.filter(u => u.role === ROLES.MA);

  const actFeed = leads
    .flatMap(l => (db.activities[l.id] || []).map(a => ({ ...a, leadName: l.name, leadId: l.id })))
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 30);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '20px' }}>
      <div>
        <div className="sec-hd"><div className="sec-t"><Mi>record_voice_over</Mi>Initial Agents</div></div>
        <div className="grid-2" style={{ marginBottom: '20px' }}>
          {iAgents.map(a => <AgentCard key={a.id} agent={a} />)}
        </div>
        <div className="sec-hd"><div className="sec-t"><Mi>handshake</Mi>Meeting Agents</div></div>
        <div className="grid-2">
          {mAgents.map(a => <AgentCard key={a.id} agent={a} />)}
        </div>
      </div>
      <div>
        <div className="sec-hd"><div className="sec-t"><Mi>history</Mi>Team Activity</div></div>
        <div className="tl">
          <div className="tl-ttl">Recent Actions</div>
          {actFeed.map(a => (
            <div key={a.id} className="tl-item">
              <div className="tl-dot" style={{ background: actClr(a.type) }}><Mi>{actIcon(a.type)}</Mi></div>
              <div className="tl-bd">
                {a.userName && <div className="tl-actor" style={{ color: actClr(a.type) }}>{a.userName}</div>}
                <div className="tl-desc">{a.description}</div>
                <div className="tl-time">{a.leadName} · {fmtAgo(a.timestamp)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
