// One unit, in a bottom sheet: the phone version of the web's ShopCard.jsx with its
// CustomerField.jsx and BookPanel.jsx. Top to bottom: what the unit is (code, status,
// price, size), who it is for (picked once), then three tabs that all work for that
// customer: Book (Details when taken), Documents, History.
//
// Booking is the web's: the unit goes on hold and management gets a hold request
// (setUnitStatus + createHoldRequest, the same two writes, the same fields).
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Badge, Button, Card, Chip, Field, ListItem, Row, SearchField, Segmented, Sheet, T, useUI } from '../../ui';
import { useTheme, space } from '../../theme';
import { useApp } from '../../store';
import { useLeadBook } from '../../hooks';
import { canCustomers, canPrices } from '../../../../src/lib/constants.js';
import { createHoldRequest, getLeads } from '../../../../src/lib/db.js';
import { setUnitStatus, findUnit, getProjectById } from '../../../../src/lib/projects.js';
import { STATUS, taka } from '../../../../src/lib/floorPlan.js';
import { shopLabel } from '../../../../src/lib/floorText.js';
import { DOCS, docReady } from '../../../../src/lib/shopDocs.js';
import { useShopDocs, day, tileColors } from './bits';
import { DocsTab, HistoryTab } from './ShopDocs';

const STEPS = [0, 2, 5, 10]; // BookPanel: quick customer-price steps below the list price

// CustomerField.jsx: search the account's own leads (getLeads, as the web does; the lead
// book is loaded for it), the first six by name or phone.
function CustomerField({ client, setClient }) {
  const { user, dbVersion } = useApp();
  void dbVersion;
  const ready = useLeadBook(true);
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const matches = term ? getLeads(user).filter((l) => `${l.name || ''} ${l.phone || ''}`.toLowerCase().includes(term)).slice(0, 6) : [];
  return (
    <View style={{ gap: space.sm }}>
      <T v="small" tone="sub" style={{ fontWeight: '600' }}>Customer</T>
      {client ? (
        <Card pad={false}>
          <ListItem icon="person" title={client.name || 'Unnamed customer'} detail={client.phone || 'No phone'}
            right={<T v="small" tone="sub">Change</T>} onPress={() => { setClient(null); setQ(''); }} last />
        </Card>
      ) : (
        <>
          <SearchField value={q} onChangeText={setQ} placeholder="Search by name or phone" />
          {term ? (matches.length ? (
            <Card pad={false}>
              {matches.map((l, i) => (
                <ListItem key={l.id} icon="person" title={l.name || 'Unnamed customer'} detail={l.phone} last={i === matches.length - 1}
                  onPress={() => { setClient(l); setQ(''); }} />
              ))}
            </Card>
          ) : <T v="small" tone="mute">{ready ? 'No customer found. Add them in Leads first.' : 'Loading customers…'}</T>) : null}
        </>
      )}
    </View>
  );
}

// BookPanel.jsx, the part above the button: a taken unit's details, or the customer price.
function BookBody({ shop, offer, setOffer }) {
  const { user } = useApp();
  const t = useTheme();
  if (shop.status !== 'available') {
    const sold = shop.status === 'sold';
    const rows = [
      ['Customer', shop.clientName],
      ['Contact', shop.clientPhone],
      [sold ? 'Booked' : 'Held since', day(shop.bookingDate)],
      ['Paid', day(shop.paymentDate)],
      ['Held by', !sold ? shop.heldByName : ''],
      ['Hold until', !sold ? day(shop.holdUntil) : ''],
    ].filter(([, v]) => v);
    const c = tileColors(t, shop);
    return (
      <View style={{ gap: space.md }}>
        <Card style={{ borderLeftWidth: 4, borderLeftColor: c.stroke }}>
          <T v="strong">{shop.look?.label || (shop.status === 'hold' ? 'On hold' : 'Sold')}</T>
          <T v="small" tone="sub">
            {!canCustomers(user) ? 'Customer details are hidden for your account'
              : rows.length ? `${sold ? 'Sold to' : 'Held for'} ${shop.clientName || 'a customer'}` : 'No customer recorded'}
          </T>
        </Card>
        {rows.length ? (
          <Card pad={false}>
            {rows.map(([k, v], i) => <ListItem key={k} title={v} detail={k} last={i === rows.length - 1} />)}
          </Card>
        ) : null}
      </View>
    );
  }
  const price = parseFloat(offer) || 0;
  return (
    <View style={{ gap: space.sm }}>
      <Field label="Customer price (৳)" value={offer} onChangeText={setOffer} keyboardType="numeric"
        placeholder={shop.price > 0 ? String(Math.round(shop.price)) : '0'} />
      {shop.price > 0 ? (
        <Row wrap>
          {STEPS.map((p) => {
            const v = Math.round(shop.price * (1 - p / 100));
            return <Chip key={p} label={p === 0 ? 'List' : `−${p}%`} active={v === Math.round(price)} onPress={() => setOffer(String(v))} />;
          })}
        </Row>
      ) : null}
    </View>
  );
}

export default function ShopSheet({ visible, project, plan, shop, onClose }) {
  const { user, refresh } = useApp();
  const { toast } = useUI();
  const seePrice = canPrices(user);
  const [client, setClient] = useState(null);
  const [tab, setTab] = useState('book');
  const [offer, setOffer] = useState('');
  const store = useShopDocs(project.id, shop?.code, project);

  // A new unit starts with no customer and its list price (ShopCard is keyed by the unit code).
  useEffect(() => {
    setClient(null);
    setOffer(shop?.price > 0 ? String(Math.round(shop.price)) : '');
  }, [project.id, shop?.code]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!shop) return <Sheet visible={false} onClose={onClose} title="" />;

  const open = shop.status === 'available';
  const ready = store.loaded && !store.missing ? `${DOCS.filter((d) => docReady(d, store.lib)).length}/${DOCS.length}` : '';
  const tabs = [
    { value: 'book', label: open ? 'Book' : 'Details' },
    { value: 'docs', label: ready ? `Documents ${ready}` : 'Documents' },
    { value: 'hist', label: store.log.length ? `History ${store.log.length}` : 'History' },
  ];
  const facts = [shop.size ? `${shop.size.toLocaleString('en-IN')} sq ft` : '', shop.beds ? `${shop.beds} bed${shop.beds > 1 ? 's' : ''}` : '', shop.baths ? `${shop.baths} bath${shop.baths > 1 ? 's' : ''}` : '', shop.type, shop.ownership].filter(Boolean);
  const headline = !seePrice || shop.status === 'sold' ? (shop.size ? `${shop.size.toLocaleString('en-IN')} sq ft` : '—') : shop.price ? taka(shop.price) : 'Price on request';
  const sub = [shop.rate > 0 && shop.status !== 'sold' && seePrice ? `${taka(shop.rate)} / sq ft` : '', ...facts].filter(Boolean).join(' · ');
  const statusTone = shop.look?.color ? undefined : shop.status === 'available' ? 'brand' : shop.status === 'hold' ? 'warn' : 'neutral';

  // BookPanel book(): the unit goes on hold and management gets the request.
  const price = parseFloat(offer) || 0;
  const perSqft = shop.size > 0 && price > 0 ? price / shop.size : 0;
  const canBook = open && !!client && price > 0;
  const book = () => {
    if (!canBook) return;
    // Held or sold meanwhile on another device (realtime): never request it.
    if (findUnit(getProjectById(project.id), shop.code)?.unit.status !== 'available') { toast('This unit is no longer available. Pick another one.', 'err'); onClose(); return; }
    setUnitStatus(project.id, shop.variantId, shop.code, 'hold', { user, client: { id: client.id, name: client.name }, note: 'Hold requested' });
    createHoldRequest({
      propertyId: project.id, propertyName: project.name, variantId: shop.variantId, variantName: shop.type, unitId: shop.code,
      clientName: client.name, clientPhone: client.phone, dealTotal: price, offerRate: perSqft,
    }, user);
    refresh();
    toast(`Shop ${shop.code} booking sent to management for ${client.name}`, 'ok');
    onClose();
  };
  const bookLabel = `${/^shop/i.test(shop.type || shop.code) ? 'Book shop' : 'Book unit'} ${shop.code}`;

  return (
    <Sheet visible={visible} onClose={onClose} title={shopLabel(shop.code)}
      footer={tab === 'book' && open ? (
        <>
          <T v="small" tone="mute" style={{ textAlign: 'center' }}>
            {!client ? 'Choose a customer above to continue.' : price > 0 ? 'Sent to management for approval; the shop is held meanwhile.' : 'Enter the customer price.'}
          </T>
          <Button label={bookLabel} icon="event-seat" disabled={!canBook} onPress={book} testID="book-unit" />
        </>
      ) : null}>
      <Card style={{ gap: space.xs }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <T v="tiny" tone="mute" style={{ flex: 1 }} numberOfLines={1}>{`${plan?.name || ''}${shop.category ? ` · ${shop.category}` : ''}`.toUpperCase()}</T>
          <Badge label={shop.look?.label || STATUS[shop.status]?.label} tone={statusTone} />
        </Row>
        <T v="title">{headline}</T>
        {sub ? <T v="small" tone="sub">{sub}</T> : null}
      </Card>

      {open || tab === 'docs' ? <CustomerField client={client} setClient={setClient} /> : null}

      <Segmented options={tabs} value={tab} onChange={setTab} />

      {tab === 'docs' ? <DocsTab project={project} shop={shop} floorName={plan?.name || ''} store={store} client={client} />
        : tab === 'hist' ? <HistoryTab project={project} shop={shop} store={store} />
          : <BookBody shop={shop} offer={offer} setOffer={setOffer} />}
    </Sheet>
  );
}
