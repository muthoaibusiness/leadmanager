// Pieces shared by the Forward and Transfer screens: the selectable person row,
// the hint line, and the "ask before discarding" back guard.
import { useCallback, useRef } from 'react';
import { View } from 'react-native';
import { usePreventRemove } from '@react-navigation/native';
import { Avatar, Badge, Card, Icon, Row, T, useUI } from '../../../ui';
import { useTheme, space, statusTone } from '../../../theme';
import { rlabel } from '../../../../../src/lib/helpers.js';

// Same role → badge tone as the web roster (ROLE_BADGE_CLS in
// src/components/modals/ForwardModal.jsx), so a role reads the same colour.
const ROLE_TONE = { AGENT: 'NEW', TEAM_LEAD: 'NEGOTIATING', MANAGEMENT: 'DEAL_CLOSED_WON', EXECUTIVE: 'NEGOTIATING' };

export function PersonRow({ person, selected, onPress, showRole = true }) {
  const t = useTheme();
  return (
    <Card onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, minHeight: 64, borderWidth: 1, borderColor: selected ? t.brand : t.line }}>
      <Avatar name={person.name} />
      <View style={{ flex: 1 }}>
        <T v="strong" numberOfLines={1}>{person.name}</T>
        {person.email ? <T v="small" tone="mute" numberOfLines={1}>{person.email}</T> : null}
      </View>
      {showRole ? <Badge label={rlabel(person.role)} tone={statusTone(ROLE_TONE[person.role] || 'NEW')} /> : null}
      <Icon name={selected ? 'check-circle' : 'radio-button-unchecked'} size={22} color={selected ? t.brand : t.mute} />
    </Card>
  );
}

export function Hint({ icon, children }) {
  const t = useTheme();
  return (
    <Card style={{ padding: space.md }}>
      <Row style={{ alignItems: 'flex-start' }}>
        <Icon name={icon} size={18} color={t.sub} />
        <T v="small" tone="sub" style={{ flex: 1 }}>{children}</T>
      </Row>
    </Card>
  );
}

export function ListNote({ icon, children }) {
  const t = useTheme();
  return (
    <Row style={{ justifyContent: 'center', paddingVertical: space.xl }}>
      <Icon name={icon} size={18} color={t.mute} />
      <T v="small" tone="mute">{children}</T>
    </Row>
  );
}

// The phone's version of the web's useDiscardGuard (src/hooks/useDiscardGuard.js):
// leaving a form with input asks first; an untouched form just closes.
// usePreventRemove is React Navigation's `beforeRemove` listener plus the flag
// the native stack needs to hand its own back button and swipe to that listener.
// Returns leave(): go back without asking (after a successful save).
export function useDiscardOnBack(navigation, dirty, ask) {
  const { confirm } = useUI();
  const done = useRef(false);
  usePreventRemove(!!dirty, ({ data }) => {
    if (done.current) { navigation.dispatch(data.action); return; }
    confirm({ title: ask.title, description: ask.description, confirmLabel: 'Exit', onConfirm: () => navigation.dispatch(data.action) });
  });
  return useCallback(() => { done.current = true; navigation.goBack(); }, [navigation]);
}
