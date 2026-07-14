import { CalendarClock } from 'lucide-react';
import { timeOf, eventType, eventColor, statusOf, paymentOf, leadCode, MON_SHORT } from './events.js';

// Everything in the next 30 days, oldest first.
export default function UpcomingList({ events, onOpenLead }) {
  return (
    <div className="cal-panel">
      <div className="cal-panel-hd">
        <div className="cal-panel-ttl">Upcoming <span className="cal-panel-ttl-dim">· Next 30 Days</span></div>
        <span className="cal-chip">{events.length}</span>
      </div>

      {!events.length ? (
        <div className="cal-none"><CalendarClock size={26} strokeWidth={1.6} /><p>No appointments in the next 30 days.</p></div>
      ) : (
        <div className="cal-rows">
          {events.map(e => {
            const d = new Date(e.at);
            const st = statusOf(e);
            const pay = paymentOf(e);
            return (
              <button key={e.id} className="cal-row cal-row-up" onClick={() => onOpenLead(e.lead.id)}>
                <span className="cal-date-blk">
                  <span className="cal-date-m">{MON_SHORT[d.getMonth()]}</span>
                  <span className="cal-date-d">{d.getDate()}</span>
                </span>
                <span className="cal-row-main">
                  <span className="cal-row-name">{e.lead.name}</span>
                  <span className="cal-row-meta">{timeOf(e.at)} · {eventType(e)} · {leadCode(e.lead)}</span>
                </span>
                <span className={`cal-pill cal-pill-${pay.tone}`}>{pay.label}</span>
                <span className="cal-row-st">
                  <i className="cal-row-dot" style={{ background: eventColor(e) }} />
                  <span className={`cal-pill cal-pill-${st.tone}`}>{st.label}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
