import { ChevronLeft, ChevronRight } from 'lucide-react';
import { dayKey, MONTHS, WEEKDAYS, eventColor, startOfDay } from './events.js';

// Month grid. `cursor` (the selected date) is owned by CalendarView; this only
// reports clicks back up. `month` is the month being browsed, which can differ
// from the selected date once you page away from it.
export default function MonthCalendar({ cursor, month, onSelect, onMonthChange, byDay }) {
  const year = month.getFullYear();
  const mon = month.getMonth();
  const todayK = dayKey(new Date());
  const cursorK = dayKey(cursor);

  const startWd = new Date(year, mon, 1).getDay();
  const daysInMonth = new Date(year, mon + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startWd; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, mon, d));
  while (cells.length % 7 !== 0) cells.push(null); // pad to whole weeks (5 or 6 rows)

  const stepMonth = (dir) => onMonthChange(new Date(year, mon + dir, 1));
  const goToday = () => { const t = startOfDay(new Date()); onMonthChange(new Date(t.getFullYear(), t.getMonth(), 1)); onSelect(t); };

  return (
    <div className="cal-panel">
      <div className="cal-panel-hd">
        <div className="cal-panel-ttl">{MONTHS[mon]} {year}</div>
        <div className="cal-mnav">
          <button onClick={() => stepMonth(-1)} aria-label="Previous month"><ChevronLeft size={15} strokeWidth={2.4} /></button>
          <button className="cal-mnav-today" onClick={goToday}>Today</button>
          <button onClick={() => stepMonth(1)} aria-label="Next month"><ChevronRight size={15} strokeWidth={2.4} /></button>
        </div>
      </div>

      <div className="cal-mgrid cal-mwd">
        {WEEKDAYS.map(w => <div key={w} className="cal-mwd-c">{w}</div>)}
      </div>

      <div className="cal-mgrid">
        {cells.map((d, i) => {
          if (!d) return <div key={i} className="cal-mcell cal-mcell-pad" />;
          const k = dayKey(d);
          const items = byDay[k] || [];
          // Up to 3 dots; distinct colours only, so a busy day doesn't smear.
          const dots = [...new Set(items.map(eventColor))].slice(0, 3);
          return (
            <button
              key={i}
              className={`cal-mcell${k === cursorK ? ' on' : ''}${k === todayK ? ' today' : ''}`}
              onClick={() => onSelect(d)}
              aria-label={`${d.getDate()} ${MONTHS[mon]} — ${items.length} appointment${items.length === 1 ? '' : 's'}`}
              aria-pressed={k === cursorK}
            >
              <span className="cal-mnum">{d.getDate()}</span>
              <span className="cal-mdots">
                {dots.map((c, j) => <i key={j} style={{ background: c }} />)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
