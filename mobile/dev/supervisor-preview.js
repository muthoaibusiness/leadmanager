// A second entry point, only for dev/check-supervisor.mjs: the two supervisor
// Home groups (src/screens/home/SupervisorHome.js) inside the app's providers
// and a plain Screen, with a navigation that only records where it was sent.
// The app itself never imports this file. Metro serves it at
// /dev/supervisor-preview.bundle; delete it once HomeScreen renders the groups.
import '../src/shims';
import { useState } from 'react';
import { registerRootComponent } from 'expo';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider, useApp } from '../src/store';
import { UIProvider, Screen, Loading, T } from '../src/ui';
import { ManagementHome, TeamLeadHome } from '../src/screens/home/SupervisorHome';
import { ROLES } from '../../src/lib/constants.js';

function Body() {
  const { user, booting } = useApp();
  const [went, setWent] = useState('');
  if (booting || !user) return <Screen><Loading label="Preview: waiting for the session" /></Screen>;
  const navigation = { navigate: (route, params) => setWent(`NAV ${route} ${JSON.stringify(params || {})}`) };
  return (
    <Screen>
      <T v="title">Preview: {user.role}</T>
      <T v="small" tone="mute" testID="went">{went || 'NAV none'}</T>
      {user.role === ROLES.TL ? <TeamLeadHome navigation={navigation} /> : <ManagementHome navigation={navigation} />}
    </Screen>
  );
}

function Preview() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <UIProvider>
          <Body />
        </UIProvider>
      </AppProvider>
    </SafeAreaProvider>
  );
}

registerRootComponent(Preview);
