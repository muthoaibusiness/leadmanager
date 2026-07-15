import { CalendarDays, CheckCircle2, Clock } from 'lucide-react';
import { statusOf } from './events.js';

// Three metrics for the selected day, all derived from real events.
export default function SummaryCards({ dayEvents, isToday }) {
  const confirmed = dayEvents.filter(e => statusOf(e).tone === 'ok').length;
  const pending = dayEvents.filter(e => statusOf(e).tone === 'warn').length;
  const when = isToday ? 'Today' : 'Selected day';

  const cards = [
    { key: 'total', tone: 'green', icon: CalendarDays, value: dayEvents.length, label: `${when}'s Total` },
    { key: 'conf', tone: 'neutral', icon: CheckCircle2, value: confirmed, label: 'Confirmed' },
    { key: 'pend', tone: 'amber', icon: Clock, value: pending, label: 'Pending' },
  ];

  return (
    <div className="cal-cards">
      {cards.map(({ key, tone, icon: Icon, value, label }) => (
        <div key={key} className={`cal-card cal-card-${tone}`}>
          <div className="cal-card-top">
            <span className="cal-card-ico"><Icon size={16} strokeWidth={2.2} /></span>
            <span className="cal-card-l">{label}</span>
          </div>
          <div className="cal-card-v">{value}</div>
        </div>
      ))}
    </div>
  );
}
