// Hold requests: the approval queue for agents' unit-hold requests, and the
// list of units currently on hold. Port of the web
// src/components/views/RequestsView.jsx and RequestsHeld.jsx. The decision
// writes are the web's, in the same order: decideHoldRequest (db.js, default
// 2-day hold; the web offers no other length), then setUnitStatus
// (projects.js) on the unit.
//
// Not on the phone: the Insights charts, the floor-plan picture in the request
// pop-up, and its "Open in Booking" / "Project" jumps (no such pages here yet).
import { useMemo, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { Badge, Button, Card, Chip, ChipBar, Empty, Icon, Row, Screen, SearchField, Segmented, Sheet, T, useUI } from '../../ui';
import { useTheme, space } from '../../theme';
import { useApp } from '../../store';
import { getHoldRequests, decideHoldRequest } from '../../../../src/lib/db.js';
import { setUnitStatus, reservedTag, getProjectById, findUnit, listProjects, unitSize } from '../../../../src/lib/projects.js';
import { canSee } from '../../../../src/lib/constants.js';
import { fmtBDT, fmtAgo } from '../../../../src/lib/helpers.js';

// Copied from RequestsView.jsx.
const STATUSES = [['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['all', 'All']];
const SORTS = [['new', 'Newest first'], ['old', 'Oldest first'], ['value', 'Highest value'], ['client', 'Client A–Z']];
const day = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
const dayTime = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const ST_TONE = { pending: 'warn', approved: 'brand', rejected: 'danger', held: 'info' };

// Copied from RequestsHeld.jsx.
const HOLD_MS = 28 * 3600000; // an agent's hold ends 28 h after it starts; an admin hold has no end
const dayY = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');
const span = (ms) => { const h = Math.floor(Math.abs(ms) / 3600000); return h >= 24 ? `${Math.floor(h / 24)} d ${h % 24} h` : `${h} h`; };
const KINDS = [['', 'All holds'], ['admin', 'Admin holds'], ['agent', 'Agent holds']];
// All held units, newest request first per unit, soonest to expire first.
function heldUnits(requests, now) {
  return listProjects().flatMap((p) => (p.variants || []).flatMap((v) => (v.units || []).filter((u) => u.status === 'hold').map((u) => {
    const req = requests.filter((r) => r.propertyId === p.id && r.unitId === u.id && r.status !== 'rejected')
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
    const start = u.at || req?.decidedAt || req?.createdAt || null;
    const end = u.adminHold ? null : u.holdUntil ? new Date(u.holdUntil).getTime() : start ? new Date(start).getTime() + HOLD_MS : null;
    return {
      key: `${p.id}:${u.id}`, projectId: p.id, project: p.name, variantId: v.id, type: v.name, unitId: u.id, size: unitSize(u, v),
      admin: !!u.adminHold, by: u.adminHold ? 'Management' : (u.heldByName || req?.agentName || '—'),
      client: u.clientName || req?.clientName || '', phone: u.clientPhone || req?.clientPhone || '', note: u.note || '',
      start, left: end == null ? null : end - now, req,
    };
  }))).sort((a, b) => (a.left ?? Infinity) - (b.left ?? Infinity) || a.project.localeCompare(b.project) || String(a.unitId).localeCompare(String(b.unitId), undefined, { numeric: true }));
}

const Fact = ({ label, value, sub }) => (
  <View style={{ width: '47%', gap: 2 }}>
    <T v="tiny" tone="mute">{String(label).toUpperCase()}</T>
    <T v="strong">{value || '—'}</T>
    {sub ? <T v="small" tone="mute">{sub}</T> : null}
  </View>
);

export default function RequestsScreen() {
  const { user, refresh, dbVersion } = useApp();
  const { toast, confirm } = useUI();
  const t = useTheme();
  const [tab, setTab] = useState('queue');
  const [status, setStatus] = useState('pending');
  const [q, setQ] = useState('');
  const [project, setProject] = useState('');
  const [agent, setAgent] = useState('');
  const [sort, setSort] = useState('new');
  const [kind, setKind] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [openId, setOpenId] = useState(null);   // the request shown in the sheet
  const [openHeld, setOpenHeld] = useState(null); // a held unit shown in the same sheet
  const [now] = useState(() => Date.now());

  const all = getHoldRequests();
  const held = useMemo(() => heldUnits(all, now), [dbVersion, all.length, now]); // eslint-disable-line react-hooks/exhaustive-deps -- dbVersion tracks the store
  const count = (k) => (k === 'all' ? all.length : all.filter((r) => r.status === k).length);
  const projects = [...new Set((tab === 'held' ? held.map((h) => h.project) : all.map((r) => r.propertyName)).filter(Boolean))].sort();
  const agents = [...new Set(all.map((r) => r.agentName).filter(Boolean))].sort();
  const needle = q.trim().toLowerCase();

  const rows = all
    .filter((r) => status === 'all' || r.status === status)
    .filter((r) => !project || r.propertyName === project)
    .filter((r) => !agent || r.agentName === agent)
    .filter((r) => !needle || [r.clientName, r.clientPhone, r.propertyName, r.unitId, r.variantName, r.agentName]
      .some((v) => String(v ?? '').toLowerCase().includes(needle)))
    .sort((a, b) => {
      if (sort === 'old') return String(a.createdAt).localeCompare(String(b.createdAt));
      if (sort === 'value') return (b.dealTotal || 0) - (a.dealTotal || 0);
      if (sort === 'client') return String(a.clientName || '').localeCompare(String(b.clientName || ''));
      return String(b.createdAt).localeCompare(String(a.createdAt));
    });
  const heldRows = held
    .filter((h) => !project || h.project === project)
    .filter((h) => !kind || (kind === 'admin') === h.admin)
    .filter((h) => !needle || [h.unitId, h.project, h.client, h.phone, h.by, h.note].some((v) => String(v || '').toLowerCase().includes(needle)));
  const nAdmin = held.filter((h) => h.admin).length;
  const filtered = !!(needle || project || agent);
  const clear = () => { setQ(''); setProject(''); setAgent(''); };

  if (!canSee(user, 'requests')) return <Screen><Empty icon="lock" title="No access" hint="Hold requests are not enabled for this account." /></Screen>;

  const closeSheet = () => { setOpenId(null); setOpenHeld(null); };

  // RequestsView.decide, unchanged.
  const decide = (r, ok) => {
    const updated = decideHoldRequest(r.id, ok, user);
    const proj = getProjectById(r.propertyId);
    // Keep the lead id the hold was placed with, so the unit still links to its prospect.
    const clientId = findUnit(proj, r.unitId)?.unit.clientId || null;
    if (ok && updated) setUnitStatus(r.propertyId, r.variantId, r.unitId, 'hold', { user, client: { id: clientId, name: r.clientName }, holdUntil: updated.holdUntil, note: 'Booked by management', tag: reservedTag(proj) });
    else setUnitStatus(r.propertyId, r.variantId, r.unitId, 'available', { user });
    closeSheet();
    refresh();
    toast(ok ? `Hold approved · Unit ${r.unitId}` : `Request rejected · Unit ${r.unitId}`);
  };
  // An approved request whose unit is still on hold can be released from the queue too.
  const isHeld = (r) => findUnit(getProjectById(r.propertyId), r.unitId)?.unit.status === 'hold';
  // RequestsView.unholdUnit / RequestsHeld.unhold: free the unit and close any
  // open request for it. h = { propertyId, variantId, unitId }.
  const unhold = (h) => confirm({
    title: `Unhold unit ${h.unitId}?`, description: 'The unit becomes available again, and any open request for it is rejected.', confirmLabel: 'Unhold', danger: true,
    onConfirm: () => {
      setUnitStatus(h.propertyId, h.variantId, h.unitId, 'available', { user });
      all.filter((x) => x.propertyId === h.propertyId && x.unitId === h.unitId && x.status === 'pending').forEach((x) => decideHoldRequest(x.id, false, user));
      closeSheet();
      refresh();
      toast(`Unit ${h.unitId} is available again`);
    },
  });
  // A held unit opens in the request sheet, shaped like a request (no decision buttons).
  const heldAsRequest = (h) => ({ ...(h.req || {}), id: h.key, propertyId: h.projectId, propertyName: h.project, variantId: h.variantId, variantName: h.type, unitId: h.unitId,
    clientName: h.client, clientPhone: h.phone, agentName: h.by, createdAt: h.req?.createdAt || h.start, holdUntil: h.left == null ? null : new Date(now + h.left).toISOString(), status: 'held' });
  const opened = openId ? all.find((x) => x.id === openId) : openHeld;

  const header = (
    <View style={{ gap: space.sm, paddingTop: space.md }}>
      <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
        <Segmented value={tab} onChange={(v) => { setTab(v); setProject(''); }}
          options={[{ value: 'queue', label: `Queue (${count('pending')})` }, { value: 'held', label: `Held units (${held.length})` }]} />
        <SearchField value={q} onChangeText={setQ} placeholder={tab === 'held' ? 'Search unit, project, customer or who held it' : 'Search client, phone, project, unit or agent'} />
      </View>
      {tab === 'queue'
        ? <ChipBar value={status} onChange={setStatus} options={STATUSES.map(([k, label]) => ({ value: k, label, count: count(k) }))} />
        : <ChipBar value={kind} onChange={setKind} options={KINDS.map(([k, l]) => ({ value: k, label: l, count: k === 'admin' ? nAdmin : k === 'agent' ? held.length - nAdmin : held.length }))} />}
      <Row style={{ justifyContent: 'space-between', paddingHorizontal: space.lg }}>
        <Pressable onPress={() => setFilterOpen(true)} accessibilityRole="button" hitSlop={8}>
          <Row gap={4}><Icon name="filter-list" size={16} color={project || agent ? t.brand : t.sub} />
            <T v="small" color={project || agent ? t.brand : t.sub}>{[project, tab === 'queue' ? agent : ''].filter(Boolean).join(' · ') || 'Filter'}</T></Row>
        </Pressable>
        {tab === 'queue' ? (
          <Pressable onPress={() => setSort(SORTS[(SORTS.findIndex((s) => s[0] === sort) + 1) % SORTS.length][0])} accessibilityRole="button" hitSlop={8}>
            <Row gap={4}><Icon name="swap-vert" size={16} color={t.sub} /><T v="small" tone="sub">{SORTS.find((s) => s[0] === sort)[1]}</T></Row>
          </Pressable>
        ) : <T v="small" tone="mute">{heldRows.length} of {held.length} held unit{held.length === 1 ? '' : 's'}</T>}
      </Row>
    </View>
  );

  const renderRequest = ({ item: r }) => (
    <View style={{ paddingHorizontal: space.lg }}>
      <Card onPress={() => setOpenId(r.id)}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <T v="strong" numberOfLines={1}>{r.clientName || '—'}</T>
            {r.clientPhone ? <T v="small" tone="mute">{r.clientPhone}</T> : null}
          </View>
          <Badge label={r.status} tone={ST_TONE[r.status]} />
        </Row>
        <T v="small" tone="sub">Unit {r.unitId} · {r.propertyName}{r.variantName ? ` · ${r.variantName}` : ''}</T>
        <T v="small" tone="mute">{[r.agentName || '—', r.dealTotal ? fmtBDT(r.dealTotal) : null, fmtAgo(r.createdAt), r.holdUntil ? `hold until ${day(r.holdUntil)}` : null].filter(Boolean).join('  ·  ')}</T>
        {r.status === 'pending' ? (
          <Row>
            <View style={{ flex: 1 }}><Button label="Reject" icon="close" variant="ghost" small onPress={() => decide(r, false)} /></View>
            <View style={{ flex: 1 }}><Button label="Approve" icon="check" small onPress={() => decide(r, true)} /></View>
          </Row>
        ) : r.status === 'approved' && isHeld(r) ? (
          <Button label="Unhold" icon="lock-open" variant="ghost" small onPress={() => unhold(r)} />
        ) : null}
      </Card>
    </View>
  );

  const renderHeld = ({ item: h }) => (
    <View style={{ paddingHorizontal: space.lg }}>
      <Card onPress={() => setOpenHeld(heldAsRequest(h))}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <T v="strong" numberOfLines={1}>Unit {h.unitId}</T>
            <T v="small" tone="mute" numberOfLines={1}>{h.project}{h.type ? ` · ${h.type}` : ''}{h.size ? ` · ${h.size.toLocaleString('en-IN')} sft` : ''}</T>
          </View>
          <Badge icon={h.left == null && h.admin ? 'lock' : 'schedule'}
            tone={h.left == null ? 'neutral' : h.left < 4 * 3600000 ? 'danger' : 'brand'}
            label={h.left == null ? (h.admin ? 'No end' : '—') : h.left < 0 ? `${span(h.left)} over` : `${span(h.left)} left`} />
        </Row>
        <T v="small" tone="sub">{h.client || '—'}{h.phone || h.note ? `  ·  ${h.phone || h.note}` : ''}</T>
        <Row wrap>
          <T v="small" tone="mute">Held by {h.by} · since {dayY(h.start)}</T>
          {h.admin ? <Badge label="Admin" tone="purple" /> : null}
        </Row>
        <Button label="Unhold" icon="lock-open" variant="ghost" small onPress={() => unhold({ propertyId: h.projectId, variantId: h.variantId, unitId: h.unitId })} />
      </Card>
    </View>
  );

  const openedHeld = opened && (opened.status === 'held' || (opened.status !== 'pending' && isHeld(opened)));

  return (
    <Screen scroll={false}>
      <FlatList
        data={tab === 'held' ? heldRows : rows}
        keyExtractor={(x) => x.key || x.id}
        renderItem={tab === 'held' ? renderHeld : renderRequest}
        ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
        ListHeaderComponent={header}
        ListHeaderComponentStyle={{ marginBottom: space.sm }}
        ListEmptyComponent={tab === 'held'
          ? <Empty icon={held.length ? 'search-off' : 'lock-open'} title={held.length ? 'No held unit matches' : 'No unit is on hold'}
              hint={held.length ? 'Try a different word or filter.' : 'Units put on hold from Booking or approved requests show up here.'} />
          : <Empty icon={filtered || status !== 'pending' ? 'search-off' : 'check-circle'}
              title={filtered ? 'No request matches' : status === 'pending' ? 'No pending requests' : 'Nothing here yet'}
              hint={filtered ? 'Try a different word or clear the filters.' : 'New hold requests from agents show up here.'}
              action={filtered ? <Button label="Clear filters" variant="ghost" full={false} onPress={clear} /> : null} />}
        ListFooterComponent={<View style={{ padding: space.lg }}>{tab === 'held' ? <T v="small" tone="mute">Agent holds end after 28 h · admin holds stay until unheld</T> : null}</View>}
        keyboardShouldPersistTaps="handled"
      />

      <Sheet visible={filterOpen} onClose={() => setFilterOpen(false)} title="Filter"
        footer={<Button label="Done" onPress={() => setFilterOpen(false)} />}>
        <T v="small" tone="sub" style={{ fontWeight: '600' }}>Project</T>
        <Row wrap>
          <Chip label="All projects" active={!project} onPress={() => setProject('')} />
          {projects.map((p) => <Chip key={p} label={p} active={project === p} onPress={() => setProject(p)} />)}
        </Row>
        {tab === 'queue' ? (
          <>
            <T v="small" tone="sub" style={{ fontWeight: '600' }}>Agent</T>
            <Row wrap>
              <Chip label="All agents" active={!agent} onPress={() => setAgent('')} />
              {agents.map((a) => <Chip key={a} label={a} active={agent === a} onPress={() => setAgent(a)} />)}
            </Row>
          </>
        ) : null}
      </Sheet>

      {/* RequestUnitModal, without the floor plan. */}
      <Sheet visible={!!opened} onClose={closeSheet} title={opened ? `Unit ${opened.unitId}` : ''}
        footer={!opened ? null : opened.status === 'pending' ? (
          <Row>
            <View style={{ flex: 1 }}><Button label="Reject" icon="close" variant="ghost" onPress={() => decide(opened, false)} /></View>
            <View style={{ flex: 1 }}><Button label="Approve" icon="check" onPress={() => decide(opened, true)} /></View>
          </Row>
        ) : openedHeld ? (
          <Row>
            <View style={{ flex: 1 }}><Button label="Keep on hold" variant="ghost" onPress={closeSheet} /></View>
            <View style={{ flex: 1 }}><Button label="Unhold" icon="lock-open" onPress={() => unhold(opened)} /></View>
          </Row>
        ) : <Button label="Done" onPress={closeSheet} />}>
        {opened ? (
          <>
            <Row style={{ justifyContent: 'space-between' }}>
              <T tone="sub" style={{ flex: 1 }}>{opened.propertyName}{opened.variantName ? ` · ${opened.variantName}` : ''}</T>
              <Badge label={opened.status === 'held' ? 'On hold' : opened.status} tone={ST_TONE[opened.status]} />
            </Row>
            <Row wrap gap={space.md} style={{ alignItems: 'flex-start' }}>
              <Fact label="Client" value={opened.clientName} />
              <Fact label="Phone" value={opened.clientPhone} />
              <Fact label="Requested by" value={opened.agentName} />
              <Fact label="Deal value" value={opened.dealTotal ? fmtBDT(opened.dealTotal) : '—'} />
              <Fact label="Requested" value={fmtAgo(opened.createdAt)} sub={dayTime(opened.createdAt)} />
              <Fact label={opened.status === 'pending' ? 'Hold until' : 'Held until'}
                value={opened.holdUntil ? dayTime(opened.holdUntil) : opened.status === 'pending' ? 'Set when approved (2 days)' : '—'} />
              {opened.status !== 'pending' && opened.status !== 'held' ? <Fact label="Decided by" value={opened.decidedBy} sub={dayTime(opened.decidedAt)} /> : null}
            </Row>
          </>
        ) : null}
      </Sheet>
    </Screen>
  );
}
