// Agent performance: one scorecard per agent for the chosen period, ranked.
// Port of the web's Analytics › Performance tab
// (src/components/views/AnalyticsPerf.jsx); every number comes from
// buildAgentPerf() in src/lib/agentPerf.js. The period decides which leads count
// as sourced (their created date); a Team Lead sees their own team only.
import { useMemo, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { Avatar, Badge, Card, ChipBar, Empty, Icon, Loading, Row, Screen, SearchField, T } from '../../ui';
import { useTheme, space } from '../../theme';
import { useApp } from '../../store';
import { Bar, Kpi, Mini, useBookAndActs } from './parts';
import { getDB } from '../../../../src/lib/db.js';
import { ROLES } from '../../../../src/lib/constants.js';
import { buildAgentPerf, ROLE_VIEWS } from '../../../../src/lib/agentPerf.js';
import { PERIODS, periodStart } from '../../../../src/lib/analyticsPeriod.js';

// Same choices and order as the web's "Sort by".
const SORTS = [
  { value: 'best', label: 'Best conversion' },
  { value: 'sourced', label: 'Most sourced' },
  { value: 'score', label: 'Highest score' },
  { value: 'alpha', label: 'Name A–Z' },
];
const AGG = ['sourced', 'contacted', 'untouched', 'calls', 'talkMins', 'followups', 'meetingsSet', 'visitsSched', 'visitsDone', 'sentTL'];
// Contact-rate tiers of the web table (50 and 25).
const tier = (c) => (c >= 50 ? 'brand' : c >= 25 ? 'warn' : 'danger');

// 7-day lead volume, as seven small bars (the web draws a line).
function Spark({ pts }) {
  const t = useTheme();
  const mx = Math.max(...pts, 1);
  return (
    <Row gap={3} style={{ alignItems: 'flex-end', height: 24 }}>
      {pts.map((p, i) => (
        <View key={i} style={{ width: 6, height: Math.max(2, Math.round((p / mx) * 24)), borderRadius: 2, backgroundColor: p ? t.info : t.line }} />
      ))}
    </Row>
  );
}

function AgentRow({ r, rank, teamName, spark, onPress }) {
  const t = useTheme();
  const c = r.contactRate;
  const tone = tier(c);
  const col = tone === 'brand' ? t.brand : tone === 'warn' ? t.warn : t.danger;
  return (
    <Card onPress={onPress}>
      <Row gap={space.md}>
        <T v="strong" tone="mute" style={{ minWidth: 22 }}>{rank}</T>
        <Avatar name={r.u.name} size={36} />
        <View style={{ flex: 1 }}>
          <T v="strong" numberOfLines={1}>{r.u.name}</T>
          <T v="small" tone="mute" numberOfLines={1}>{teamName}{r.untouched > 0 ? ` · ${r.untouched} untouched` : ''}</T>
        </View>
        <Badge label={`Score ${r.score}`} tone={r.score >= 70 ? 'brand' : r.score < 30 ? 'danger' : 'neutral'} />
        <Icon name="chevron-right" color={t.mute} />
      </Row>
      <Row style={{ marginTop: space.xs }}>
        <Mini label="Sourced" value={r.sourced} />
        <Mini label="Contacted" value={r.contacted} />
        <Mini label="Meetings" value={r.meetingsSet} />
        <Mini label="Sent to TL" value={r.sentTL} />
      </Row>
      <Row gap={space.md} style={{ marginTop: space.xs }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <T v="small" tone="sub">Contact rate</T>
            <T v="small" color={col} style={{ fontWeight: '700' }}>{Math.round(c)}%</T>
          </Row>
          <Bar pct={c} color={col} height={6} />
        </View>
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Spark pts={spark} />
          <T v="small" tone="mute">7 days</T>
        </View>
      </Row>
      <T v="small" tone="sub">Visits done {r.visitsDone} of {r.visitsSched} scheduled</T>
    </Card>
  );
}

export default function PerformanceScreen({ navigation }) {
  const { user, dbVersion } = useApp();
  const t = useTheme();
  const ready = useBookAndActs(); // reduces over every lead, and over the activity window for calls
  const db = getDB();
  const [pk, setPk] = useState('30');
  const [team, setTeam] = useState('ALL');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('best');

  const mine = user.role === ROLES.TL ? user.teamId : null; // a Team Lead sees their own team only
  const teams = (db.teams || []).filter((x) => !user.companyId || !x.companyId || x.companyId === user.companyId);
  const teamId = mine || (team === 'ALL' ? null : team);

  const rows = useMemo(
    () => buildAgentPerf(db, { start: periodStart(pk), end: null, periodDays: 0, teamId }).filter((r) => r.u.role === ROLES.AGENT),
    [db, pk, teamId, dbVersion, ready] // eslint-disable-line react-hooks/exhaustive-deps -- db mutates in place; dbVersion is the change signal
  );

  // 7-day lead volume per agent (AnalyticsPerf.jsx, sparkOf).
  const sparkOf = useMemo(() => {
    const days = 7; const now = new Date(); now.setHours(0, 0, 0, 0);
    const map = {};
    (db.leads || []).forEach((l) => {
      [l.assignedTo, ...(l.previousAssignees || [])].forEach((id) => {
        if (!id) return;
        if (!map[id]) map[id] = Array(days).fill(0);
        const dd = Math.floor((now - new Date(new Date(l.createdAt).setHours(0, 0, 0, 0))) / 864e5);
        if (dd >= 0 && dd < days) map[id][days - 1 - dd]++;
      });
    });
    return (id) => map[id] || Array(days).fill(0);
  }, [db, dbVersion, ready]); // eslint-disable-line react-hooks/exhaustive-deps -- as above

  const agg = rows.reduce((a, r) => { AGG.forEach((k) => { a[k] = (a[k] || 0) + r[k]; }); return a; }, Object.fromEntries(AGG.map((k) => [k, 0])));
  const kpis = ROLE_VIEWS[ROLES.AGENT].kpis(agg);
  const rate = agg.sourced ? Math.round((agg.contacted / agg.sourced) * 100) : 0;

  const needle = q.trim().toLowerCase();
  const list = rows
    .filter((r) => !needle || (r.u.name || '').toLowerCase().includes(needle))
    .sort((a, b) => (sort === 'alpha' ? (a.u.name || '').localeCompare(b.u.name || '')
      : sort === 'sourced' ? b.sourced - a.sourced
      : sort === 'score' ? b.score - a.score
      : b.contactRate - a.contactRate || b.sourced - a.sourced));
  const teamName = (u) => (teams.find((x) => x.id === u.teamId) || {}).name || '—';
  const period = PERIODS.find((p) => p.key === pk);

  const header = (
    <View style={{ gap: space.sm, paddingTop: space.md }}>
      <View style={{ paddingHorizontal: space.lg }}>
        <SearchField value={q} onChangeText={setQ} placeholder="Search agent" />
      </View>
      <ChipBar options={PERIODS.map((p) => ({ value: p.key, label: p.label }))} value={pk} onChange={setPk} />
      {!mine && teams.length ? (
        <ChipBar options={[{ value: 'ALL', label: 'All teams' }, ...teams.map((x) => ({ value: x.id, label: x.name }))]} value={team} onChange={setTeam} />
      ) : null}
      <Row style={{ justifyContent: 'space-between', paddingHorizontal: space.lg }}>
        <T v="small" tone="mute" style={{ flex: 1 }} numberOfLines={1}>
          Leads sourced {pk === 'all' ? 'since the start' : pk === '1' ? 'today' : `in the last ${period.label}`} · {list.length} agent{list.length === 1 ? '' : 's'}
        </T>
        <Pressable onPress={() => setSort(SORTS[(SORTS.findIndex((s) => s.value === sort) + 1) % SORTS.length].value)} accessibilityRole="button" hitSlop={8}>
          <Row gap={4}><Icon name="swap-vert" size={16} color={t.sub} /><T v="small" tone="sub">{SORTS.find((s) => s.value === sort).label}</T></Row>
        </Pressable>
      </Row>
      {ready ? (
        <Row wrap gap={space.md} style={{ paddingHorizontal: space.lg }}>
          {kpis.map((k) => <Kpi key={k.label} label={k.label} value={Number(k.val).toLocaleString()} sub={k.sub} />)}
          <Kpi label="Contact rate" value={`${rate}%`} sub={`${agg.contacted || 0} of ${agg.sourced || 0} contacted`} />
        </Row>
      ) : null}
    </View>
  );

  return (
    <Screen scroll={false}>
      <FlatList
        data={ready ? list : []}
        keyExtractor={(r) => r.u.id}
        renderItem={({ item, index }) => (
          <View style={{ paddingHorizontal: space.lg }}>
            <AgentRow r={item} rank={index + 1} teamName={teamName(item.u)} spark={sparkOf(item.u.id)}
              onPress={() => navigation.navigate('AgentDetail', { userId: item.u.id, period: pk })} />
          </View>
        )}
        ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
        ListHeaderComponent={header}
        ListHeaderComponentStyle={{ marginBottom: space.md }}
        ListEmptyComponent={!ready ? <Loading label="Loading leads…" />
          : <Empty icon="search-off" title="No agent matches" hint="Try another word, team or period." />}
        ListFooterComponent={<View style={{ height: space.xl }} />}
        keyboardShouldPersistTaps="handled"
      />
    </Screen>
  );
}
