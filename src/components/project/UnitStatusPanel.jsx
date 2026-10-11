import { useId, useState } from 'react';
import Mi from '../Mi.jsx';
import { uid } from '../../lib/helpers.js';
import { STATUS } from '../../lib/floorPlan.js';
import { editUnitStatuses } from '../../lib/projects.js';
import { Select, SelectLabel, SelectTrigger, SelectValue, SelectPopover, SelectListBox, SelectItem } from '../ui/select.jsx';

// The project's own unit statuses (Management, in the floor plan editor): a
// name, a colour, and the base status it counts as. Saved straight to the
// project row (editUnitStatuses), not with the plan, and synced to every
// viewer through the properties realtime channel.
//
//   statuses   the project's list now
//   editing    'list' | 'new' | a status id
//   onEditing  (editing | null) => void — null closes the panel
//   onSaved    (status | null) => void — the status created / edited, null on delete
//   inUse      (id) => number of units tagged with it

const BASES = ['available', 'hold', 'sold'];
const SWATCHES = ['#7C3AED', '#2563EB', '#0EA5E9', '#14B8A6', '#F97316', '#DB2777', '#64748B'];

export default function UnitStatusPanel({ projectId, statuses, editing, onEditing, onSaved, inUse, toast, refreshDB }) {
  const fid = useId();
  const cur = editing !== 'list' && editing !== 'new' ? statuses.find(s => s.id === editing) : null;
  const [name, setName] = useState(cur?.name || '');
  const [color, setColor] = useState(cur?.color || SWATCHES[0]);
  const [base, setBase] = useState(cur?.base || 'available');
  const [busy, setBusy] = useState(false);

  const clean = name.trim();
  const clash = statuses.some(s => s.id !== cur?.id && s.name.trim().toLowerCase() === clean.toLowerCase())
    || BASES.some(b => STATUS[b].label.toLowerCase() === clean.toLowerCase());

  const save = async () => {
    if (!clean || clash || busy) return;
    setBusy(true);
    const next = cur ? { ...cur, name: clean, color, base } : { id: 'st' + uid(), name: clean, color, base };
    const res = await editUnitStatuses(projectId, list => (cur ? list.map(s => (s.id === cur.id ? next : s)) : [...list, next]));
    setBusy(false);
    if (!res.ok) { toast.error('Status not saved', `${res.error}.`); return; }
    refreshDB();
    toast.success(cur ? 'Status updated' : 'Status created', `${next.name} · counts as ${STATUS[base].label.toLowerCase()}.`);
    onSaved(next);
  };

  const remove = (s) => {
    const n = inUse(s.id);
    toast.confirm({
      title: `Delete "${s.name}"?`,
      description: n ? `${n} unit${n > 1 ? 's' : ''} will show ${STATUS[s.base].label.toLowerCase()} again.` : 'No unit uses it.',
      confirmLabel: 'Delete',
      onConfirm: async () => {
        const res = await editUnitStatuses(projectId, list => list.filter(x => x.id !== s.id));
        if (!res.ok) { toast.error('Status not deleted', `${res.error}.`); return; }
        refreshDB();
        onSaved(null);
      },
    });
  };

  if (editing === 'list') {
    return (
      <div className="usp">
        {statuses.map(s => (
          <div key={s.id} className="usp-row">
            <i className="fp-dot" style={{ background: s.color }} />
            <span className="usp-name">{s.name}</span>
            <span className="usp-base">{STATUS[s.base].label}</span>
            <button type="button" className="usp-ic" onClick={() => onEditing(s.id)} aria-label={`Edit ${s.name}`} title="Edit"><Mi>edit</Mi></button>
            <button type="button" className="usp-ic usp-del" onClick={() => remove(s)} aria-label={`Delete ${s.name}`} title="Delete"><Mi>delete</Mi></button>
          </div>
        ))}
        <div className="usp-acts">
          <button type="button" className="btn btn-g btn-sm" onClick={() => onEditing(null)}>Done</button>
          <button type="button" className="btn btn-g btn-sm" onClick={() => onEditing('new')}><Mi>add</Mi>New status</button>
        </div>
      </div>
    );
  }

  return (
    <div className="usp usp-form">
      <label className="fpe-f" htmlFor={`${fid}name`}><span>Status name</span></label>
      <input id={`${fid}name`} name="status-name" className="usp-in" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Reserved" maxLength={24} autoFocus
        aria-invalid={clash ? 'true' : undefined} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save(); } }} />
      {clash && <div className="fpe-fe">{clean} is already a status.</div>}
      <div className="fpe-f"><span>Colour</span></div>
      <div className="usp-colors" role="group" aria-label="Colour">
        {SWATCHES.map(c => (
          <button key={c} type="button" className={`usp-sw${c.toLowerCase() === color.toLowerCase() ? ' on' : ''}`} style={{ background: c }}
            onClick={() => setColor(c)} aria-label={c} aria-pressed={c.toLowerCase() === color.toLowerCase()} />
        ))}
        <input type="color" name="status-color" className="usp-pick" value={color} onChange={e => setColor(e.target.value)} aria-label="Pick any colour" title="Pick any colour" />
      </div>
      <Select className="usp-base-sel" value={base} onChange={setBase} name="status-base">
        <SelectLabel>Counts as</SelectLabel>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectPopover>
          <SelectListBox>
            {BASES.map(b => <SelectItem key={b} value={b}><i className={`fp-dot st-${b}`} />{STATUS[b].label}</SelectItem>)}
          </SelectListBox>
        </SelectPopover>
      </Select>
      <div className="usp-hint">Counts, holds and reports treat it as {STATUS[base].label.toLowerCase()}.</div>
      <div className="usp-acts">
        <button type="button" className="btn btn-g btn-sm" onClick={() => onEditing(statuses.length ? 'list' : null)} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-p btn-sm" onClick={save} disabled={!clean || clash || busy}>
          <Mi>check</Mi>{busy ? 'Saving…' : cur ? 'Save status' : 'Create status'}
        </button>
      </div>
    </div>
  );
}
