// Booking, step one: choose a project. The phone version of the web's
// src/components/booking/ProjectList.jsx, with the projects ShopBookingView passes
// it: the account's own projects (projectsFor), masked to what it may see
// (customers, prices). A project with no floor plan yet cannot be booked and says so.
// Adding and editing projects stay on the web (Projects page).
import { useMemo, useState } from 'react';
import { FlatList, Image, Pressable, View } from 'react-native';
import { Badge, Empty, Icon, Row, Screen, SearchField, T } from '../../ui';
import { useTheme, space, radius } from '../../theme';
import { useApp } from '../../store';
import { planProjects, maskProject, projectsFor, projectInventory } from '../../../../src/lib/projects.js';
import { canCustomers, canPrices, canSee } from '../../../../src/lib/constants.js';
import { swatch } from './bits';

function Stat({ status, label, color }) {
  const t = useTheme();
  const sw = color ? { bg: color, border: color } : swatch(t, status);
  return (
    <Row gap={5}>
      <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: sw.bg, borderWidth: 1, borderColor: sw.border }} />
      <T v="small" tone="sub">{label}</T>
    </Row>
  );
}

function ProjectCard({ p, manage, onPress }) {
  const t = useTheme();
  const [broken, setBroken] = useState(false);
  const inv = projectInventory(p);
  const cover = p.media?.images?.[0]?.url || p.images?.[0] || '';
  const ready = (p.floorPlans || []).length > 0;
  return (
    <Pressable onPress={ready ? onPress : undefined} disabled={!ready} accessibilityRole="button"
      accessibilityLabel={ready ? `Open ${p.name}` : `${p.name}, no floor plan yet`}
      style={({ pressed }) => ({ backgroundColor: t.card, borderRadius: radius.lg, overflow: 'hidden', opacity: !ready ? 0.6 : pressed ? 0.75 : 1 })}>
      <View style={{ height: 120, backgroundColor: t.raised, alignItems: 'center', justifyContent: 'center' }}>
        {cover && !broken
          ? <Image source={{ uri: cover }} onError={() => setBroken(true)} resizeMode="cover" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
          : <Icon name="apartment" size={34} color={t.mute} />}
        {p.purpose ? <View style={{ position: 'absolute', top: space.sm, left: space.sm }}><Badge label={p.purpose} /></View> : null}
      </View>
      <View style={{ padding: space.md, gap: 4 }}>
        <T v="strong" numberOfLines={1}>{p.name || 'Untitled project'}</T>
        <T v="small" tone="sub" numberOfLines={1}>{p.address || 'No address yet'}</T>
        {ready ? (
          <Row wrap gap={space.md} style={{ marginTop: 2 }}>
            <Stat status="available" label={`${inv.available} open`} />
            <Stat status="hold" label={`${inv.hold} held`} />
            <Stat status="sold" label={`${inv.soldOnly} sold`} />
            {inv.landowner > 0 ? <Stat color="#A78BFA" label={`${inv.landowner} landowner`} /> : null}
          </Row>
        ) : null}
        <Row style={{ marginTop: 4 }}>
          {ready
            ? <><T v="small" color={t.brand} style={{ fontWeight: '600' }}>Choose a unit</T><Icon name="arrow-forward" size={16} color={t.brand} /></>
            : <T v="small" tone="mute">{manage ? 'No floor plan yet. Add one in Projects on the web.' : 'No floor plan yet.'}</T>}
        </Row>
      </View>
    </Pressable>
  );
}

export default function BookingScreen({ navigation }) {
  const { user, dbVersion } = useApp();
  const [q, setQ] = useState('');
  const manage = canSee(user, 'properties');
  const projects = useMemo(() => {
    const access = { customers: canCustomers(user), prices: canPrices(user) };
    return projectsFor(user, planProjects()).map((p) => maskProject(p, access));
  }, [user, dbVersion]); // eslint-disable-line react-hooks/exhaustive-deps -- the store changes in place

  const term = q.trim().toLowerCase();
  const shown = projects.filter((p) => !term || `${p.name || ''} ${p.address || ''} ${p.purpose || ''}`.toLowerCase().includes(term));

  return (
    <Screen scroll={false}>
      <FlatList
        data={shown}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => (
          <View style={{ paddingHorizontal: space.lg }}>
            <ProjectCard p={item} manage={manage} onPress={() => navigation.navigate('BookingProject', { projectId: item.id })} />
          </View>
        )}
        ItemSeparatorComponent={() => <View style={{ height: space.md }} />}
        ListHeaderComponent={projects.length > 6 ? (
          <View style={{ paddingHorizontal: space.lg, paddingTop: space.md }}>
            <SearchField value={q} onChangeText={setQ} placeholder="Search projects" />
          </View>
        ) : <View style={{ height: space.md }} />}
        ListHeaderComponentStyle={{ marginBottom: space.md }}
        ListEmptyComponent={!projects.length
          ? <Empty icon="apartment" title="No projects yet" hint={manage ? 'Add one in Projects on the web.' : 'Ask a manager to add one.'} />
          : <Empty icon="search-off" title="No project matches" hint="Try another word." />}
        ListFooterComponent={<View style={{ height: space.xl }} />}
        keyboardShouldPersistTaps="handled"
      />
    </Screen>
  );
}
