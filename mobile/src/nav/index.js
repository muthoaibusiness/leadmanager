// Navigation: a tab bar (Home, Leads, Alerts, Menu) under one stack that holds
// every other page. Signed out, the only screen is Login.
import { useState } from 'react';
import { NavigationContainer, DefaultTheme, DarkTheme, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View } from 'react-native';
import { Icon, Loading } from '../ui';
import { useTheme } from '../theme';
import { useApp } from '../store';
import { getUnreadCount } from '../../../src/lib/db.js';
import { canSee } from '../../../src/lib/constants.js';
import LoginScreen from '../screens/LoginScreen';
import HomeScreen from '../screens/HomeScreen';
import LeadsScreen from '../screens/lead/LeadsScreen';
import LeadDetailScreen from '../screens/lead/LeadDetailScreen';
import LeadFormScreen from '../screens/lead/LeadFormScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import MenuScreen from '../screens/MenuScreen';
import ProfileScreen from '../screens/ProfileScreen';
import { MODULES, DETAIL_ROUTES } from './modules';
import { usePushTaps } from '../push';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const navigationRef = createNavigationContainerRef();

function Tabs() {
  const t = useTheme();
  const { user, dbVersion } = useApp();
  void dbVersion; // the unread badge follows the store
  const unread = getUnreadCount(user.id);
  const icon = (name) => ({ color, size }) => <Icon name={name} size={size} color={color} />;
  return (
    <Tab.Navigator screenOptions={{
      headerStyle: { backgroundColor: t.bg }, headerTintColor: t.text, headerShadowVisible: false, headerTitleStyle: { fontWeight: '700' },
      tabBarStyle: { backgroundColor: t.card, borderTopColor: t.line }, tabBarActiveTintColor: t.brand, tabBarInactiveTintColor: t.mute,
      tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
    }}>
      {canSee(user, 'dashboard') || user.role === 'MASTER'
        ? <Tab.Screen name="Home" component={HomeScreen} options={{ tabBarIcon: icon('home') }} /> : null}
      {canSee(user, 'leads')
        ? <Tab.Screen name="Leads" component={LeadsScreen} options={{ tabBarIcon: icon('groups') }} /> : null}
      <Tab.Screen name="Alerts" component={NotificationsScreen}
        options={{ title: 'Notifications', tabBarLabel: 'Alerts', tabBarIcon: icon('notifications'), tabBarBadge: unread ? (unread > 99 ? '99+' : unread) : undefined }} />
      <Tab.Screen name="Menu" component={MenuScreen} options={{ tabBarIcon: icon('menu') }} />
    </Tab.Navigator>
  );
}

export default function Navigation() {
  const t = useTheme();
  const { user, booting } = useApp();
  const base = t.dark ? DarkTheme : DefaultTheme;
  const theme = { ...base, colors: { ...base.colors, background: t.bg, card: t.bg, text: t.text, border: t.line, primary: t.brand } };
  // A tapped push notification opens its lead once someone is signed in.
  const [navReady, setNavReady] = useState(false);
  usePushTaps(navigationRef, navReady && !!user && !booting);

  if (booting) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Loading label="Loading your workspace…" />
      </View>
    );
  }

  return (
    <NavigationContainer theme={theme} ref={navigationRef} onReady={() => setNavReady(true)}>
      <Stack.Navigator screenOptions={{
        headerStyle: { backgroundColor: t.bg }, headerTintColor: t.text, headerShadowVisible: false,
        headerTitleStyle: { fontWeight: '700' }, headerBackButtonDisplayMode: 'minimal', contentStyle: { backgroundColor: t.bg },
      }}>
        {!user ? (
          <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        ) : (
          <>
            <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
            <Stack.Screen name="LeadList" component={LeadsScreen} options={{ title: 'Leads' }} />
            <Stack.Screen name="LeadDetail" component={LeadDetailScreen} options={{ title: 'Customer' }} />
            <Stack.Screen name="AddLead" component={LeadFormScreen} options={{ title: 'Add customer' }} />
            <Stack.Screen name="EditLead" component={LeadFormScreen} options={{ title: 'Edit customer' }} />
            <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profile' }} />
            {MODULES.map((m) => <Stack.Screen key={m.route} name={m.route} component={m.screen} options={{ title: m.title }} />)}
            {DETAIL_ROUTES.map((m) => <Stack.Screen key={m.route} name={m.route} component={m.screen} options={{ title: m.title }} />)}
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
