import { useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { getDB, getDeletionLog, calcPipelineValue } from '../../lib/db.js';
import StatCard from '../StatCard.jsx';
import Mi from '../Mi.jsx';
import { fmtBDT, avc, ini, fmtAgo, fmtDT, startOfMonth, rlabel } from '../../lib/helpers.js';
import { ROLES, STATUS_LABELS, SRC_LABELS } from '../../lib/constants.js';

function sclass(s) { return 's-' + (s || '').toLowerCase(); }

function AgentActivityRow({ agent, leads, acts }) {
  const myLeads = leads.filter(l => l.assignedTo === agent.id || l.previousAssignees.includes(agent.id));
  const myActs = acts.filter(a => a.userId === agent.id);
  const recentAct = [...myActs].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
  const won = myLeads.filter(l => l.status === 'DEAL_CLOSED_WON').length;
  const active = myLeads.filter(l => !['DEAL_CLOSED_WON', 'DEAL_CLOSED_LOST', 'NOT_INTERESTED'].includes(l.status)).length;
  const calls = myLeads.reduce((s, l) => s + (l.callCount || 0), 0);
  return (
    <div className="aa-row">
      <div className="aa-av" style={{ background: avc(agent.name) }}>{ini(agent.name)}</div>
      <div className="aa-info">
        <div className="aa-name">{agent.name}</div>
        <div className="aa-role">{rlabel(agent.role)}</div>
      </div>
      <div className="aa-stats">
        <div className="aa-stat"><div className="aa-sv">{myLeads.length}</div><div className="aa-sl">Leads</div></div>
        <div className="aa-stat"><div className="aa-sv">{active}</div><div className="aa-sl">Active</div></div>
        <div className="aa-stat"><div className="aa-sv">{calls}</div><div className="aa-sl">Calls</div></div>
        <div className="aa-stat"><div className="aa-sv" style={{ color: 'var(--green)' }}>{won}</div><div className="aa-sl">Won</div></div>
      </div>
      <div className="aa-last">
        {recentAct
          ? <><div className="aa-act">{recentAct.description}</div><div className="aa-time">{fmtAgo(recentAct.timestamp)}</div></>
          : <div className="aa-time">No activity</div>}
      </div>
    </div>
  );
}

function SourceBar({ label, count, total, color }) {
  const pct = total ? Math.round(count / total * 100) : 0;
  return (
    <div className="src-bar-row">
      <div className="src-bar-lbl">{label}</div>
      <div className="src-bar-track"><div className="src-bar-fill" style={{ width: pct + '%', background: color }} /></div>
      <div className="src-bar-ct">{count} <span className="src-bar-pct">({pct}%)</span></div>
    </div>
  );
}

export default function ManagementDash() {
  const { setView, setTeamFilter, setAgentFilter, setTab, setSearch, dateRange } = useApp();
  const [activeTab, setActiveTab] = useState(0);
  const db = getDB();
  const sm = startOfMonth();

  const filterByDate = (arr) => {
    if (!dateRange?.range) return arr;
    const { start, end } = dateRange.range;
    return arr.filter(l => { const d = new Date(l.createdAt); return d >= start && d <= end; });
  };

  const allLeads = filterByDate(db.leads);
  const allAgents = db.users.filter(u => u.role === ROLES.IA || u.role === ROLES.MA || u.role === ROLES.TL);
  const allActs = Object.values(db.activities || {}).flat();

  const won = allLeads.filter(l => l.status === 'DEAL_CLOSED_WON');
  const lost = allLeads.filter(l => l.status === 'DEAL_CLOSED_LOST');
  const active = allLeads.filter(l => !['DEAL_CLOSED_WON', 'DEAL_CLOSED_LOST', 'NOT_INTERESTED'].includes(l.status));
  const rev = won.reduce((s, l) => s + (l.dealValue || 0), 0);
  const pipe = allLeads.filter(l => ['NEGOTIATING', 'SITE_VISIT_DONE'].includes(l.status)).reduce((s, l) => s + calcPipelineValue(l.id, db), 0);
  const wr = won.length + lost.length > 0 ? Math.round(won.length / (won.length + lost.length) * 100) : 0;
  const newThisMonth = allLeads.filter(l => new Date(l.createdAt) >= sm).length;

  const srcCounts = {};
  allLeads.forEach(l => { srcCounts[l.source] = (srcCounts[l.source] || 0) + 1; });
  const srcColors = { META_ADS: '#2563EB', WHATSAPP_ADS: '#16A34A', LINKEDIN: '#7C3AED', HOTLINE: '#D97706', PERSONAL: '#0891B2', WEBSITE: '#DC2626' };

  const statusCounts = {};
  allLeads.forEach(l => { statusCounts[l.status] = (statusCounts[l.status] || 0) + 1; });

  const deletionLog = getDeletionLog();

  const viewTeamLeads = (teamId) => { setView('leads'); setTab(0); setSearch(''); setAgentFilter(null); setTeamFilter(teamId); };

  const tabs = ['Overview', 'Agent Activity', 'Deletion Log'];

  return (
    <>
      <div className="grid-4" style={{ marginBottom: '16px' }}>
        <StatCard val={fmtBDT(rev)} label="Total Revenue" ico="payments" bg="#16A34A" />
        <StatCard val={fmtBDT(pipe)} label="Pipeline Value" ico="trending_up" bg="#2563EB" />
        <StatCard val={won.length + '/' + (won.length + lost.length)} label="Deals (Won/Closed)" ico="emoji_events" bg="#D97706" />
        <StatCard val={wr + '%'} label="Win Rate" ico="percent" bg="#7C3AED" />
      </div>

      <div className="grid-4" style={{ marginBottom: '20px' }}>
        <StatCard val={allLeads.length} label="Total Leads" ico="group" bg="#0891B2" />
        <StatCard val={active.length} label="Active Leads" ico="person" bg="#2563EB" />
        <StatCard val={newThisMonth} label="New This Month" ico="fiber_new" bg="#7C3AED" />
        <StatCard val={allLeads.filter(l => l.status === 'NOT_INTERESTED').length} label="Not Interested" ico="thumb_down" bg="#DC2626" />
      </div>

      <div className="fbar" style={{ marginBottom: '16px' }}>
        <div className="ftabs">
          {tabs.map((t, i) => <div key={i} className={`ftab${activeTab === i ? ' on' : ''}`} onClick={() => setActiveTab(i)}>{t}</div>)}
        </div>
      </div>

      {activeTab === 0 && (
        <>
          <div className="sec-hd"><div className="sec-t"><Mi>groups</Mi>Team Performance</div></div>
          <div className="grid-2" style={{ marginBottom: '24px' }}>
            {db.users.filter(u => u.role === ROLES.TL).map(tl => {
              const tLeads = filterByDate(db.leads.filter(l => l.teamId === tl.teamId));
              const tWon = tLeads.filter(l => l.status === 'DEAL_CLOSED_WON');
              const tRev = tWon.reduce((s, l) => s + (l.dealValue || 0), 0);
              const tAgents = db.users.filter(u => (u.role === ROLES.IA || u.role === ROLES.MA) && u.teamId === tl.teamId);
              const tActive = tLeads.filter(l => !['DEAL_CLOSED_WON', 'DEAL_CLOSED_LOST', 'NOT_INTERESTED'].includes(l.status));
              const c = avc(tl.name);
              return (
                <div key={tl.id} className="tmcard" onClick={() => viewTeamLeads(tl.teamId)}>
                  <div className="tmc-hd">
                    <div className="tmc-ico" style={{ background: c, color: '#fff' }}>{ini(tl.name)}</div>
                    <div><div className="tmc-n">{tl.name}'s Team</div><div className="tmc-s">{tAgents.length} agents · {tLeads.length} leads</div></div>
                  </div>
                  <div className="tmc-grid">
                    <div className="tmc-stat"><div className="tmc-sv">{fmtBDT(tRev)}</div><div className="tmc-sl">Revenue</div></div>
                    <div className="tmc-stat"><div className="tmc-sv">{tWon.length} won</div><div className="tmc-sl">Closed deals</div></div>
                    <div className="tmc-stat"><div className="tmc-sv">{tActive.length}</div><div className="tmc-sl">Active leads</div></div>
                    <div className="tmc-stat"><div className="tmc-sv">{tLeads.filter(l => l.siteVisitDoneDate && new Date(l.siteVisitDoneDate) >= sm).length}</div><div className="tmc-sl">Visits this mo.</div></div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mgmt-charts">
            <div className="analytics-card">
              <div className="ac-hd"><Mi>pie_chart</Mi>Leads by Source</div>
              <div className="ac-body">
                {Object.entries(srcCounts).sort((a, b) => b[1] - a[1]).map(([src, cnt]) => (
                  <SourceBar key={src} label={SRC_LABELS[src] || src} count={cnt} total={allLeads.length} color={srcColors[src] || '#64748B'} />
                ))}
              </div>
            </div>
            <div className="analytics-card">
              <div className="ac-hd"><Mi>bar_chart</Mi>Leads by Status</div>
              <div className="ac-body">
                {Object.entries(statusCounts).sort((a, b) => b[1] - a[1]).map(([st, cnt]) => (
                  <SourceBar key={st} label={STATUS_LABELS[st] || st} count={cnt} total={allLeads.length} color="#2563EB" />
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {activeTab === 1 && (
        <>
          <div className="sec-hd"><div className="sec-t"><Mi>manage_accounts</Mi>Agent Activity</div></div>
          <div className="analytics-card" style={{ marginBottom: '16px', overflowX: 'auto' }}>
            {allAgents.length === 0 && <div className="empty"><Mi>person_off</Mi><p>No agents</p></div>}
            {allAgents.map(agent => (
              <AgentActivityRow key={agent.id} agent={agent} leads={db.leads} acts={allActs} />
            ))}
          </div>
        </>
      )}

      {activeTab === 2 && (
        <>
          <div className="sec-hd"><div className="sec-t"><Mi>history</Mi>Deletion Log</div></div>
          <div className="analytics-card" style={{ overflowX: 'auto' }}>
            {deletionLog.length === 0 && <div className="empty"><Mi>check_circle</Mi><p>No deletions recorded</p></div>}
            {deletionLog.length > 0 && (
              <div className="del-log">
                <div className="dl-hdr"><div>Lead</div><div>Status</div><div>Deleted By</div><div>When</div></div>
                {deletionLog.map((d, i) => (
                  <div key={i} className="dl-row">
                    <div><div className="dl-name">{d.name}</div><div className="dl-phone">{d.phone}</div></div>
                    <div><span className={`bdg ${sclass(d.status)}`}>{STATUS_LABELS[d.status] || d.status}</span></div>
                    <div className="dl-by">{d.deletedBy}</div>
                    <div className="dl-when">{fmtDT(d.deletedAt)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
