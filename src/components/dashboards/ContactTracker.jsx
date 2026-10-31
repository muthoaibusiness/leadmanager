import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { getDB, loadLeadUpdates } from '../../lib/db.js';
import { CONTACT_PERIODS, contactPerf, updatesFromActs, periodSince } from '../../lib/contactPerf.js';
import ProgressMetricCard from '../ui/progress-metric-card.jsx';
import { PeriodSelect } from '../ui/metric-controls.jsx';
import { canSee } from '../../lib/constants.js';
import Mi from '../Mi.jsx';

// Home › Performance Reports: every status change and follow-up any person in
// the company logged on a prospect, prospects still in New left out (see
// lib/contactPerf.js). Opens on the past 24 hours, hour by hour; the period
// menu switches to 7 / 14 / 30 days, day by day. The headline is the updates
// in the period, and the change compares it with the period before.
//
// Each period loads its own updates (loadLeadUpdates: one light query), once
// per visit, so the card never waits on the full activity window; updates
// already in db.activities (realtime, this browser's own) are merged in, which
// keeps it live. Current statuses come from the lead book, which
// ManagementDash loads (useLeadBook).
//
// `variant="soft"` (the phone Home) renders the same numbers as a compact card:
// the count, the change, one square per bucket shaded by its count, and Check
// now at the foot (styled like Lead sources' View all).
//
// `period` (optional) sets the period from outside — the phone Home's
// Performance Overview picks one for both its cards — and hides the card's own
// picker.
export default function ContactTracker({ variant, period: fixed }) {
  const { user, dbVersion, nav } = useApp();
  const [picked, setPeriod] = useState(CONTACT_PERIODS[0]);
  const period = fixed || picked;
  const [loaded, setLoaded] = useState({}); // period label → updates from the cloud
  const cloud = loaded[period.label];

  // The 24-hour window rolls: recount once a minute even when nothing changes.
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60e3);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (cloud) return undefined;
    let alive = true;
    loadLeadUpdates(user, periodSince(period)).then(updates => {
      if (alive) setLoaded(l => ({ ...l, [period.label]: updates || [] }));
    });
    return () => { alive = false; };
  }, [cloud, period, user]);

  const local = useMemo(() => updatesFromActs(getDB().activities), [dbVersion]); // eslint-disable-line react-hooks/exhaustive-deps -- db.activities is mutated in place; dbVersion tracks it
  const leadStatus = useMemo(() => new Map(getDB().leads.map(l => [l.id, l.status])), [dbVersion]); // eslint-disable-line react-hooks/exhaustive-deps -- db.leads is mutated in place; dbVersion tracks it
  const { points, total, prevTotal } = useMemo(
    () => contactPerf(cloud ? cloud.concat(local) : local, period, { companyId: user.companyId, leadStatus, now }),
    [cloud, local, period, user.companyId, leadStatus, now],
  );

  const diff = total - prevTotal;
  const trend = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
  const percent = prevTotal ? `${Math.abs((diff / prevTotal) * 100).toFixed(1)}%` : total ? 'New' : '0.0%';

  if (variant === 'soft') {
    // Shade: none / up to half the busiest bucket / over half / the busiest.
    const max = Math.max(0, ...points.map(p => p.value));
    const level = (v) => (v <= 0 || !max ? 0 : v >= max ? 3 : v / max > 0.5 ? 2 : 1);
    const cols = points.length >= 24 ? 12 : points.length >= 14 ? 7 : points.length >= 10 ? 10 : Math.max(points.length, 1);
    return (
      <section className="mh-card mh-contact" aria-label="Prospects contacted">
        <div className="mh-contact-main">
          <span className="mh-card-hd">
            <span className="mh-card-t">Prospects Contacted</span>
            <span className="mh-card-s">Lead updates by your team</span>
          </span>
          {!fixed && <PeriodSelect value={period.label} options={CONTACT_PERIODS} onChange={setPeriod} />}
          <span className="mh-num mh-num-md">{cloud ? total : '—'}</span>
          {cloud && (
            <span className={`mh-pill ${trend}`}>
              {trend === 'up' ? '+' : trend === 'down' ? '−' : ''}{percent}
              <span className="mh-pill-sub"> vs previous {period.span}</span>
            </span>
          )}
        </div>
        <div className="mh-heat" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {points.map((p, i) => <span key={i} className={`mh-heat-c l${level(p.value)}`} title={`${p.date}: ${p.value}`} />)}
        </div>
        {canSee(user, 'agentperf') && <button type="button" className="mh-more" onClick={() => nav('agentperf')}>Check now<Mi aria-hidden="true">chevron_right</Mi></button>}
      </section>
    );
  }

  return (
    <ProgressMetricCard
      title="Prospects contacted"
      unit="updates"
      size="sm"
      period={period.label}
      periodOptions={CONTACT_PERIODS}
      onPeriodChange={setPeriod}
      data={points}
      total={total}
      delta={(diff >= 0 ? '+' : '−') + Math.abs(diff)}
      deltaLabel={`vs previous ${period.span}`}
      percent={percent}
      trend={trend}
      loading={!cloud}
    />
  );
}
