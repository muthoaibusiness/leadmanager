// Sign-in with the same accounts as the web app (src/lib/auth.js signIn).
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Field, T } from '../ui';
import { useTheme, space } from '../theme';
import { useApp } from '../store';
import { signIn } from '../../../src/lib/auth.js';
import { SB_URL } from '../../../src/lib/supabase.js';

export default function LoginScreen() {
  const t = useTheme();
  const { enter } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(SB_URL ? '' : 'The app is not configured: the server address is missing (mobile/.env).');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    if (!email.trim() || !password) { setError('Enter your email and password.'); return; }
    setBusy(true); setError('');
    const res = await signIn(email, password);
    if (!res.user) { setBusy(false); setError(res.error || 'Could not sign in.'); return; }
    await enter(res.user);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: space.xl, gap: space.lg }} keyboardShouldPersistTaps="handled">
          <View style={{ gap: space.sm }}>
            <View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: '#0C180E', alignItems: 'center', justifyContent: 'center' }}>
              <T style={{ color: '#5EC564', fontSize: 30, fontWeight: '800' }}>W</T>
            </View>
            <T v="title">WEPRO CRM</T>
            <T tone="sub">Sign in with your CRM account.</T>
          </View>
          <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address"
            textContentType="username" autoComplete="email" placeholder="you@company.com" testID="login-email" />
          <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry textContentType="password" autoComplete="password"
            placeholder="Password" onSubmitEditing={submit} returnKeyType="go" testID="login-password" />
          {error ? <T v="small" tone="danger" accessibilityLiveRegion="polite">{error}</T> : null}
          <Button label="Sign in" icon="login" onPress={submit} busy={busy} testID="login-submit" />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
