import { useState } from 'react';
import Mi from '../Mi.jsx';
import ItemEditor from './ItemEditor.jsx';
import ItemList from './ItemList.jsx';
import { useItems } from './useItems.js';

// Projects, facts and rules. Everything here is a draft until published from
// Quality & Publish. The legacy import copies wa_projects, wa_knowledge and
// wa_message_corrections into drafts, one reviewed row at a time; the legacy
// tables are never changed.
function ImportWizard({ api, showToast, onDone }) {
  const [rows, setRows] = useState(null);
  const [decide, setDecide] = useState({});
  const [report, setReport] = useState(null);
  const load = async () => {
    try {
      const d = await api('import.preview');
      setRows(d.rows);
      setDecide(Object.fromEntries(d.rows.map((r, n) => [n, r.status === 'ready' ? 'import' : 'reject'])));
    } catch (e) { showToast(e.message, 'err'); }
  };
  const commit = async () => {
    const decisions = rows.map((r, n) => ({ ref: { source: r.source, source_id: r.source_id }, decision: decide[n], item: r.proposed,
      reason: decide[n] === 'reject' ? (r.status === 'duplicate' ? 'duplicate' : r.errors?.join('; ') || 'rejected by reviewer') : undefined }));
    try { const d = await api('import.commit', { decisions }); setReport(d.report); onDone(); }
    catch (e) { showToast(e.message, 'err'); }
  };
  if (report) return (
    <div className="analytics-card">
      <b>Import report</b>
      {['imported', 'duplicate', 'rejected'].map(k => <div key={k}>{k}: {report.filter(r => r.result === k).length}</div>)}
      <ul>{report.filter(r => r.result !== 'imported').map((r, n) => <li key={n}>{r.source} {r.source_id}: {r.result} — {r.reason}</li>)}</ul>
    </div>
  );
  if (!rows) return <button className="btn btn-g" onClick={load}><Mi>upload</Mi>Import from WA Relay</button>;
  return (
    <div className="analytics-card">
      <b>Review each legacy row before importing</b>
      <div className="ait-list">
        {rows.map((r, n) => (
          <div className="ait-row" key={n}>
            <div>
              <div>{r.source} · {r.proposed.kind} · {r.proposed.body.name || r.proposed.body.topic || r.proposed.body.ideal_reply?.slice(0, 50)}</div>
              <div className="meta">{r.status}{r.errors?.length ? ` · ${r.errors.join('; ')}` : ''}{r.warnings?.length ? ` · ${r.warnings.join('; ')}` : ''}</div>
            </div>
            <div className="ea-row">
              {r.source === 'wa_knowledge' && (
                <select className="fi" value={r.proposed.kind} aria-label="Kind" onChange={e => {
                  const kind = e.target.value; const old = r.proposed.body;
                  const text = old.must || old.instruction || old.text || ''; const title = old.name || old.topic || 'Imported';
                  const body = kind === 'rule' ? { name: title, when: title, must: text } : kind === 'behaviour' ? { aspect: 'tone', instruction: text } : { topic: title, text };
                  setRows(v => v.map((x, i) => (i === n ? { ...x, proposed: { ...x.proposed, kind, body } } : x)));
                }}>
                  <option value="rule">rule</option><option value="behaviour">behaviour</option><option value="fact">fact</option>
                </select>
              )}
              <select className="fi" value={decide[n]} onChange={e => setDecide(v => ({ ...v, [n]: e.target.value }))} aria-label="Decision" disabled={r.status === 'rejected'}>
                <option value="import">Import</option><option value="reject">Reject</option>
              </select>
            </div>
          </div>
        ))}
      </div>
      <button className="btn btn-p" onClick={commit}>Import decided rows</button>
    </div>
  );
}

export default function KnowledgeTab({ api, showToast }) {
  const { items, reload, retire } = useItems(api, showToast);
  const [edit, setEdit] = useState(null);
  if (!items) return <div className="ea-count">Loading…</div>;
  const projects = items.filter(i => i.kind === 'project' && i.status === 'active');
  const section = (kind, title) => (
    <section>
      <div className="ea-row" style={{ justifyContent: 'space-between' }}>
        <h3>{title}</h3>
        <button className="btn btn-g btn-sm" onClick={() => setEdit({ kind, item: null })}><Mi>add</Mi>Add</button>
      </div>
      <ItemList items={items} kind={kind} projects={projects} onEdit={i => setEdit({ kind, item: i })} onRetire={retire} />
    </section>
  );
  return (
    <div className="ait">
      <ImportWizard api={api} showToast={showToast} onDone={reload} />
      {section('project', 'Projects')}
      {section('fact', 'Facts')}
      {section('rule', 'Business rules')}
      {edit && <ItemEditor kind={edit.kind} initial={edit.item} projects={projects} api={api} showToast={showToast} onClose={() => setEdit(null)} onSaved={reload} />}
    </div>
  );
}
