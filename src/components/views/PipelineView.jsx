import { useState } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import {
  getLeads, getPipelines, leadStageId, moveLead, getActs,
  addStage, renameStage, deleteStage,
} from '../../lib/db.js';
import { fmtD, fmtBDT, scoreLead, scoreLabel } from '../../lib/helpers.js';
import { successRate } from '../../lib/successRate.js';
import { TickGauge } from '../SuccessGauge.jsx';

// Deal value from a forwarded offer (OFFER activity), falling back to budget.
function dealValueOf(lead, acts) {
  const offer = (acts || []).find(a => a.type === 'OFFER');
  if (offer) { try { const o = JSON.parse(offer.description); return o.pipelineValue || o.clientOffer || lead.budget || 0; } catch { /* ignore */ } }
  return lead.budget || 0;
}

// Leads that have dropped out of the funnel are hidden from the board.
const HIDDEN = ['DEAL_CLOSED_LOST', 'NOT_INTERESTED'];

export default function PipelineView() {
  const { user, refreshDB, showToast, setPanLead, dbVersion, nav } = useApp();
  void dbVersion; // re-render when the DB changes

  const pipelines = getPipelines();
  const pipeline = pipelines[0];

  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  if (!pipeline) return null;

  const leads = getLeads(user).filter(l => !HIDDEN.includes(l.status));
  const cols = {};
  pipeline.stages.forEach(s => { cols[s.id] = []; });
  leads.forEach(l => {
    const sid = leadStageId(pipeline, l);
    if (cols[sid]) cols[sid].push(l);
  });

  // Project demand — how many leads on this board are interested in each project
  const demand = {};
  leads.forEach(l => { const k = l.dealProjectName || l.propertyInterest; if (k) demand[k] = (demand[k] || 0) + 1; });
  const demandTop = Object.entries(demand).sort((a, b) => b[1] - a[1]).slice(0, 8);

  // ── Summary stats strip (real data) ──
  const allMine = getLeads(user);
  // IA/MA are measured over every lead they ever touched (assigned or forwarded on).
  const involved = getLeads(user, { involved: true });
  const succ = successRate(user, allMine, involved);
  const inProgress = leads.length; // active deals on the board
  const pipelineValue = leads.reduce((s, l) => s + dealValueOf(l, getActs(l.id)), 0);
  const NEW_DAYS = 14;
  const newDays = Array.from({ length: NEW_DAYS }, (_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (NEW_DAYS - 1 - i)); return d; });
  const newSeries = newDays.map(d => {
    const nx = new Date(d); nx.setDate(nx.getDate() + 1);
    return allMine.filter(l => { const c = new Date(l.createdAt); return c >= d && c < nx; }).length;
  });
  const newTotal = newSeries.reduce((a, b) => a + b, 0);
  const maxNew = Math.max(...newSeries, 1);

  const onDrop = (stageId) => {
    const id = drag;
    setDrag(null); setOver(null);
    if (!id) return;
    const lead = leads.find(l => l.id === id);
    if (!lead || leadStageId(pipeline, lead) === stageId) return;
    moveLead(pipeline, id, stageId, user);
    refreshDB();
    const st = pipeline.stages.find(s => s.id === stageId);
    showToast(`${lead.name} → ${st?.name}`, 'ok');
  };

  // ── stage editing ──
  const addStg = () => { const n = window.prompt('New stage name'); if (n === null) return; addStage(pipeline.id, n); refreshDB(); };
  const renStg = (s) => { const n = window.prompt('Rename stage', s.name); if (n) { renameStage(pipeline.id, s.id, n); refreshDB(); } };
  const delStg = (s) => {
    if (pipeline.stages.length <= 1) { showToast('Keep at least one stage', ''); return; }
    if (!window.confirm(`Delete stage "${s.name}"?`)) return;
    deleteStage(pipeline.id, s.id); refreshDB();
  };

  return (
    <div className="pk-wrap">
      {/* Summary strip — new customers · win rate · in-progress · pipeline value */}
      <div className="pks">
        <div className="pks-chart">
          <div className="pks-ttl">New customers <span className="pks-ttl-sub">· {newTotal} in 14 days</span></div>
          <div className="pks-bars">
            {newSeries.map((v, i) => (
              <div key={i} className="pks-col">
                <div className="pks-bar-wrap"><div className={`pks-bar${v === 0 ? ' empty' : ''}`} style={{ height: Math.max(3, v / maxNew * 100) + '%' }} title={`${v} on ${newDays[i].toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`} /></div>
                {(i % 2 === 0 || i === newSeries.length - 1) && <span className="pks-bar-lbl">{newDays[i].getDate()}</span>}
              </div>
            ))}
          </div>
        </div>
        <div className="pks-gauge">
          <TickGauge pct={succ.pct} label={`${succ.label} · ${succ.n}/${succ.d}`} />
        </div>
        <button className="pks-stat" onClick={() => nav('leads')}>
          <div className="pks-num">{inProgress}</div>
          <div className="pks-stat-ft"><span className="pks-lbl">Deals in progress</span><Mi>arrow_forward</Mi></div>
        </button>
        <button className="pks-stat" onClick={() => nav('leads')}>
          <div className="pks-num">{fmtBDT(pipelineValue)}</div>
          <div className="pks-stat-ft"><span className="pks-lbl">Pipeline value</span><Mi>arrow_forward</Mi></div>
        </button>
      </div>

      {demandTop.length > 0 && (
        <div className="pk-demand">
          <span className="pk-demand-hd"><Mi>apartment</Mi>Project demand</span>
          {demandTop.map(([name, n]) => (
            <span key={name} className="pk-demand-chip">{name}<b>{n}</b></span>
          ))}
        </div>
      )}

      <div className="pk-board">
        {pipeline.stages.map((s, si) => (
          <div
            key={s.id}
            className={`pk-col${over === s.id ? ' over' : ''}`}
            onDragOver={e => { e.preventDefault(); if (over !== s.id) setOver(s.id); }}
            onDragLeave={() => setOver(o => (o === s.id ? null : o))}
            onDrop={() => onDrop(s.id)}
          >
            <div className="pk-col-hd">
              <span className="pk-dot" style={{ background: s.color }} />
              <button className="pk-col-name" onClick={() => renStg(s)} title="Rename stage">{s.name}</button>
              <span className="pk-col-ct">{cols[s.id].length}</span>
              <button className="pk-col-del" onClick={() => delStg(s)} title="Delete stage"><Mi>close</Mi></button>
            </div>
            <div className="pk-col-body">
              {cols[s.id].map(l => {
                const acts = getActs(l.id);
                const score = scoreLead(l, acts);
                const sl = scoreLabel(score);
                const dealVal = dealValueOf(l, acts);
                const msgCount = acts.length; // total activity log entries
                const matCount = acts.filter(a => a.type === 'OFFER').length; // materials / offers sent
                return (
                <div
                  key={l.id}
                  className={`pk-card${drag === l.id ? ' dragging' : ''}`}
                  draggable
                  onDragStart={() => setDrag(l.id)}
                  onDragEnd={() => { setDrag(null); setOver(null); }}
                  onClick={() => setPanLead(l.id)}
                >
                  <div className="pk-card-top">
                    <div className="pk-name">{l.name}</div>
                    <span className={`pk-mx pk-score-sm${si >= 1 ? ' glow' : ''}`} style={{ color: s.color }} title={`${sl.label} lead · score ${score} · ${s.name}`}><Mi>bolt</Mi>{score}</span>
                  </div>
                  <div className="pk-desc">{l.dealProjectName || l.propertyInterest || l.company || '—'}</div>
                  <div className="pk-card-ft">
                    <span className="pk-chip"><Mi>event</Mi>{fmtD(l.updatedAt)}</span>
                    {dealVal > 0 && <span className="pk-mx"><Mi>payments</Mi>{fmtBDT(dealVal)}</span>}
                    <span className="pk-mx" style={{ marginLeft: 'auto' }} title={`${msgCount} activities`}><Mi>chat_bubble</Mi>{msgCount}</span>
                    <span className="pk-mx" title={`${matCount} materials sent`}><Mi>attach_file</Mi>{matCount}</span>
                  </div>
                </div>
                );
              })}
              {cols[s.id].length === 0 && <div className="pk-empty">Drop here</div>}
            </div>
          </div>
        ))}
        <button className="pk-addcol" onClick={addStg}><Mi>add</Mi>Add stage</button>
      </div>
    </div>
  );
}
