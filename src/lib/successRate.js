import { ROLES } from './constants.js';

// Success rate is role-specific — each role is measured on its own objective,
// as a share of every lead they handled (how many they convert toward it).
//   Initial Agent  → got a meeting set
//   Meeting Agent  → forwarded the lead on to a Team Lead
//   Team Lead      → closed the deal (won) out of the whole team's leads
//   Management/…   → classic win rate on resolved deals
const REACHED_MEETING = ['MEETING_SET', 'SITE_VISIT_SCHEDULED', 'SITE_VISIT_DONE', 'NEGOTIATING', 'DEAL_CLOSED_WON'];
const REACHED_TL = ['NEGOTIATING', 'DEAL_CLOSED_WON', 'DEAL_CLOSED_LOST'];

// `mine` = role-scoped board leads, `involved` = every lead the user ever touched
// (assigned or forwarded on) — needed so IA/MA keep credit after handing a lead off.
export function successRate(user, mine, involved) {
  if (user.role === ROLES.IA) {
    const n = involved.filter(l => l.meetingSetBy === user.id || REACHED_MEETING.includes(l.status)).length;
    return { pct: involved.length ? Math.round(n / involved.length * 100) : 0, label: 'Meetings set', n, d: involved.length };
  }
  if (user.role === ROLES.MA) {
    const n = involved.filter(l => l.assignedRole === ROLES.TL || REACHED_TL.includes(l.status)).length;
    return { pct: involved.length ? Math.round(n / involved.length * 100) : 0, label: 'Forwarded to TL', n, d: involved.length };
  }
  if (user.role === ROLES.TL) {
    const n = mine.filter(l => l.status === 'DEAL_CLOSED_WON').length;
    return { pct: mine.length ? Math.round(n / mine.length * 100) : 0, label: 'Deals won', n, d: mine.length };
  }
  const won = mine.filter(l => l.status === 'DEAL_CLOSED_WON').length;
  const lost = mine.filter(l => l.status === 'DEAL_CLOSED_LOST').length;
  return { pct: won + lost ? Math.round(won / (won + lost) * 100) : 0, label: 'Successful deals', n: won, d: won + lost };
}
