import { useCallback, useEffect, useRef, useState } from 'react';
import Mi from '../Mi.jsx';
import useNavState from '../../hooks/useNavState.js';
import { Select as SelectRoot, SelectLabel, SelectTrigger, SelectValue, SelectPopover, SelectListBox, SelectItem } from '../ui/select.jsx';
import { retrievedDocs } from '../../lib/traceDocs.js';

// Multi-turn chat against drafts or any snapshot, through the same core the
// bots will run. Nothing is sent on WhatsApp. Each bot reply shows its trace,
// and a wrong reply can be saved as an example and a regression test.
//
// Every turn is saved on the server (ai_playground_*, migration 0040), so a
// conversation survives a reload and can be reopened from History and
// continued from its saved state. The open conversation id is kept in the
// browser history entry (useNavState), so Back and reload return to it.
const SETUP = { isAd: false, adText: '', returning: false };
const newTurnId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`);
const fmt = (t) => (t ? new Date(t).toLocaleString() : '');

function MarkWrong({ turn, history, bot, api, showToast, onClose }) {
  const [ideal, setIdeal] = useState('');
  const [reason, setReason] = useState('');
  const [asTest, setAsTest] = useState(true);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    const conversation = [...history.map(h => ({ role: h.role, text: h.text })), { role: 'customer', text: turn.customer }];
    try {
      await api('items.create', { kind: 'example', bots: [bot], project_ref: null,
        body: { conversation, original_reply: turn.reply || undefined, ideal_reply: ideal, reason, source: 'playground' } });
      if (asTest) {
        await api('tests.create', { bots: [bot], origin: 'playground', spec: {
          title: turn.customer.slice(0, 60),
          setup: { isAd: !!turn.setup.isAd, adText: turn.setup.adText || undefined, returning: turn.returning, state: turn.stateBefore || undefined },
          conversation: history.map(h => ({ role: h.role, text: h.text })),
          target: turn.customer, checks: [{ type: 'handoff', value: false }], ideal_reply: ideal, judge: 'rubric' } });
      }
      showToast(asTest ? 'Saved as an example and a test' : 'Saved as an example', 'ok');
      onClose();
    } catch (e) { showToast(e.message, 'err'); }
    finally { setSaving(false); }
  };
  return (
    <div className="analytics-card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <b>Correct this reply</b>
      <textarea className="fi" rows={3} placeholder="Ideal reply" value={ideal} onChange={e => setIdeal(e.target.value)} />
      <textarea className="fi" rows={2} placeholder="Why (required)" value={reason} onChange={e => setReason(e.target.value)} />
      <label style={{ display: 'inline-flex', gap: 6 }}><input type="checkbox" checked={asTest} onChange={e => setAsTest(e.target.checked)} />Also save as a regression test</label>
      <div className="ea-row">
        <button className="btn btn-g" onClick={onClose}>Cancel</button>
        <button className="btn btn-p" disabled={saving || !ideal.trim() || !reason.trim()} onClick={save}>Save</button>
      </div>
    </div>
  );
}

// A saved turn (server row) in the shape the chat and MarkWrong use.
// The Knowledge sections retrieval put in the prompt for this reply, with
// their similarity score. Collapsed so the chat stays readable.
function RetrievedDocs({ docs }) {
  const v = retrievedDocs(docs);
  if (v.kind === 'none') return null;
  if (v.kind === 'error') return <div className="ait-trace ait-err">Knowledge search failed: {v.error}</div>;
  if (v.kind === 'empty') return <div className="ait-trace">Knowledge retrieved: none matched</div>;
  return (
    <details className="ait-docs">
      <summary className="ait-trace">Knowledge retrieved ({v.hits.length})</summary>
      <ul aria-label="Knowledge sections retrieved for this reply">
        {v.hits.map((h) => <li key={h.key}><span>{h.label}</span><span className="ait-docs-score" title="Similarity to the message (0 to 1)">{h.score}</span></li>)}
      </ul>
    </details>
  );
}

const fromRow = (r, history) => ({
  id: r.id, seq: r.seq, customer: r.customer_text, reply: r.reply || '', media: r.media || [], handoff: r.handoff,
  outcome: r.outcome, trace: r.trace || {}, error: r.error, checksum: r.checksum, at: r.created_at, finishedAt: r.finished_at,
  setup: r.setup || SETUP, returning: r.returning_contact, stateBefore: r.state_before, historyBefore: history,
});
const toTurns = (rows) => {
  const out = []; const hist = [];
  for (const r of [...rows].sort((a, b) => a.seq - b.seq)) {
    out.push(fromRow(r, [...hist]));
    hist.push({ role: 'customer', text: r.customer_text });
    if (r.reply) hist.push({ role: 'bot', text: r.reply });
  }
  return out;
};

function History({ api, bot, current, onOpen, onNew }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState('');
  const [mine, setMine] = useState(true);
  const load = useCallback(() => {
    setErr(null);
    return api('playground.list', { q, bot: mine ? bot : undefined }).then(setRows).catch(e => setErr(e.message));
  }, [api, q, bot, mine]);
  // Debounced so typing a search does not fire a request per key.
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load, current?.last_activity_at]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <div className="ea-row" style={{ justifyContent: 'space-between' }}>
        <b>History</b>
        <button className="btn btn-g btn-sm" onClick={onNew}><Mi>add</Mi>New conversation</button>
      </div>
      <input className="fi" type="search" placeholder="Search messages and replies" aria-label="Search Playground history" value={q} onChange={e => setQ(e.target.value)} />
      <label style={{ display: 'inline-flex', gap: 6, fontSize: 13 }}><input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)} />Only {bot}</label>
      {err && <div className="ait-err" role="alert">{err} <button className="btn btn-g btn-sm" onClick={load}><Mi>refresh</Mi>Retry</button></div>}
      {!err && rows === null && <div className="ea-count">Loading…</div>}
      {!err && rows?.length === 0 && <div className="ea-count">{q ? 'No conversation matches.' : 'No saved conversations yet. Send a message to start one.'}</div>}
      <div className="ait-list" role="list" aria-label="Saved Playground conversations" style={{ maxHeight: 360, overflowY: 'auto' }}>
        {rows?.map(c => (
          <button key={c.id} type="button" role="listitem" onClick={() => onOpen(c.id)}
            className="ait-row" aria-current={current?.id === c.id ? 'true' : undefined}
            style={{ textAlign: 'left', border: current?.id === c.id ? '1px solid var(--green)' : '1px solid transparent', cursor: 'pointer', flexDirection: 'column', gap: 2, width: '100%' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{c.title || '(untitled)'}</span>
            <span className="meta">{c.bot} · {c.source === 'drafts' ? 'drafts' : 'snapshot'} · {c.turn_count} {c.turn_count === 1 ? 'turn' : 'turns'} · {fmt(c.last_activity_at)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function PlaygroundTab({ api, showToast }) {
  const [convId, setConvId] = useNavState('aitrainer.playground.conv', null);
  const [conv, setConv] = useState(null);
  const [bot, setBot] = useState('eyad');
  const [source, setSource] = useState('drafts');
  const [promptSel, setPromptSel] = useState('published'); // which System Prompt drives a drafts turn
  const [snapshots, setSnapshots] = useState([]);
  const [setup, setSetup] = useState(SETUP);
  const [turns, setTurns] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadErr, setLoadErr] = useState(null);
  const [failed, setFailed] = useState(null); // { text, clientTurnId, message } of a send that did not reach the server
  const [wrong, setWrong] = useState(null);
  const [names, setNames] = useState({});
  const opening = useRef(null);

  useEffect(() => {
    api('snapshot.list').then(setSnapshots).catch(() => {});
    api('items.list').then(rows => setNames(Object.fromEntries(rows.map(r => [r.id, r.body.name || r.body.topic || r.body.title || r.kind])))).catch(() => {});
  }, [api]);

  // Open the saved conversation named by convId (after a reload, Back, or a
  // click in History). The settings shown are the conversation's own.
  // State is set in the promise callbacks, never synchronously in the effect
  // (react-hooks/set-state-in-effect); a reply for a conversation the user
  // has already left is dropped.
  const show = useCallback((id, p) => {
    opening.current = id;
    return p.then((d) => {
      if (opening.current !== id) return;
      setLoadErr(null); setWrong(null); setFailed(null);
      setConv(d.conversation); setTurns(toTurns(d.turns));
      setBot(d.conversation.bot); setSource(d.conversation.source === 'snapshot' ? d.conversation.snapshot_id : 'drafts');
      setSetup({ ...SETUP, ...(d.conversation.setup || {}) });
    }, (e) => {
      if (opening.current !== id) return;
      if (e.code === 'not_found') { setConvId(null); setConv(null); setTurns([]); showToast('That conversation no longer exists.', 'err'); }
      else { setLoadErr(e.message); setConv(null); }
    });
  }, [setConvId, showToast]);
  const open = useCallback((id) => show(id, api('playground.get', { id })), [api, show]);
  useEffect(() => { if (convId) show(convId, api('playground.get', { id: convId })); }, [convId, api, show]);

  const startNew = () => { opening.current = null; setConvId(null); setConv(null); setTurns([]); setWrong(null); setFailed(null); setLoadErr(null); };
  const choose = (id) => { if (id === convId) open(id); else setConvId(id); };

  const history = turns.flatMap(t => [{ role: 'customer', text: t.customer }, ...(t.reply ? [{ role: 'bot', text: t.reply }] : [])]);
  const state = conv?.state || null;

  // A retry reuses the same client turn id, so the server returns the saved
  // turn instead of running the model again if the first attempt got through.
  const submit = async (msg, clientTurnId) => {
    setBusy(true); setFailed(null);
    const isSnap = source !== 'drafts';
    try {
      const d = await api('playground.turn', { conversation_id: conv?.id, client_turn_id: clientTurnId, bot,
        source: isSnap ? 'snapshot' : 'drafts', snapshot_id: isSnap ? source : undefined, text: msg, setup, prompt: isSnap ? undefined : promptSel });
      setConv(d.conversation);
      setTurns(v => (v.some(t => t.id === d.turn.id) ? v : [...v, fromRow(d.turn, history)]));
      if (!conv) { opening.current = d.conversation_id; setConvId(d.conversation_id); }
      setText('');
    } catch (x) {
      if (x.code === 'freeze') showToast(`Drafts have errors: ${(x.details || []).join('; ')}`, 'err');
      else if (x.code === 'not_found') { showToast(x.message, 'err'); startNew(); }
      else setFailed({ text: msg, clientTurnId, message: x.message });
    } finally { setBusy(false); }
  };
  const send = (e) => { e.preventDefault(); if (text.trim()) submit(text, newTurnId()); };

  const locked = turns.length > 0; // bot, version and setup belong to the conversation once it has a turn
  return (
    <div className="ait-grid">
      <div className="analytics-card" style={{ minWidth: 0 }}>
        <div className="ea-row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <div className="ait-trace" style={{ margin: 0 }}>
            {conv ? <>Saved conversation · {conv.turn_count} {conv.turn_count === 1 ? 'turn' : 'turns'} · started {fmt(conv.created_at)}</> : 'New conversation (saved when you send the first message)'}
          </div>
        </div>
        {loadErr && <div className="ait-err" role="alert">Could not load this conversation: {loadErr} <button className="btn btn-g btn-sm" onClick={() => open(convId)}><Mi>refresh</Mi>Retry</button></div>}
        <div className="ait-chat" aria-live="polite">
          {convId && !conv && !loadErr && <div className="ea-count">Loading conversation…</div>}
          {turns.map((t) => (
            <div key={t.id} style={{ display: 'contents' }}>
              <div className="ait-msg customer">{t.customer}<div className="ait-trace">#{t.seq} · {fmt(t.at)}</div></div>
              <div className="ait-msg bot">
                {t.reply || <i>(no reply: {t.outcome})</i>}
                {t.media?.map((m, i) => <div key={i} className="ait-trace"><Mi>{m.type === 'document' ? 'description' : 'image'}</Mi> {m.caption}</div>)}
                <div className="ait-trace">
                  <span className={`ait-badge ${t.outcome === 'ok' ? 'pass' : /fallback|error/.test(t.outcome) ? 'fail' : 'inc'}`}>{t.outcome}</span>
                  {t.handoff ? ' · handoff' : ''} · {fmt(t.finishedAt)} · project: {(t.trace?.project?.projects || []).map(id => names[id] || id).join(', ') || 'none'}
                  {/* used_item_ids is what the model says it used, not a retrieval log. */}
                  {' '}· sources the model reports using: {(t.trace?.used_item_ids || []).length ? t.trace.used_item_ids.map(id => names[id] || id).join(', ') : 'none'}
                  {t.trace?.guard_errors?.length ? ` · guards: ${t.trace.guard_errors.join(', ')}` : ''}
                  {' '}· prompt: {t.trace?.system_prompt ? `v${t.trace.system_prompt.version_no}` : 'built-in'}{t.trace?.model ? ` · ${t.trace.model}` : ''}
                  {t.trace?.media_missing?.length ? ` · missing media: ${t.trace.media_missing.join(', ')}` : ''}
                  {t.error ? <span className="ait-err"> · error: {t.error}</span> : ''}
                </div>
                <RetrievedDocs docs={t.trace?.documents} />
                <button className="btn btn-g btn-sm" onClick={() => setWrong({ turn: t, history: t.historyBefore })}><Mi>edit</Mi>Mark wrong</button>
              </div>
            </div>
          ))}
          {!convId && turns.length === 0 && <div className="ea-count">Write a customer message to start. Previous conversations are under History.</div>}
        </div>
        {wrong && <MarkWrong {...wrong} bot={bot} api={api} showToast={showToast} onClose={() => setWrong(null)} />}
        {failed && (
          <div className="ait-err" role="alert" style={{ marginTop: 8 }}>
            Not sent: {failed.message}{' '}
            <button className="btn btn-g btn-sm" disabled={busy} onClick={() => submit(failed.text, failed.clientTurnId)}><Mi>refresh</Mi>Retry</button>
          </div>
        )}
        <form className="ea-row" onSubmit={send} style={{ marginTop: 12 }}>
          <input className="fi" value={text} onChange={e => setText(e.target.value)} placeholder="Write as the customer…" aria-label="Customer message" maxLength={2000} style={{ minWidth: 0, flex: 1 }} />
          <button className="btn btn-p" disabled={busy || !text.trim() || (convId && !conv)}><Mi>send</Mi>{busy ? '…' : 'Send'}</button>
        </form>
        <div className="ait-trace" role="note">Messages are saved exactly as typed and other trainers can see them. Do not paste a real customer's phone number, email or other personal details.</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
        <div className="analytics-card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SelectRoot value={bot} onChange={setBot} disabled={locked}>
            <SelectLabel>Bot</SelectLabel>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectPopover><SelectListBox>
              <SelectItem value="eyad">eyad</SelectItem>
              <SelectItem value="dubai">dubai</SelectItem>
            </SelectListBox></SelectPopover>
          </SelectRoot>
          {source === 'drafts' && (
            <SelectRoot value={promptSel} onChange={setPromptSel}>
              <SelectLabel>System Prompt</SelectLabel>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectPopover><SelectListBox>
                <SelectItem value="published">Published</SelectItem>
                <SelectItem value="draft">Latest draft</SelectItem>
              </SelectListBox></SelectPopover>
            </SelectRoot>
          )}
          <SelectRoot value={source} onChange={setSource} disabled={locked}>
            <SelectLabel>Version</SelectLabel>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectPopover><SelectListBox>
              <SelectItem value="drafts">Current drafts</SelectItem>
              {snapshots.map(s => <SelectItem key={s.id} value={s.id}>v{s.version_no} ({s.status})</SelectItem>)}
            </SelectListBox></SelectPopover>
          </SelectRoot>
          <label style={{ display: 'inline-flex', gap: 6 }}><input type="checkbox" disabled={locked} checked={setup.isAd} onChange={e => setSetup(v => ({ ...v, isAd: e.target.checked }))} />Came from an ad</label>
          {setup.isAd && <input className="fi" disabled={locked} placeholder="Ad text" value={setup.adText} onChange={e => setSetup(v => ({ ...v, adText: e.target.value }))} />}
          <label style={{ display: 'inline-flex', gap: 6 }}><input type="checkbox" disabled={locked} checked={setup.returning} onChange={e => setSetup(v => ({ ...v, returning: e.target.checked }))} />Returning contact</label>
          {locked && <div className="ait-trace">Bot, version and setup are fixed for this conversation. Start a new one to change them.</div>}
          <div className="ait-trace">State: {state ? `project ${names[state.active_project] || state.active_project || 'none'}, language ${state.language || 'unknown'}` : 'new conversation'}</div>
        </div>
        <div className="analytics-card">
          <History api={api} bot={bot} current={conv} onOpen={choose} onNew={startNew} />
        </div>
      </div>
    </div>
  );
}
