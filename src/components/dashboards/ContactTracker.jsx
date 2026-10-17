import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { getDB, loadLeadUpdates } from '../../lib/db.js';
import { CONTACT_PERIODS, contactPerf, updatesFromActs, periodSince } from '../../lib/contactPerf.js';
import ProgressMetricCard from '../ui/progress-metric-card.jsx';

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
export default function ContactTracker() {
  const { user, dbVersion } = useApp();
  const [period, setPeriod] = useState(CONTACT_PERIODS[0]);
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
