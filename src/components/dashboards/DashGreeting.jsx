import { useGreeting } from '../../lib/useGreeting.js';

// Shared dashboard header — live time-of-day greeting + optional sub line.
export default function DashGreeting({ user, sub }) {
  const g = useGreeting();
  const firstName = (user?.name || '').trim().split(/\s+/)[0];
  return (
    <div className="iad-greet">
      <div className="iad-greet-hi">{g}, <span>{firstName}</span></div>
      {sub && <div className="iad-greet-sub">{sub}</div>}
    </div>
  );
}
