// Team (Team Lead): the team's agents with their headline numbers, then the
// executives, then one person's recent activity. Port of the web's
// src/components/views/TeamView.jsx and dashboards/AgentCard.jsx.
import { useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { Avatar, Button, Card, ChipBar, Empty, Icon, Row, Screen, Section, T } from '../../ui';
import { useTheme, space } from '../../theme';
import { useApp } from '../../store';
import { useLeadBook } from '../../hooks';
import { ActivityFeed, Mini, TargetProgress, TargetSheet, projectLabel, useAgentNumbers } from './parts';
import { getDB } from '../../../../src/lib/db.js';
import { ROLES } from '../../../../src/lib/constants.js';
import { rlabel } from '../../../../src/lib/helpers.js';

function AgentCard({ agent, bookReady, navigation, onTarget }) {
  const t = useTheme();
  const n = useAgentNumbers(agent, bookReady);
  const proj = projectLabel(agent);
  const show = (v) => (n.ready ? v : null);
  return (
    <Card>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open ${agent.name}`}
        onPress={() => navigation.navigate('AgentDetail', { userId: agent.id })}
        style={({ pressed }) => ({ gap: space.md, opacity: pressed ? 0.7 : 1 })}>
        <Row gap={space.md}>
          <Avatar name={agent.name} />
          <View style={{ flex: 1 }}>
            <T v="strong" numberOfLines={1}>{agent.name}</T>
            <T v="small" tone="sub">{rlabel(agent.role)}</T>
          </View>
          <Icon name="chevron-right" color={t.mute} />
        </Row>
        <TargetProgress n={n} />
        <Row>
          <Mini label="Customers" value={show(n.leadCount)} />
          <Mini label="Calls" value={show(n.calls)} />
          <Mini label="Converted" value={show(n.converted)} />
        </Row>
        <Row gap={6}>
          <Icon name="apartment" size={15} color={proj === 'No projects' ? t.warn : t.sub} />
          <T v="small" tone={proj === 'No projects' ? 'warn' : 'sub'}>{proj}</T>
        </Row>
      </Pressable>
      <Row style={{ marginTop: space.xs }}>
        <View style={{ flex: 1 }}><Button label="Target" icon="flag" small variant="ghost" onPress={() => onTarget(agent)} /></View>
        <View style={{ flex: 1 }}>
          <Button label="Customers" icon="list" small variant="soft"
            onPress={() => navigation.navigate('LeadList', { preset: { title: agent.name + "'s leads", agentId: agent.id } })} />
        </View>
      </Row>
    </Card>
  );
}

export default function TeamScreen({ navigation }) {
  const { user, dbVersion } = useApp();
  void dbVersion;
  // The cards reduce over the book until the database has agent_lead_stats.
  const bookReady = useLeadBook();
  const db = getDB();
  const agents = db.users.filter((u) => (u.role === ROLES.AGENT || u.role === ROLES.MA) && u.teamId === user.teamId);
  // Executives are created by the Team Lead too, so they are listed, as a plain
  // row: targets, calls and conversions do not apply to them.
  const execs = db.users.filter((u) => u.role === ROLES.EXEC && u.teamId === user.teamId);

  // Team activity: one person at a time; the Team Lead first and by default.
  const feedPeople = [user, ...agents, ...execs].filter(Boolean);
  const [feedUser, setFeedUser] = useState(user.id);
  const activeFeedUser = feedPeople.some((p) => p.id === feedUser) ? feedUser : user.id;
  const [tgtAgent, setTgtAgent] = useState(null);

  const footer = (
    <View style={{ gap: space.md, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xl }}>
      {execs.length > 0 ? (
        <Section title="Executives">
          <Card>
            {execs.map((u) => (
              <Row key={u.id} gap={space.md} style={{ minHeight: 44 }}>
                <Avatar name={u.name} size={34} />
                <View style={{ flex: 1 }}>
                  <T v="strong" numberOfLines={1}>{u.name}</T>
                  <T v="small" tone="sub">{rlabel(u.role)}</T>
                </View>
              </Row>
            ))}
          </Card>
        </Section>
      ) : null}
      <Section title="Team activity">
        <ChipBar pad={false} value={activeFeedUser} onChange={setFeedUser}
          options={feedPeople.map((p) => ({ value: p.id, label: p.id === user.id ? `${p.name} (me)` : p.name }))} />
        <ActivityFeed userId={activeFeedUser} navigation={navigation} />
      </Section>
    </View>
  );

  return (
    <Screen scroll={false}>
      <FlatList
        data={agents}
        keyExtractor={(a) => a.id}
        renderItem={({ item }) => (
          <View style={{ paddingHorizontal: space.lg }}>
            <AgentCard agent={item} bookReady={bookReady} navigation={navigation} onTarget={setTgtAgent} />
          </View>
        )}
        ItemSeparatorComponent={() => <View style={{ height: space.md }} />}
        ListHeaderComponent={(
          <View style={{ paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.sm }}>
            <T v="tiny" tone="mute">AGENTS · {agents.length}</T>
          </View>
        )}
        ListEmptyComponent={<Empty icon="groups" title="No agents in your team" hint="Agents added to your team show here." />}
        ListFooterComponent={footer}
      />
      <TargetSheet agent={tgtAgent} visible={!!tgtAgent} onClose={() => setTgtAgent(null)} />
    </Screen>
  );
}
