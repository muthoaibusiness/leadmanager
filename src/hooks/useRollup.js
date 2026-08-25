import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { dashboardRollup, agentLeadStats, activityRollup, stageTrend } from '../lib/db.js';

// Server-side dashboard rollup, with an explicit "the migration is not applied"
// signal so the caller can fall back.
//
// Returns:
//   rollup   totals / status+source breakdown / trend, or null
//   agents   per-agent leaderboard rows, or null
//   acts     activity totals (talk time, offers), or null
//   trend    per-day stage events for the conversion panel, or null
//   ready    the round trip has finished, one way or the other
//   needBook true once we know the rollups are unavailable — feed this to
//            useLeadBook(needBook) so the whole-book download happens ONLY in
//            that case, instead of on every render of every dashboard.
//
// `opts` must be memoised by the caller; it is stringified into the effect key.
export default function useRollup(opts) {
  const { user, dbVersion } = useApp();
  const [state, setState] = useState({ rollup: null, agents: null, acts: null, trend: null, ready: false, needBook: false });
  const key = JSON.stringify({ ...opts, u: user?.id, v: dbVersion });

  useEffect(() => {
    let alive = true;
    const { teamId = null, userIds = null, start = null, end = null, trendDays = 14, monthStart = null, stageDays = 0 } = opts || {};
    Promise.all([
      dashboardRollup(user, { teamId, userIds, start, end, trendDays }),
      userIds && userIds.length ? agentLeadStats(user, userIds, { start, end, monthStart }) : Promise.resolve(null),
      activityRollup(user, { userIds, start, end }),
      stageDays ? stageTrend(user, { teamId, userIds, days: stageDays }) : Promise.resolve(null),
    ]).then(([rollup, agents, acts, trend]) => {
      if (!alive) return;
      // The lead rollup is the one that decides: if it is missing, every number
      // on the page has to come from the book anyway.
      setState({ rollup, agents, acts, trend, ready: true, needBook: !rollup });
    });
    return () => { alive = false; };
    // `key` stands in for opts/user/dbVersion — a fresh opts object each render
    // would otherwise refetch forever.
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
}
