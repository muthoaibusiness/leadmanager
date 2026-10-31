import { useEffect, useState } from 'react';
import Mi from '../Mi.jsx';
import EmbeddingModel from './EmbeddingModel.jsx';

// Provider, base URL, model and API key for the Playground only (migration
// 0043). The server never returns the key; the browser sees whether one is
// set and its last 4. Live bots, test runs and test numbers are unaffected.
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,127}$/;
const fmt = (t) => (t ? new Date(t).toLocaleString() : '');

function localErrors(f, providers, hasKey) {
  const e = {};
  const def = providers?.[f.provider];
  if (!def) e.provider = 'Choose a provider.';
  const base = f.base_url.trim() || def?.defaultBase || '';
  let u = null;
  try { u = new URL(base); } catch { e.base_url = 'Enter a full URL, for example https://api.example.com/v1.'; }
  if (u && u.protocol !== 'https:') e.base_url = 'The URL must start with https://.';
  if (u && def?.fixedHost && u.hostname !== def.fixedHost) e.base_url = `${def.label} uses ${def.fixedHost}.`;
  if (!MODEL_RE.test(f.model.trim())) e.model = 'Use letters, digits and . _ : / @ + - (up to 128 characters).';
  if (!hasKey && !f.api_key) e.api_key = 'An API key is required the first time.';
  if (f.api_key && !/^[\x21-\x7e]{8,512}$/.test(f.api_key)) e.api_key = 'The key must be 8-512 characters with no spaces.';
  return e;
}

export default function ModelTab({ api, showToast }) {
  const [data, setData] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState('');
  const [errors, setErrors] = useState({});
  const [serverErr, setServerErr] = useState(null);

  const apply = (d) => {
    setData(d);
    const c = d.config;
    setForm({ provider: c?.provider || 'openrouter', base_url: c?.base_url || '', model: c?.model || d.server_default?.model || '', api_key: '' });
  };
  useEffect(() => { api('modelconfig.get').then(apply, (e) => setLoadErr(e.message)); }, [api]);

  if (loadErr) return <div className="ait-err" role="alert">Could not load model settings: {loadErr}</div>;
  if (!data || !form) return <div className="ea-count">Loading…</div>;
  const cfg = data.config;
  const def = data.providers[form.provider];
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: undefined })); };

  const save = async (e) => {
    e.preventDefault();
    const errs = localErrors(form, data.providers, !!cfg?.key?.set);
    setErrors(errs); setServerErr(null);
    if (Object.keys(errs).length) return;
    setBusy('save');
    try {
      const r = await api('modelconfig.save', { provider: form.provider, base_url: form.base_url.trim() || def.defaultBase, model: form.model.trim(), ...(form.api_key ? { api_key: form.api_key } : {}) });
      apply({ ...data, config: r.config });
      showToast('Model settings saved.', 'ok');
    } catch (x) { setServerErr(x.message); } finally { setBusy(''); }
  };
  const test = async () => {
    setBusy('test'); setServerErr(null);
    try {
      const r = await api('modelconfig.test');
      setData((d) => ({ ...d, config: { ...d.config, last_test: r } }));
      showToast(r.ok ? 'Connection works.' : `Connection failed: ${r.error}`, r.ok ? 'ok' : 'err');
    } catch (x) { setServerErr(x.message); } finally { setBusy(''); }
  };
  const t = cfg?.last_test;

  return (
    <div className="ait">
    <div className="ait-grid">
      <form className="analytics-card" onSubmit={save} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
        <b>Playground model</b>
        <div className="ait-trace" style={{ marginTop: 0 }}>Used by the Playground only. The WhatsApp bots, test runs and test numbers keep the server&apos;s model ({data.server_default.model}).</div>
        <label>Provider
          <select className="fi" value={form.provider} onChange={(e) => { set('provider')(e); setForm((f) => ({ ...f, base_url: '' })); }}>
            {Object.entries(data.providers).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
          </select>
        </label>
        <label>API base URL
          <input className="fi" type="url" inputMode="url" value={form.base_url} onChange={set('base_url')} placeholder={def?.defaultBase || 'https://api.example.com/v1'}
            aria-invalid={!!errors.base_url} aria-describedby="mt-base-err" />
        </label>
        {errors.base_url && <div id="mt-base-err" className="ait-err">{errors.base_url}</div>}
        <label>Model ID
          <input className="fi" value={form.model} onChange={set('model')} placeholder="anthropic/claude-haiku-5.5" spellCheck={false} autoComplete="off"
            aria-invalid={!!errors.model} aria-describedby="mt-model-err" />
        </label>
        {errors.model && <div id="mt-model-err" className="ait-err">{errors.model}</div>}
        <label>API key {cfg?.key?.set ? <span className="ait-trace">(stored: {cfg.key.masked}, leave blank to keep it)</span> : null}
          <input className="fi" type="password" value={form.api_key} onChange={set('api_key')} autoComplete="new-password" spellCheck={false}
            placeholder={cfg?.key?.set ? 'Enter a new key to rotate' : 'Paste the API key'} aria-invalid={!!errors.api_key} aria-describedby="mt-key-err" />
        </label>
        {errors.api_key && <div id="mt-key-err" className="ait-err">{errors.api_key}</div>}
        {serverErr && <div className="ait-err" role="alert">{serverErr}</div>}
        <div className="ea-row">
          <button className="btn btn-p" type="submit" disabled={!!busy}><Mi>save</Mi>{busy === 'save' ? 'Saving…' : 'Save'}</button>
          <button className="btn btn-g" type="button" disabled={!!busy || !cfg} onClick={test}><Mi>network_check</Mi>{busy === 'test' ? 'Testing…' : 'Test connection'}</button>
        </div>
        <div className="ait-trace">The key is stored encrypted on the server and is never shown again. Test connection sends one short request to the provider; it does not send WhatsApp messages.</div>
      </form>
      <div className="analytics-card" style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        <b>Active configuration</b>
        {cfg ? (
          <>
            <div>{data.providers[cfg.provider]?.label} · <code>{cfg.model}</code></div>
            <div className="ait-trace" style={{ wordBreak: 'break-all' }}>{cfg.base_url}</div>
            <div className="ait-trace">Key: {cfg.key.set ? `${cfg.key.masked}, set ${fmt(cfg.key.set_at)}` : 'not set'}</div>
            <div className="ait-trace">Saved {fmt(cfg.updated_at)} by {cfg.updated_by}</div>
          </>
        ) : <div className="ait-trace">Nothing saved. The Playground uses the server default ({data.server_default.model}).</div>}
        <b style={{ marginTop: 8 }}>Last test</b>
        {t ? (
          <div role="status">
            <span className={`ait-badge ${t.ok ? 'pass' : 'fail'}`}>{t.ok ? 'connected' : t.code || 'failed'}</span>
            <span className="ait-trace"> {fmt(t.at)} · {t.ms} ms · {t.model}</span>
            {!t.ok && <div className="ait-err">{t.error}</div>}
          </div>
        ) : <div className="ait-trace">Not tested since the last change.</div>}
      </div>
    </div>
    <EmbeddingModel api={api} showToast={showToast} />
    </div>
  );
}
