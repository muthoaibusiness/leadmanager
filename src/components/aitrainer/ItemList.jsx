import Mi from '../Mi.jsx';

// Active items of one kind, with edit and retire buttons.
export default function ItemList({ items, kind, projects, onEdit, onRetire }) {
  const rows = items.filter(i => i.kind === kind && i.status === 'active');
  if (!rows.length) return <div className="ea-count">None yet.</div>;
  const pname = (id) => projects.find(p => p.id === id)?.body.name;
  return (
    <div className="ait-list">
      {rows.map(i => (
        <div className="ait-row" key={i.id}>
          <div>
            <div style={{ fontWeight: 600 }}>{i.body.name || i.body.topic || i.body.aspect || i.body.ideal_reply?.slice(0, 60)}</div>
            <div>{i.body.text || i.body.must || i.body.instruction || i.body.address || i.body.reason || ''}</div>
            <div className="meta">rev {i.revision} · {i.bots.join(', ')}{i.project_ref ? ` · ${pname(i.project_ref) || 'unknown project'}` : ''}</div>
          </div>
          <div className="ea-row">
            <button className="btn btn-g btn-sm" onClick={() => onEdit(i)} aria-label="Edit"><Mi>edit</Mi></button>
            <button className="btn btn-g btn-sm" onClick={() => onRetire(i)} aria-label="Retire"><Mi>delete</Mi></button>
          </div>
        </div>
      ))}
    </div>
  );
}
