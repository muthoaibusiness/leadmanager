// The sales pipeline (web: src/components/views/PipelineView.jsx).
// The web shows a kanban board and moves a lead by drag and drop. A board does
// not fit a phone, so the stages are a chip bar with a count each, the chosen
// stage's leads are a list, and a lead is moved through a bottom sheet. The
// sheet calls the same moveLead() the web's drop handler calls, under the same
// conditions: the web has no role check here (anyone who may open the page may
// move, and edit the stages), it skips a drop onto the stage the lead is
// already in, and "Closed Won" closes the deal with a value of 0.
//
// Like the web, the page shows the first pipeline only and has no agent or
// team filter: getLeads(user) already scopes the book by role.
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { Button, Card, ChipBar, Empty, Field, Icon, IconButton, Loading, Row, Screen, Sheet, T, useUI } from '../ui';
import { useTheme, space, radius } from '../theme';
import { useApp } from '../store';
import { useLeadBook, useActWindow } from '../hooks';
import { LeadRow } from './lead/LeadsScreen';
import {
  getLeads, getPipelines, leadStageId, moveLead, getActs,
  addStage, renameStage, deleteStage,
} from '../../../src/lib/db.js';
import { fmtD, fmtBDT, scoreLead, scoreLabel } from '../../../src/lib/helpers.js';
import { successRate } from '../../../src/lib/successRate.js';
import { ROLES, effectiveRole, canSee } from '../../../src/lib/constants.js';

// Copied from PipelineView.jsx (it lives in the component, not in src/lib).
// Deal value from a forwarded offer (OFFER activity), falling back to budget.
function dealValueOf(lead, acts) {
  const offer = (acts || []).find((a) => a.type === 'OFFER');
  if (offer) { try { const o = JSON.parse(offer.description); return o.pipelineValue || o.clientOffer || lead.budget || 0; } catch { /* ignore */ } }
  return lead.budget || 0;
}
// Leads that have dropped out of the funnel are hidden from the board.
const HIDDEN = ['DEAL_CLOSED_LOST', 'NOT_INTERESTED'];
const NEW_DAYS = 14;

// The 14-day "new customers" bars from the web's summary strip.
function NewBars({ series, days }) {
  const t = useTheme();
  const max = Math.max(...series, 1);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3 }}>
      {series.map((v, i) => (
        <View key={i} style={{ flex: 1, alignItems: 'center', gap: 2 }}>
          <View style={{ height: 44, alignSelf: 'stretch', justifyContent: 'flex-end' }}>
            <View style={{ height: Math.max(3, (v / max) * 44), borderRadius: 3, backgroundColor: v === 0 ? t.line : t.brand }} />
          </View>
          <T v="tiny" tone="mute" style={{ fontSize: 9.5, letterSpacing: 0 }}>{i % 2 === 0 || i === series.length - 1 ? days[i].getDate() : ' '}</T>
        </View>
      ))}
    </View>
  );
}

function StageCard({ lead, stageColor, showOwner, onOpen, onMove }) {
  const t = useTheme();
  const acts = getActs(lead.id);
  const score = scoreLead(lead, acts);
  const sl = scoreLabel(score);
  const dealVal = dealValueOf(lead, acts);
  const matCount = acts.filter((a) => a.type === 'OFFER').length;
  const meta = (icon, label, a11y) => (
    <Row gap={3} key={icon}><Icon name={icon} size={14} color={t.mute} /><T v="small" tone="sub" accessibilityLabel={a11y}>{label}</T></Row>
  );
  return (
    <View style={{ backgroundColor: t.card, borderRadius: radius.lg }}>
      <LeadRow lead={lead} showOwner={showOwner} onPress={onOpen} />
      <Row gap={space.md} style={{ paddingLeft: space.md, paddingRight: space.sm, paddingBottom: space.sm }}>
        <Row gap={2}>
          <Icon name="bolt" size={15} color={stageColor || t.sub} />
          <T v="small" style={{ fontWeight: '700' }} accessibilityLabel={`${sl.label} lead, score ${score}`}>{score}</T>
        </Row>
        {meta('event', fmtD(lead.updatedAt), 'Last updated')}
        {dealVal > 0 ? meta('payments', fmtBDT(dealVal), 'Deal value') : null}
        {meta('chat-bubble-outline', acts.length, `${acts.length} activities`)}
        {meta('attach-file', matCount, `${matCount} materials sent`)}
        <View style={{ flex: 1 }} />
        <Pressable onPress={onMove} accessibilityRole="button" accessibilityLabel={`Move ${lead.name}`} hitSlop={6}
          style={({ pressed }) => ({ minHeight: 36, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: t.brandSoft, flexDirection: 'row', alignItems: 'center', gap: 4, opacity: pressed ? 0.7 : 1 })}>
          <Icon name="swap-horiz" size={16} color={t.brand} />
          <T v="small" color={t.brand} style={{ fontWeight: '700' }}>Move</T>
        </Pressable>
      </Row>
    </View>
  );
}

// Add, rename and delete stages (the web uses window.prompt / window.confirm).
function StagesSheet({ visible, onClose, pipeline }) {
  const { refresh } = useApp();
  const { toast } = useUI();
  const [names, setNames] = useState({});
  const [fresh, setFresh] = useState('');
  const [asking, setAsking] = useState(null);
  useEffect(() => { if (visible) { setNames({}); setFresh(''); setAsking(null); } }, [visible]);

  const rename = (s) => {
    const n = (names[s.id] ?? s.name).trim();
    if (n && n !== s.name) { renameStage(pipeline.id, s.id, n); refresh(); }
    setNames((m) => { const next = { ...m }; delete next[s.id]; return next; });
  };
  const askDelete = (s) => {
    if (pipeline.stages.length <= 1) { toast('Keep at least one stage', 'warn'); return; }
    setAsking(s.id);
  };
  const del = (s) => { deleteStage(pipeline.id, s.id); setAsking(null); refresh(); };
  const add = () => { addStage(pipeline.id, fresh); setFresh(''); refresh(); };

  return (
    <Sheet visible={visible} onClose={onClose} title="Edit stages" footer={<Button label="Done" onPress={onClose} />}>
      {pipeline.stages.map((s) => (asking === s.id ? (
        <Card key={s.id}>
          <T v="strong">{`Delete stage "${s.name}"?`}</T>
          <Row style={{ justifyContent: 'flex-end' }}>
            <Button label="Keep" variant="ghost" small full={false} onPress={() => setAsking(null)} />
            <Button label="Delete stage" tone="danger" small full={false} onPress={() => del(s)} />
          </Row>
        </Card>
      ) : (
        <Row key={s.id}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: s.color }} />
          <Field style={{ flex: 1 }} value={names[s.id] ?? s.name} accessibilityLabel={`Stage name ${s.name}`}
            onChangeText={(v) => setNames((m) => ({ ...m, [s.id]: v }))} onBlur={() => rename(s)} onSubmitEditing={() => rename(s)} returnKeyType="done" />
          <IconButton name="delete-outline" label={`Delete stage ${s.name}`} onPress={() => askDelete(s)} />
        </Row>
      )))}
      <Row>
        <Field style={{ flex: 1 }} value={fresh} onChangeText={setFresh} placeholder="New stage name" returnKeyType="done" onSubmitEditing={add} />
        <Button label="Add stage" icon="add" variant="soft" full={false} onPress={add} />
      </Row>
      <T v="small" tone="mute">Stages are kept on this device, the same as on the web.</T>
    </Sheet>
  );
}

export default function PipelineScreen({ navigation }) {
  const { user, dbVersion, refresh } = useApp();
  const t = useTheme();
  const { toast, confirm } = useUI();
  const ready = useLeadBook(); // this view reduces over every lead; leads are not in the boot load
  useActWindow(); // the recent-activity window; activities are not in the boot load
  const [sel, setSel] = useState(null);
  const [moving, setMoving] = useState(null); // lead id the move sheet is open for
  const [editing, setEditing] = useState(false);

  const pipeline = getPipelines()[0];
  const showOwner = effectiveRole(user) !== ROLES.AGENT;

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (pipeline ? <IconButton name="tune" label="Edit stages" onPress={() => setEditing(true)} /> : null),
    });
  }, [navigation, pipeline]);

  // Recomputed when the store changes (dbVersion): getLeads reads the mutable DB.
  const model = useMemo(() => {
    if (!pipeline || !ready) return null;
    const allMine = getLeads(user);
    const leads = allMine.filter((l) => !HIDDEN.includes(l.status));
    const cols = {};
    pipeline.stages.forEach((s) => { cols[s.id] = []; });
    leads.forEach((l) => { const sid = leadStageId(pipeline, l); if (cols[sid]) cols[sid].push(l); });

    // Project demand: how many leads on the board are interested in each project.
    const demand = {};
    leads.forEach((l) => { const k = l.dealProjectName || l.propertyInterest; if (k) demand[k] = (demand[k] || 0) + 1; });
    const demandTop = Object.entries(demand).sort((a, b) => b[1] - a[1]).slice(0, 8);

    // Agents are measured over every lead they ever touched (assigned or forwarded on).
    const succ = successRate(user, allMine, getLeads(user, { involved: true }));
    const pipelineValue = leads.reduce((s, l) => s + dealValueOf(l, getActs(l.id)), 0);
    const days = Array.from({ length: NEW_DAYS }, (_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (NEW_DAYS - 1 - i)); return d; });
    const series = days.map((d) => {
      const nx = new Date(d); nx.setDate(nx.getDate() + 1);
      return allMine.filter((l) => { const c = new Date(l.createdAt); return c >= d && c < nx; }).length;
    });
    return { leads, cols, demandTop, succ, pipelineValue, days, series, newTotal: series.reduce((a, b) => a + b, 0) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipeline, ready, user, dbVersion]);

  if (!pipeline) return <Screen><Empty icon="view-kanban" title="No pipeline" /></Screen>;
  if (!model) return <Screen><Loading label="Loading the pipeline…" /></Screen>;

  const { leads, cols, demandTop, succ, pipelineValue, days, series, newTotal } = model;
  const stageId = pipeline.stages.some((s) => s.id === sel) ? sel : pipeline.stages[0].id;
  const stage = pipeline.stages.find((s) => s.id === stageId);
  const rows = cols[stageId] || [];
  const movingLead = moving ? leads.find((l) => l.id === moving) : null;
  const movingStage = movingLead ? leadStageId(pipeline, movingLead) : null;

  // The web's onDrop.
  const doMove = (id, toId) => {
    const lead = leads.find((l) => l.id === id);
    if (!lead || leadStageId(pipeline, lead) === toId) return;
    moveLead(pipeline, id, toId, user);
    refresh();
    const st = pipeline.stages.find((s) => s.id === toId);
    toast(`${lead.name} → ${st?.name}`, 'ok');
  };
  const pick = (s) => {
    const id = moving;
    setMoving(null);
    if (!id || s.id === movingStage) return;
    // A drag is deliberate; a tap is easy to mis-hit. Closing a deal notifies
    // management, so the phone asks first. The write is the web's.
    if (pipeline.id === 'sales' && s.set === 'DEAL_CLOSED_WON') {
      const lead = leads.find((l) => l.id === id);
      confirm({ title: 'Close this deal as won?', description: `${lead?.name || 'This customer'} moves to ${s.name} and the deal is recorded as won.`, confirmLabel: 'Close as won', onConfirm: () => doMove(id, s.id) });
      return;
    }
    doMove(id, s.id);
  };
  const toLeads = canSee(user, 'leads') ? () => navigation.navigate('Tabs', { screen: 'Leads' }) : undefined;

  const header = (
    <View style={{ gap: space.md, paddingTop: space.md }}>
      <View style={{ paddingHorizontal: space.lg, gap: space.md }}>
        <Row gap={space.md} style={{ alignItems: 'stretch' }}>
          <Card onPress={toLeads} style={{ flex: 1, gap: 2 }}>
            <T v="small" tone="sub" numberOfLines={1}>Deals in progress</T>
            <T v="num">{leads.length}</T>
          </Card>
          <Card onPress={toLeads} style={{ flex: 1, gap: 2 }}>
            <T v="small" tone="sub" numberOfLines={1}>Pipeline value</T>
            <T v="num" numberOfLines={1} adjustsFontSizeToFit>{fmtBDT(pipelineValue)}</T>
          </Card>
        </Row>
        <Row gap={space.md} style={{ alignItems: 'stretch' }}>
          <Card style={{ flex: 1, gap: 2 }}>
            <T v="small" tone="sub" numberOfLines={1}>{succ.label}</T>
            <T v="num" tone="brand">{succ.pct}%</T>
            <T v="small" tone="mute">{succ.n} of {succ.d}</T>
          </Card>
          <Card style={{ flex: 1.4, gap: space.sm }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T v="small" tone="sub" numberOfLines={1} style={{ flex: 1 }}>New customers</T>
              <T v="small" tone="mute">{newTotal} in 14d</T>
            </Row>
            <NewBars series={series} days={days} />
          </Card>
        </Row>
      </View>
      {demandTop.length > 0 ? (
        <View style={{ gap: 2 }}>
          <Row gap={4} style={{ paddingHorizontal: space.lg }}>
            <Icon name="apartment" size={14} color={t.mute} /><T v="tiny" tone="mute">PROJECT DEMAND</T>
          </Row>
          <FlatList horizontal data={demandTop} keyExtractor={(d) => d[0]} showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.xs }}
            renderItem={({ item: [name, n] }) => (
              <Row gap={6} style={{ backgroundColor: t.card, borderRadius: radius.pill, paddingHorizontal: space.md, minHeight: 30 }}>
                <T v="small" numberOfLines={1}>{name}</T><T v="small" tone="brand" style={{ fontWeight: '700' }}>{n}</T>
              </Row>
            )} />
        </View>
      ) : null}
      <View>
        <T v="tiny" tone="mute" style={{ paddingHorizontal: space.lg }}>STAGES</T>
        <ChipBar options={pipeline.stages.map((s) => ({ value: s.id, label: s.name, count: cols[s.id].length }))} value={stageId} onChange={setSel} />
      </View>
    </View>
  );

  return (
    <Screen scroll={false}>
      <FlatList
        data={rows}
        keyExtractor={(l) => l.id}
        renderItem={({ item }) => (
          <View style={{ paddingHorizontal: space.lg }}>
            <StageCard lead={item} stageColor={stage?.color} showOwner={showOwner}
              onOpen={() => navigation.navigate('LeadDetail', { leadId: item.id })} onMove={() => setMoving(item.id)} />
          </View>
        )}
        ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
        ListHeaderComponent={header}
        ListHeaderComponentStyle={{ marginBottom: space.sm }}
        ListEmptyComponent={<Empty icon="view-kanban" title={`Nothing in ${stage?.name || 'this stage'}`} hint="Move a customer here from another stage." />}
        ListFooterComponent={<View style={{ height: space.xl }} />}
        keyboardShouldPersistTaps="handled"
      />

      <Sheet visible={!!movingLead} onClose={() => setMoving(null)} title={movingLead ? `Move ${movingLead.name}` : 'Move'}>
        <T v="small" tone="mute">Choose the stage this customer belongs in.</T>
        <Card pad={false} style={{ gap: 0, overflow: 'hidden' }}>
          {pipeline.stages.map((s, i) => {
            const here = s.id === movingStage;
            return (
              <Pressable key={s.id} onPress={here ? undefined : () => pick(s)} disabled={here} accessibilityRole="button"
                accessibilityLabel={here ? `${s.name}, current stage` : `Move to ${s.name}`} accessibilityState={{ disabled: here, selected: here }}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingHorizontal: space.lg, opacity: pressed ? 0.6 : 1, borderTopWidth: i ? 1 : 0, borderTopColor: t.line })}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: s.color }} />
                <View style={{ flex: 1 }}>
                  <T v="strong" tone={here ? 'mute' : undefined}>{s.name}</T>
                  {here ? <T v="small" tone="mute">Current stage</T> : null}
                </View>
                <T v="small" tone="mute">{cols[s.id].length}</T>
                <Icon name={here ? 'check' : 'chevron-right'} size={20} color={here ? t.brand : t.mute} />
              </Pressable>
            );
          })}
        </Card>
      </Sheet>

      <StagesSheet visible={editing} onClose={() => setEditing(false)} pipeline={pipeline} />
    </Screen>
  );
}
