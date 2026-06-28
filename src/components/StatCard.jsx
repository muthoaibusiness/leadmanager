import Mi from './Mi.jsx';

// Minimal brand KPI card: quiet monochrome label icon, big number, sub.
// `tone` ('accent'|'good'|'warn'|'danger') tints only the value for status emphasis.
// Pass `onClick` to make it actionable (shows a drill-down chevron + hover lift).
export default function StatCard({ val, label, ico, sub, tone, onClick }) {
  const clickable = typeof onClick === 'function';
  return (
    <div
      className={`mc${tone ? ' ' + tone : ''}${clickable ? ' mc-click' : ''}`}
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
      <div className="mc-l">{ico && <Mi>{ico}</Mi>}{label}</div>
      <div className="mc-v">{val}</div>
      {sub && <div className="mc-sub">{sub}</div>}
      {clickable && <span className="mc-go"><Mi>chevron_right</Mi></span>}
    </div>
  );
}
