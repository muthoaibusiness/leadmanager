import { useState, useRef, useEffect } from 'react';
import Mi from './Mi.jsx';
import { useApp } from '../context/AppContext.jsx';

const PRESETS = [
  { key: 'custom',    label: 'Custom' },
  { key: 'today',     label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last7',     label: 'Last 7 days' },
  { key: 'last28',    label: 'Last 28 days' },
  { key: 'last30',    label: 'Last 30 days' },
  { key: 'thisMonth', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: 'last90',    label: 'Last 90 days' },
  { key: 'qtd',       label: 'Quarter to date' },
  { key: 'thisYear',  label: 'This year (Jan – Today)' },
  { key: 'lastYear',  label: 'Last calendar year' },
  { key: 'allTime',   label: 'All time' },
];

const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const DAYS   = ['S','M','T','W','T','F','S'];

function startOf(d) { const x=new Date(d); x.setHours(0,0,0,0); return x; }
function endOf(d)   { const x=new Date(d); x.setHours(23,59,59,999); return x; }
function sameDay(a,b){ return a&&b&&a.toDateString()===b.toDateString(); }
function inRange(d,s,e){ return d&&s&&e&&d>=s&&d<=e; }
function fmtLabel(d){ return d?d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):''; }
function fmtShort(d){ return d?d.toLocaleDateString('en-US',{month:'short',day:'numeric'}):''; }

export function getPresetRange(key) {
  const t = startOf(new Date());
  switch(key) {
    case 'today':     return { start: startOf(t), end: endOf(t) };
    case 'yesterday': { const d=new Date(t); d.setDate(d.getDate()-1); return { start: startOf(d), end: endOf(d) }; }
    case 'last7':     { const s=new Date(t); s.setDate(s.getDate()-6); return { start: startOf(s), end: endOf(t) }; }
    case 'last28':    { const s=new Date(t); s.setDate(s.getDate()-27); return { start: startOf(s), end: endOf(t) }; }
    case 'last30':    { const s=new Date(t); s.setDate(s.getDate()-29); return { start: startOf(s), end: endOf(t) }; }
    case 'thisMonth': { const s=new Date(t); s.setDate(1); return { start: startOf(s), end: endOf(t) }; }
    case 'lastMonth': { const s=new Date(t); s.setDate(1); s.setMonth(s.getMonth()-1); const e=new Date(t); e.setDate(0); return { start: startOf(s), end: endOf(e) }; }
    case 'last90':    { const s=new Date(t); s.setDate(s.getDate()-89); return { start: startOf(s), end: endOf(t) }; }
    case 'qtd':       { const s=new Date(t); s.setMonth(Math.floor(s.getMonth()/3)*3); s.setDate(1); return { start: startOf(s), end: endOf(t) }; }
    case 'thisYear':  { const s=new Date(t); s.setMonth(0); s.setDate(1); return { start: startOf(s), end: endOf(t) }; }
    case 'lastYear':  { const s=new Date(t); s.setFullYear(s.getFullYear()-1); s.setMonth(0); s.setDate(1); const e=new Date(t); e.setMonth(0); e.setDate(0); return { start: startOf(s), end: endOf(e) }; }
    case 'allTime':   return null;
    default:          return null;
  }
}

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
  useEffect(()=>{
    if(!open) return;
    const now=new Date();
    setLeftMonth(now.getMonth()===0?11:now.getMonth()-1);
    setLeftYear(now.getMonth()===0?now.getFullYear()-1:now.getFullYear());
  },[open]);

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
      <button className={`drp-trigger${open?' open':''}`} onClick={()=>setOpen(o=>!o)}>
        <Mi>date_range</Mi>
        <span className="drp-trigger-preset">{activeLabel}</span>
        {rangeLabel && <span className="drp-trigger-range">{rangeLabel}</span>}
        <Mi>arrow_drop_down</Mi>
      </button>

      {open && (
        <div className="drp-panel">
          {/* left: preset list */}
          <div className="drp-presets">
            {PRESETS.map(p=>(
              <div key={p.key} className={`drp-preset${preset===p.key?' on':''}`} onClick={()=>selectPreset(p.key)}>
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
