import { useState, useRef, useEffect } from 'react';
import Mi from './Mi.jsx';
import { useApp } from '../context/AppContext.jsx';
import { getPresetRange, DATE_PRESETS as PRESETS } from '../lib/datePresets.js';

const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const DAYS   = ['S','M','T','W','T','F','S'];

function startOf(d) { const x=new Date(d); x.setHours(0,0,0,0); return x; }
function endOf(d)   { const x=new Date(d); x.setHours(23,59,59,999); return x; }
function sameDay(a,b){ return a&&b&&a.toDateString()===b.toDateString(); }
function inRange(d,s,e){ return d&&s&&e&&d>=s&&d<=e; }
function fmtLabel(d){ return d?d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):''; }
function fmtShort(d){ return d?d.toLocaleDateString('en-US',{month:'short',day:'numeric'}):''; }

function CalMonth({ year, month, selStart, selEnd, hover, selecting, onDay, onHover }) {
  const first = new Date(year, month, 1).getDay();
  const total = new Date(year, month+1, 0).getDate();
  const cells = [];
  for (let i=0; i<first; i++) cells.push(null);
  for (let d=1; d<=total; d++) cells.push(new Date(year, month, d));

  const rangeEnd = hover && selecting==='end' && selStart ? (hover>selStart?hover:selStart) : selEnd;
  const rangeStart = hover && selecting==='end' && selStart && hover<selStart ? hover : selStart;

  return (
    <div className="drp-cal">
      <div className="drp-cal-hd">{MONTHS[month]} {year}</div>
      <div className="drp-cal-grid">
        {DAYS.map((d,i)=><div key={i} className="drp-day-name">{d}</div>)}
        {cells.map((d,i)=>{
          if(!d) return <div key={'e'+i} />;
          const isStart = sameDay(d,selStart);
          const isEnd   = sameDay(d,selEnd) || (selecting==='end'&&sameDay(d,hover)&&hover&&selStart&&hover>selStart);
          const isMid   = !isStart&&!isEnd&&inRange(d,rangeStart,rangeEnd);
          const isToday = sameDay(d,new Date());
          let cls='drp-day';
          if(isStart) cls+=' drp-start';
          if(isEnd)   cls+=' drp-end';
          if(isMid)   cls+=' drp-mid';
          if(isToday&&!isStart&&!isEnd) cls+=' drp-today';
          return (
            <div key={i} className={cls}
              onClick={()=>onDay(d)}
              onMouseEnter={()=>onHover(d)}
            ><span>{d.getDate()}</span></div>
          );
        })}
      </div>
    </div>
  );
}

export default function DateRangePicker() {
  const { dateRange, setDateRange } = useApp();
  const [open, setOpen]           = useState(false);
  const [preset, setPreset]       = useState(dateRange?.preset || 'allTime');
  const [selStart, setSelStart]   = useState(dateRange?.range?.start || null);
  const [selEnd, setSelEnd]       = useState(dateRange?.range?.end || null);
  const [selecting, setSelecting] = useState('start');
  const [hover, setHover]         = useState(null);
  const [leftYear, setLeftYear]   = useState(()=>{ const d=new Date(); return d.getFullYear(); });
  const [leftMonth, setLeftMonth] = useState(()=>{ const d=new Date(); return d.getMonth()-1<0?11:d.getMonth()-1; });
  const ref = useRef();

  // sync left month when opening
  function toggle() {
    if(!open){
      const now=new Date();
      setLeftMonth(now.getMonth()===0?11:now.getMonth()-1);
      setLeftYear(now.getMonth()===0?now.getFullYear()-1:now.getFullYear());
    }
    setOpen(!open);
  }

  // close on outside click
  useEffect(()=>{
    if(!open) return;
    const h=e=>{ if(ref.current&&!ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown',h);
    return ()=>document.removeEventListener('mousedown',h);
  },[open]);

  const rightMonth = leftMonth===11?0:leftMonth+1;
  const rightYear  = leftMonth===11?leftYear+1:leftYear;

  function prevMonth(){ if(leftMonth===0){setLeftMonth(11);setLeftYear(y=>y-1);}else setLeftMonth(m=>m-1); }
  function nextMonth(){ if(leftMonth===11){setLeftMonth(0);setLeftYear(y=>y+1);}else setLeftMonth(m=>m+1); }

  function selectPreset(key) {
    setPreset(key);
    if(key==='custom'){ setSelStart(null);setSelEnd(null);setSelecting('start'); return; }
    const r=getPresetRange(key);
    if(r){ setSelStart(r.start);setSelEnd(r.end); }
    else { setSelStart(null);setSelEnd(null); }
  }

  function onDay(d) {
    if(preset!=='custom') setPreset('custom');
    if(selecting==='start'||!selStart){ setSelStart(startOf(d)); setSelEnd(null); setSelecting('end'); }
    else {
      if(d<selStart){ setSelStart(startOf(d)); setSelEnd(endOf(selStart)); }
      else { setSelEnd(endOf(d)); }
      setSelecting('start');
    }
  }

  function apply() {
    const r = preset==='custom' ? (selStart&&selEnd?{start:selStart,end:selEnd}:null) : getPresetRange(preset);
    setDateRange({ preset, range: r });
    setOpen(false);
  }

  function cancel() { setOpen(false); }

  // trigger label
  const active = dateRange?.preset||'allTime';
  const activeLabel = PRESETS.find(p=>p.key===active)?.label||'All time';
  const r = dateRange?.range;
  const rangeLabel = r ? `${fmtShort(r.start)} – ${fmtShort(r.end)}` : '';

  return (
    <div className="drp-wrap" ref={ref}>
      {/* Header icon button: the calendar alone. The active filter is in the
          tooltip / label, and a dot marks any filter other than All time. */}
      <button type="button" className={`hd-ic drp-trigger${open?' open':''}`} onClick={toggle}
        title={`Date filter: ${activeLabel}${rangeLabel ? ` (${rangeLabel})` : ''}`}
        aria-label={`Date filter: ${activeLabel}${rangeLabel ? `, ${rangeLabel}` : ''}`} aria-expanded={open}>
        <Mi aria-hidden="true">calendar_month</Mi>
        {active !== 'allTime' && <span className="drp-dot" aria-hidden="true" />}
      </button>

      {open && (
        <div className="drp-panel">
          {/* left: preset list */}
          <div className="drp-presets">
            {PRESETS.map(p=>(
              <div key={p.key} data-key={p.key} className={`drp-preset${preset===p.key?' on':''}`} onClick={()=>selectPreset(p.key)}>
                {p.label}
              </div>
            ))}
          </div>

          {/* right: date inputs + dual calendar */}
          <div className="drp-right">
            <div className="drp-inputs">
              <div className={`drp-inp${selecting==='start'?' active':''}`} onClick={()=>setSelecting('start')}>
                <span className="drp-inp-lbl">Start date</span>
                <span className="drp-inp-val">{selStart?fmtLabel(selStart):'—'}</span>
              </div>
              <span className="drp-inp-sep">–</span>
              <div className={`drp-inp${selecting==='end'?' active':''}`} onClick={()=>setSelecting('end')}>
                <span className="drp-inp-lbl">End date</span>
                <span className="drp-inp-val">{selEnd?fmtLabel(selEnd):'—'}</span>
              </div>
            </div>

            <div className="drp-cals">
              <div className="drp-cal-nav">
                <button onClick={prevMonth}><Mi>chevron_left</Mi></button>
              </div>
              <CalMonth year={leftYear} month={leftMonth} selStart={selStart} selEnd={selEnd} hover={hover} selecting={selecting} onDay={onDay} onHover={setHover} />
              <CalMonth year={rightYear} month={rightMonth} selStart={selStart} selEnd={selEnd} hover={hover} selecting={selecting} onDay={onDay} onHover={setHover} />
              <div className="drp-cal-nav">
                <button onClick={nextMonth}><Mi>chevron_right</Mi></button>
              </div>
            </div>

            <div className="drp-footer">
              <button className="btn btn-g" onClick={cancel}>Cancel</button>
              <button className="btn btn-p" onClick={apply}>Apply</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
