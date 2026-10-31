import { useState } from 'react';
import Mi from '../Mi.jsx';
import ItemEditor from './ItemEditor.jsx';
import ItemList from './ItemList.jsx';
import { useItems } from './useItems.js';
import { TrainingManager } from '../wa/RelayParts.jsx';

// Behaviour instructions (tone, discovery, pricing, handoff…) and conversation
// examples. Examples also come from the Playground's "Mark wrong" action and
// from Live replies below.
export default function BehaviourTab({ api, showToast }) {
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
  // A live reply corrected here is stored twice: the legacy correction row
  // (what the live bots use today, unchanged) and a draft example (what the
  // trainer uses once a snapshot is published).
  const saveExample = async (item, ideal) => {
    try {
      await api('items.create', { kind: 'example', bots: [String(item.conversationId).startsWith('dubai:') ? 'dubai' : 'eyad'], project_ref: null, body: {
        conversation: [{ role: 'customer', text: item.customerMessage || '(no text)' }],
        original_reply: item.aiReply, ideal_reply: ideal, reason: 'live reply corrected', source: 'real', source_ref: String(item.id) } });
      showToast('Correction saved, and added as a draft example', 'ok');
      reload();
    } catch (e) {
      showToast(e.code === 'duplicate' ? 'Correction saved. The draft example already exists.' : `Correction saved, but the draft example was not: ${e.message}`, e.code === 'duplicate' ? 'ok' : 'err');
    }
  };
  return (
    <div className="ait">
      {section('behaviour', 'Behaviour instructions')}
      {section('example', 'Conversation examples')}
      <TrainingManager showToast={showToast} onSaved={saveExample} />
      {edit && <ItemEditor kind={edit.kind} initial={edit.item} projects={projects} api={api} showToast={showToast} onClose={() => setEdit(null)} onSaved={reload} />}
    </div>
  );
}
