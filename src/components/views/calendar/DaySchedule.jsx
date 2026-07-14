import { CalendarX2, ChevronLeft, ChevronRight } from 'lucide-react';
import { timeOf, eventType, eventColor, statusOf, paymentOf, leadCode, MONTHS } from './events.js';

// Schedule for the selected day. Rows open the lead panel, matching how every
// other list in the app behaves.
export default function DaySchedule({ cursor, dayEvents, isToday, onStepDay, onOpenLead }) {
  const title = isToday ? "Today's Schedule" : 'Schedule';
  const sub = `${cursor.getDate()} ${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`;

  return (
    <div className="cal-panel">
      <div className="cal-panel-hd">
        <div className="cal-day-hd">
          <div>
            <div className="cal-panel-ttl">{title}</div>
            <div className="cal-panel-sub">{sub}</div>
          </div>
          <div className="cal-mnav">
            <button onClick={() => onStepDay(-1)} aria-label="Previous day"><ChevronLeft size={15} strokeWidth={2.4} /></button>
            <button onClick={() => onStepDay(1)} aria-label="Next day"><ChevronRight size={15} strokeWidth={2.4} /></button>
          </div>
        </div>
        <span className="cal-chip">{dayEvents.length} appointment{dayEvents.length === 1 ? '' : 's'}</span>
      </div>

      {!dayEvents.length ? (
        <div className="cal-none"><CalendarX2 size={26} strokeWidth={1.6} /><p>Nothing scheduled for this day.</p></div>
      ) : (
        <div className="cal-rows">
          {dayEvents.map(e => {
            const st = statusOf(e);
            const pay = paymentOf(e);
            return (
              <button key={e.id} className="cal-row" onClick={() => onOpenLead(e.lead.id)}>
                <span className="cal-row-time">{timeOf(e.at)}</span>
                <i className="cal-row-dot" style={{ background: eventColor(e) }} />
                <span className="cal-row-main">
                  <span className="cal-row-name">{e.lead.name}</span>
                  <span className="cal-row-meta">{eventType(e)} · {leadCode(e.lead)}</span>
                </span>
                <span className={`cal-pill cal-pill-${st.tone}`}>{st.label}</span>
                <span className={`cal-pill cal-pill-${pay.tone}`}>{pay.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
