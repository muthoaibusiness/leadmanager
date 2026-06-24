import { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { getDB } from '../../lib/db.js';
import { ROLES } from '../../lib/constants.js';
import { buildAgentPerf, ROLE_VIEWS } from '../../lib/agentPerf.js';
import { fmtBDT, ini } from '../../lib/helpers.js';

// "Minimal Intelligence" redesign — purple palette, scoped under .mip (see index.css).
const FC = ['#2E7D27', '#3E9A33', '#4AA838', '#54B848', '#6BC95A'];
const ROLE_TABS = [ROLES.IA, ROLES.MA, ROLES.TL];
const tier = c => (c >= 50 ? 'green' : c >= 25 ? 'warn' : 'red');
const AGG_KEYS = ['sourced', 'contacted', 'qualified', 'untouched', 'calls', 'talkMins', 'followups', 'meetingsSet', 'mReceived', 'visitsSched', 'visitsDone', 'sentTL', 'negotiation', 'proposals', 'won', 'lost', 'revenue'];

const CFG = {
  [ROLES.IA]: { conv: r => r.contactRate, sub: r => `${r.sourced} sourced · ${r.followups} follow-ups`,
    stats: r => [['Contacted', r.contacted], ['Follow-ups', r.followups], ['Meetings', r.meetingsSet]] },
  [ROLES.MA]: { conv: r => r.showRate, sub: r => `${r.mReceived} received · ${r.visitsDone} visits done`,
    stats: r => [['Received', r.mReceived], ['Visits Done', r.visitsDone], ['Sent TL', r.sentTL]] },
  [ROLES.TL]: { conv: r => r.closeRate, sub: r => `${fmtBDT(r.revenue)} · ${r.won} won`,
    stats: r => [['Won', r.won], ['Lost', r.lost], ['Revenue', fmtBDT(r.revenue)]] },
};

function Spark({ pts }) {
  const w = 84, h = 26;
  const arr = pts.some(p => p) ? pts : pts.map(() => 0);
  const mx = Math.max(...arr, 1), step = w / (arr.length - 1);
  const up = arr[arr.length - 1] >= arr[0];
  const c = arr.map((p, i) => `${(i * step).toFixed(1)},${(h - 2 - (p / mx) * (h - 4)).toFixed(1)}`);
  return (
    <svg className="mip-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polyline points={c.join(' ')} fill="none" stroke={up ? '#22C55E' : '#EF4444'} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function AgentPerformanceView() {
  const { user, dbVersion, dateRange } = useApp();
  void dbVersion;
  const db = getDB();
  const [role, setRole] = useState(user.role === ROLES.MA ? ROLES.MA : ROLES.IA);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('best');
  const [open, setOpen] = useState(null);

  const teamId = user.role === ROLES.TL ? user.teamId : null;
  // Driven by the global date filter (top bar) — no separate period control here.
  const r = dateRange?.range;
  const allRows = useMemo(
    () => buildAgentPerf(db, { start: r ? r.start.getTime() : null, end: r ? r.end.getTime() : null, periodDays: 0, teamId }),
    [db, r, teamId, dbVersion]
  );

  // 7-day daily involved-lead volume per agent (for the row sparkline + trend insight)
  const sparkOf = useMemo(() => {
    const days = 7, now = new Date(); now.setHours(0, 0, 0, 0);
    const map = {};
    (db.leads || []).forEach(l => {
      [l.assignedTo, ...(l.previousAssignees || [])].forEach(id => {
        if (!id) return; if (!map[id]) map[id] = Array(days).fill(0);
        const dd = Math.floor((now - new Date(new Date(l.createdAt).setHours(0, 0, 0, 0))) / 864e5);
        if (dd >= 0 && dd < days) map[id][days - 1 - dd]++;
      });
    });
    return id => map[id] || Array(days).fill(0);
  }, [db, dbVersion]);

  const view = ROLE_VIEWS[role], cfg = CFG[role];
  const rows = allRows.filter(r => r.u.role === role);
  const agg = rows.reduce((a, r) => { AGG_KEYS.forEach(k => { a[k] = (a[k] || 0) + r[k]; }); return a; }, {});
  agg.contactRate = agg.sourced ? (agg.contacted / agg.sourced) * 100 : 0;
  agg.showRate = agg.visitsSched ? (agg.visitsDone / agg.visitsSched) * 100 : 0;
  agg.closeRate = (agg.won + agg.lost) ? (agg.won / (agg.won + agg.lost)) * 100 : 0;

  const kpis = view.kpis(agg);
  const funnel = view.funnel(agg, FC);
  let dropIdx = -1, dropPct = 0;
  for (let i = 1; i < funnel.length; i++) { const pv = funnel[i - 1].value || 0; const dp = pv ? 1 - funnel[i].value / pv : 0; if (dp > dropPct) { dropPct = dp; dropIdx = i; } }

  const entered = funnel[0]?.value || 0, won = agg.won || funnel[funnel.length - 1]?.value || 0;
  const lost = agg.lost || 0, silent = agg.untouched || 0, pend = Math.max(0, entered - won - lost - silent);

  const convBars = rows.slice().sort((a, b) => cfg.conv(b) - cfg.conv(a)).slice(0, 8);

  let list = rows;
  if (q) { const s = q.toLowerCase(); list = list.filter(r => r.u.name.toLowerCase().includes(s)); }
  list = list.slice().sort((a, b) => sort === 'alpha' ? a.u.name.localeCompare(b.u.name) : sort === 'worst' ? cfg.conv(a) - cfg.conv(b) : cfg.conv(b) - cfg.conv(a));

  const insights = r => {
    const out = []; const f = view.funnel(r, FC);
    let di = -1, dp = 0; for (let i = 1; i < f.length; i++) { const pv = f[i - 1].value || 0; const d = pv ? 1 - f[i].value / pv : 0; if (d > dp && pv > 0) { dp = d; di = i; } }
    if (di > 0 && dp >= .4) out.push(['r', `🔴 Drops at ${f[di].label}`]);
    if (r.resp != null && r.resp <= 4) out.push(['g', '⚡ Fast responder']);
    if (role === ROLES.IA && r.untouched > 0) out.push(['w', `🟠 ${r.untouched} untouched`]);
    if (role === ROLES.IA && r.followups >= 10) out.push(['g', '🔁 Diligent follow-up']);
    const sp = sparkOf(r.u.id); if (sp[sp.length - 1] > sp[0]) out.push(['g', '📈 Trending up']);
    else if (sp[sp.length - 1] < sp[0]) out.push(['r', '📉 Declining']);
    if (r.score >= 70) out.push(['p', '⭐ Top performer']); else if (r.score < 30) out.push(['w', '⚠️ Needs attention']);
    return out.length ? out.slice(0, 3) : [['p', '➖ Steady']];
  };

  return (
    <div className="mip">
      {/* toolbar: role switch + search (date range comes from the global top-bar filter) */}
      <div className="mip-bar">
        <div className="mip-seg">
          {ROLE_TABS.map(rk => (
            <button key={rk} className={role === rk ? 'on' : ''} onClick={() => { setRole(rk); setOpen(null); }}>{ROLE_VIEWS[rk].label}</button>
          ))}
        </div>
        <div className="mip-sp" />
        <div className="mip-fld">
          <svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" strokeWidth="2" /><path d="M21 21l-4-4" strokeWidth="2" strokeLinecap="round" /></svg>
          <input placeholder="Search agent" value={q} onChange={e => setQ(e.target.value)} />
        </div>
      </div>

      <div className="mip-grid">
        {/* LEFT: KPI strip + agent list */}
        <div className="mip-col">
          <div className="mip-kstrip">
            {kpis.map((k, i) => {
              const isRev = k.val === '__REVENUE__';
              return (
                <div key={i} className={`mip-kpi ${k.tone === 'good' ? 'green' : k.tone === 'warn' ? 'warn' : k.tone === 'accent' ? 'accent' : ''}`}>
                  <div className="v">{isRev ? fmtBDT(agg.revenue) : (typeof k.val === 'number' ? k.val.toLocaleString() : k.val)}</div>
                  <div className="l">{k.label}</div>
                </div>
              );
            })}
          </div>

          <div>
            <div className="mip-sortbar">
              <span className="mip-lbl">Agents · {list.length}</span>
              <div className="mip-sp" />
              <div className="mip-seg sm">
                {[['best', 'Best'], ['worst', 'Worst'], ['alpha', 'A–Z']].map(([k, l]) => (
                  <button key={k} className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>{l}</button>
                ))}
              </div>
            </div>
            <div className="mip-alist">
              {list.length === 0 && <div className="mip-none">No agents match.</div>}
              {list.map(r => {
                const c = cfg.conv(r), t = tier(c), isOpen = open === r.u.id;
                return (
                  <div key={r.u.id} className={`mip-arow${isOpen ? ' open' : ''}`}>
                    <div className="mip-atop" onClick={() => setOpen(isOpen ? null : r.u.id)}>
                      <span className={`mip-av t-${t}`}>{ini(r.u.name)}</span>
                      <div className="mip-amid"><div className="an">{r.u.name}</div><div className="as">{cfg.sub(r)}</div></div>
                      <div className="mip-aright"><Spark pts={sparkOf(r.u.id)} /><div className={`mip-aconv t-${t}`}>{Math.round(c)}%</div></div>
                    </div>
                    <div className="mip-aexp"><div className="mip-aexp-in">
                      <div className="mip-mini-steps">
                        {view.funnel(r, FC).map((s, i) => (
                          <span key={i} className="mip-ms">{i > 0 && <span className="mip-ms-arrow">→</span>}<b>{s.value}</b> {s.label}</span>
                        ))}
                      </div>
                      <div className="mip-qstats">
                        {cfg.stats(r).map(([l, v], i) => <div key={i} className="mip-qstat"><div className="qv">{v}</div><div className="ql mip-lbl">{l}</div></div>)}
                      </div>
                      <div className="mip-tags">{insights(r).map(([c2, x], i) => <span key={i} className={`mip-tag ${c2}`}>{x}</span>)}</div>
                    </div></div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* RIGHT: funnel + conversion bars + outcome pills */}
        <div className="mip-col">
          <div className="mip-card">
            <div className="mip-hd"><span className="mip-lbl">Pipeline funnel</span><span className="mip-mini">{dropIdx > 0 ? `biggest drop → ${funnel[dropIdx].label}` : '—'}</span></div>
            <div className="mip-steps-rail"><div className="mip-steps">
              {funnel.map((s, i) => {
                const mx = Math.max(...funnel.map(x => x.value), 1), sz = Math.round(30 + 22 * (s.value / mx));
                const dp = i > 0 ? Math.round((1 - (s.value / (funnel[i - 1].value || 1))) * 100) : 0;
                return (
                  <div key={i} className={`mip-step${i === dropIdx ? ' drop' : ''}`}>
                    <div className="circ" style={{ width: sz, height: sz, background: s.color }}>{s.value}</div>
                    <div className="nm">{s.label}</div><div className="dpct">{i === dropIdx ? '−' + dp + '%' : ''}</div>
                  </div>
                );
              })}
            </div></div>
          </div>

          <div className="mip-card">
            <div className="mip-hd"><span className="mip-lbl">Conversion by agent</span><span className="mip-mini">top {convBars.length}</span></div>
            <div className="mip-cv">
              {convBars.length ? convBars.map(r => {
                const c = cfg.conv(r), t = tier(c), col = t === 'green' ? 'var(--mip-grn)' : t === 'warn' ? 'var(--mip-wrn)' : 'var(--mip-red)';
                return (
                  <div key={r.u.id} className="mip-cv-row" title={`${r.u.name} · ${c.toFixed(1)}%`}>
                    <div className="mip-cv-name">{r.u.name}</div>
                    <div className="mip-cv-track"><div className="mip-cv-fill" style={{ width: Math.min(100, c) + '%', background: col }} /></div>
                    <div className="mip-cv-pct" style={{ color: col }}>{Math.round(c)}%</div>
                  </div>
                );
              }) : <div className="mip-none">No data.</div>}
            </div>
          </div>

          <div className="mip-card">
            <div className="mip-hd"><span className="mip-lbl">Outcome breakdown</span></div>
            <div className="mip-pills">
              <div className="mip-pill won"><div className="pv">{won}</div><div className="pl">Won</div></div>
              <div className="mip-pill lost"><div className="pv">{lost}</div><div className="pl">Lost</div></div>
              <div className="mip-pill pend"><div className="pv">{pend}</div><div className="pl">Pending</div></div>
              <div className="mip-pill silent"><div className="pv">{silent}</div><div className="pl">Silent</div></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
