import { createPortal } from 'react-dom';
import { getDB } from '../lib/db.js';
import { ROLES, STATUS_FLOW, STATUS_LABELS, SRC_LABELS } from '../lib/constants.js';
import { fmtBDT, fmtD } from '../lib/helpers.js';

// Printable, letterhead-style version of the Reports dashboard. Rendered via a
// portal straight onto <body> (a sibling of #root, not inside it) so the print
// stylesheet can hide the whole app shell with one rule and show only this.
const ROLE_LABEL = { INITIAL_AGENT: 'Initial Agent', MEETING_AGENT: 'Meeting Agent', TEAM_LEAD: 'Team Lead', EXECUTIVE: 'Executive' };
const FUNNEL_ORDER = [...STATUS_FLOW, 'DEAL_CLOSED_LOST', 'NOT_INTERESTED'];
const CONNECTED_STATUSES = new Set(STATUS_FLOW.slice(1).concat(['DEAL_CLOSED_LOST'])); // everything past NEW

function pct(n, d) { return d ? Math.round((n / d) * 100) + '%' : '0%'; }

export default function ReportPrintDoc({ user, leads, onClose }) {
  const db = getDB();
  const company = (db.companies || []).find(c => c.id === user.companyId);
  const teams = db.teams || [];
  const usersById = Object.fromEntries((db.users || []).map(u => [u.id, u]));

  // KPIs
  const totalLeads = leads.length;
  const won = leads.filter(l => l.status === 'DEAL_CLOSED_WON');
  const revenue = won.reduce((s, l) => s + (l.dealValue || 0), 0);
  const connected = leads.filter(l => CONNECTED_STATUSES.has(l.status) || (l.callCount || 0) > 0).length;
  const calls = leads.reduce((s, l) => s + (l.callCount || 0), 0);
  const meetings = leads.filter(l => l.meetingSetBy).length;
  const visits = leads.filter(l => l.siteVisitDoneBy).length;

  // funnel
  const funnelCounts = {};
  leads.forEach(l => { funnelCounts[l.status] = (funnelCounts[l.status] || 0) + 1; });
  const funnel = FUNNEL_ORDER.filter(s => funnelCounts[s]).map(s => ({ key: s, label: STATUS_LABELS[s] || s, count: funnelCounts[s] }));
  const funnelMax = Math.max(...funnel.map(f => f.count), 1);

  // team standings (only meaningful with >1 team in scope, i.e. Management)
  const byTeam = {};
  leads.forEach(l => {
    const key = l.teamId || 'none';
    if (!byTeam[key]) byTeam[key] = { teamId: key, leads: 0, connected: 0, won: 0, revenue: 0, calls: 0, agents: new Set() };
    const t = byTeam[key];
    t.leads++;
    if (CONNECTED_STATUSES.has(l.status) || (l.callCount || 0) > 0) t.connected++;
    if (l.status === 'DEAL_CLOSED_WON') { t.won++; t.revenue += l.dealValue || 0; }
    t.calls += l.callCount || 0;
    if (l.assignedTo) t.agents.add(l.assignedTo);
  });
  const teamRows = Object.values(byTeam).map(t => ({
    ...t,
    teamName: teams.find(x => x.id === t.teamId)?.name || 'Unassigned',
    agents: t.agents.size,
  })).sort((a, b) => b.revenue - a.revenue || b.leads - a.leads);

  // agent leaderboard
  const byAgent = {};
  leads.forEach(l => {
    if (!l.assignedTo) return;
    if (!byAgent[l.assignedTo]) byAgent[l.assignedTo] = { userId: l.assignedTo, name: l.assignedToName || 'Unknown', leads: 0, connected: 0, won: 0, revenue: 0, calls: 0, teamId: l.teamId };
    const a = byAgent[l.assignedTo];
    a.leads++;
    if (CONNECTED_STATUSES.has(l.status) || (l.callCount || 0) > 0) a.connected++;
    if (l.status === 'DEAL_CLOSED_WON') { a.won++; a.revenue += l.dealValue || 0; }
    a.calls += l.callCount || 0;
  });
  const agentRows = Object.values(byAgent).map(a => ({
    ...a,
    role: ROLE_LABEL[usersById[a.userId]?.role] || usersById[a.userId]?.role || '—',
    teamName: teams.find(t => t.id === a.teamId)?.name || '—',
  })).sort((a, b) => b.revenue - a.revenue || b.connected / (b.leads || 1) - a.connected / (a.leads || 1));

  // source mix
  const bySrc = {};
  leads.forEach(l => { const k = SRC_LABELS[l.source] || l.source || 'Unspecified'; bySrc[k] = (bySrc[k] || 0) + 1; });
  const sources = Object.entries(bySrc).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
  const srcMax = Math.max(...sources.map(s => s.count), 1);

  const scopeLabel = user.role === ROLES.TL ? (teams.find(t => t.id === user.teamId)?.name || 'My Team') : (company?.name || 'All Teams');
  const generated = new Date();

  return createPortal(
    <div className="print-report-root">
      <style>{`
        .print-report-root { display: none; }
        @media print {
          #root { display: none !important; }
          .print-report-root { display: block !important; }
        }
        .print-report-root {
          --pr-ink: #16181c; --pr-ink2: #565b64; --pr-ink3: #8b8f97;
          --pr-hair: #dfe1e6; --pr-accent: #2E7D27; --pr-accent-l: #e8f4e6;
          --pr-good: #1f8a1f; --pr-bg: #ffffff;
          position: fixed; inset: 0; z-index: 9999; background: var(--pr-bg);
          overflow: auto; font-family: 'Inter', sans-serif; color: var(--pr-ink);
        }
        .pr-toolbar {
          position: sticky; top: 0; z-index: 2; display: flex; justify-content: flex-end; gap: 10px;
          padding: 12px 24px; background: #fafafa; border-bottom: 1px solid var(--pr-hair);
        }
        .pr-btn {
          font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 600; padding: 8px 16px;
          border-radius: 6px; border: 1px solid var(--pr-hair); background: #fff; color: var(--pr-ink); cursor: pointer;
        }
        .pr-btn.primary { background: var(--pr-accent); border-color: var(--pr-accent); color: #fff; }
        .pr-sheet { max-width: 880px; margin: 0 auto; padding: 40px 32px 64px; }
        .pr-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 20px; border-bottom: 2px solid var(--pr-ink); padding-bottom: 20px; }
        .pr-eyebrow { font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--pr-accent); font-weight: 700; margin: 0 0 8px; }
        .pr-h1 { font-family: 'Montserrat', sans-serif; font-weight: 800; font-size: 30px; margin: 0; letter-spacing: -.01em; }
        .pr-meta { text-align: right; font-size: 12px; color: var(--pr-ink2); line-height: 1.6; }
        .pr-meta b { color: var(--pr-ink); }
        .pr-section { margin-top: 34px; }
        .pr-h2 { font-family: 'Montserrat', sans-serif; font-weight: 700; font-size: 16px; margin: 0 0 4px; border-bottom: 1px solid var(--pr-hair); padding-bottom: 8px; }
        .pr-note { font-size: 12.5px; color: var(--pr-ink2); margin: 6px 0 14px; max-width: 68ch; }
        .pr-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; background: var(--pr-hair); border: 1px solid var(--pr-hair); }
        .pr-kpi { background: #fff; padding: 12px 14px; }
        .pr-kpi .l { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: var(--pr-ink3); }
        .pr-kpi .v { font-size: 20px; font-weight: 700; margin-top: 4px; }
        .pr-kpi.accent .v { color: var(--pr-accent); }
        .pr-bar-row { display: grid; grid-template-columns: 130px 1fr 50px; align-items: center; gap: 10px; padding: 5px 0; font-size: 12.5px; }
        .pr-bar-row .track { height: 12px; background: #f1f1ef; border-radius: 2px; overflow: hidden; }
        .pr-bar-row .fill { height: 100%; background: var(--pr-accent); }
        .pr-bar-row.exit .fill { background: #b23a3a; opacity: .8; }
        .pr-bar-row.win .fill { background: var(--pr-good); }
        .pr-bar-row .num { text-align: right; font-variant-numeric: tabular-nums; }
        table.pr-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        table.pr-table th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .03em; color: var(--pr-ink3); padding: 6px 8px; border-bottom: 1.5px solid var(--pr-ink); }
        table.pr-table th.num, table.pr-table td.num { text-align: right; }
        table.pr-table td { padding: 6px 8px; border-bottom: 1px solid var(--pr-hair); font-variant-numeric: tabular-nums; }
        table.pr-table td.name { font-variant-numeric: normal; font-weight: 600; }
        .pr-foot { margin-top: 40px; padding-top: 14px; border-top: 1px solid var(--pr-hair); font-size: 10.5px; color: var(--pr-ink3); line-height: 1.6; }
        @page { size: A4; margin: 14mm; }
        @media print { .pr-toolbar { display: none; } .pr-sheet { padding: 0; max-width: none; } }
      `}</style>

      <div className="pr-toolbar">
        <button className="pr-btn" onClick={onClose}>Close</button>
        <button className="pr-btn primary" onClick={() => window.print()}>Print / Save PDF</button>
      </div>

      <div className="pr-sheet">
        <div className="pr-head">
          <div>
            <p className="pr-eyebrow">{scopeLabel} &middot; Sales Performance</p>
            <h1 className="pr-h1">Team Sales Performance Report</h1>
          </div>
          <div className="pr-meta">
            Generated <b>{fmtD(generated.toISOString())}</b><br />
            By <b>{user.name}</b> ({ROLE_LABEL[user.role] || user.role})
          </div>
        </div>

        <div className="pr-section">
          <h2 className="pr-h2">Executive Summary</h2>
          <div className="pr-kpis">
            <div className="pr-kpi"><div className="l">Total Leads</div><div className="v">{totalLeads}</div></div>
            <div className="pr-kpi"><div className="l">Connected</div><div className="v">{connected} <span style={{ fontSize: 12, color: 'var(--pr-ink3)' }}>({pct(connected, totalLeads)})</span></div></div>
            <div className="pr-kpi"><div className="l">Meetings Set</div><div className="v">{meetings}</div></div>
            <div className="pr-kpi"><div className="l">Site Visits</div><div className="v">{visits}</div></div>
            <div className="pr-kpi"><div className="l">Calls Logged</div><div className="v">{calls}</div></div>
            <div className="pr-kpi"><div className="l">Deals Won</div><div className="v">{won.length}</div></div>
            <div className="pr-kpi accent" style={{ gridColumn: 'span 2' }}><div className="l">Revenue Closed</div><div className="v">{fmtBDT(revenue)}</div></div>
          </div>
        </div>

        <div className="pr-section">
          <h2 className="pr-h2">Pipeline Funnel</h2>
          <p className="pr-note">Every lead in scope, by current stage.</p>
          {funnel.map(f => (
            <div key={f.key} className={'pr-bar-row' + (f.key === 'DEAL_CLOSED_WON' ? ' win' : (f.key === 'DEAL_CLOSED_LOST' || f.key === 'NOT_INTERESTED') ? ' exit' : '')}>
              <span>{f.label}</span>
              <span className="track"><span className="fill" style={{ width: (f.count / funnelMax * 100) + '%' }} /></span>
              <span className="num">{f.count}</span>
            </div>
          ))}
        </div>

        {teamRows.length > 1 && (
          <div className="pr-section">
            <h2 className="pr-h2">Team Standings</h2>
            <p className="pr-note">Ranked by closed revenue.</p>
            <table className="pr-table">
              <thead><tr><th>Team</th><th className="num">Seats</th><th className="num">Leads</th><th className="num">Connect</th><th className="num">Calls</th><th className="num">Won</th><th className="num">Revenue</th></tr></thead>
              <tbody>
                {teamRows.map(t => (
                  <tr key={t.teamId}>
                    <td className="name">{t.teamName}</td>
                    <td className="num">{t.agents}</td>
                    <td className="num">{t.leads}</td>
                    <td className="num">{pct(t.connected, t.leads)}</td>
                    <td className="num">{t.calls}</td>
                    <td className="num">{t.won || '—'}</td>
                    <td className="num">{t.revenue ? fmtBDT(t.revenue) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="pr-section">
          <h2 className="pr-h2">Agent Leaderboard</h2>
          <p className="pr-note">Ranked by closed revenue, then connect rate.</p>
          <table className="pr-table">
            <thead><tr><th>Agent</th><th>Team</th><th>Role</th><th className="num">Leads</th><th className="num">Connect</th><th className="num">Calls</th><th className="num">Won</th><th className="num">Revenue</th></tr></thead>
            <tbody>
              {agentRows.map(a => (
                <tr key={a.userId}>
                  <td className="name">{a.name}</td>
                  <td>{a.teamName}</td>
                  <td>{a.role}</td>
                  <td className="num">{a.leads}</td>
                  <td className="num">{pct(a.connected, a.leads)}</td>
                  <td className="num">{a.calls}</td>
                  <td className="num">{a.won || '—'}</td>
                  <td className="num">{a.revenue ? fmtBDT(a.revenue) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="pr-section">
          <h2 className="pr-h2">Lead Source Mix</h2>
          {sources.map(s => (
            <div key={s.label} className="pr-bar-row">
              <span>{s.label}</span>
              <span className="track"><span className="fill" style={{ width: (s.count / srcMax * 100) + '%' }} /></span>
              <span className="num">{s.count}</span>
            </div>
          ))}
        </div>

        <div className="pr-foot">
          Revenue counts leads with status Deal Won, summed on deal value. Connect rate = leads past New (or with a logged call), over leads in scope.
          Report scope: {scopeLabel} &middot; {totalLeads} leads as of {fmtD(generated.toISOString())}.
        </div>
      </div>
    </div>,
    document.body
  );
}
