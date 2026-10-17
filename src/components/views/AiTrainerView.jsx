import { useCallback, useState } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import useNavState from '../../hooks/useNavState.js';
import { isChatAdmin } from '../../lib/wa.js';
import { getTrainerKey, setTrainerKey, clearTrainerKey, trainerCall } from '../../lib/aiTrainer.js';
import KnowledgeTab from '../aitrainer/KnowledgeTab.jsx';
import BehaviourTab from '../aitrainer/BehaviourTab.jsx';
import PlaygroundTab from '../aitrainer/PlaygroundTab.jsx';
import QualityTab from '../aitrainer/QualityTab.jsx';
import '../aitrainer/aitrainer.css';

// AI Trainer: Management trains the WhatsApp bot here. Edits are drafts; the
// bots only use a snapshot after it passes every regression test and is
// published (docs/superpowers/specs/2026-10-18-wecon-ai-trainer-design.md).
// isChatAdmin only decides what to show; the server checks the access key.
const TABS = [
  ['knowledge', 'Knowledge', 'menu_book'],
  ['behaviour', 'Behaviour', 'psychology'],
  ['playground', 'Playground', 'chat'],
  ['quality', 'Quality & Publish', 'fact_check'],
];

function KeyGate({ user, onOk }) {
  const [k, setK] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    setTrainerKey(k.trim());
    try { await trainerCall(user, 'auth.check'); onOk(); }
    catch (x) { clearTrainerKey(); setErr(x.message); }
    finally { setBusy(false); }
  };
  return (
    <form className="ait-gate" onSubmit={submit}>
      <Mi>key</Mi>
      <p>Enter the AI Trainer access key. It is kept for this browser tab only.</p>
      <input className="fi" type="password" autoComplete="off" value={k} onChange={e => setK(e.target.value)} aria-label="AI Trainer access key" />
      {err && <div className="ait-err" role="alert">{err}</div>}
      <button className="btn btn-p" disabled={busy || !k.trim()}>{busy ? 'Checking…' : 'Unlock'}</button>
    </form>
  );
}

export default function AiTrainerView() {
  const { user, showToast } = useApp();
  const [tab, setTab] = useNavState('aitrainer.tab', 'knowledge');
  const [unlocked, setUnlocked] = useState(() => !!getTrainerKey());
  // Stable across renders: the tabs load data in effects keyed on `api`, so a
  // new function every render would refetch in a loop.
  const api = useCallback((action, payload) => trainerCall(user, action, payload).catch((e) => {
    if (e.status === 401) setUnlocked(false);
    throw e;
  }), [user]);
  if (!isChatAdmin(user)) return <div className="ea-count" style={{ padding: 18 }}>Only Management can use the AI Trainer.</div>;
  if (!unlocked) return <KeyGate user={user} onOk={() => setUnlocked(true)} />;
  const props = { api, showToast, user };
  return (
    <div className="ait">
      <div className="fin-tabs" role="tablist" aria-label="AI Trainer sections">
        {TABS.map(([k, l, ic]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            <Mi>{ic}</Mi>{l}
          </button>
        ))}
      </div>
      {tab === 'knowledge' && <KnowledgeTab {...props} />}
      {tab === 'behaviour' && <BehaviourTab {...props} />}
      {tab === 'playground' && <PlaygroundTab {...props} />}
      {tab === 'quality' && <QualityTab {...props} />}
    </div>
  );
}
