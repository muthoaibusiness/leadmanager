// A project's Overview and Documents tabs: the phone version of the web's
// src/components/booking/ProjectOverview.jsx and ProjectDocs.jsx. Same figures and the
// same rows (as cards instead of table rows, ten at a time).
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Badge, Button, Card, Empty, Icon, Row, SearchField, T } from '../../ui';
import { useTheme, space, radius } from '../../theme';
import { useApp } from '../../store';
import { countLeads, getHoldRequests } from '../../../../src/lib/db.js';
import { unitSize, unitPrice, projectKey, maskRequest } from '../../../../src/lib/projects.js';
import { canCustomers, canPrices } from '../../../../src/lib/constants.js';
import { loadProjectDocLog, DOCS } from '../../../../src/lib/shopDocs.js';
import { shortCode } from '../../../../src/lib/floorText.js';
import { usePaged, when } from './bits';

const HOLD_MS = 28 * 3600000; // an agent's hold ends 28 h after it starts; an admin hold has no end
const day = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');
const span = (ms) => { const h = Math.floor(Math.abs(ms) / 3600000); return h >= 24 ? `${Math.floor(h / 24)} d ${h % 24} h` : `${h} h`; };

function More({ pg }) {
  return pg.more ? <Button label={`Show ${Math.min(10, pg.left)} more`} variant="ghost" small onPress={pg.more} /> : null;
}

function Figure({ label, value, tone, sub }) {
  const t = useTheme();
  const color = tone === 'ok' ? t.brand : tone === 'gold' ? t.warn : tone === 'pl' ? t.purple : t.text;
  return (
    <View style={{ width: '48%', backgroundColor: t.card, borderRadius: radius.md, padding: space.md, gap: 2 }}>
      <T v="tiny" tone="mute">{label.toUpperCase()}</T>
      <T v="title" color={color}>{String(value)}</T>
      {sub ? <T v="tiny" tone="sub" numberOfLines={1}>{sub}</T> : null}
    </View>
  );
}

export function OverviewTab({ project }) {
  const { user, dbVersion } = useApp();
  void dbVersion;
  const t = useTheme();
  const [leads, setLeads] = useState(null);
  const [docs, setDocs] = useState(null);
  const [now] = useState(() => Date.now());
  useEffect(() => {
    let live = true;
    countLeads({ user, involved: true, project: projectKey(project.name) }).then((n) => { if (live) setLeads(n); });
    loadProjectDocLog(user?.companyId, project.id).then((r) => { if (live) setDocs(r.log.length); }).catch(() => { if (live) setDocs(0); });
    return () => { live = false; };
  }, [user, project.id, project.name]);

  const units = (project.variants || []).flatMap((v) => (v.units || []).map((u) => ({ ...u, type: v.name, size: unitSize(u, v), price: unitPrice(u, v) })));
  const land = units.filter((u) => u.tag === 'st-landowner');
  const sold = units.filter((u) => u.status === 'sold' && u.tag !== 'st-landowner');
  const held = units.filter((u) => u.status === 'hold');
  const open = units.filter((u) => u.status === 'available');
  const seeCust = canCustomers(user), seePrice = canPrices(user);
  const reqs = getHoldRequests().filter((r) => r.propertyId === project.id).map((r) => maskRequest(r, { customers: seeCust, prices: seePrice }));
  const top = reqs.filter((r) => r.offerRate > 0).sort((a, b) => b.offerRate - a.offerRate)[0];
  const soldSft = sold.reduce((s, u) => s + (u.size || 0), 0);
  const holds = held.map((u) => {
    const req = reqs.filter((r) => r.unitId === u.id && r.status !== 'rejected').sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
    const start = req?.createdAt || u.at || null;
    const end = u.adminHold ? null : (u.holdUntil ? new Date(u.holdUntil).getTime() : start ? new Date(start).getTime() + HOLD_MS : null);
    return { ...u, by: u.adminHold ? 'Management' : (req?.agentName || u.heldByName || '—'), client: u.clientName || req?.clientName || '', start, left: end == null ? null : end - now };
  }).sort((a, b) => (a.left ?? Infinity) - (b.left ?? Infinity));

  const k = [
    ['Leads', leads == null ? '…' : leads, ''],
    ['Available Units', open.length, 'ok'],
    ['On Hold Units', held.length, 'gold'],
    ['Sold Units', sold.length, '', soldSft ? `${soldSft.toLocaleString('en-IN')} sft` : ''],
    ['Landowner Units', land.length, 'pl'],
    ...(seePrice ? [['Top offer', top ? `৳${Math.round(top.offerRate).toLocaleString('en-IN')}` : '—', 'gold', top ? `${seeCust ? top.clientName + ' · ' : ''}${top.unitId}` : 'per sft']] : []),
    ['Docs sent', docs == null ? '…' : docs, ''],
  ];
  const soldPg = usePaged(sold);
  const holdPg = usePaged(holds);

  return (
    <View style={{ gap: space.lg }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: space.sm }}>
        {k.map(([l, v, tone, sub]) => <Figure key={l} label={l} value={v} tone={tone} sub={sub} />)}
      </View>

      {seeCust ? (
        <View style={{ gap: space.sm }}>
          <T v="h2">{`Customers · ${sold.length}`}</T>
          {!sold.length ? <T v="small" tone="mute">No unit sold yet.</T> : soldPg.rows.map((u) => (
            <Card key={u.id} style={{ gap: 2 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <T v="strong">{shortCode(u.id)}</T>
                <T v="small" tone="sub">{u.size ? `${u.size.toLocaleString('en-IN')} sft` : '—'}</T>
              </Row>
              <T v="small">{u.clientName || 'Not recorded'}</T>
              <T v="small" tone="sub">{[u.clientPhone || u.sheet?.phone, `Booked ${day(u.bookingDate || u.sheet?.bookingDate)}`, `Paid ${day(u.paymentDate || u.sheet?.paymentDate)}`].filter(Boolean).join(' · ')}</T>
            </Card>
          ))}
          <More pg={soldPg} />
        </View>
      ) : null}

      <View style={{ gap: space.sm }}>
        <T v="h2">{`On hold · ${held.length}`}</T>
        <T v="small" tone="mute">Agent holds end after 28 h · admin holds stay</T>
        {!holds.length ? <T v="small" tone="mute">No unit is on hold.</T> : holdPg.rows.map((h) => {
          const left = h.left == null ? (h.adminHold ? 'No end' : '—') : h.left < 0 ? `${span(h.left)} over` : span(h.left);
          const leftColor = h.left == null ? t.mute : h.left < 4 * 3600000 ? t.danger : t.brand;
          return (
            <Card key={h.id} style={{ gap: 2 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <T v="strong">{shortCode(h.id)}</T>
                <Row gap={4}>
                  {h.left == null && h.adminHold ? <Icon name="lock" size={14} color={t.mute} /> : null}
                  <T v="small" color={leftColor} style={{ fontWeight: '600' }}>{left}</T>
                </Row>
              </Row>
              {seeCust && h.client ? <T v="small">{h.client}</T> : null}
              <Row gap={6}>
                <T v="small" tone="sub">{`${h.by} · since ${day(h.start)}`}</T>
                {h.adminHold ? <Badge label="Admin" /> : null}
              </Row>
            </Card>
          );
        })}
        <More pg={holdPg} />
      </View>
    </View>
  );
}

const NAME = Object.fromEntries(DOCS.map((d) => [d.k, d.n]));
const docName = (d) => (typeof d === 'string' ? NAME[d] || d : d?.n || NAME[d?.k] || d?.name || '');

export function ProjectDocsTab({ project }) {
  const { user } = useApp();
  const [state, setState] = useState({ loading: true, log: [], missing: false });
  const [q, setQ] = useState('');
  useEffect(() => {
    let live = true;
    loadProjectDocLog(user?.companyId, project.id).then((r) => { if (live) setState({ loading: false, ...r }); }).catch(() => { if (live) setState({ loading: false, log: [], missing: false }); });
    return () => { live = false; };
  }, [user?.companyId, project.id]);
  const needle = q.trim().toLowerCase();
  const rows = state.log.filter((r) => !needle || [r.client, r.unitId, r.by, ...r.docs.map(docName)].some((v) => String(v || '').toLowerCase().includes(needle)));
  const pg = usePaged(rows);
  if (!canCustomers(user)) return <Empty icon="lock" title="Hidden" hint="Who documents were sent to is customer data, which your account does not have access to." />;
  const clients = new Set(state.log.map((r) => r.client).filter(Boolean)).size;
  return (
    <View style={{ gap: space.md }}>
      <SearchField value={q} onChangeText={setQ} placeholder="Search client, unit or document" />
      <T v="small" tone="sub">{`${state.log.length} send${state.log.length === 1 ? '' : 's'} · ${clients} client${clients === 1 ? '' : 's'}`}</T>
      {state.loading ? <T v="small" tone="mute">Loading…</T>
        : state.missing ? <T v="small" tone="mute">Document sending is not set up in the database yet.</T>
          : !rows.length ? <T v="small" tone="mute">{state.log.length ? 'No send matches.' : 'No documents sent for this project yet. Send them from a unit’s Documents tab.'}</T>
            : pg.rows.map((r) => (
              <Card key={r.id} style={{ gap: 3 }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <T v="strong" style={{ flex: 1 }} numberOfLines={1}>{r.client || '—'}</T>
                  <T v="small" tone="sub">{shortCode(r.unitId)}</T>
                </Row>
                {r.contact ? <T v="small" tone="sub">{r.contact}</T> : null}
                <T v="small">{r.docs.map(docName).join(', ')}</T>
                <T v="tiny" tone="mute">{[r.by, r.channel, when(r.at)].filter(Boolean).join(' · ')}</T>
              </Card>
            ))}
      <More pg={pg} />
    </View>
  );
}
