import { useApp } from '../../context/AppContext.jsx';
import { getLeads, getDB } from '../../lib/db.js';
import AgentCard from '../dashboards/AgentCard.jsx';
import ActivityTimeline from '../ActivityTimeline.jsx';
import UserRow from '../UserRow.jsx';
import Mi from '../Mi.jsx';
import { fmtAgo } from '../../lib/helpers.js';
import { ROLES } from '../../lib/constants.js';

export default function TeamView() {
  const { user, dbVersion } = useApp();
  const db = getDB();
  const leads = getLeads(user);
  const agents = db.users.filter(u => (u.role === ROLES.IA || u.role === ROLES.MA) && u.teamId === user.teamId);
  const iAgents = agents.filter(u => u.role === ROLES.IA);
  const mAgents = agents.filter(u => u.role === ROLES.MA);
  // Executives are created here too, so they have to be visible here — otherwise a Team
  // Lead adds one and it vanishes. They get a plain row rather than an AgentCard: that
  // card is all targets, calls and conversions, none of which apply to an Executive.
  const execs = db.users.filter(u => u.role === ROLES.EXEC && u.teamId === user.teamId);

  const actFeed = leads
    .flatMap(l => (db.activities[l.id] || []).map(a => ({ ...a, leadName: l.name, leadId: l.id })))
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 30);

  return (
    <div>
      <div className="sec-hd"><div className="sec-t"><Mi>record_voice_over</Mi>Initial Agents</div></div>
      <div className="grid-2" style={{ marginBottom: '20px' }}>
        {iAgents.map(a => <AgentCard key={a.id} agent={a} />)}
      </div>
      <div className="sec-hd"><div className="sec-t"><Mi>handshake</Mi>Meeting Agents</div></div>
      <div className="grid-2" style={{ marginBottom: '20px' }}>
        {mAgents.map(a => <AgentCard key={a.id} agent={a} />)}
      </div>
      {execs.length > 0 && (
        <>
          <div className="sec-hd"><div className="sec-t"><Mi>badge</Mi>Executives</div></div>
          <div className="tg" style={{ marginBottom: '20px' }}>
            <div className="tg-agents">
              {execs.map(u => <UserRow key={u.id} u={u} />)}
            </div>
          </div>
        </>
      )}
      <div className="sec-hd"><div className="sec-t"><Mi>history</Mi>Team Activity</div></div>
      <div className="tl">
        <div className="tl-ttl">Recent Actions</div>
        <ActivityTimeline items={actFeed.map(a => ({ id: a.id, type: a.type, actor: a.userName, description: a.description, sub: `${a.leadName} · ${fmtAgo(a.timestamp)}` }))} />
      </div>
    </div>
  );
}
