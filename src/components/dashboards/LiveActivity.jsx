import { useState, useEffect, useMemo } from 'react';
import Mi from '../Mi.jsx';
import { actIcon, actClr, fmtAgo, rlabel, srclabel } from '../../lib/helpers.js';

// Live team radar — a chronological feed of every team action plus new leads as
// they land, with source + time. Auto-refreshes so it updates without a reload.
export default function LiveActivity({ db, coLeads, coUsers, dbVersion }) {
  // Local heartbeat: re-render every 12s so relative times tick and any newly
  // synced rows surface even between dbVersion bumps.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 12000);
    const onVis = () => setTick(n => n + 1);
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  const usersById = useMemo(() => {
    const m = {}; coUsers.forEach(u => { m[u.id] = u; }); return m;
  }, [coUsers]);
  const leadsById = useMemo(() => {
    const m = {}; coLeads.forEach(l => { m[l.id] = l; }); return m;
  }, [coLeads]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const events = useMemo(() => {
    const out = [];
    const acts = db.activities || {};
    Object.entries(acts).forEach(([leadId, list]) => {
      const lead = leadsById[leadId];
      if (!lead) return; // outside this company
      (list || []).forEach(a => {
        out.push({ kind: 'act', time: a.timestamp, type: a.type, desc: a.description, userId: a.userId, lead });
      });
    });
    // New leads as their own radar pings.
    coLeads.forEach(l => out.push({ kind: 'lead', time: l.createdAt, type: 'CREATED', lead: l, userId: l.assignedTo }));

    return out
      .filter(e => e.time)
      .sort((a, b) => new Date(b.time) - new Date(a.time))
      .slice(0, 50);
  }, [db, coLeads, leadsById, dbVersion]);

  return (
    <div className="analytics-card">
      <div className="ac-hd la-hd">
        <span className="la-live"><span className="la-dot" />Live activity</span>
        <span className="la-hint">auto-refreshing · team radar</span>
      </div>
      {events.length === 0 ? (
        <div className="empty"><Mi>sensors</Mi><p>No activity yet</p></div>
      ) : (
        <div className="la-feed">
          {events.map((e, i) => {
            const who = usersById[e.userId];
            const isLead = e.kind === 'lead';
            const ico = isLead ? 'person_add' : actIcon(e.type);
            const clr = isLead ? '#C8FF00' : actClr(e.type);
            return (
              <div key={i} className="la-row">
                <span className="la-ico" style={{ color: clr, borderColor: clr }}><Mi>{ico}</Mi></span>
                <div className="la-bd">
                  <div className="la-main">
                    <b>{e.lead?.name || 'Unknown'}</b>
                    {isLead
                      ? <span className="la-txt"> — new lead added</span>
                      : <span className="la-txt"> — {e.desc || e.type}</span>}
                  </div>
                  <div className="la-sub">
                    {who ? <>{who.name} · {rlabel(who.role)}</> : 'System'}
                    {isLead && e.lead?.source && <span className="la-chip">{srclabel(e.lead.source)}</span>}
                  </div>
                </div>
                <div className="la-time">{fmtAgo(e.time)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
