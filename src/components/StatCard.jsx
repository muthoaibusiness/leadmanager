import Mi from './Mi.jsx';
import Spinner from './Spinner.jsx';
import { fmtAgoLong } from '../lib/helpers.js';

// Minimal brand KPI card: quiet monochrome label icon, big number, sub.
// `tone` ('accent'|'good'|'warn'|'danger') tints only the value for status emphasis.
// Pass `onClick` to make it actionable (shows a drill-down chevron + hover lift).
// `val` of null/undefined means "still counting" — every KPI card is a server
// count now, so that state is normal rather than exceptional and gets a spinner
// instead of a dash. An actual zero is a number and renders as one.
// `updated` is an ISO timestamp: when the thing this card counts last moved.
// It renders as "3 hours ago" under the sub-label, so a number that has not
// changed in a fortnight cannot be mistaken for a live one. Omit it (or pass
// null, which is what "nothing counted yet" looks like) and the line is simply
// absent.
export default function StatCard({ val, label, ico, sub, tone, onClick, updated }) {
  const clickable = typeof onClick === 'function';
  const pending = val == null;
  return (
    <div
      className={`mc${tone ? ' ' + tone : ''}${clickable ? ' mc-click' : ''}`}
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
      <div className="mc-l">{ico && <Mi>{ico}</Mi>}{label}</div>
      <div className="mc-v">{pending ? <Spinner size={20} /> : val}</div>
      {(sub || updated) && (
        <div className="mc-ft">
          {sub && <span className="mc-sub">{sub}</span>}
          {updated && <span className="mc-upd" title={new Date(updated).toLocaleString('en-GB')}><Mi>schedule</Mi>{fmtAgoLong(updated)}</span>}
        </div>
      )}
      {clickable && <span className="mc-go"><Mi>chevron_right</Mi></span>}
    </div>
  );
}
