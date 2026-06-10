import Mi from './Mi.jsx';
import { actIcon, actClr } from '../lib/helpers.js';

// Shared activity timeline — funnel-row concept used everywhere (Contacts, Lead
// panel, Team activity): minimal outline-icon badge → chevron → text → time.
// items: [{ id, type, description, actor?, sub?, time? }]
export default function ActivityTimeline({ items, empty = 'No activity recorded.' }) {
  if (!items || !items.length) {
    return <div className="atl-empty"><Mi>history</Mi>{empty}</div>;
  }
  return (
    <div className="atl">
      {items.map(a => (
        <div key={a.id} className="atl-row">
          <span className="atl-badge" style={{ color: actClr(a.type), borderColor: actClr(a.type) }}>
            <Mi>{actIcon(a.type)}</Mi>
          </span>
          <span className="atl-chev"><Mi>chevron_right</Mi></span>
          <div className="atl-bd">
            {a.actor && <div className="atl-actor" style={{ color: actClr(a.type) }}>{a.actor}</div>}
            <div className="atl-desc">{a.description}</div>
            {a.sub && <div className="atl-sub">{a.sub}</div>}
          </div>
          {a.time && <span className="atl-time">{a.time}</span>}
        </div>
      ))}
    </div>
  );
}
