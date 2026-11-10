import { useEffect, useMemo, useState } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { queryLeads, completeFollowUp } from '../../lib/db.js';
import useLeadCounts from '../../hooks/useLeadCounts.js';
import useCountUp from '../../hooks/useCountUp.js';
import { dayBounds, fetchPending, pendingFor, fetchDone, activitySummary } from '../../lib/followups.js';
import { FU_TYPES, typeOf, purposeText } from '../../lib/followupTypes.js';
import { Menu, MenuItem, MenuRadioGroup, MenuRadio } from '../ui/menu.jsx';
import { LoadingBlock } from '../Spinner.jsx';

const TABS = [
  { key: 'today', kpi: 'followToday', label: "Today's Followup", tone: 'green', empty: 'Nothing due today.' },
  { key: 'missed', kpi: 'followMissed', label: 'Missed Followup', tone: 'red', empty: 'No missed follow-ups.' },
  { key: 'upcoming', kpi: 'followUpcoming', label: 'Upcoming', tone: 'purple', empty: 'Nothing scheduled after today.' },
];
const LIST_SIZE = 30;
const DAY = 86_400_000;
const PERIODS = [{ days: 7, label: 'Last 7 days' }, { days: 30, label: 'Last 30 days' }];
const TYPE_SUB = { CALL: 'Calls completed', MESSAGE: 'Messages sent', PROJECT_VISIT: 'Project visits done', OFFICE_VISIT: 'Office visits done', MEETING: 'Meetings held' };

function Num({ value }) {
  const n = useCountUp(value);
  return value == null ? '—' : n;
}

// The agent's follow-up to-do and what they completed. Today / Missed /
// Upcoming are counted on the server (leadQuery KPI followToday / followMissed /
// followUpcoming, the same day rule as followBucket); a tile opens its list
// underneath. Follow-up activity is the follow-ups this person completed in the
// period, against the period before, by type.
// `rail`: the narrow right-hand column of the desktop dashboard. Both cards and
// the three tiles stack top to bottom there.
export default function SmartTodo({ rail = false }) {
  const { user, dbVersion, setPanLead, openModal, refreshDB, showToast, nav } = useApp();
  const dayKey = new Date().toDateString();
  const bounds = useMemo(() => dayBounds(), [dayKey]); // eslint-disable-line react-hooks/exhaustive-deps -- recomputed when the day changes
  const specs = useMemo(() => Object.fromEntries(TABS.map((t) => [t.key, { user, involved: false, kpi: t.kpi, kpiArg: bounds }])), [user, bounds]);
  const counts = useLeadCounts(specs);
  const [tab, setTab] = useState('today');
  // The list with the tab it belongs to; a different tab reads as still loading.
  const [res, setRes] = useState(null);
  const rows = res && res.tab === tab ? res.list : null;
  const [days, setDays] = useState(7);
  const [act, setAct] = useState(null);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    let alive = true;
    queryLeads(specs[tab], { page: 0, size: LIST_SIZE, sort: tab === 'missed' ? 'followupDesc' : 'followup' })
      .then(async (r) => {
        const list = r?.rows || [];
        await fetchPending(list.map((l) => l.id), { force: true });
        if (alive) setRes({ tab, list });
      });
    return () => { alive = false; };
  }, [tab, specs, dbVersion]);

  useEffect(() => {
    let alive = true;
    const now = Date.now(), span = days * DAY;
    Promise.all([fetchDone(user.id, now - span, now), fetchDone(user.id, now - 2 * span, now - span)])
      .then(([cur, prev]) => { if (alive) setAct(activitySummary(cur || [], prev || [])); });
    return () => { alive = false; };
  }, [user.id, dbVersion, days]);

  const done = async (l) => {
    setBusy(l.id);
    try { await completeFollowUp(l.id, {}, user); refreshDB(); showToast('Follow-up completed', 'ok'); }
    finally { setBusy(null); }
  };
  const reschedule = (l) => { setPanLead(l.id); openModal('follow-up'); };
  const when = (iso) => {
    const d = new Date(iso);
    const t = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const day = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    return tab === 'today' ? t : tab === 'missed' ? day : `${day}, ${t}`;
  };

  // Missed leads the row while there is anything missed.
  const order = counts.missed > 0 ? ['missed', 'today', 'upcoming'] : ['today', 'missed', 'upcoming'];
  const cur = TABS.find((t) => t.key === tab);
  const period = PERIODS.find((p) => p.days === days);
  const up = act?.change != null && act.change >= 0;
  const hint = !act || act.change == null
    ? (act?.total ? 'Nothing to compare with yet. Keep going.' : 'Complete follow-ups to see your progress here.')
    : up ? 'Team activity up, keep it consistent.' : 'Activity is down. Pick a few follow-ups to finish today.';

  return (
    <section className={`st${rail ? ' rail' : ''}`} aria-label="Follow-ups">
      {/* ── To-Do ── */}
      <div className="st-card">
        <div className="st-hd">
          <span className="st-ico yellow" aria-hidden="true"><Mi>checklist</Mi></span>
          <span className="st-ttl">To-Do</span>
          <span className="st-info" title="Follow-ups on leads you hold. Missed means due before today."><Mi>info</Mi></span>
          <span className="st-sp" />
          <Menu label="To-Do options" trigger={<button type="button" className="st-iconbtn"><Mi>more_vert</Mi></button>}>
            <MenuItem icon="refresh" onSelect={() => refreshDB()}>Refresh</MenuItem>
            <MenuItem icon="list" onSelect={() => nav('leads')}>Open Leads</MenuItem>
          </Menu>
        </div>

        <div className="st-tiles">
          {order.map((k) => {
            const t = TABS.find((x) => x.key === k);
            return (
              <button key={k} type="button" className={`st-tile ${t.tone}${tab === k ? ' on' : ''}`} aria-pressed={tab === k} onClick={() => setTab(k)}>
                <span className="st-tile-txt">
                  <b className="st-num"><Num value={counts[k]} /></b>
                  <span className="st-lbl">{t.label}</span>
                </span>
                <span className="st-arrow" aria-hidden="true"><Mi>arrow_forward</Mi></span>
              </button>
            );
          })}
        </div>

        <div className="st-list" aria-live="polite">
          {rows === null ? <LoadingBlock label="Loading follow-ups…" />
            : rows.length === 0 ? <div className="st-empty"><Mi>task_alt</Mi>{cur.empty}</div>
              : rows.map((l) => {
                const f = pendingFor(l.id);
                const ty = typeOf(f?.type);
                return (
                  <div key={l.id} className="st-row" onClick={() => setPanLead(l.id)}>
                    <span className={`st-when${tab === 'missed' ? ' over' : ''}`}>{when(l.nextFollowup)}</span>
                    <span className="st-row-ico" aria-hidden="true"><Mi>{ty.icon}</Mi></span>
                    <span className="st-row-info">
                      <span className="st-row-name">{l.name}</span>
                      <span className="st-row-meta">{[ty.label, purposeText(f)].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="st-row-act">
                      {l.phone && <a className="st-mini" href={`tel:${l.phone}`} title="Call" aria-label={`Call ${l.name}`} onClick={(e) => e.stopPropagation()}><Mi>call</Mi></a>}
                      <button type="button" className="st-mini edit" title="Reschedule" aria-label={`Reschedule ${l.name}`} onClick={(e) => { e.stopPropagation(); reschedule(l); }}><Mi>edit_calendar</Mi></button>
                      <button type="button" className="st-mini ok" title="Mark done" aria-label={`Mark follow-up done: ${l.name}`} disabled={busy === l.id} onClick={(e) => { e.stopPropagation(); done(l); }}><Mi>check</Mi></button>
                    </span>
                  </div>
                );
              })}
          {rows && counts[tab] > rows.length && <div className="st-more">Showing {rows.length} of {counts[tab]}</div>}
        </div>
      </div>

      {/* ── Follow-up activity ── */}
      <div className="st-card">
        <div className="st-hd">
          <span className="st-ttl">Follow-up Activity</span>
          <span className="st-sp" />
          <Menu label="Activity period" trigger={<button type="button" className="st-iconbtn" title={period.label}><Mi>calendar_month</Mi></button>}>
            <MenuRadioGroup value={String(days)} onChange={(v) => setDays(Number(v))}>
              {PERIODS.map((p) => <MenuRadio key={p.days} value={String(p.days)}>{p.label}</MenuRadio>)}
            </MenuRadioGroup>
          </Menu>
        </div>

        <div className="st-big">
          <span className="st-big-txt">
            <span className="st-lbl">Followup Completed · {period.label.toLowerCase()}</span>
            <b className="st-num xl"><Num value={act ? act.total : null} /></b>
          </span>
          {act?.change != null && (
            <span className={`st-chg ${up ? 'up' : 'down'}`}><Mi>{up ? 'trending_up' : 'trending_down'}</Mi>{up ? '+' : ''}{act.change}%</span>
          )}
        </div>
        <div className="st-hint"><Mi>lightbulb</Mi>{hint}</div>

        <ul className="st-types">
          {FU_TYPES.map((t) => (
            <li key={t.code} className="st-type">
              <span className="st-type-ico" aria-hidden="true"><Mi>{t.icon}</Mi></span>
              <span className="st-type-txt">
                <span className="st-type-ttl">{t.label}</span>
                <span className="st-type-sub">{TYPE_SUB[t.code]}</span>
              </span>
              <b className="st-type-n"><Num value={act ? act.byType[t.code] || 0 : null} /></b>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
