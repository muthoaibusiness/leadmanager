import { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { getDB, userNameById, fetchUserActivity } from '../../lib/db.js';
import AgentCard from '../dashboards/AgentCard.jsx';
import ActivityTimeline from '../ActivityTimeline.jsx';
import UserRow from '../UserRow.jsx';
import Mi from '../Mi.jsx';
import { fmtAgo } from '../../lib/helpers.js';
import { ROLES } from '../../lib/constants.js';
import useLeadBook from '../../hooks/useLeadBook.js';
import { LoadingBlock } from '../Spinner.jsx';

export default function TeamView() {
  // The agent cards still reduce over the book (until migration 0011 gives them
  // agent_lead_stats). The activity feed below no longer does — it fetches one
  // person's rows on demand, so useActWindow is gone from this view.
  useLeadBook();
  const { user, dbVersion, setPanLead } = useApp();
  const db = getDB();
  const agents = db.users.filter(u => (u.role === ROLES.IA || u.role === ROLES.MA) && u.teamId === user.teamId);
  const iAgents = agents.filter(u => u.role === ROLES.IA);
  const mAgents = agents.filter(u => u.role === ROLES.MA);
  // Executives are created here too, so they have to be visible here — otherwise a Team
  // Lead adds one and it vanishes. They get a plain row rather than an AgentCard: that
  // card is all targets, calls and conversions, none of which apply to an Executive.
  const execs = db.users.filter(u => u.role === ROLES.EXEC && u.teamId === user.teamId);

  // ── Team Activity: one agent at a time ──────────────────────────────────
  //
  // This used to flatten the whole team's activity window and slice 30 rows off
  // the front — every teammate's history downloaded to render one column. Now
  // the Team Lead picks a person and only that person's rows are fetched, which
  // is both the question they were actually asking and a fraction of the data.
  //
  // The Team Lead is first in the list and the default: their own hand-offs are
  // the feed they land on, and it keeps the view useful for a team of one.
  const feedPeople = [user, ...agents, ...execs].filter(Boolean);
  const [feedUser, setFeedUser] = useState(user.id);
  // A roster change (someone added or removed) can retire the selection.
  const activeFeedUser = feedPeople.some(p => p.id === feedUser) ? feedUser : user.id;

  // The result carries the id it belongs to, so "still loading" is simply
  // "what I hold is not for the person selected". Clearing it synchronously in
  // the effect instead would set state during the effect and cascade a render.
  const [feed, setFeed] = useState(null);
  useEffect(() => {
    let alive = true;
    fetchUserActivity(activeFeedUser, { limit: 40 }).then(rows => {
      // Resolving is the signal, not finding rows — an agent with no activity
      // must land on the empty state rather than a spinner that never clears.
      if (alive) setFeed({ userId: activeFeedUser, rows });
    });
    return () => { alive = false; };
  }, [activeFeedUser, dbVersion]);
  const feedRows = feed && feed.userId === activeFeedUser ? feed.rows : null;

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
      <div className="sec-hd">
        <div className="sec-t"><Mi>history</Mi>Team Activity</div>
        <select
          className="fsel"
          value={activeFeedUser}
          onChange={e => setFeedUser(e.target.value)}
          title="Whose activity to show"
        >
          {feedPeople.map(p => (
            <option key={p.id} value={p.id}>
              {p.id === user.id ? `${p.name} (me)` : p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="tl">
        <div className="tl-ttl">Recent Actions</div>
        {feedRows === null
          ? <LoadingBlock label="Loading activity…" pad={18} />
          : (
            <ActivityTimeline
              empty="No activity yet for this agent"
              items={feedRows.map(a => ({
                id: a.id,
                type: a.type,
                actor: userNameById(a.userId, a.userName),
                description: a.description,
                sub: `${a.leadName} · ${fmtAgo(a.timestamp)}`,
                onClick: a.leadId ? () => setPanLead(a.leadId) : undefined,
              }))}
            />
          )}
      </div>
    </div>
  );
}
