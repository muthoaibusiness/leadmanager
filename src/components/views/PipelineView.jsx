import { useState } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import {
  getLeads, getPipelines, leadStageId, moveLead, getActs,
  addStage, renameStage, deleteStage,
} from '../../lib/db.js';
import { fmtD, fmtBDT, scoreLead, scoreLabel } from '../../lib/helpers.js';

// Deal value from a forwarded offer (OFFER activity), falling back to budget.
function dealValueOf(lead, acts) {
  const offer = (acts || []).find(a => a.type === 'OFFER');
  if (offer) { try { const o = JSON.parse(offer.description); return o.pipelineValue || o.clientOffer || lead.budget || 0; } catch { /* ignore */ } }
  return lead.budget || 0;
}

// Leads that have dropped out of the funnel are hidden from the board.
const HIDDEN = ['DEAL_CLOSED_LOST', 'NOT_INTERESTED'];

export default function PipelineView() {
  const { user, refreshDB, showToast, setPanLead, dbVersion } = useApp();
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
      <div className="pk-toolbar">
        <div className="pk-hint"><Mi>drag_indicator</Mi>Drag a card to move it · click a stage title to rename</div>
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
        {pipeline.stages.map(s => (
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
                    <div className="pk-card-id">
                      <div className="pk-name">{l.name}</div>
                      <div className="pk-meta">{l.dealProjectName || l.propertyInterest || l.company || '—'}</div>
                    </div>
                    <span className="pk-score" style={{ color: sl.color, background: sl.bg }} title={`${sl.label} lead · score ${score}`}>{score}</span>
                  </div>
                  {l.phone && (
                    <a className="pk-phone" href={`tel:${l.phone}`} onClick={e => e.stopPropagation()}>
                      <Mi>call</Mi>{l.phone}
                    </a>
                  )}
                  <div className="pk-card-ft">
                    <span className="pk-val">{dealVal ? fmtBDT(dealVal) : '—'}</span>
                    <span className="pk-date">{fmtD(l.updatedAt)}</span>
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
