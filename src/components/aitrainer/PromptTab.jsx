import { useCallback, useEffect, useState } from 'react';
import Mi from '../Mi.jsx';
import { BOTS } from '../wa/relayBots.js';
import { Menu, MenuRadio, MenuRadioGroup } from '../ui/menu.jsx';

// The operator's System Prompt per bot (migration 0046): edit a draft, try it
// on one message, publish it, or roll back to an earlier published version.
// Only the Playground and trainer test numbers use it; the live customer bots
// stay on the legacy FAQ agent until a separate, approved cutover.
const MAX = 12000;
const stats = (s) => {
  const t = String(s || '');
  const bangla = [...t].filter((c) => /[ঀ-৿]/.test(c)).length;
  return { chars: [...t].length, tokens: t ? Math.ceil((t.length - bangla) / 4 + bangla / 2) : 0 };
};
const fmt = (t) => (t ? new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

export default function PromptTab({ api, showToast }) {
  const [bot, setBot] = useState(BOTS[0].bot);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');
  const [tryMsg, setTryMsg] = useState('');
  const [tryOut, setTryOut] = useState(null);
  const [history, setHistory] = useState(null);

  // State is set only in the promise callbacks, never synchronously in the
  // effect (react-hooks/set-state-in-effect).
  const load = useCallback(() => Promise.all([api('prompt.get', { bot }), api('prompt.history', { bot })])
    .then(([d, h]) => { setErr(null); setData(d); setHistory(h); setText(d.draft?.body ?? d.published?.body ?? ''); setTryOut(null); })
    .catch((e) => setErr(e.message)), [api, bot]);
  useEffect(() => { load(); }, [load]);

  if (err) return <div className="ait-err" role="alert">Could not load the System Prompt: {err} <button className="btn btn-g btn-sm" onClick={load}><Mi>refresh</Mi>Retry</button></div>;
  if (!data) return <div className="ea-count">Loading…</div>;

  const name = BOTS.find((b) => b.bot === bot)?.name || bot;
  const base = data.draft?.body ?? data.published?.body ?? '';
  const dirty = text.trim() !== base.trim();
  const st = stats(text);
  const over = st.chars > MAX;
  const empty = !text.trim();
  const draftIsNewest = data.draft && !dirty;

  const saveDraft = async () => {
    setBusy('save');
    try { await api('prompt.save_draft', { bot, body: text }); showToast('Draft saved. Published prompt unchanged.', 'ok'); await load(); }
    catch (e) { showToast(e.message, 'err'); } finally { setBusy(''); }
  };
  const publish = async () => {
    if (!window.confirm(`Publish this draft for ${name}? The Playground and test numbers will use it. Customers are not affected.`)) return;
    setBusy('publish');
    try { const r = await api('prompt.publish', { bot, draft_id: data.draft.id }); showToast(`Published v${r.version_no} for ${name}`, 'ok'); await load(); }
    catch (e) { showToast(e.message, 'err'); } finally { setBusy(''); }
  };
  const rollback = async (row) => {
    const reason = window.prompt(`Why switch ${name} back to v${row.version_no}? (required)`);
    if (!reason?.trim()) return;
    setBusy('rollback');
    try { await api('prompt.rollback', { bot, prompt_id: row.id, reason }); showToast(`${name} now uses v${row.version_no}`, 'ok'); await load(); }
    catch (e) { showToast(e.message, 'err'); } finally { setBusy(''); }
  };
  const tryIt = async (e) => {
    e.preventDefault();
    setBusy('test'); setTryOut(null);
    try { setTryOut(await api('prompt.test', { bot, body: text, text: tryMsg })); }
    catch (x) { setTryOut({ error: x.message }); } finally { setBusy(''); }
  };

  const status = data.draft ? ['warn', `Draft v${data.draft.version_no} not published`]
    : data.published ? ['ok', `Published v${data.published.version_no}`] : ['off', 'Nothing published'];

  return (
    <div className="ait">
      <div className="bc-bar">
        <Menu align="start" label={`Bot: ${name}`}
          trigger={<button type="button" className="btn btn-g bc-pick"><Mi>smart_toy</Mi>{name}<Mi>expand_more</Mi></button>}>
          <MenuRadioGroup value={bot} onChange={(v) => { if (!dirty || window.confirm('Discard unsaved changes?')) setBot(v); }}>
            {BOTS.map((b) => <MenuRadio key={b.bot} value={b.bot}>{b.name}</MenuRadio>)}
          </MenuRadioGroup>
        </Menu>
        <span className={`cot-badge ${status[0]}`} role="status">{status[1]}</span>
      </div>

      <div className="ait-grid">
        <section className="analytics-card sp-edit">
          <label htmlFor="sp-body" className="bc-label">System Prompt for {name}</label>
          <p className="bc-note">Persona, tone and how to sell. Facts, prices and stock come from Knowledge and live inventory, and the platform's safety rules and reply format always apply on top of this.</p>
          <textarea id="sp-body" className="fi sp-area" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false}
            placeholder={'You are Eyad from WECON Properties.\nGreet with Assalamu Alaikum. Ask which area the customer prefers before quoting.\nOffer a site visit once the customer shows interest.'}
            aria-describedby="sp-count" aria-invalid={over} />
          <div className="sp-meta">
            <span id="sp-count" className={over ? 'ait-err' : 'bc-note'}>{st.chars.toLocaleString()} / {MAX.toLocaleString()} characters · about {st.tokens.toLocaleString()} tokens</span>
            <span className="bc-note">{dirty ? 'Unsaved changes' : data.draft ? `Draft v${data.draft.version_no} saved ${fmt(data.draft.created_at)}` : data.published ? `Same as published v${data.published.version_no}` : 'Not saved'}</span>
          </div>
          <div className="sp-actions">
            <button type="button" className="btn btn-g" disabled={!!busy || !dirty || empty || over} onClick={saveDraft}><Mi>save</Mi>{busy === 'save' ? 'Saving…' : 'Save draft'}</button>
            <button type="button" className="btn btn-p" disabled={!!busy || !draftIsNewest} onClick={publish}
              aria-describedby="sp-pub-why"><Mi>rocket_launch</Mi>{busy === 'publish' ? 'Publishing…' : data.draft ? `Publish v${data.draft.version_no}` : 'Publish'}</button>
          </div>
          {!draftIsNewest && <p id="sp-pub-why" className="bc-note">{dirty ? 'Save the draft first, then publish it.' : 'Edit and save a draft to publish a new version.'}</p>}

          <form className="sp-try" onSubmit={tryIt}>
            <label htmlFor="sp-try" className="bc-label">Test this prompt</label>
            <p className="bc-note">Runs one turn with the text above, saved or not, against the current Knowledge drafts. Nothing is saved or sent on WhatsApp.</p>
            <div className="ea-row">
              <input id="sp-try" className="fi" value={tryMsg} onChange={(e) => setTryMsg(e.target.value)} placeholder="Write as the customer, e.g. Jolshiri te 3 bed er dam koto?" maxLength={2000} style={{ flex: 1, minWidth: 0 }} />
              <button type="submit" className="btn btn-g" disabled={!!busy || empty || over || !tryMsg.trim()}><Mi>play_arrow</Mi>{busy === 'test' ? 'Testing…' : 'Test prompt'}</button>
            </div>
            {tryOut?.error && <div className="ait-err" role="alert">{tryOut.error}</div>}
            {tryOut && !tryOut.error && (
              <div className="ait-msg bot sp-out" aria-live="polite">
                {tryOut.reply || <i>(no reply: {tryOut.outcome})</i>}
                <div className="ait-trace">{tryOut.outcome}{tryOut.handoff ? ' · handoff' : ''}{tryOut.trace?.model ? ` · ${tryOut.trace.model}` : ''}{tryOut.trace?.guard_errors?.length ? ` · guards: ${tryOut.trace.guard_errors.join(', ')}` : ''}</div>
              </div>
            )}
          </form>
        </section>

        <aside className="analytics-card sp-side" aria-label="Published version and history">
          <div className="bc-label">In use now</div>
          {data.published ? (
            <>
              <div className="bc-strong">v{data.published.version_no} · Published</div>
              <div className="bc-note">{fmt(data.published.created_at)} by {data.published.created_by_claimed}{data.pointer?.reason && data.pointer.reason !== 'publish' ? ` · rolled back: ${data.pointer.reason}` : ''}</div>
            </>
          ) : <div className="bc-note">Nothing published. The Playground and test numbers use the built-in persona.</div>}
          <p className="bc-note">Used by the Playground and trainer test numbers. Customer chats keep the legacy FAQ agent until a cutover is approved.</p>

          <div className="bc-label" style={{ marginTop: 12 }}>History</div>
          <div className="ait-list sp-hist">
            {(history || []).filter((h) => h.status === 'published').map((h) => {
              const current = data.published?.id === h.id;
              return (
                <div key={h.id} className="ait-row">
                  <div style={{ minWidth: 0 }}>
                    <div>v{h.version_no}{current ? ' · in use' : ''}</div>
                    <div className="meta">{fmt(h.created_at)} · {h.created_by_claimed}</div>
                  </div>
                  {current ? <span className="cot-badge ok">In use</span>
                    : <button type="button" className="btn btn-g btn-sm" disabled={!!busy} onClick={() => rollback(h)}><Mi>history</Mi>Use this</button>}
                </div>
              );
            })}
            {!(history || []).some((h) => h.status === 'published') && <div className="bc-note">No published versions yet.</div>}
          </div>
        </aside>
      </div>
    </div>
  );
}
