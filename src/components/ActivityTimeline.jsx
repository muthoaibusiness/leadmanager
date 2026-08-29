import Mi from './Mi.jsx';
import { actIcon, actClr, parseOfferDesc } from '../lib/helpers.js';

// Shared activity timeline — funnel-row concept used everywhere (Contacts, Lead
// panel, Team activity): minimal outline-icon badge → chevron → text → time.
// items: [{ id, type, description, actor?, sub?, time?, onClick? }]
// An item with onClick becomes a keyboard-reachable row — used by the Team
// Activity feed to jump from an entry to the customer it belongs to.

// OFFER rows carry a JSON payload; render it as labelled figures, everything
// else stays a plain sentence.
function Desc({ type, description }) {
  const offer = type === 'OFFER' ? parseOfferDesc(description) : null;
  if (!offer) return <div className="atl-desc">{description}</div>;
  return (
    <div className="atl-desc">
      <div className="atl-offer-ttl">Offer submitted</div>
      <div className="atl-offer">
        {offer.rows.map(r => (
          <span key={r.label} className={`atl-offer-item${r.strong ? ' atl-offer-key' : ''}`}>
            <span className="atl-offer-lbl">{r.label}</span>
            <span className="atl-offer-val">{r.value}</span>
          </span>
        ))}
      </div>
      {offer.notes && <div className="atl-offer-notes">{offer.notes}</div>}
    </div>
  );
}

export default function ActivityTimeline({ items, empty = 'No activity recorded.' }) {
  if (!items || !items.length) {
    return <div className="atl-empty"><Mi>history</Mi>{empty}</div>;
  }
  return (
    <div className="atl">
      {items.map(a => (
        <div
          key={a.id}
          className={`atl-row${a.onClick ? ' atl-click' : ''}`}
          onClick={a.onClick}
          role={a.onClick ? 'button' : undefined}
          tabIndex={a.onClick ? 0 : undefined}
          onKeyDown={a.onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); a.onClick(); } } : undefined}
        >
          <span className="atl-badge" style={{ color: actClr(a.type), borderColor: actClr(a.type) }}>
            <Mi>{actIcon(a.type)}</Mi>
          </span>
          <span className="atl-chev"><Mi>chevron_right</Mi></span>
          <div className="atl-bd">
            {a.actor && <div className="atl-actor" style={{ color: actClr(a.type) }}>{a.actor}</div>}
            <Desc type={a.type} description={a.description} />
            {a.sub && <div className="atl-sub">{a.sub}</div>}
          </div>
          {a.time && <span className="atl-time">{a.time}</span>}
        </div>
      ))}
    </div>
  );
}
