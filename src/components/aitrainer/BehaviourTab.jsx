import { useState } from 'react';
import Mi from '../Mi.jsx';
import ItemEditor from './ItemEditor.jsx';
import ItemList from './ItemList.jsx';
import { useItems } from './useItems.js';

// Behaviour instructions (tone, discovery, pricing, handoff…) and conversation
// examples. Examples also come from the Playground's "Mark wrong" action.
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
  return (
    <div className="ait">
      {section('behaviour', 'Behaviour instructions')}
      {section('example', 'Conversation examples')}
      {edit && <ItemEditor kind={edit.kind} initial={edit.item} projects={projects} api={api} showToast={showToast} onClose={() => setEdit(null)} onSaved={reload} />}
    </div>
  );
}
