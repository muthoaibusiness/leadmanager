// Shared pieces of the four "people and numbers" screens (Team, Performance,
// Agent, Reports): bars drawn with plain Views, the per-agent headline numbers,
// the one-person activity feed and the target sheet.
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button, Card, Field, Icon, Loading, Row, Sheet, T, useUI } from '../../ui';
import { useTheme, space } from '../../theme';
import { useApp } from '../../store';
import { useLeadBook, useActWindow } from '../../hooks';
import {
  getLeads, getTarget, achievement, agentLeadStats, fetchUserActivity, setTargetFn, ensureActWindow,
} from '../../../../src/lib/db.js';
import { startOfMonth, actIcon, fmtAgo } from '../../../../src/lib/helpers.js';

// Series colours for bars, all from the theme.
export function usePalette() {
  const t = useTheme();
  return [t.brand, t.info, t.purple, t.teal, t.warn, t.danger, t.sub];
}

// The tiers of progColor() (src/lib/helpers.js: 80 and 50), in theme colours.
export const progTone = (pct) => (pct >= 80 ? 'brand' : pct >= 50 ? 'warn' : 'danger');

export function Bar({ pct, color, height = 8 }) {
  const t = useTheme();
  const w = Math.max(0, Math.min(100, Number(pct) || 0));
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: t.line, overflow: 'hidden' }}>
      <View style={{ width: `${w}%`, height: '100%', borderRadius: height / 2, backgroundColor: color || t.brand }} />
    </View>
  );
}

// One labelled bar: label left, value right, the bar beneath.
export function BarRow({ label, value, pct, color, sub }) {
  return (
    <View style={{ gap: 4 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <T v="small" numberOfLines={1} style={{ flex: 1 }}>{label}</T>
        {sub ? <T v="small" tone="mute">{sub}</T> : null}
        <T v="small" style={{ fontWeight: '700', fontVariant: ['tabular-nums'] }}>{value}</T>
      </Row>
      <Bar pct={pct} color={color} />
    </View>
  );
}

// A number tile with a caption line under it (the ui Stat has no caption).
export function Kpi({ label, value, sub, tone }) {
  return (
    <Card style={{ flex: 1, minWidth: 140, gap: 2 }}>
      <T v="small" tone="sub" numberOfLines={1}>{label}</T>
      <T v="num" tone={tone || undefined}>{value == null ? '…' : String(value)}</T>
      {sub ? <T v="small" tone="mute" numberOfLines={1}>{sub}</T> : null}
    </Card>
  );
}

// A small number with its label under it, three or four to a row.
export function Mini({ label, value }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
      <T v="h2" style={{ fontVariant: ['tabular-nums'] }}>{value == null ? '…' : String(value)}</T>
      <T v="small" tone="mute" numberOfLines={1}>{label}</T>
    </View>
  );
}

// The lead book plus the recent-activity window. For a Team Lead the activity
// window is asked for by lead id, so it is asked again once the book is in
// (ensureActWindow keys on the lead count and runs once per key).
export function useBookAndActs() {
  const { user, refresh } = useApp();
  const ready = useLeadBook();
  useActWindow();
  useEffect(() => {
    if (!ready || !user) return undefined;
    let alive = true;
    Promise.resolve(ensureActWindow(user)).then((changed) => { if (alive && changed) refresh(); });
    return () => { alive = false; };
  }, [ready, user, refresh]);
  return ready;
}

// "All projects" / "2 projects" / "No projects" (AgentCard.jsx).
export function projectLabel(agent) {
  if (agent.projects === 'ALL') return 'All projects';
  const n = Array.isArray(agent.projects) ? agent.projects.length : 0;
  return n ? `${n} project${n > 1 ? 's' : ''}` : 'No projects';
}

// An agent's headline numbers, as the web's AgentCard computes them
// (src/components/dashboards/AgentCard.jsx): agent_lead_stats when the database
// has it (migration 0011), otherwise a reduction over the lead book.
// `ready` is false while neither source has answered: show a placeholder then.
export function useAgentNumbers(agent, bookReady) {
  const { user, dbVersion } = useApp();
  void dbVersion;
  const [res, setRes] = useState(null); // { id, row | null }
  const agentId = agent ? agent.id : null;
  useEffect(() => {
    if (!agentId) return undefined;
    let alive = true;
    agentLeadStats(user, [agentId], { monthStart: startOfMonth() })
      .then((rows) => { if (alive) setRes({ id: agentId, row: rows && rows.length ? rows[0] : null }); })
      .catch(() => { if (alive) setRes({ id: agentId, row: null }); });
    return () => { alive = false; };
  }, [user, agentId]);
  if (!agent) return null;
  const answered = !!res && res.id === agentId;
  const stats = answered ? res.row : null;
  const leads = stats ? null : getLeads(agent);
  const tgt = getTarget(agent.id);
  const ach = stats ? stats.visitsDone : achievement(agent.id, agent.role);
  const tar = tgt ? tgt.value : 0;
  const pct = tar > 0 ? Math.min(100, Math.round((ach / tar) * 100)) : 0;
  return {
    ready: !!stats || (answered && bookReady),
    stats,
    ach, tar, pct,
    calls: stats ? stats.calls : leads.reduce((s, l) => s + (l.callCount || 0), 0),
    leadCount: stats ? stats.leads : leads.length,
    converted: stats ? stats.converted : leads.filter((l) => l.status === 'SITE_VISIT_DONE' || l.status === 'DEAL_CLOSED_WON').length,
  };
}

// The monthly target block: "Site Visits Done  3 / 15", percent and a bar.
export function TargetProgress({ n }) {
  const t = useTheme();
  const tone = progTone(n.pct);
  const col = tone === 'brand' ? t.brand : tone === 'warn' ? t.warn : t.danger;
  return (
    <View style={{ gap: 6 }}>
      <T v="tiny" tone="mute">SITE VISITS DONE</T>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <Row gap={6} style={{ alignItems: 'flex-end' }}>
          <T v="num" color={col}>{n.ready ? n.ach : '…'}</T>
          <T tone="sub">/ {n.tar || '—'}</T>
        </Row>
        <T v="strong" color={col}>{n.pct}%</T>
      </Row>
      <Bar pct={n.pct} color={col} />
    </View>
  );
}

// One person's recent activity, fetched for that person only
// (fetchUserActivity, as the web's Team Activity feed does).
export function ActivityFeed({ userId, navigation, empty = 'No activity yet for this agent' }) {
  const t = useTheme();
  const { dbVersion } = useApp();
  const [feed, setFeed] = useState(null);
  useEffect(() => {
    let alive = true;
    fetchUserActivity(userId, { limit: 40 })
      .then((rows) => { if (alive) setFeed({ userId, rows }); })
      .catch(() => { if (alive) setFeed({ userId, rows: [] }); });
    return () => { alive = false; };
  }, [userId, dbVersion]);
  const rows = feed && feed.userId === userId ? feed.rows : null;
  return (
    <Card>
      {rows === null ? <Loading label="Loading activity…" /> : !rows.length ? <T tone="mute">{empty}</T> : rows.map((a, i) => (
        <Pressable key={a.id} disabled={!a.leadId} accessibilityRole={a.leadId ? 'button' : undefined}
          onPress={() => navigation.navigate('LeadDetail', { leadId: a.leadId })}
          style={({ pressed }) => ({ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', minHeight: 44, paddingVertical: space.sm, borderTopWidth: i ? 1 : 0, borderTopColor: t.line, opacity: pressed ? 0.6 : 1 })}>
          <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={actIcon(a.type)} size={16} color={t.sub} />
          </View>
          <View style={{ flex: 1 }}>
            <T v="small">{a.type === 'OFFER' ? 'Offer submitted' : a.description}</T>
            <T v="small" tone="mute" numberOfLines={1}>{a.leadName} · {fmtAgo(a.timestamp)}</T>
          </View>
        </Pressable>
      ))}
    </Card>
  );
}

// Set this month's target (the web's TargetModal: same check, same messages).
export function TargetSheet({ agent, visible, onClose }) {
  const { refresh } = useApp();
  const { toast } = useUI();
  const [val, setVal] = useState('');
  const agentId = agent ? agent.id : null;
  useEffect(() => {
    if (!visible || !agentId) return;
    const cur = getTarget(agentId);
    setVal(cur ? String(cur.value) : '');
  }, [visible, agentId]);
  const submit = () => {
    if (!val || !(parseInt(val, 10) >= 1)) { toast('Enter a valid target', 'err'); return; }
    setTargetFn(agentId, val);
    onClose();
    refresh();
    toast('Target updated', 'ok');
  };
  const month = new Date().toLocaleString('default', { month: 'long' });
  return (
    <Sheet visible={visible} onClose={onClose} title={`Set target — ${agent ? agent.name : ''}`}
      footer={<Button label="Set target" icon="flag" onPress={submit} />}>
      <Field label="Target (site visits done)" hint={`Site Visits Done target for ${month}`} value={val}
        onChangeText={(v) => setVal(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" placeholder="e.g. 15" maxLength={3} />
    </Sheet>
  );
}
