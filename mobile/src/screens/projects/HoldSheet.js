// A unit's bottom sheet. For an available unit it is the hold request: the
// project console's deal cart (src/components/project/ProjectConsole.jsx) on
// one sheet. Same fields (your offer, customer offer, fast-close, add-ons, an
// existing customer), the same numbers (computeDeal in src/lib/deal.js on the
// unit's own size and price, pricedVariant), the same rule (a customer must be
// picked) and the same two writes as the console's holdUnit(): the unit goes
// on hold under the project's Reserved tag, and management gets the request.
//
// For a unit already held or sold it shows what the console's tile tooltip
// shows, and the two ways back the web has: the requester cancels a request
// (console releaseHold), management unholds (RequestsView unholdUnit).
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Badge, Button, Card, Chip, Field, ListItem, Loading, Row, SearchField, Sheet, T, useUI } from '../../ui';
import { space } from '../../theme';
import { useApp } from '../../store';
import { useDebounced } from '../../hooks';
import { ROLES, canSee } from '../../../../src/lib/constants.js';
import { createHoldRequest, decideHoldRequest, getHoldRequests, queryLeads } from '../../../../src/lib/db.js';
import { findUnit, getProjectById, pricedVariant, reservedTag, setUnitStatus, unitPrice, unitSize } from '../../../../src/lib/projects.js';
import { computeDeal, emptyDeal } from '../../../../src/lib/deal.js';
import { UNIT_TONE, crShort, dayMonth, taka, unitLook } from './bits';

// The console's setRate(): empty = not set, else the number typed.
const rate = (s) => { const n = parseFloat(s); return s === '' || !Number.isFinite(n) ? null : n; };

function Line({ label, value, strong, tone }) {
  return (
    <Row style={{ justifyContent: 'space-between' }}>
      <T v={strong ? 'strong' : 'small'} tone={strong ? undefined : 'sub'} style={{ flex: 1 }}>{label}</T>
      <T v={strong ? 'strong' : 'small'} tone={tone}>{value}</T>
    </Row>
  );
}

export default function UnitSheet({ visible, onClose, project: p, variant, unit, navigation }) {
  const { user, refresh } = useApp();
  const { toast, confirm } = useUI();
  const [offer, setOffer] = useState('');
  const [cust, setCust] = useState('');
  const [fastClose, setFastClose] = useState(false);
  const [addons, setAddons] = useState({});
  const [client, setClient] = useState({ name: '', phone: '' });
  const [cq, setCq] = useState('');
  const [matches, setMatches] = useState(null); // null = searching
  const search = useDebounced(cq.trim(), 300);

  // Each unit starts its own deal.
  useEffect(() => {
    if (!visible) return;
    setOffer(''); setCust(''); setFastClose(false); setAddons({}); setClient({ name: '', phone: '' }); setCq(''); setMatches(null);
  }, [visible, unit?.id]);

  // Offers go to an existing customer: this account's own leads, by name or
  // phone, the first six. The console filters getLeads(user) in memory; the
  // phone does not hold the lead book, so the same set is asked of the server.
  useEffect(() => {
    if (!visible || !search) { setMatches(null); return undefined; }
    let live = true;
    setMatches(null);
    queryLeads({ user, involved: false, search }, { page: 0, size: 6 }).then((res) => { if (live) setMatches(res ? res.rows : []); });
    return () => { live = false; };
  }, [visible, search, user]);

  if (!p || !variant || !unit) return <Sheet visible={false} onClose={onClose} title="" />;

  const lk = unitLook(p.unitStatuses, unit);
  const size = unitSize(unit, variant);
  const price = unitPrice(unit, variant);
  const title = `Unit ${unit.id}`;
  const about = (
    <Card style={{ gap: space.xs }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <T v="strong" style={{ flex: 1 }} numberOfLines={1}>{variant.name || 'Type'}</T>
        <Badge label={lk.label} tone={UNIT_TONE[unit.status]} />
      </Row>
      <T v="small" tone="sub">{[size > 0 ? `${size.toLocaleString('en-IN')} sqft` : '', price > 0 ? `${crShort(price)} at list` : ''].filter(Boolean).join(' · ') || 'No size or price yet'}</T>
    </Card>
  );

  // ── held or sold ──────────────────────────────────────────────────────────
  if (unit.status !== 'available') {
    const approved = !!unit.holdUntil;
    const isHold = unit.status === 'hold';
    const mine = isHold && unit.heldBy === user.id;
    const isMgmt = user.role === ROLES.MGMT;
    // Console releaseHold(): the unit is available again; nothing else changes.
    const release = () => confirm({
      title: approved ? 'Release this hold?' : 'Cancel this request?',
      description: `Unit ${unit.id} becomes available again.`,
      confirmLabel: approved ? 'Release hold' : 'Cancel request', danger: true,
      onConfirm: () => {
        setUnitStatus(p.id, variant.id, unit.id, 'available', { user });
        refresh(); onClose(); toast(`Unit ${unit.id} released`);
      },
    });
    // RequestsView unholdUnit(): available again, and its pending requests are rejected.
    const unhold = () => confirm({
      title: 'Unhold this unit?',
      description: `Unit ${unit.id} becomes available again. A pending request for it is rejected.`,
      confirmLabel: 'Unhold', danger: true,
      onConfirm: () => {
        setUnitStatus(p.id, variant.id, unit.id, 'available', { user });
        getHoldRequests().filter((x) => x.propertyId === p.id && x.unitId === unit.id && x.status === 'pending').forEach((x) => decideHoldRequest(x.id, false, user));
        refresh(); onClose(); toast(`Unit ${unit.id} is available again`);
      },
    });
    return (
      <Sheet visible={visible} onClose={onClose} title={title}
        footer={isHold && isMgmt ? <Button label="Unhold" icon="lock-open" tone="danger" variant="soft" onPress={unhold} />
          : mine ? <Button label={approved ? 'Release hold' : 'Cancel request'} variant="ghost" onPress={release} /> : null}>
        {about}
        <Card pad={false}>
          {unit.clientName ? <ListItem icon="person" title={unit.clientName} detail="Client" /> : null}
          {isHold && approved ? <ListItem icon="verified" title={`Booked by management until ${dayMonth(unit.holdUntil)}`} tone="brand" />
            : isHold && unit.note === 'Hold requested' ? <ListItem icon="hourglass-top" title="Awaiting management approval…" tone="warn" /> : null}
          {unit.heldByName ? <ListItem icon="support-agent" title={unit.heldByName} detail={isHold ? 'Held by' : 'Sold by'} last /> : null}
        </Card>
      </Sheet>
    );
  }

  // ── available: the hold request ───────────────────────────────────────────
  const deal = { ...emptyDeal(), variantId: variant.id, unitId: unit.id, offerRate: rate(offer), custRate: rate(cust), fastClose, addons, client };
  const pv = pricedVariant(variant, unit.id); // the unit's own size and price, when it has them
  const calc = computeDeal(deal, pv, p);
  const canAddLead = canSee(user, 'add_customer');
  const addLead = () => { onClose(); navigation.navigate('AddLead', { interest: p.name }); };

  const send = () => {
    if (!deal.client.id) { toast('Select an existing customer to continue', 'err'); return; }
    // Sold or held meanwhile by someone else (realtime): never request it.
    if (findUnit(getProjectById(p.id), unit.id)?.unit.status !== 'available') { toast('This unit is no longer available. Pick another one.', 'err'); onClose(); return; }
    setUnitStatus(p.id, variant.id, unit.id, 'hold', { user, client: { id: deal.client.id, name: deal.client.name }, note: 'Hold requested', tag: reservedTag(p) });
    createHoldRequest({
      propertyId: p.id, propertyName: p.name, variantId: variant.id, variantName: variant.name, unitId: unit.id,
      clientName: deal.client.name, clientPhone: deal.client.phone, dealTotal: calc.dealTotal, offerRate: calc.offerRate,
    }, user);
    refresh(); onClose(); toast('Hold request sent to management');
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={title}
      footer={(
        <>
          {!deal.client.id ? <T v="small" tone="mute" style={{ textAlign: 'center' }}>Select an existing customer to continue</T> : null}
          <Button label="Request hold" icon="lock" disabled={!deal.client.id} onPress={send} testID="request-hold" />
        </>
      )}>
      {about}

      <Row style={{ alignItems: 'flex-start' }}>
        <Field label="Your offer (৳/sqft)" style={{ flex: 1 }} value={offer} onChangeText={setOffer} keyboardType="decimal-pad"
          placeholder={String(Math.round(pv.listRate || 0))} hint={crShort(calc.offerValue)} />
        <Field label="Customer offer (৳/sqft)" style={{ flex: 1 }} value={cust} onChangeText={setCust} keyboardType="decimal-pad" placeholder="—"
          hint={calc.customerTotal == null ? 'No offer yet'
            : `${crShort(calc.customerTotal)} · ${calc.gap === 0 ? 'matched' : `${calc.gap > 0 ? 'you +' : 'client +'}${crShort(Math.abs(calc.gap))}`}`} />
      </Row>

      <Row wrap>
        <Chip icon="bolt" label={`Fast-close −${p.fastClosePct || 0}% · ${p.fastCloseDays || 0}d window`} active={fastClose} onPress={() => setFastClose((v) => !v)} />
        {(p.addons || []).map((a) => (
          <Chip key={a.id} icon={addons[a.id] ? 'check' : 'add'} label={`${a.name} + ${crShort(a.amount || 0)}`} active={!!addons[a.id]}
            onPress={() => setAddons((s) => ({ ...s, [a.id]: !s[a.id] }))} />
        ))}
      </Row>

      <Card style={{ gap: space.xs }}>
        <Line label="Offer rate" value={`${taka(calc.offerRate)}/sqft`} />
        <Line label={`Offer value · ${pv.size.toLocaleString('en-IN')} sqft`} value={taka(calc.offerValue)} />
        {calc.discountPct > 0 ? <Line label={`Fast-close −${calc.discountPct}%`} value={`−${taka(calc.offerValue - calc.discountedOffer)}`} tone="danger" /> : null}
        {(p.addons || []).filter((a) => addons[a.id]).map((a) => <Line key={a.id} label={a.name} value={`+${taka(a.amount)}`} />)}
        <Line strong label="Deal total" value={taka(calc.dealTotal)} />
        {calc.belowFloor ? <Badge label="Below floor · needs manager approval" tone="warn" icon="warning" /> : null}
      </Card>

      <View style={{ gap: space.sm }}>
        <T v="small" tone="sub" style={{ fontWeight: '600' }}>Client</T>
        {deal.client.id ? (
          <Card pad={false}>
            <ListItem icon="person" title={deal.client.name || 'Unnamed customer'} detail={deal.client.phone}
              onPress={() => setClient({ name: '', phone: '' })} right={<T v="small" tone="sub">Change</T>} last />
          </Card>
        ) : (
          <>
            <SearchField value={cq} onChangeText={setCq} placeholder="Search customer by name / phone…" />
            {!search ? null : matches == null ? <Loading /> : matches.length ? (
              <Card pad={false}>
                {matches.map((l, i) => (
                  <ListItem key={l.id} icon="person" title={l.name || 'Unnamed customer'} detail={l.phone} last={i === matches.length - 1}
                    onPress={() => { setClient({ id: l.id, name: l.name, phone: l.phone }); setCq(''); }} />
                ))}
              </Card>
            ) : <T v="small" tone="mute">{canAddLead ? 'No customer found. Add a new lead for this project.' : 'No customer found.'}</T>}
            {canAddLead ? <Button label="Add new lead" icon="person-add" variant="ghost" small full={false} onPress={addLead} /> : null}
          </>
        )}
      </View>
    </Sheet>
  );
}
