import { useCallback, useEffect, useRef, useState } from 'react';
import Mi from '../Mi.jsx';
import { readDocument } from '../../lib/ingest.js';

// Markdown knowledge documents (migration 0047). A document is written or
// uploaded as Markdown (or text, or reviewed PDF text), reviewed, then indexed
// with the embedding model saved in Model & API. Any edit returns it to draft.
// Status: draft, reviewed, indexing, indexed, failed, needs reindex.
const STATUS = {
  draft: ['off', 'Draft'], reviewed: ['warn', 'Reviewed, not indexed'], indexing: ['warn', 'Indexing'],
  indexed: ['ok', 'Indexed'], failed: ['bad', 'Index failed'], needs_reindex: ['warn', 'Needs re-index'],
};
const loadPdf = () => import('pdfjs-dist/legacy/build/pdf.min.mjs').then(async (lib) => {
  const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
  lib.GlobalWorkerOptions.workerSrc = worker.default;
  return lib;
});
const fmt = (t) => (t ? new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

// A PDF's verdict from readDocument: how much of it can answer questions.
const VERDICT = { usable: 'Most pages have text.', partial: 'Half the pages or fewer have text: facts that are only in pictures will not be found.' };

function Editor({ api, showToast, doc, projects, projErr, onDone }) {
  const [title, setTitle] = useState(doc?.title || '');
  const [body, setBody] = useState(doc?.body || '');
  const [format, setFormat] = useState(doc?.format || 'markdown');
  const [bots, setBots] = useState(doc?.bots || ['eyad', 'dubai']);
  // The project this document is about. Retrieval answers a project's
  // questions only from its own documents and untagged general ones.
  const [projectRef, setProjectRef] = useState(doc?.project_ref || '');
  const [sourceName, setSourceName] = useState(doc?.source_name || '');
  const [verdict, setVerdict] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const pick = async (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    setErr(null);
    try {
      const d = await readDocument(f, loadPdf);
      setTitle((t) => t || d.title); setBody(d.body); setFormat(d.format); setWarnings(d.warnings);
      setSourceName(d.source_name || f.name); setVerdict(d.verdict || null);
    } catch (x) { setErr(x.message); }
  };
  const save = async () => {
    setBusy(true); setErr(null);
    try { await api('docs.save', { id: doc?.id, title, body, format, bots, project_ref: projectRef || null, source_name: sourceName || null }); showToast(doc ? 'Saved as a new draft version. Review it again to index.' : 'Draft saved.', 'ok'); onDone(); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="analytics-card dp-edit">
      <div className="ea-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <b>{doc ? `Edit "${doc.title}"` : 'New document'}</b>
        <input ref={fileRef} type="file" hidden accept=".md,.markdown,.txt,.pdf,text/markdown,text/plain,application/pdf" onChange={pick} />
        <button type="button" className="btn btn-g" onClick={() => fileRef.current?.click()}><Mi>upload_file</Mi>Load .md, .txt or .pdf</button>
      </div>
      <label>Title<input className="fi" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} /></label>
      <label>Project<select className="fi" value={projectRef} onChange={(e) => setProjectRef(e.target.value)}>
        <option value="">General (not about one project)</option>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.body?.name}</option>)}
        {/* The saved tag stays visible even when the project list failed to load. */}
        {projectRef && !projects.some((p) => p.id === projectRef) && <option value={projectRef}>Current project ({projectRef.slice(0, 8)})</option>}
      </select></label>
      {projErr && <div className="ait-err" role="alert">Could not load the project list: {projErr}. The current tag is kept.</div>}
      {format === 'pdf_text' && <div className="ait-trace" role="note">Text read from a PDF{sourceName ? ` (${sourceName})` : ''}. Check it against the original: tables and columns can come out in the wrong order. Nothing is indexed until you review it.{verdict && VERDICT[verdict] ? ` ${VERDICT[verdict]}` : ''}</div>}
      {warnings.map((w) => <div key={w} className="ait-err">{w}</div>)}
      <label htmlFor="dp-body">Content (Markdown)</label>
      <textarea id="dp-body" className="fi dp-area" value={body} onChange={(e) => setBody(e.target.value)} spellCheck={false}
        placeholder={'# Wecon Nuznan\n\n## Location\n- Sector 16, Jolshiri Abashon, Dhaka\n\n## Apartment sizes\n| Type | Size |\n| --- | --- |\n| A | 1,450 sqft |'} />
      <div className="bc-note">{[...body].length.toLocaleString()} characters · headings (#, ##) become the sections the bot searches</div>
      <fieldset className="di-bots"><legend className="bc-note">Bots</legend>
        {['eyad', 'dubai'].map((b) => <label key={b}><input type="checkbox" checked={bots.includes(b)} onChange={() => setBots((v) => (v.includes(b) ? v.filter((x) => x !== b) : [...v, b]))} />{b}</label>)}
      </fieldset>
      {err && <div className="ait-err" role="alert">{err}</div>}
      <div className="ea-row" style={{ gap: 8 }}>
        <button type="button" className="btn btn-p" disabled={busy || !title.trim() || !body.trim() || !bots.length} onClick={save}><Mi>save</Mi>{busy ? 'Saving…' : 'Save draft'}</button>
        <button type="button" className="btn btn-g" disabled={busy} onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

export default function DocumentsPanel({ api, showToast }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [editing, setEditing] = useState(null); // null | 'new' | doc
  const [busy, setBusy] = useState('');

  const [projects, setProjects] = useState([]);
  const load = useCallback(() => api('docs.list').then((d) => { setErr(null); setData(d); }, (e) => setErr(e.message)), [api]);
  const [projErr, setProjErr] = useState(null);
  useEffect(() => { api('items.list').then((xs) => { setProjErr(null); setProjects((xs || []).filter((i) => i.kind === 'project' && i.status === 'active')); }, (e) => setProjErr(e.message)); }, [api]);
  const nameOf = (id) => projects.find((p) => p.id === id)?.body?.name;
  useEffect(() => { load(); }, [load]);

  const open = async (d) => { try { setEditing(await api('docs.get', { id: d.id })); } catch (x) { showToast(x.message, 'err'); } };
  const review = async (d) => {
    setBusy(d.id);
    try { await api('docs.review', { id: d.id, version: d.version }); showToast(`"${d.title}" reviewed.`, 'ok'); await load(); }
    catch (x) { showToast(x.message, 'err'); } finally { setBusy(''); }
  };
  const index = async (d) => {
    setBusy(d.id);
    try {
      const r = await api('docs.index', { id: d.id });
      showToast(r.status === 'indexed' ? `"${d.title}" indexed: ${r.chunks} sections with ${r.index_model}.` : `Indexing failed: ${r.index_error}`, r.status === 'indexed' ? 'ok' : 'err');
      await load();
    } catch (x) { showToast(x.message, 'err'); } finally { setBusy(''); }
  };

  if (err) return <div className="ait-err" role="alert">Could not load documents: {err} <button className="btn btn-g btn-sm" onClick={load}><Mi>refresh</Mi>Retry</button></div>;
  if (!data) return <div className="ea-count">Loading documents…</div>;
  if (editing) return <Editor api={api} showToast={showToast} projects={projects} projErr={projErr} doc={editing === 'new' ? null : editing} onDone={() => { setEditing(null); load(); }} />;

  return (
    <section className="analytics-card dp">
      <div className="ea-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <b>Knowledge documents</b>
          <p className="bc-note">Markdown is the main format. Each heading becomes a section the bot can find by meaning, in Bangla, Banglish or English.</p>
        </div>
        <button type="button" className="btn btn-g" onClick={() => setEditing('new')}><Mi>add</Mi>New document</button>
      </div>
      <div className={data.publish_ready ? 'bc-note' : 'ait-err'} role="status">
        {data.publish_ready ? 'All reviewed documents are indexed for the current embedding model.'
          : `Publishing is blocked: ${data.blockers.join('; ')}.`}
      </div>
      <div className="ait-list">
        {data.documents.map((d) => {
          const [cls, label] = STATUS[d.status] || ['off', d.status];
          const canIndex = ['reviewed', 'failed', 'needs_reindex'].includes(d.status);
          return (
            <div key={d.id} className="ait-row dp-row">
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{d.title}</div>
                <div className="meta">v{d.version} · {d.format === 'pdf_text' ? 'PDF text' : d.format} · {d.chars.toLocaleString()} chars · {d.bots.join(', ')} · {d.project_ref ? (nameOf(d.project_ref) || 'unknown project') : 'general'}{d.index_model ? ` · ${d.index_model} (${d.index_dim})` : ''} · {fmt(d.updated_at)}</div>
                {(data.association || []).filter((a) => a.id === d.id).map((a) => <div key={a.id} className="ait-err">Names {a.named} but is not tagged with it, so other projects' questions can retrieve it. Edit it and choose {a.named}.</div>)}
                {d.status === 'failed' && d.index_error && <div className="ait-err">{d.index_error}</div>}
              </div>
              <div className="dp-acts">
                <span className={`cot-badge ${cls}`}>{label}</span>
                <button type="button" className="btn btn-g btn-sm" disabled={!!busy} onClick={() => open(d)}><Mi>edit</Mi>Edit</button>
                {d.status === 'draft' && <button type="button" className="btn btn-g btn-sm" disabled={!!busy} onClick={() => review(d)}><Mi>task_alt</Mi>Mark reviewed</button>}
                {canIndex && <button type="button" className="btn btn-p btn-sm" disabled={!!busy} onClick={() => index(d)}><Mi>hub</Mi>{busy === d.id ? 'Indexing…' : d.status === 'reviewed' ? 'Index' : 'Re-index'}</button>}
              </div>
            </div>
          );
        })}
        {!data.documents.length && <div className="bc-note">No documents yet. Write one in Markdown, or load a .md file.</div>}
      </div>
    </section>
  );
}
