import { useEffect, useState } from 'react';
import Mi from '../Mi.jsx';

// Multi-turn chat against drafts or any snapshot, through the same core the
// bots will run. Nothing is sent on WhatsApp. Each bot reply shows its trace,
// and a wrong reply can be saved as an example and a regression test.
const SETUP = { isAd: false, adText: '', returning: false };

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

export default function PlaygroundTab({ api, showToast }) {
  const [bot, setBot] = useState('eyad');
  const [source, setSource] = useState('drafts');
  const [snapshots, setSnapshots] = useState([]);
  const [setup, setSetup] = useState(SETUP);
  const [turns, setTurns] = useState([]);
  const [state, setState] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(null);
  const [names, setNames] = useState({});

  useEffect(() => {
    api('snapshot.list').then(setSnapshots).catch(() => {});
    api('items.list').then(rows => setNames(Object.fromEntries(rows.map(r => [r.id, r.body.name || r.body.topic || r.body.title || r.kind])))).catch(() => {});
  }, [api]);

  const history = turns.flatMap(t => [{ role: 'customer', text: t.customer }, ...(t.reply ? [{ role: 'bot', text: t.reply }] : [])]);
  const reset = () => { setTurns([]); setState(null); setWrong(null); };

  const send = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    const isSnap = source !== 'drafts';
    try {
      const d = await api('playground.turn', { bot, source: isSnap ? 'snapshot' : 'drafts', snapshot_id: isSnap ? source : undefined,
        text, history, state, setup: { ...setup, returning: setup.returning || turns.length > 0 } });
      // A saved test replays this exact turn, so keep what it started from.
      const sent = { returning: setup.returning || turns.length > 0, stateBefore: state, historyBefore: history };
      setTurns(v => [...v, { customer: text, setup, ...sent, ...d.result, checksum: d.checksum }]);
      setState(d.result.stateNext);
      setText('');
    } catch (x) {
      showToast(x.code === 'freeze' ? `Drafts have errors: ${(x.details || []).join('; ')}` : x.message, 'err');
    } finally { setBusy(false); }
  };

  return (
    <div className="ait-grid">
      <div className="analytics-card">
        <div className="ait-chat" aria-live="polite">
          {turns.map((t, n) => (
            <div key={n} style={{ display: 'contents' }}>
              <div className="ait-msg customer">{t.customer}</div>
              <div className="ait-msg bot">
                {t.reply || <i>(no reply: {t.outcome})</i>}
                {t.media?.map((m, i) => <div key={i} className="ait-trace"><Mi>{m.type === 'document' ? 'description' : 'image'}</Mi> {m.caption}</div>)}
                <div className="ait-trace">
                  {t.outcome}{t.handoff ? ' · handoff' : ''} · project: {(t.trace?.project?.projects || []).map(id => names[id] || id).join(', ') || 'none'}
                  {' '}· used: {(t.trace?.used_item_ids || []).map(id => names[id] || id).join(', ') || 'none'}
                  {t.trace?.guard_errors?.length ? ` · guards: ${t.trace.guard_errors.join(', ')}` : ''}
                  {t.trace?.media_missing?.length ? ` · missing media: ${t.trace.media_missing.join(', ')}` : ''}
                </div>
                <button className="btn btn-g btn-sm" onClick={() => setWrong({ turn: t, history: t.historyBefore })}><Mi>edit</Mi>Mark wrong</button>
              </div>
            </div>
          ))}
        </div>
        {wrong && <MarkWrong {...wrong} bot={bot} api={api} showToast={showToast} onClose={() => setWrong(null)} />}
        <form className="ea-row" onSubmit={send} style={{ marginTop: 12 }}>
          <input className="fi" value={text} onChange={e => setText(e.target.value)} placeholder="Write as the customer…" aria-label="Customer message" maxLength={2000} />
          <button className="btn btn-p" disabled={busy || !text.trim()}><Mi>send</Mi>{busy ? '…' : 'Send'}</button>
        </form>
      </div>
      <div className="analytics-card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label>Bot <select className="fi" value={bot} onChange={e => { setBot(e.target.value); reset(); }}><option value="eyad">eyad</option><option value="dubai">dubai</option></select></label>
        <label>Version <select className="fi" value={source} onChange={e => { setSource(e.target.value); reset(); }}>
          <option value="drafts">Current drafts</option>
          {snapshots.map(s => <option key={s.id} value={s.id}>v{s.version_no} ({s.status})</option>)}
        </select></label>
        <label style={{ display: 'inline-flex', gap: 6 }}><input type="checkbox" checked={setup.isAd} onChange={e => setSetup(v => ({ ...v, isAd: e.target.checked }))} />Came from an ad</label>
        {setup.isAd && <input className="fi" placeholder="Ad text" value={setup.adText} onChange={e => setSetup(v => ({ ...v, adText: e.target.value }))} />}
        <label style={{ display: 'inline-flex', gap: 6 }}><input type="checkbox" checked={setup.returning} onChange={e => setSetup(v => ({ ...v, returning: e.target.checked }))} />Returning contact</label>
        <div className="ait-trace">State: {state ? `project ${names[state.active_project] || state.active_project || 'none'}, language ${state.language || '—'}` : 'new conversation'}</div>
        <button className="btn btn-g" onClick={reset}><Mi>refresh</Mi>Reset conversation</button>
      </div>
    </div>
  );
}
