import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider } from './src/store';
import { UIProvider } from './src/ui';
import Navigation from './src/nav';
import { useTheme } from './src/theme';

export default function App() {
  const t = useTheme();
  return (
    <SafeAreaProvider>
      <AppProvider>
        <UIProvider>
          <StatusBar style={t.dark ? 'light' : 'dark'} />
          <Navigation />
        </UIProvider>
      </AppProvider>
    </SafeAreaProvider>
  );
}
