// One project: the phone version of the web project console's agent view
// (src/components/project/ProjectConsole.jsx): facts, photos, documents and
// links, unit types, and the unit grid by floor and type with each unit's
// status (the project's own status tags where a unit has one).
//
// An available unit opens the hold request (HoldSheet.js), the console's deal
// cart: same fields, same numbers (computeDeal), same two writes. The catalog
// editor, floor-plan drawing, invoice PDF and the payment / close steps stay
// on the web.
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Image, Linking, Pressable, View } from 'react-native';
import { Badge, Button, Card, ChipBar, Empty, Icon, ListItem, Row, Screen, Section, Sheet, T, useUI } from '../../ui';
import { useTheme, toneColors, space, radius } from '../../theme';
import { useApp } from '../../store';
import { ROLES, PROPERTY_STATUS, canSee } from '../../../../src/lib/constants.js';
import { getProjectById, projectFloors, projectInventory, projectTypeOf, unitPrice, unitSize } from '../../../../src/lib/projects.js';
import { PROJECT_STATUS_TONE, UNIT_TONE, crShort, taka, unitKey, unitLook } from './bits';
import UnitSheet from './HoldSheet';

const COLS = 3;

function Fact({ label, value }) {
  return (
    <View style={{ minWidth: '45%', flex: 1, gap: 1 }}>
      <T v="tiny" tone="mute">{label.toUpperCase()}</T>
      <T v="strong">{value}</T>
    </View>
  );
}

// A status swatch. A project's own status carries its own colour (stored on
// the project, chosen by its owner); the three base statuses use theme tones.
function Dot({ color, size = 9 }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

export default function ProjectDetailScreen({ navigation, route }) {
  const { user, dbVersion } = useApp();
  const t = useTheme();
  const { toast } = useUI();
  const projectId = route.params?.projectId;
  // dbVersion: the stored project is changed in place, so read it again per change.
  const p = useMemo(() => getProjectById(projectId), [projectId, dbVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const variants = useMemo(() => (p ? p.variants : []), [p]);
  const floors = useMemo(() => (p ? projectFloors(p) : []), [p]);

  const [floorSel, setFloorSel] = useState(null);
  const [vid, setVid] = useState(null);
  const [unitId, setUnitId] = useState(null); // the unit whose sheet is open
  const [photo, setPhoto] = useState(null);

  useEffect(() => { navigation.setOptions({ title: p?.name || 'Project' }); }, [navigation, p?.name]);

  if (!p) return <Screen><Empty icon="apartment" title="Project not found" hint="It may have been removed." /></Screen>;

  // Floor and type, picked as the console picks them: the 1st Floor when there
  // is one, and a type is offered only on floors it has units on.
  const floor = floors.find((f) => f.name === floorSel) || floors.find((f) => /^1st\b/i.test(f.name)) || floors[0] || null;
  const onFloor = (u) => !floor || floor.ids.has(u.id);
  const hasFloor = (v) => (v.units || []).some(onFloor);
  const variant = variants.find((v) => v.id === vid && hasFloor(v)) || variants.find(hasFloor) || variants[0] || null;
  const floorUnits = variant ? (variant.units || []).filter(onFloor) : [];
  const vAvail = floorUnits.filter((u) => u.status === 'available').length;

  const iv = projectInventory(p);
  // Floor (bottom) price and total project value are commercially sensitive:
  // only Team Leads and Management see them (ProjectConsole canSeeFloor).
  const canSeeFloor = [ROLES.TL, ROLES.MGMT, ROLES.MASTER].includes(user?.role);
  const projectValue = variants.reduce((s, v) => s + (v.units || []).reduce((n, u) => n + unitPrice(u, v), 0), 0);

  const photos = p.media?.images || [];
  const docs = p.media?.docs || [];
  const links = p.media?.links || [];
  const open = (url) => { if (url) Linking.openURL(url).catch(() => toast('Could not open the link', 'err')); };
  const bare = (url) => String(url || '').replace(/^https?:\/\//, '');

  const toneOf = (u) => toneColors(t, UNIT_TONE[u.status] || 'neutral');
  const legend = [
    ['available', 'Available', toneColors(t, 'brand').fg], ['hold', 'On hold', toneColors(t, 'warn').fg], ['sold', 'Sold', toneColors(t, 'danger').fg],
    ...(p.unitStatuses || []).map((st) => ['c:' + st.id, st.name, st.color]),
  ].map(([k, label, color]) => ({ k, label, color, n: floorUnits.filter((u) => unitKey(p.unitStatuses, u) === k).length }));

  const sheetUnit = unitId ? variants.flatMap((v) => (v.units || []).map((u) => ({ u, v }))).find((x) => x.u.id === unitId) : null;

  const header = (
    <View style={{ gap: space.md, paddingTop: space.md, paddingBottom: space.sm }}>
      {photos.length > 0 ? (
        <FlatList
          horizontal data={photos} keyExtractor={(m, i) => String(i) + (m.url || '')} showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: space.sm, paddingHorizontal: space.lg }}
          renderItem={({ item }) => (
            <Pressable onPress={() => setPhoto(item)} accessibilityRole="imagebutton" accessibilityLabel={item.label || 'Project photo'}>
              <Image source={{ uri: item.url }} resizeMode="cover" style={{ width: 260, height: 170, borderRadius: radius.lg, backgroundColor: t.line }} />
            </Pressable>
          )}
        />
      ) : null}

      <View style={{ paddingHorizontal: space.lg, gap: space.md }}>
        <Card>
          <T v="title">{p.name || 'Untitled project'}</T>
          <Row gap={4}>
            <Icon name="place" size={16} color={t.sub} />
            <T v="small" tone="sub" style={{ flex: 1 }}>{p.address || [p.area, p.district].filter(Boolean).join(' · ') || 'No address yet'}</T>
          </Row>
          <Row wrap>
            <Badge label={`${iv.available} of ${iv.total} available`} tone="brand" />
            {iv.status ? <Badge label={PROPERTY_STATUS[iv.status]} tone={PROJECT_STATUS_TONE[iv.status]} /> : <Badge label="No units" />}
            {[...new Set([projectTypeOf(p), p.type].filter(Boolean))].map((x) => <Badge key={x} label={x} />)}
          </Row>
          <Row wrap gap={space.md} style={{ alignItems: 'flex-start', marginTop: space.xs }}>
            <Fact label="Handover" value={p.handover || '—'} />
            <Fact label="Total units" value={String(iv.total)} />
            {canSeeFloor ? <Fact label="Project value" value={crShort(projectValue)} /> : null}
            <Fact label="Approval" value={p.approval ? `${p.approval} ✓` : '—'} />
            {p.listing ? <Fact label="Listing" value={`#${p.listing}`} /> : null}
            {iv.hold ? <Fact label="On hold" value={String(iv.hold)} /> : null}
            {iv.sold ? <Fact label="Sold" value={String(iv.sold)} /> : null}
          </Row>
        </Card>

        {canSee(user, 'add_customer')
          ? <Button label="Add lead for this project" icon="person-add" variant="soft" onPress={() => navigation.navigate('AddLead', { interest: p.name })} />
          : null}

        {docs.length + links.length > 0 ? (
          <Section title="Documents and links">
            <Card pad={false}>
              {docs.map((d, i) => (
                <ListItem key={'d' + i} icon="picture-as-pdf" title={d.name || d.label || 'Document'} detail={bare(d.url)}
                  onPress={() => open(d.url)} right={<Icon name="open-in-new" size={18} color={t.mute} />} last={i === docs.length - 1 && !links.length} />
              ))}
              {links.map((l, i) => (
                <ListItem key={'l' + i} icon="link" title={l.label || 'Link'} detail={bare(l.url)}
                  onPress={() => open(l.url)} right={<Icon name="open-in-new" size={18} color={t.mute} />} last={i === links.length - 1} />
              ))}
            </Card>
          </Section>
        ) : null}

        {variants.length > 0 ? (
          <Section title="Unit types">
            {variants.map((v) => {
              const units = v.units || [];
              const free = units.filter((u) => u.status === 'available').length;
              const facts = [v.beds ? `${v.beds} bed${v.beds > 1 ? 's' : ''}` : '', v.baths ? `${v.baths} bath${v.baths > 1 ? 's' : ''}` : '', v.size > 0 ? `${v.size.toLocaleString('en-IN')} sqft` : ''].filter(Boolean).join(' · ');
              return (
                <Card key={v.id} style={{ gap: 4 }}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <T v="strong" style={{ flex: 1 }} numberOfLines={1}>{v.name || 'Type'}</T>
                    <T v="small" tone={free ? 'brand' : 'mute'}>{`${free} of ${units.length} available`}</T>
                  </Row>
                  {facts ? <T v="small" tone="sub">{facts}</T> : null}
                  {v.listRate > 0 ? (
                    <T v="small">
                      {`${taka(v.listRate)}/sqft`}{v.size > 0 ? ` · from ${crShort(v.listRate * v.size)}` : ''}
                    </T>
                  ) : <T v="small" tone="mute">No list rate yet</T>}
                  {canSeeFloor ? <T v="small" tone="mute">{v.floorRate > 0 ? `Bottom price ${taka(v.floorRate)}/sqft` : 'Bottom price not set'}</T> : null}
                </Card>
              );
            })}
          </Section>
        ) : null}

        {(p.addons || []).length > 0 ? (
          <Section title="Add-ons">
            <Card pad={false}>
              {p.addons.map((a, i) => <ListItem key={a.id} icon={a.icon || 'add'} title={a.name} right={<T v="small" tone="sub">{`+ ${crShort(a.amount || 0)}`}</T>} last={i === p.addons.length - 1} />)}
            </Card>
          </Section>
        ) : null}

        <Section title="Units" action={variant ? <T v="small" tone="sub">{`${vAvail} available`}</T> : null} />
      </View>

      {floors.length > 1 ? (
        <ChipBar value={floor?.name} onChange={setFloorSel}
          options={floors.map((f) => ({ value: f.name, label: f.name, count: variants.reduce((n, v) => n + (v.units || []).filter((u) => f.ids.has(u.id) && u.status === 'available').length, 0) }))} />
      ) : null}
      {variants.filter(hasFloor).length > 1 ? (
        <ChipBar value={variant?.id} onChange={setVid}
          options={variants.filter(hasFloor).map((v) => ({ value: v.id, label: v.name || 'Type', count: (v.units || []).filter((u) => onFloor(u) && u.status === 'available').length }))} />
      ) : null}
      {floorUnits.length > 0 ? (
        <Row wrap gap={space.md} style={{ paddingHorizontal: space.lg }}>
          {legend.map((l) => (
            <Row key={l.k} gap={5}>
              <Dot color={l.color} />
              <T v="small" tone="sub">{l.label}</T>
              <T v="small" style={{ fontWeight: '700' }}>{l.n}</T>
            </Row>
          ))}
        </Row>
      ) : null}
    </View>
  );

  return (
    <Screen scroll={false}>
      <FlatList
        data={floorUnits}
        numColumns={COLS}
        keyExtractor={(u) => u.id}
        columnWrapperStyle={{ gap: space.sm, paddingHorizontal: space.lg }}
        ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
        ListHeaderComponent={header}
        ListEmptyComponent={<Empty icon="grid-view" title="No units here" hint={variants.length ? 'This type has no units on this floor.' : 'Units are added from the web app.'} />}
        ListFooterComponent={<View style={{ height: space.xl }} />}
        renderItem={({ item: u }) => {
          const lk = unitLook(p.unitStatuses, u);
          const c = toneOf(u);
          const size = unitSize(u, variant);
          return (
            <Pressable onPress={() => setUnitId(u.id)} accessibilityRole="button" accessibilityLabel={`Unit ${u.id}, ${lk.label}`}
              style={({ pressed }) => ({
                flex: 1, maxWidth: `${100 / COLS}%`, minHeight: 68, borderRadius: radius.md, padding: space.sm, gap: 2, justifyContent: 'center',
                backgroundColor: lk.color ? t.card : c.bg, borderWidth: 1.5, borderColor: lk.color || c.fg, opacity: pressed ? 0.7 : 1,
              })}>
              <T v="strong" numberOfLines={1}>{u.id.replace(/^U-/, '')}</T>
              {size > 0 ? <T v="small" tone="sub" numberOfLines={1}>{`${size.toLocaleString('en-IN')} sft`}</T> : null}
              <Row gap={4}>
                <Dot color={lk.color || c.fg} size={7} />
                <T v="tiny" color={lk.color ? t.sub : c.fg} numberOfLines={1} style={{ flex: 1 }}>{lk.label}</T>
              </Row>
            </Pressable>
          );
        }}
      />

      <UnitSheet visible={!!sheetUnit} onClose={() => setUnitId(null)} project={p} variant={sheetUnit?.v} unit={sheetUnit?.u} navigation={navigation} />

      <Sheet visible={!!photo} onClose={() => setPhoto(null)} title={photo?.label || 'Photo'}>
        {photo ? <Image source={{ uri: photo.url }} resizeMode="contain" style={{ width: '100%', height: 420, borderRadius: radius.md, backgroundColor: t.line }} /> : null}
      </Sheet>
    </Screen>
  );
}
