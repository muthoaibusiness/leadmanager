import { useState } from 'react';
import Mi from '../Mi.jsx';

// One modal for every item kind. The body is edited as typed fields for the
// common kinds and as JSON for projects (their media lists are long); the
// server validates the schema either way and returns field errors.
const FIELDS = {
  fact: [['topic', 'Topic'], ['text', 'Fact', 'area'], ['source', 'Source (brochure, management, website)']],
  rule: [['name', 'Name'], ['when', 'When', 'area'], ['must', 'Must', 'area'], ['must_not', 'Must not', 'area']],
  behaviour: [['aspect', 'Aspect (tone, language, greeting, discovery, pricing, objection, meeting, handoff)'], ['instruction', 'Instruction', 'area']],
  example: [['ideal_reply', 'Ideal reply', 'area'], ['reason', 'Why this is right', 'area'], ['original_reply', 'Original (wrong) reply', 'area']],
};
const NEW_BODY = {
  fact: { topic: '', text: '' }, rule: { name: '', when: '', must: '' }, behaviour: { aspect: 'tone', instruction: '' },
  example: { conversation: [{ role: 'customer', text: '' }], ideal_reply: '', reason: '', source: 'handwritten' },
  project: { name: '', aliases: { bn: [], banglish: [], en: [] }, media: { photos: [], floor_plans: [] } },
};
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v !== undefined));

export default function ItemEditor({ kind, initial, projects, onClose, onSaved, api, showToast }) {
  const [body, setBody] = useState(() => initial?.body || NEW_BODY[kind]);
  const [json, setJson] = useState(() => JSON.stringify(initial?.body || NEW_BODY[kind], null, 2));
  const [bots, setBots] = useState(() => initial?.bots || ['eyad', 'dubai']);
  const [projectRef, setProjectRef] = useState(initial?.project_ref || '');
  const [errors, setErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  const scoped = kind === 'fact' || kind === 'rule' || kind === 'example';
  const toggleBot = (b) => setBots(v => (v.includes(b) ? v.filter(x => x !== b) : [...v, b]));

  const save = async () => {
    let b = body;
    if (kind === 'project') { try { b = JSON.parse(json); } catch { setErrors(['Body is not valid JSON']); return; } }
    if (kind === 'example' && typeof b.customer_text === 'string') {
      const { customer_text, ...rest } = b;
      b = { ...rest, conversation: [{ role: 'customer', text: customer_text }] };
    }
    setSaving(true); setErrors([]);
    const payload = { kind, bots, project_ref: scoped && projectRef ? projectRef : null, body: kind === 'project' ? b : clean(b) };
    try {
      if (initial) await api('items.update', { ...payload, id: initial.id, revision: initial.revision });
      else await api('items.create', payload);
      showToast('Saved as a draft. Live bots are not affected until you publish.', 'ok');
      onSaved(); onClose();
    } catch (e) {
      setErrors(Array.isArray(e.details) ? e.details : [e.message]);
    } finally { setSaving(false); }
  };

  return (
    <div className="mov on" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 640 }}>
        <div className="m-hd">
          <div className="m-ttl">{initial ? `Edit ${kind}` : `New ${kind}`}</div>
          <button className="m-x" onClick={onClose} aria-label="Close"><Mi>close</Mi></button>
        </div>
        <div className="m-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {kind === 'project' ? (
            <div className="fg"><label>Project (JSON)</label><textarea className="fi" rows={16} value={json} onChange={e => setJson(e.target.value)} spellCheck={false} /></div>
          ) : (
            <>
              {kind === 'example' && (
                <div className="fg"><label>Customer message</label>
                  <textarea className="fi" rows={2} value={body.customer_text ?? body.conversation?.at(-1)?.text ?? ''} onChange={e => setBody(v => ({ ...v, customer_text: e.target.value }))} /></div>
              )}
              {FIELDS[kind].map(([k, l, t]) => (
                <div className="fg" key={k}><label>{l}</label>
                  {t === 'area'
                    ? <textarea className="fi" rows={3} value={body[k] || ''} onChange={e => setBody(v => ({ ...v, [k]: e.target.value }))} />
                    : <input className="fi" value={body[k] || ''} onChange={e => setBody(v => ({ ...v, [k]: e.target.value }))} />}
                </div>
              ))}
            </>
          )}
          <div className="ea-row" style={{ gap: 16 }}>
            <span>Bots:</span>
            {['eyad', 'dubai'].map(b => (
              <label key={b} style={{ display: 'inline-flex', gap: 6 }}><input type="checkbox" checked={bots.includes(b)} onChange={() => toggleBot(b)} />{b}</label>
            ))}
          </div>
          {scoped && (
            <div className="fg"><label>Project</label>
              <select className="fi" value={projectRef} onChange={e => setProjectRef(e.target.value)}>
                <option value="">Company-wide</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.body.name}</option>)}
              </select>
            </div>
          )}
          {errors.length > 0 && <ul className="ait-err" role="alert">{errors.map(e => <li key={e}>{e}</li>)}</ul>}
        </div>
        <div className="m-ft">
          <button className="btn btn-g" onClick={onClose}>Cancel</button>
          <button className="btn btn-p" disabled={saving || bots.length === 0} onClick={save}>{saving ? 'Saving…' : 'Save draft'}</button>
        </div>
      </div>
    </div>
  );
}
