// Push notifications for the native app (migration 0076, Edge Function push-send).
//
// The phone asks Expo's push service for a token and registers it for the
// signed-in account (push_register_device). The server then sends every new
// notifications row to it through Expo, which hands it to FCM (Android) or APNs
// (iOS), so it arrives with the app closed. A tap opens the lead.
//
// What this needs that code cannot supply: an EAS project id in app.json
// (extra.eas.projectId, written by `eas init`) and push credentials uploaded to
// EAS (FCM for Android, an APNs key for iOS). Without them, in Expo Go, on a
// simulator and on the web target, registerPush() does nothing and says why once.
import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { SB_URL, SB_H, ensureFreshToken } from '../../src/lib/supabase.js';

const native = Platform.OS === 'android' || Platform.OS === 'ios';
let _token = null;
let _said = false;
const why = (msg) => { if (!_said) { _said = true; console.log('[push] off: ' + msg); } };

// While the app is open a push still shows as a banner and lands in the tray.
if (native) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

async function rpc(fn, args) {
  await ensureFreshToken();
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { ...SB_H }, body: JSON.stringify(args) });
  return r.ok;
}

const projectId = () => Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId || null;

// Ask for permission (the system dialog shows once) and register this phone for
// the account. Resolves to whether it is registered. Safe to call at every sign-in.
export async function registerPush(user) {
  try {
    if (!native) return false;
    if (!user) return false;
    if (!Device.isDevice) { why('push needs a real device'); return false; }
    const pid = projectId();
    if (!pid) { why('no EAS project id in app.json (run `eas init`)'); return false; }
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', { name: 'CRM notifications', importance: Notifications.AndroidImportance.HIGH });
    }
    let perm = await Notifications.getPermissionsAsync();
    if (!perm.granted && perm.canAskAgain !== false) perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) { why('notifications are not allowed for the app'); return false; }
    const token = (await Notifications.getExpoPushTokenAsync({ projectId: pid })).data;
    if (!token) return false;
    _token = token;
    return await rpc('push_register_device', { p_token: token, p_platform: Platform.OS, p_name: Device.modelName || null });
  } catch (e) { why(String(e?.message || e)); return false; }
}

// Sign-out: this phone stops receiving the account's notifications. Called
// while the session is still valid; gives up after 3 s so a dead connection
// cannot hold up signing out (the next account to sign in here takes the token over).
export async function unregisterPush() {
  if (!native || !_token) return false;
  const token = _token;
  _token = null;
  const work = rpc('push_unregister_device', { p_token: token }).catch(() => false);
  return Promise.race([work, new Promise((res) => setTimeout(() => res(false), 3000))]);
}

// Open the lead of a tapped notification (also the one that launched the app).
// `ready` is false until there is a signed-in user and a mounted navigator.
// Native only: the notification-response API throws on the web target, so it
// is never touched there.
export function usePushTaps(navigationRef, ready) {
  useEffect(() => {
    if (!native || !ready) return undefined;
    let handled = null; // the same response is not acted on twice
    const act = (response) => {
      if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
      const id = response.notification?.request?.identifier;
      if (id && id === handled) return;
      handled = id;
      if (!navigationRef.isReady()) return;
      const data = response.notification?.request?.content?.data || {};
      if (data.leadId) navigationRef.navigate('LeadDetail', { leadId: String(data.leadId) });
      else navigationRef.navigate('Tabs', { screen: 'Alerts' });
    };
    try { act(Notifications.getLastNotificationResponse()); } catch { /* not available on this build */ }
    const sub = Notifications.addNotificationResponseReceivedListener(act);
    return () => sub.remove();
  }, [ready, navigationRef]);
}
