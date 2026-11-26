// The menu: every page the account may open, grouped. Access is the web
// sidebar's rule, canSee(user, feature); chat alone follows the WhatsApp
// allow-list instead of the role (waCanChat in src/lib/wa.js).
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Avatar, Card, ListItem, Row, Screen, Section, T, useUI } from '../ui';
import { useApp } from '../store';
import { MODULES } from '../nav/modules';
import { canSee } from '../../../src/lib/constants.js';
import { waCanChat, waLoadSettings } from '../../../src/lib/wa.js';
import { rlabel } from '../../../src/lib/helpers.js';

export default function MenuScreen({ navigation }) {
  const { user, signOut } = useApp();
  const { confirm } = useUI();
  const [wa, setWa] = useState(null);
  useEffect(() => {
    let alive = true;
    waLoadSettings().then((s) => { if (alive) setWa(s); }).catch(() => {});
    return () => { alive = false; };
  }, [user.id]);

  const allowed = MODULES.filter((m) => (m.chat ? !!wa && waCanChat(user, wa) : canSee(user, m.feature)));
  const groups = [...new Set(allowed.map((m) => m.group))];

  return (
    <Screen>
      <Card onPress={() => navigation.navigate('Profile')}>
        <Row gap={12}>
          <Avatar name={user.name} size={48} />
          <View style={{ flex: 1 }}>
            <T v="h2">{user.name}</T>
            <T v="small" tone="sub">{rlabel(user.role)}{user.email ? ' · ' + user.email : ''}</T>
          </View>
        </Row>
      </Card>

      {groups.map((g) => {
        const items = allowed.filter((m) => m.group === g);
        return (
          <Section key={g} title={g}>
            <Card pad={false}>
              {items.map((m, i) => <ListItem key={m.route} icon={m.icon} title={m.title} last={i === items.length - 1} onPress={() => navigation.navigate(m.route)} />)}
            </Card>
          </Section>
        );
      })}

      <Section title="Account">
        <Card pad={false}>
          <ListItem icon="person" title="Profile" onPress={() => navigation.navigate('Profile')} />
          <ListItem icon="logout" title="Sign out" tone="danger" last
            onPress={() => confirm({ title: 'Sign out?', description: 'Data kept on this phone for this account is removed.', confirmLabel: 'Sign out', danger: true, onConfirm: signOut })} />
        </Card>
      </Section>
    </Screen>
  );
}
