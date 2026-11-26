// The bell: the signed-in account's notifications, newest first. Tapping one
// marks it read and opens its lead, as on the web (src/components/NotifBell.jsx).
import { useLayoutEffect } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { Empty, Icon, Screen, T } from '../ui';
import { useTheme, space, radius } from '../theme';
import { useApp } from '../store';
import { getNotifs, markAllRead, markOneRead } from '../../../src/lib/db.js';
import { fmtAgo } from '../../../src/lib/helpers.js';
import { NOTIF_ICO, NOTIF_CLR } from '../../../src/lib/constants.js';

export default function NotificationsScreen({ navigation }) {
  const t = useTheme();
  const { user, refresh, dbVersion } = useApp();
  void dbVersion;
  const notifs = getNotifs(user.id).slice(0, 100);
  const unread = notifs.filter((n) => !n.read).length;

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (unread ? (
        <Pressable onPress={() => { markAllRead(user.id); refresh(); }} hitSlop={8} accessibilityRole="button">
          <T v="small" tone="brand" style={{ fontWeight: '700' }}>Mark all read</T>
        </Pressable>
      ) : null),
    });
  }, [navigation, unread, user.id, refresh]);

  const openOne = (n) => {
    markOneRead(n.id, user.id);
    refresh();
    if (n.leadId) navigation.navigate('LeadDetail', { leadId: n.leadId });
  };

  return (
    <Screen scroll={false}>
      <FlatList
        data={notifs}
        keyExtractor={(n) => String(n.id)}
        contentContainerStyle={{ padding: space.lg, gap: space.sm }}
        ListEmptyComponent={<Empty icon="notifications-none" title="No notifications yet" />}
        renderItem={({ item: n }) => (
          <Pressable onPress={() => openOne(n)} accessibilityRole="button"
            style={({ pressed }) => ({ flexDirection: 'row', gap: space.md, alignItems: 'center', backgroundColor: n.read ? t.card : t.brandSoft, borderRadius: radius.lg, padding: space.md, opacity: pressed ? 0.7 : 1 })}>
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: NOTIF_CLR[n.type] || '#9CA3AF', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={NOTIF_ICO[n.type] || 'circle'} size={18} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1 }}>
              <T v={n.read ? 'body' : 'strong'}>{n.message}</T>
              <T v="small" tone="mute">{fmtAgo(n.timestamp)}</T>
            </View>
            {!n.read ? <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: t.brand }} /> : null}
          </Pressable>
        )}
      />
    </Screen>
  );
}
