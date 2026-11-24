import { useState } from 'react';
import Mi from '../Mi.jsx';
import useNavState from '../../hooks/useNavState.js';
import useShopDocs from '../../hooks/useShopDocs.js';
import { STATUS, taka } from '../../lib/floorPlan.js';
import { shopLabel } from '../../lib/floorText.js';
import { DOCS, docReady } from '../../lib/shopDocs.js';
import BookPanel from './BookPanel.jsx';
import CustomerField from './CustomerField.jsx';
import { DocsTab, HistoryTab } from './ShopDocs.jsx';

// The right-hand card for one shop, top to bottom: what it is (code, status,
// price, size), who it is for (picked once), then three tabs that all work for
// that customer: Book, Documents, History. Rendered with key = shop code, so a
// new shop starts with no customer.
// `bare`: the phone sheet already shows the shop's name and price, so only the
// customer and the tabs are drawn; `onDone` runs after a booking is sent.
export default function ShopCard({ project, plan, shop, onClose, bare = false, onDone }) {
  const [client, setClient] = useState(null);
  const [tab, setTab] = useNavState('booking.tab', 'book');
  const store = useShopDocs(project.id, shop.code, project);
  const open = shop.status === 'available';
  const ready = store.loaded && !store.missing ? `${DOCS.filter(d => docReady(d, store.lib)).length}/${DOCS.length}` : '';
  const tabs = [['book', open ? 'Book' : 'Details', ''], ['docs', 'Documents', ready], ['hist', 'History', store.log.length ? String(store.log.length) : '']];
  const facts = [shop.size ? `${shop.size.toLocaleString('en-IN')} sq ft` : '', shop.beds ? `${shop.beds} bed${shop.beds > 1 ? 's' : ''}` : '', shop.baths ? `${shop.baths} bath${shop.baths > 1 ? 's' : ''}` : '', shop.type, shop.ownership].filter(Boolean);

  return (
    <div className={bare ? 'bk-card bare' : 'bk-card'}>
      {!bare && (
        <>
      <div className="bk-sd-head">
        <div>
          <span className="bk-eyebrow">{plan.name}{shop.category ? ` · ${shop.category}` : ''}</span>
          <h3>{shopLabel(shop.code)}</h3>
        </div>
        <span className={`bk-pill s-${shop.status}`} style={shop.look.color ? { '--bk-c': shop.look.color } : undefined}>
          <i className="bk-dot" />{shop.look.label || STATUS[shop.status]?.label}
        </span>
        <button type="button" className="bk-close" aria-label="Close" onClick={onClose}><Mi>close</Mi></button>
      </div>

      <div className="bk-sd-price">
        <div className="bk-price">{shop.price ? taka(shop.price) : 'Price on request'}</div>
        <span className="bk-fx">{[shop.rate > 0 ? `${taka(shop.rate)} / sq ft` : '', ...facts].filter(Boolean).join(' · ')}</span>
      </div>

        </>
      )}

      {(open || tab === 'docs') && <CustomerField client={client} setClient={setClient} />}

      <div className="bkd-tabs" role="tablist">
        {tabs.map(([k, l, c]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}{c && <span className="ct">{c}</span>}</button>
        ))}
      </div>

      {tab === 'docs' ? <DocsTab project={project} shop={shop} floorName={plan.name} store={store} client={client} />
        : tab === 'hist' ? <HistoryTab project={project} shop={shop} store={store} />
          : <BookPanel project={project} shop={shop} client={client} onDone={onDone} />}
    </div>
  );
}
