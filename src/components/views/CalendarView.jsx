import { useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import SummaryCards from './calendar/SummaryCards.jsx';
import MonthCalendar from './calendar/MonthCalendar.jsx';
import DaySchedule from './calendar/DaySchedule.jsx';
import UpcomingList from './calendar/UpcomingList.jsx';
import { buildEvents, groupByDay, dayKey, startOfDay } from './calendar/events.js';

// Dashboard-style calendar: day metrics, month grid + day schedule, then a
// 30-day look-ahead. `cursor` (selected day) lives here and flows down; `month`
// tracks which month the grid is browsing so paging away doesn't move the
// selection.
export default function CalendarView() {
  const { user, setPanLead, dbVersion } = useApp();
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });

  // Built fresh each render: buildEvents reads the mutable in-memory DB, which
  // React can't track — dbVersion is the app's signal that it changed. The data
  // is a small in-memory array, so recomputing beats risking a stale cache.
  void dbVersion;
  const events = buildEvents(user);
  const byDay = groupByDay(events);

  const dayEvents = byDay[dayKey(cursor)] || [];
  const isToday = dayKey(cursor) === dayKey(new Date());

  // Next 30 days, from right now (so today's already-passed slots drop off).
  const upcomingTo = startOfDay(new Date());
  upcomingTo.setDate(upcomingTo.getDate() + 30);
  upcomingTo.setHours(23, 59, 59, 999);
  const now = new Date();
  const upcoming = events.filter(e => { const t = new Date(e.at); return t >= now && t <= upcomingTo; });

  const selectDay = (d) => {
    const day = startOfDay(d);
    setCursor(day);
    setMonth(new Date(day.getFullYear(), day.getMonth(), 1));
  };

  // Prev/next day. Goes through selectDay so stepping across a month boundary
  // pages the grid with it and the selected cell stays visible.
  const stepDay = (dir) => {
    const d = new Date(cursor);
    d.setDate(d.getDate() + dir);
    selectDay(d);
  };

  return (
    <div className="cal2">
      <SummaryCards dayEvents={dayEvents} isToday={isToday} />

      <div className="cal-split">
        <MonthCalendar
          cursor={cursor}
          month={month}
          byDay={byDay}
          onSelect={selectDay}
          onMonthChange={setMonth}
        />
        <DaySchedule
          cursor={cursor}
          dayEvents={dayEvents}
          isToday={isToday}
          onStepDay={stepDay}
          onOpenLead={setPanLead}
        />
      </div>

      <UpcomingList events={upcoming} onOpenLead={setPanLead} />
    </div>
  );
}
