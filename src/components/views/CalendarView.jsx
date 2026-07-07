import { useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { getLeads } from '../../lib/db.js';
import Mi from '../Mi.jsx';

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WD_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const HOURS = Array.from({ length: 15 }, (_, i) => 8 + i); // 8 AM – 10 PM

const dayKey = (d) => {
  const x = new Date(d);
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
};
const timeOf = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
const hourLabel = (h) => (h % 12 || 12) + (h < 12 ? ' AM' : ' PM');
const evClass = (e) => e.kind === 'visit' ? 'cal-vis' : (e.off ? 'cal-off' : 'cal-onl');
const evTag = (e) => e.kind === 'visit' ? 'Site visit' : (e.off ? 'Offline' : 'Online');

// Google-style calendar — meetings (online/offline) + site visits. Month + hour-wise Day view.
export default function CalendarView() {
  const { user, setPanLead, dbVersion } = useApp();
  void dbVersion;
  const [mode, setMode] = useState('month');
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; });

  // Build events: a lead may have both a meeting (meetingAt) and a site visit (meetingDate).
  const events = [];
  getLeads(user, { involved: true }).forEach(l => {
    if (l.meetingAt) events.push({ id: l.id + '-m', lead: l, at: l.meetingAt, kind: 'meeting', off: l.meetingType === 'OFFLINE' });
    if (l.meetingDate && ['SITE_VISIT_SCHEDULED', 'SITE_VISIT_DONE'].includes(l.status)) events.push({ id: l.id + '-v', lead: l, at: l.meetingDate, kind: 'visit' });
  });
  const byDay = {};
  events.forEach(e => { (byDay[dayKey(e.at)] ||= []).push(e); });
  Object.values(byDay).forEach(arr => arr.sort((a, b) => new Date(a.at) - new Date(b.at)));

  const year = cursor.getFullYear(), month = cursor.getMonth();
  const todayKey = dayKey(new Date());

  const step = (dir) => { const d = new Date(cursor); if (mode === 'month') d.setMonth(d.getMonth() + dir); else d.setDate(d.getDate() + dir); setCursor(d); };
  const goToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); setCursor(d); };
  const openDay = (d) => { setCursor(new Date(d)); setMode('day'); };

  const title = mode === 'month' ? `${MON[month]} ${year}` : `${WD_FULL[cursor.getDay()]}, ${cursor.getDate()} ${MON[month]} ${year}`;

  const startWd = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startWd; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const dayItems = byDay[dayKey(cursor)] || [];

  return (
    <div className="cal">
      <div className="cal-bar">
        <div className="cal-title">{title}</div>
        <div className="cal-tools">
          <div className="cal-legend">
            <span><i className="cal-dot cal-onl" />Online</span>
            <span><i className="cal-dot cal-off" />Offline</span>
            <span><i className="cal-dot cal-vis" />Site visit</span>
          </div>
          <div className="cal-seg">
            <button className={mode === 'month' ? 'on' : ''} onClick={() => setMode('month')}>Month</button>
            <button className={mode === 'day' ? 'on' : ''} onClick={() => setMode('day')}>Day</button>
          </div>
          <div className="cal-nav">
            <button onClick={() => step(-1)} title="Previous"><Mi>chevron_left</Mi></button>
            <button className="cal-today-btn" onClick={goToday}>Today</button>
            <button onClick={() => step(1)} title="Next"><Mi>chevron_right</Mi></button>
          </div>
        </div>
      </div>

      {mode === 'month' ? (
        <>
          <div className="cal-grid cal-head">{WD.map(w => <div key={w} className="cal-wd">{w}</div>)}</div>
          <div className="cal-grid cal-body">
            {cells.map((d, i) => {
              if (!d) return <div key={i} className="cal-cell cal-empty" />;
              const k = dayKey(d);
              const items = byDay[k] || [];
              return (
                <div key={i} className={`cal-cell${k === todayKey ? ' cal-on-today' : ''}`} onClick={() => openDay(d)}>
                  <div className="cal-dnum">{d.getDate()}</div>
                  <div className="cal-events">
                    {items.slice(0, 3).map(e => (
                      <button key={e.id} className={`cal-ev ${evClass(e)}`}
                        onClick={(ev) => { ev.stopPropagation(); setPanLead(e.lead.id); }} title={`${e.lead.name} · ${timeOf(e.at)} · ${evTag(e)}`}>
                        <span className="cal-ev-t">{timeOf(e.at)}</span>
                        <span className="cal-ev-n">{e.lead.name}</span>
                      </button>
                    ))}
                    {items.length > 3 && <div className="cal-more">+{items.length - 3} more</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="cal-day">
          {dayItems.length === 0 && <div className="cal-day-empty"><Mi>event_available</Mi>No meetings or visits this day.</div>}
          {HOURS.map(h => {
            const slot = dayItems.filter(e => new Date(e.at).getHours() === h);
            return (
              <div key={h} className="cal-hr">
                <div className="cal-hr-l">{hourLabel(h)}</div>
                <div className="cal-hr-lane">
                  {slot.map(e => (
                    <button key={e.id} className={`cal-blk ${evClass(e)}`} onClick={() => setPanLead(e.lead.id)}>
                      <span className="cal-blk-t">{timeOf(e.at)} · {evTag(e)}</span>
                      <span className="cal-blk-n">{e.lead.name}</span>
                      {e.lead.propertyInterest && <span className="cal-blk-p">{e.lead.propertyInterest}</span>}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
