// Home. Counts come from the server (countLeads), one query per card, with the
// same KPI definitions as the web dashboards (KPI in src/lib/leadQuery.js); a
// card opens the lead list narrowed to exactly what it counted.
import { useEffect, useMemo, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import { Button, Card, Empty, Loading, Row, Screen, Section, Segmented, Stat, T, useUI } from '../ui';
import { useTheme, space } from '../theme';
import { useApp } from '../store';
import { useLeadCounts } from '../hooks';
import { LeadRow } from './lead/LeadsScreen';
import { ManagementHome, TeamLeadHome } from './home/SupervisorHome';
import { queryLeads, completeFollowUp } from '../../../src/lib/db.js';
import { dayBounds, fetchPending, pendingFor } from '../../../src/lib/followups.js';
import { typeOf, purposeText } from '../../../src/lib/followupTypes.js';
import { ROLES, effectiveRole } from '../../../src/lib/constants.js';
import { rlabel } from '../../../src/lib/helpers.js';

const TODO = [
  { key: 'today', kpi: 'followToday', label: 'Today', tone: 'brand', empty: 'Nothing due today.' },
  { key: 'missed', kpi: 'followMissed', label: 'Missed', tone: 'danger', empty: 'No missed follow-ups.' },
  { key: 'upcoming', kpi: 'followUpcoming', label: 'Upcoming', tone: 'purple', empty: 'Nothing scheduled after today.' },
];

// The follow-up to-do: three counted buckets and the list of the chosen one.
function FollowUps({ navigation }) {
  const { user, dbVersion, refresh } = useApp();
  const { toast } = useUI();
  const dayKey = new Date().toDateString();
  const bounds = useMemo(() => dayBounds(), [dayKey]); // eslint-disable-line react-hooks/exhaustive-deps -- recomputed when the day changes
  const specs = useMemo(() => Object.fromEntries(TODO.map((x) => [x.key, { user, involved: false, kpi: x.kpi, kpiArg: bounds }])), [user, bounds]);
  const counts = useLeadCounts(specs);
  const [tab, setTab] = useState('today');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(null);
  const rows = res && res.tab === tab ? res.list : null;

  useEffect(() => {
    let alive = true;
    queryLeads(specs[tab], { page: 0, size: 30, sort: tab === 'missed' ? 'followupDesc' : 'followup' }).then(async (r) => {
      const list = r?.rows || [];
      await fetchPending(list.map((l) => l.id), { force: true });
      if (alive) setRes({ tab, list });
    });
    return () => { alive = false; };
  }, [tab, specs, dbVersion]);

  const done = async (l) => {
    setBusy(l.id);
    try { await completeFollowUp(l.id, {}, user); refresh(); toast('Follow-up completed'); }
    catch { toast('Not saved. Try again.', 'err'); }
    setBusy(null);
  };
  const cur = TODO.find((x) => x.key === tab);

  return (
    <Section title="Follow-ups">
      <Segmented value={tab} onChange={setTab}
        options={TODO.map((x) => ({ value: x.key, label: `${x.label}${counts[x.key] != null ? ` (${counts[x.key]})` : ''}` }))} />
      {rows == null ? <Loading /> : !rows.length ? <Card><T tone="mute">{cur.empty}</T></Card> : rows.map((l) => {
        const p = pendingFor(l.id);
        const what = p ? [typeOf(p.type).label, purposeText(p)].filter(Boolean).join(' · ') : null;
        return (
          <View key={l.id} style={{ gap: 6 }}>
            <LeadRow lead={l} onPress={() => navigation.navigate('LeadDetail', { leadId: l.id })} />
            <Row style={{ justifyContent: 'space-between', paddingHorizontal: space.sm }}>
              <T v="small" tone="mute" style={{ flex: 1 }} numberOfLines={1}>{what || ''}</T>
              <Button label="Done" icon="check" small full={false} variant="soft" tone="brand" busy={busy === l.id} onPress={() => done(l)} />
            </Row>
          </View>
        );
      })}
    </Section>
  );
}

// One grid of counted cards. cards = [{ key, label, tone, icon, opts, preset }].
function KpiGrid({ title, cards, navigation }) {
  const specs = useMemo(() => Object.fromEntries(cards.map((c) => [c.key, c.opts])), [cards]);
  const counts = useLeadCounts(specs);
  return (
    <Section title={title}>
      <Row wrap gap={space.md}>
        {cards.map((c) => (
          <Stat key={c.key} label={c.label} tone={c.tone} icon={c.icon} value={counts[c.key]}
            onPress={() => navigation.navigate('LeadList', { preset: { title: c.label, ...c.preset } })} />
        ))}
      </Row>
    </Section>
  );
}

export default function HomeScreen({ navigation }) {
  const { user, syncing, reload } = useApp();
  const t = useTheme();
  const role = effectiveRole(user);

  const cards = useMemo(() => {
    const kpi = (key, label, name, tone, icon, more = {}) => ({
      key, label, tone, icon,
      opts: { user, involved: true, kpi: name, ...more },
      preset: { kpi: name, ...more },
    });
    const byStatus = (key, label, status, tone, icon) => ({
      key, label, tone, icon, opts: { user, involved: true, status }, preset: { status },
    });
    if (role === ROLES.AGENT) {
      return [
        { key: 'leads', label: 'My leads', icon: 'groups', opts: { user, involved: true }, preset: {} },
        kpi('connected', 'Connected', 'connected', 'teal', 'phone-callback'),
        kpi('interested', 'Interested', 'interested', 'brand', 'thumb-up'),
        // Workload cards cover only the leads this agent holds now.
        kpi('untouched', 'Never called', 'untouched', 'info', 'fiber-new', { involved: false }),
        kpi('followPending', 'Follow-up pending', 'followPending', 'warn', 'alarm', { involved: false }),
        kpi('meetings', 'Meetings I set', 'meetingsSet', 'purple', 'event', { kpiArg: user.id }),
        kpi('notInterested', 'Not interested', 'notInterested', 'danger', 'thumb-down'),
      ];
    }
    return [
      { key: 'all', label: 'All leads', icon: 'groups', opts: { user, involved: true }, preset: {} },
      kpi('active', 'Active', 'active', 'info', 'bolt'),
      kpi('connected', 'Connected', 'connected', 'teal', 'phone-callback'),
      kpi('interested', 'Interested', 'interested', 'brand', 'thumb-up'),
      byStatus('meeting', 'Meeting set', 'MEETING_SET', 'purple', 'event'),
      byStatus('visit', 'Visit done', 'SITE_VISIT_DONE', 'teal', 'location-on'),
      byStatus('neg', 'Negotiating', 'NEGOTIATING', 'warn', 'balance'),
      byStatus('won', 'Deals won', 'DEAL_CLOSED_WON', 'brand', 'emoji-events'),
      byStatus('lost', 'Deals lost', 'DEAL_CLOSED_LOST', 'danger', 'thumb-down'),
      kpi('notInterested', 'Not interested', 'notInterested', 'danger', 'block'),
    ];
  }, [user, role]);

  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  if (user.role === ROLES.MASTER) {
    return (
      <Screen>
        <T v="title">{hello}, {String(user.name || '').split(' ')[0]}</T>
        <Empty icon="corporate-fare" title="Master account" hint="Company overview is in the menu, under Companies." action={<Button label="Open companies" full={false} onPress={() => navigation.navigate('Companies')} />} />
      </Screen>
    );
  }

  return (
    <Screen refreshControl={<RefreshControl refreshing={syncing} onRefresh={reload} tintColor={t.brand} />}>
      <View>
        <T v="title">{hello}, {String(user.name || '').split(' ')[0]}</T>
        <T tone="sub">{rlabel(user.role)}</T>
      </View>
      {/* Supervisors get their dashboard first (the web's Management / Team Lead
          home); the Team Lead's own cards already open the lists they count,
          so the plain lead-book grid is kept for Management only. */}
      {role === ROLES.MGMT ? <ManagementHome navigation={navigation} /> : null}
      {role === ROLES.TL ? <TeamLeadHome navigation={navigation} /> : null}
      <FollowUps navigation={navigation} />
      {role !== ROLES.TL ? <KpiGrid title={role === ROLES.AGENT ? 'My numbers' : 'Lead book'} cards={cards} navigation={navigation} /> : null}
    </Screen>
  );
}
