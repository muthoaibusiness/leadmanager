import { useEffect, useState } from 'react';
import Mi from '../Mi.jsx';
import { Select as SelectRoot, SelectLabel, SelectTrigger, SelectValue, SelectPopover, SelectListBox, SelectItem } from '../ui/select.jsx';

// The embedding model used to index Markdown knowledge and search it during a
// turn (migration 0047). Separate from the chat model: its own provider, base
// URL, model id, vector size and key. The key is never returned; the chat key
// can be reused only for the same provider and host. Changing the model or
// size marks indexed documents for re-indexing instead of mixing vectors.
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,127}$/;
const fmt = (t) => (t ? new Date(t).toLocaleString() : '');

export default function EmbeddingModel({ api, showToast }) {
  const [data, setData] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState('');
  const [serverErr, setServerErr] = useState(null);
  const [notice, setNotice] = useState(null);

  const apply = (d) => {
    setData(d);
    const c = d.config;
    setForm({ provider: c?.provider || 'openrouter', base_url: c?.base_url || '', model: c?.model || '', dim: c?.embedding_dim ? String(c.embedding_dim) : '', api_key: '', reuse: false });
  };
  useEffect(() => { api('embedconfig.get').then(apply, (e) => setLoadErr(e.message)); }, [api]);

  if (loadErr) return <div className="ait-err" role="alert">Could not load embedding settings: {loadErr}</div>;
  if (!data || !form) return <div className="ea-count">Loading…</div>;
  const cfg = data.config;
  const def = data.providers[form.provider];
  const base = form.base_url.trim() || def?.defaultBase || '';
  const host = (() => { try { return new URL(base).hostname; } catch { return ''; } })();
  const canReuse = !!data.chat_key && data.chat_key.provider === form.provider && data.chat_key.host === host;
  const set = (k) => (v) => { setForm((f) => ({ ...f, [k]: v })); setErrors((x) => ({ ...x, [k]: undefined })); };

  const check = () => {
    const e = {};
    if (!base) e.base_url = 'Enter the full API base URL.';
    else if (!/^https:\/\//.test(base)) e.base_url = 'The URL must start with https://.';
    if (!MODEL_RE.test(form.model.trim())) e.model = 'Use letters, digits and . _ : / @ + - (up to 128 characters).';
    const d = Number(form.dim);
    if (!Number.isInteger(d) || d < 1 || d > 4096) e.dim = 'Enter the model’s vector size, for example 1536.';
    if (!cfg?.key?.set && !form.api_key && !(form.reuse && canReuse)) e.api_key = 'Enter a key, or reuse the chat model’s key if it is for the same provider.';
    if (form.api_key && !/^[\x21-\x7e]{8,512}$/.test(form.api_key)) e.api_key = 'The key must be 8-512 characters with no spaces.';
    return e;
  };

  const save = async (ev) => {
    ev.preventDefault();
    const e = check(); setErrors(e); setServerErr(null); setNotice(null);
    if (Object.keys(e).length) return;
    setBusy('save');
    try {
      const r = await api('embedconfig.save', { provider: form.provider, base_url: base, model: form.model.trim(), embedding_dim: Number(form.dim),
        ...(form.api_key ? { api_key: form.api_key } : {}), ...(form.reuse && canReuse ? { reuse_chat_key: true } : {}) });
      apply({ ...data, config: r.config });
      if (r.reindex?.documents) setNotice(`${r.reindex.documents} indexed document${r.reindex.documents === 1 ? '' : 's'} now need re-indexing with the new model. Until then they are not searched.`);
      showToast('Embedding settings saved.', 'ok');
    } catch (x) { setServerErr(x.message); } finally { setBusy(''); }
  };
  const test = async () => {
    setBusy('test'); setServerErr(null);
    try {
      const r = await api('embedconfig.test');
      setData((d) => ({ ...d, config: { ...d.config, last_test: r } }));
      showToast(r.ok ? `Embedding works: ${r.dimensions} dimensions.` : `Embedding failed: ${r.error}`, r.ok ? 'ok' : 'err');
    } catch (x) { setServerErr(x.message); } finally { setBusy(''); }
  };
  const t = cfg?.last_test;

  return (
    <div className="ait-grid">
      <form className="analytics-card em-form" onSubmit={save} noValidate>
        <b>Embedding model</b>
        <div className="ait-trace" style={{ marginTop: 0 }}>Turns Markdown knowledge into vectors for search. Used when indexing documents and for every Playground and test-number question.</div>
        <SelectRoot value={form.provider} onChange={(v) => { set('provider')(v); setForm((f) => ({ ...f, base_url: '', reuse: false })); }}>
          <SelectLabel>Provider</SelectLabel>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectPopover><SelectListBox>
            {Object.entries(data.providers).map(([k, p]) => <SelectItem key={k} value={k}>{p.label}</SelectItem>)}
          </SelectListBox></SelectPopover>
        </SelectRoot>
        <label>API base URL
          <input className="fi" type="url" inputMode="url" value={form.base_url} onChange={(e) => set('base_url')(e.target.value)} placeholder={def?.defaultBase || 'https://api.example.com/v1'} aria-invalid={!!errors.base_url} aria-describedby="em-base-err" />
        </label>
        {errors.base_url && <div id="em-base-err" className="ait-err">{errors.base_url}</div>}
        <label>Embedding model ID
          <input className="fi" value={form.model} onChange={(e) => set('model')(e.target.value)} placeholder="openai/text-embedding-3-small" spellCheck={false} autoComplete="off" aria-invalid={!!errors.model} aria-describedby="em-model-err" />
        </label>
        {errors.model && <div id="em-model-err" className="ait-err">{errors.model}</div>}
        <label>Vector size (dimensions)
          <input className="fi" inputMode="numeric" value={form.dim} onChange={(e) => set('dim')(e.target.value.replace(/\D/g, ''))} placeholder="1536" aria-invalid={!!errors.dim} aria-describedby="em-dim-err" />
        </label>
        {errors.dim && <div id="em-dim-err" className="ait-err">{errors.dim}</div>}
        <label>API key {cfg?.key?.set ? <span className="ait-trace">(stored: {cfg.key.masked}, leave blank to keep it)</span> : null}
          <input className="fi" type="password" value={form.api_key} onChange={(e) => set('api_key')(e.target.value)} autoComplete="new-password" spellCheck={false}
            placeholder={cfg?.key?.set ? 'Enter a new key to rotate' : 'Paste the API key'} aria-invalid={!!errors.api_key} aria-describedby="em-key-err" disabled={form.reuse && canReuse} />
        </label>
        {canReuse && !form.api_key && (
          <label className="em-reuse"><input type="checkbox" checked={form.reuse} onChange={(e) => set('reuse')(e.target.checked)} />Reuse the chat model&apos;s key ({data.chat_key.provider}, {data.chat_key.host})</label>
        )}
        {errors.api_key && <div id="em-key-err" className="ait-err">{errors.api_key}</div>}
        {serverErr && <div className="ait-err" role="alert">{serverErr}</div>}
        {notice && <div className="ait-trace" role="status">{notice}</div>}
        <div className="ea-row">
          <button className="btn btn-p" type="submit" disabled={!!busy}><Mi>save</Mi>{busy === 'save' ? 'Saving…' : 'Save configuration'}</button>
          <button className="btn btn-g" type="button" disabled={!!busy || !cfg} onClick={test}><Mi>network_check</Mi>{busy === 'test' ? 'Testing…' : 'Test connection'}</button>
        </div>
        <div className="ait-trace">Changing the model or vector size marks indexed documents for re-indexing. Vectors from different models are never searched together.</div>
      </form>
      <div className="analytics-card em-side">
        <b>Active embedding model</b>
        {cfg ? (
          <>
            <div>{data.providers[cfg.provider]?.label} · <code>{cfg.model}</code> · {cfg.embedding_dim} dims</div>
            <div className="ait-trace" style={{ wordBreak: 'break-all' }}>{cfg.base_url}</div>
            <div className="ait-trace">Key: {cfg.key.set ? `${cfg.key.masked}, set ${fmt(cfg.key.set_at)}` : 'not set'}</div>
          </>
        ) : <div className="ait-trace">Not set. Documents cannot be indexed, and answers use Knowledge items only.</div>}
        <b style={{ marginTop: 8 }}>Last test</b>
        {t ? (
          <div role="status">
            <span className={`ait-badge ${t.ok ? 'pass' : 'fail'}`}>{t.ok ? 'connected' : 'failed'}</span>
            <span className="ait-trace"> {fmt(t.at)} · {t.ms} ms{t.dimensions ? ` · ${t.dimensions} dims` : ''}</span>
            {!t.ok && <div className="ait-err">{t.error}</div>}
          </div>
        ) : <div className="ait-trace">Not tested since the last change.</div>}
      </div>
    </div>
  );
}
