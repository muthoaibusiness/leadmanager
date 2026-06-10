import Mi from './Mi.jsx';

// Minimal brand KPI card: quiet monochrome label icon, big number, sub.
// `tone` ('accent'|'good'|'warn'|'danger') tints only the value for status emphasis.
export default function StatCard({ val, label, ico, sub, tone }) {
  return (
    <div className={`mc${tone ? ' ' + tone : ''}`}>
      <div className="mc-l">{ico && <Mi>{ico}</Mi>}{label}</div>
      <div className="mc-v">{val}</div>
      {sub && <div className="mc-sub">{sub}</div>}
    </div>
  );
}
