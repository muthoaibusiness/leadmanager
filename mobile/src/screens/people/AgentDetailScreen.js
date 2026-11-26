// One agent (route.params.userId): this month's target, the headline numbers of
// the web's AgentCard, the agent's row of the performance table
// (buildAgentPerf, src/lib/agentPerf.js) laid out in full with its funnel, a
// button to their leads, and their recent activity (fetchUserActivity).
// The web has no page of its own for this: it shows the same numbers on the
// Team card, in the Analytics › Performance row and in the Team Activity feed.
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Avatar, Badge, Button, Card, ChipBar, Empty, Icon, Loading, Row, Screen, Section, T } from '../../ui';
import { useTheme, space } from '../../theme';
import { useApp } from '../../store';
import { ActivityFeed, BarRow, Kpi, Mini, TargetProgress, TargetSheet, projectLabel, useAgentNumbers, useBookAndActs, usePalette } from './parts';
import { getDB, getLeads } from '../../../../src/lib/db.js';
import { ROLES, canSee } from '../../../../src/lib/constants.js';
import { buildAgentPerf, ROLE_VIEWS } from '../../../../src/lib/agentPerf.js';
import { PERIODS, periodStart } from '../../../../src/lib/analyticsPeriod.js';
import { fmtBDT, rlabel } from '../../../../src/lib/helpers.js';

export default function AgentDetailScreen({ navigation, route }) {
  const { user, dbVersion } = useApp();
  const t = useTheme();
  const palette = usePalette();
  const userId = route.params?.userId;
  const ready = useBookAndActs();
  const db = getDB();
  const agent = db.users.find((u) => u.id === userId) || null;
  // A Team Lead's pages cover their own team only.
  const allowed = !!agent && (user.role !== ROLES.TL || agent.teamId === user.teamId || agent.id === user.id);
  const n = useAgentNumbers(allowed ? agent : null, ready);
  const [pk, setPk] = useState(route.params?.period || '30');
  const [tgtOpen, setTgtOpen] = useState(false);

  const name = agent ? agent.name : '';
  useEffect(() => { if (name) navigation.setOptions({ title: name }); }, [navigation, name]);

  // The same call as the Performance page, so the row (and its score, which is
  // relative to the other agents in scope) is the one shown there.
  const mine = user.role === ROLES.TL ? user.teamId : null;
  const row = useMemo(
    () => (allowed ? buildAgentPerf(db, { start: periodStart(pk), end: null, periodDays: 0, teamId: mine }).find((r) => r.u.id === userId) || null : null),
    [db, pk, mine, userId, allowed, dbVersion, ready] // eslint-disable-line react-hooks/exhaustive-deps -- db mutates in place; dbVersion is the change signal
  );

  if (!allowed) {
    return <Screen><Empty icon="person-off" title="Agent not found" hint="This account is not in your team, or no longer exists." /></Screen>;
  }

  const team = (db.teams || []).find((x) => x.id === agent.teamId);
  const proj = projectLabel(agent);
  const show = (v) => (n.ready ? v : null);

  // Deals won and revenue: agent_lead_stats when it answered, else the
  // reduction TeamLeadDash.jsx does for "Top performers" over the book.
  let won = null; let revenue = null;
  if (n.stats) { won = n.stats.won; revenue = n.stats.revenue; }
  else if (n.ready) {
    const wonLeads = getLeads(user).filter((l) => (l.assignedTo === agent.id || (l.previousAssignees || []).includes(agent.id)) && l.status === 'DEAL_CLOSED_WON');
    won = wonLeads.length;
    revenue = wonLeads.reduce((s, l) => s + (l.dealValue || 0), 0);
  }

  const view = row ? ROLE_VIEWS[row.u.role] : null;
  const funnel = view ? view.funnel(row, palette) : [];
  const fMax = Math.max(1, ...funnel.map((f) => f.value));
  const period = PERIODS.find((p) => p.key === pk);
  const cell = (c) => (c.money ? fmtBDT(row[c.k]) : c.fmt(row[c.k]));

  return (
    <Screen>
      <Card>
        <Row gap={space.md}>
          <Avatar name={agent.name} size={52} />
          <View style={{ flex: 1, gap: 2 }}>
            <T v="h2" numberOfLines={1}>{agent.name}</T>
            <T v="small" tone="sub">{[rlabel(agent.role), team ? team.name : null].filter(Boolean).join(' · ')}</T>
            <Row gap={6}>
              <Icon name="apartment" size={14} color={proj === 'No projects' ? t.warn : t.sub} />
              <T v="small" tone={proj === 'No projects' ? 'warn' : 'sub'}>{proj}</T>
            </Row>
          </View>
        </Row>
      </Card>

      <Button label={`Open ${agent.name}'s leads`} icon="list"
        onPress={() => navigation.navigate('LeadList', { preset: { title: agent.name + "'s leads", agentId: userId } })} />

      <Section title="This month"
        action={canSee(user, 'team') ? <Button label="Set target" icon="flag" small full={false} variant="ghost" onPress={() => setTgtOpen(true)} /> : null}>
        <Card>
          <TargetProgress n={n} />
        </Card>
      </Section>

      <Section title="Book">
        <Card>
          <Row>
            <Mini label="Customers" value={show(n.leadCount)} />
            <Mini label="Calls" value={show(n.calls)} />
            <Mini label="Converted" value={show(n.converted)} />
            <Mini label="Deals won" value={won} />
          </Row>
          <Row style={{ justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: t.line, paddingTop: space.sm }}>
            <T v="small" tone="sub">Revenue from deals won</T>
            <T v="strong">{revenue == null ? '…' : fmtBDT(revenue)}</T>
          </Row>
        </Card>
      </Section>

      <Section title="Performance">
        <ChipBar pad={false} options={PERIODS.map((p) => ({ value: p.key, label: p.label }))} value={pk} onChange={setPk} />
        {!ready ? <Loading label="Loading leads…" /> : !row ? (
          <Card><T tone="mute">The performance table covers Agents and Team Leads only.</T></Card>
        ) : (
          <>
            <Row style={{ justifyContent: 'space-between' }}>
              <T v="small" tone="mute" style={{ flex: 1 }}>Leads created {pk === 'all' ? 'since the start' : pk === '1' ? 'today' : `in the last ${period.label}`}</T>
              <Badge label={`Score ${row.score}`} tone={row.score >= 70 ? 'brand' : row.score < 30 ? 'danger' : 'neutral'} />
            </Row>
            <Row wrap gap={space.md}>
              {view.kpis(row).map((k) => (
                <Kpi key={k.label} label={k.label} sub={k.sub}
                  value={k.val === '__REVENUE__' ? fmtBDT(row.revenue) : Number(k.val).toLocaleString()} />
              ))}
            </Row>
            <Card>
              <T v="strong">Funnel</T>
              {funnel.map((f) => (
                <BarRow key={f.label} label={f.label} value={f.value} color={f.color} pct={(f.value / fMax) * 100}
                  sub={funnel[0].value ? `${Math.round((f.value / funnel[0].value) * 100)}%` : null} />
              ))}
            </Card>
            <Card>
              {view.columns.map((c, i) => (
                <Row key={c.k} style={{ justifyContent: 'space-between', minHeight: 32, borderTopWidth: i ? 1 : 0, borderTopColor: t.line }}>
                  <T v="small" tone="sub">{c.t}</T>
                  <T v="strong" tone={c.good && row[c.k] ? 'brand' : c.bad && row[c.k] ? 'danger' : undefined} style={{ fontVariant: ['tabular-nums'] }}>{cell(c)}</T>
                </Row>
              ))}
              {row.u.role === ROLES.AGENT ? (
                <>
                  <Row style={{ justifyContent: 'space-between', minHeight: 32, borderTopWidth: 1, borderTopColor: t.line }}>
                    <T v="small" tone="sub">Untouched</T>
                    <T v="strong" tone={row.untouched ? 'warn' : undefined}>{row.untouched}</T>
                  </Row>
                  <Row style={{ justifyContent: 'space-between', minHeight: 32, borderTopWidth: 1, borderTopColor: t.line }}>
                    <T v="small" tone="sub">Visits scheduled</T>
                    <T v="strong">{row.visitsSched}</T>
                  </Row>
                  <Row style={{ justifyContent: 'space-between', minHeight: 32, borderTopWidth: 1, borderTopColor: t.line }}>
                    <T v="small" tone="sub">Talk time</T>
                    <T v="strong">{row.talkMins} min</T>
                  </Row>
                  <Row style={{ justifyContent: 'space-between', minHeight: 32, borderTopWidth: 1, borderTopColor: t.line }}>
                    <T v="small" tone="sub">Follow-ups</T>
                    <T v="strong">{row.followups}</T>
                  </Row>
                </>
              ) : null}
            </Card>
          </>
        )}
      </Section>

      <Section title="Recent activity">
        <ActivityFeed userId={userId} navigation={navigation} />
      </Section>

      <TargetSheet agent={agent} visible={tgtOpen} onClose={() => setTgtOpen(false)} />
    </Screen>
  );
}
