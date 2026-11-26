// The app's building blocks. Screens compose these and do not style raw Views
// themselves, so spacing, colours and touch sizes stay the same everywhere.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme, toneColors, statusTone, space, radius } from '../theme';
import { leadDisplayStatus, ini, avc } from '../../../src/lib/helpers.js';

// The web app names icons the Material Symbols way (phone_callback); this icon
// set uses dashes, and lacks a few of the newer names.
const ICON_ALIAS = {
  'voice-over-off': 'voice-over-off', 'alarm-on': 'alarm-on', 'how-to-reg': 'how-to-reg',
  'psychology': 'psychology', 'apartment': 'apartment', 'request-quote': 'request-quote',
  'directions-walk': 'directions-walk', 'forward-to-inbox': 'forward-to-inbox', 'pan-tool': 'pan-tool',
  'emoji-events': 'emoji-events', 'view-kanban': 'view-kanban', 'real-estate-agent': 'real-estate-agent',
};
export function Icon({ name, size = 20, color }) {
  const t = useTheme();
  const key = String(name || 'circle').replace(/_/g, '-');
  const glyph = MaterialIcons.glyphMap[ICON_ALIAS[key] || key] ? (ICON_ALIAS[key] || key) : 'circle';
  return <MaterialIcons name={glyph} size={size} color={color || t.text} />;
}

// ── Text ────────────────────────────────────────────────────────────────────
const TEXT = {
  title: { fontSize: 22, fontWeight: '700', lineHeight: 28 },
  h2: { fontSize: 17, fontWeight: '700', lineHeight: 22 },
  body: { fontSize: 15, lineHeight: 21 },
  strong: { fontSize: 15, fontWeight: '600', lineHeight: 21 },
  small: { fontSize: 13, lineHeight: 18 },
  tiny: { fontSize: 11.5, lineHeight: 15, fontWeight: '600', letterSpacing: 0.4 },
  num: { fontSize: 24, fontWeight: '700', lineHeight: 28, fontVariant: ['tabular-nums'] },
};
export function T({ v = 'body', tone, color, style, children, ...rest }) {
  const t = useTheme();
  const c = color || (tone === 'sub' ? t.sub : tone === 'mute' ? t.mute : tone ? toneColors(t, tone).fg : t.text);
  return <Text style={[TEXT[v], { color: c }, style]} {...rest}>{children}</Text>;
}

// ── Layout ──────────────────────────────────────────────────────────────────
// A page. `scroll` wraps the content in a ScrollView; lists pass scroll={false}
// and bring their own FlatList.
export function Screen({ children, scroll = true, pad = true, edges = ['left', 'right'], refreshControl, footer }) {
  const t = useTheme();
  const inner = { padding: pad ? space.lg : 0, gap: space.md, paddingBottom: space.xl };
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: t.bg }}>
      {scroll
        ? <ScrollView contentContainerStyle={inner} keyboardShouldPersistTaps="handled" refreshControl={refreshControl}>{children}</ScrollView>
        : <View style={{ flex: 1 }}>{children}</View>}
      {footer}
    </SafeAreaView>
  );
}

export function Card({ children, style, onPress, pad = true }) {
  const t = useTheme();
  const s = [{ backgroundColor: t.card, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: t.line, padding: pad ? space.lg : 0, gap: space.sm }, style];
  if (!onPress) return <View style={s}>{children}</View>;
  return <Pressable onPress={onPress} style={({ pressed }) => [s, pressed && { opacity: 0.7 }]}>{children}</Pressable>;
}

export function Row({ children, gap = space.sm, style, wrap }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap, flexWrap: wrap ? 'wrap' : 'nowrap' }, style]}>{children}</View>;
}

export function Section({ title, action, children }) {
  return (
    <View style={{ gap: space.sm }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <T v="tiny" tone="mute">{String(title).toUpperCase()}</T>
        {action}
      </Row>
      {children}
    </View>
  );
}

// ── Controls ────────────────────────────────────────────────────────────────
// variant: 'primary' (filled brand) | 'soft' (tinted, needs tone) | 'ghost' (outline)
export function Button({ label, icon, onPress, variant = 'primary', tone = 'brand', disabled, busy, small, full = true, testID }) {
  const t = useTheme();
  const c = toneColors(t, tone);
  const off = disabled || busy;
  const bg = variant === 'primary' ? (tone === 'brand' ? t.brand : c.fg) : variant === 'soft' ? c.bg : 'transparent';
  const fg = variant === 'primary' ? (tone === 'brand' ? t.onBrand : '#FFFFFF') : variant === 'soft' ? c.fg : t.text;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off }}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [{
        minHeight: small ? 36 : 48, paddingHorizontal: small ? space.md : space.lg, borderRadius: radius.md,
        backgroundColor: bg, borderWidth: variant === 'ghost' ? 1 : 0, borderColor: t.line,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm,
        alignSelf: full ? 'stretch' : 'flex-start', opacity: off ? 0.45 : pressed ? 0.75 : 1,
      }]}
    >
      {busy ? <ActivityIndicator size="small" color={fg} /> : icon ? <Icon name={icon} size={small ? 16 : 19} color={fg} /> : null}
      <Text style={{ color: fg, fontSize: small ? 13 : 15, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export function IconButton({ name, onPress, tone, label, size = 22 }) {
  const t = useTheme();
  const c = tone ? toneColors(t, tone) : { fg: t.text, bg: t.card };
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={6}
      style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg, opacity: pressed ? 0.6 : 1 })}>
      <Icon name={name} size={size} color={c.fg} />
    </Pressable>
  );
}

export function Chip({ label, active, onPress, icon, count }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!active }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, minHeight: 36, borderRadius: radius.pill, backgroundColor: active ? t.brand : t.card, borderWidth: StyleSheet.hairlineWidth, borderColor: active ? t.brand : t.line }}>
      {icon ? <Icon name={icon} size={15} color={active ? t.onBrand : t.sub} /> : null}
      <Text style={{ color: active ? t.onBrand : t.text, fontSize: 13, fontWeight: '600' }}>{label}</Text>
      {count != null ? <Text style={{ color: active ? t.onBrand : t.mute, fontSize: 12, fontWeight: '700' }}>{count}</Text> : null}
    </Pressable>
  );
}

// A horizontally scrolling row of chips: options = [{ value, label, count? }].
export function ChipBar({ options, value, onChange, pad = true }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled"
      style={{ flexGrow: 0 }} contentContainerStyle={{ gap: space.sm, paddingHorizontal: pad ? space.lg : 0, paddingVertical: space.sm }}>
      {options.map((o) => <Chip key={String(o.value)} label={o.label} count={o.count} icon={o.icon} active={o.value === value} onPress={() => onChange(o.value)} />)}
    </ScrollView>
  );
}

export function Badge({ label, tone = 'neutral', icon }) {
  const t = useTheme();
  const c = toneColors(t, tone);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', backgroundColor: c.bg, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3 }}>
      {icon ? <Icon name={icon} size={12} color={c.fg} /> : null}
      <Text style={{ color: c.fg, fontSize: 11.5, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

// A lead's status as the web shows it (leadDisplayStatus folds follow-up and
// forwarded states into the label).
export function StatusBadge({ lead, status }) {
  if (lead) {
    const ds = leadDisplayStatus(lead);
    const key = String(ds.cls || '').replace(/^s-/, '').toUpperCase();
    return <Badge label={ds.label} tone={statusTone(key)} />;
  }
  return <Badge label={status} tone={statusTone(status)} />;
}

export function Avatar({ name, size = 40 }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: avc(name || '?'), alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: size * 0.38 }}>{ini(name || '?')}</Text>
    </View>
  );
}

export function Field({ label, hint, error, style, multiline, ...input }) {
  const t = useTheme();
  return (
    <View style={[{ gap: 6 }, style]}>
      {label ? <T v="small" tone="sub" style={{ fontWeight: '600' }}>{label}</T> : null}
      <TextInput
        placeholderTextColor={t.mute}
        multiline={multiline}
        style={{
          minHeight: multiline ? 96 : 48, paddingHorizontal: space.md, paddingVertical: multiline ? space.md : 0,
          borderRadius: radius.md, borderWidth: 1, borderColor: error ? t.danger : t.line, backgroundColor: t.input,
          color: t.text, fontSize: 16, textAlignVertical: multiline ? 'top' : 'center',
        }}
        {...input}
      />
      {error ? <T v="small" tone="danger">{error}</T> : hint ? <T v="small" tone="mute">{hint}</T> : null}
    </View>
  );
}

export function SearchField({ value, onChangeText, placeholder = 'Search' }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: t.card, borderWidth: StyleSheet.hairlineWidth, borderColor: t.line }}>
      <Icon name="search" size={19} color={t.mute} />
      <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={t.mute}
        autoCorrect={false} autoCapitalize="none" returnKeyType="search" style={{ flex: 1, color: t.text, fontSize: 15, paddingVertical: 0 }} />
      {value ? <Pressable onPress={() => onChangeText('')} hitSlop={10} accessibilityLabel="Clear search"><Icon name="close" size={18} color={t.mute} /></Pressable> : null}
    </View>
  );
}

// options = [{ value, label }]; one is always selected.
export function Segmented({ options, value, onChange }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', backgroundColor: t.line, borderRadius: radius.md, padding: 3 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={String(o.value)} onPress={() => onChange(o.value)} accessibilityRole="button" accessibilityState={{ selected: on }}
            style={{ flex: 1, minHeight: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? t.card : 'transparent' }}>
            <Text style={{ color: on ? t.text : t.sub, fontWeight: '600', fontSize: 13 }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// A tappable settings-style line: icon, title, optional detail, chevron.
export function ListItem({ icon, title, detail, right, onPress, tone, last }) {
  const t = useTheme();
  const c = tone ? toneColors(t, tone) : null;
  return (
    <Pressable onPress={onPress} disabled={!onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingHorizontal: space.lg, opacity: pressed ? 0.6 : 1, borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth, borderBottomColor: t.line })}>
      {icon ? <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: c ? c.bg : t.bg, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={19} color={c ? c.fg : t.sub} /></View> : null}
      <View style={{ flex: 1, paddingVertical: space.sm }}>
        <T v="strong" color={c ? c.fg : undefined}>{title}</T>
        {detail ? <T v="small" tone="mute" numberOfLines={2}>{detail}</T> : null}
      </View>
      {right !== undefined ? right : onPress ? <Icon name="chevron-right" size={20} color={t.mute} /> : null}
    </Pressable>
  );
}

export function Stat({ label, value, tone, onPress, icon }) {
  const t = useTheme();
  const c = tone ? toneColors(t, tone) : { fg: t.text };
  return (
    <Card onPress={onPress} style={{ flex: 1, minWidth: 140, gap: 2 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <T v="small" tone="sub" numberOfLines={1} style={{ flex: 1 }}>{label}</T>
        {icon ? <Icon name={icon} size={17} color={c.fg} /> : null}
      </Row>
      <T v="num" color={c.fg}>{value == null ? '…' : String(value)}</T>
    </Card>
  );
}

export function Empty({ icon = 'inbox', title, hint, action }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: space.sm, paddingVertical: 48, paddingHorizontal: space.xl }}>
      <Icon name={icon} size={36} color={t.mute} />
      <T v="h2" style={{ textAlign: 'center' }}>{title}</T>
      {hint ? <T v="small" tone="mute" style={{ textAlign: 'center' }}>{hint}</T> : null}
      {action}
    </View>
  );
}

export function Loading({ label }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: space.sm, paddingVertical: 40 }}>
      <ActivityIndicator color={t.brand} />
      {label ? <T v="small" tone="mute">{label}</T> : null}
    </View>
  );
}

// ── Bottom sheet ────────────────────────────────────────────────────────────
// Forms and pickers open in one of these. `footer` stays above the keyboard.
export function Sheet({ visible, onClose, title, children, footer }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={!!visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: t.overlay }]} onPress={onClose} accessibilityLabel="Close" />
        <View style={{ maxHeight: '90%', backgroundColor: t.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: Math.max(insets.bottom, space.md) }}>
          <Row style={{ justifyContent: 'space-between', paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm }}>
            <T v="h2" style={{ flex: 1 }} numberOfLines={1}>{title}</T>
            <IconButton name="close" label="Close" onPress={onClose} />
          </Row>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.md }}>
            {children}
          </ScrollView>
          {footer ? <View style={{ paddingHorizontal: space.lg, paddingTop: space.sm, gap: space.sm }}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Toast and confirm ───────────────────────────────────────────────────────
// useUI().toast('Saved', 'ok' | 'warn' | 'err')
// useUI().confirm({ title, description, confirmLabel, danger, onConfirm })
const UICtx = createContext({ toast: () => {}, confirm: () => {} });
export const useUI = () => useContext(UICtx);

export function UIProvider({ children }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [msg, setMsg] = useState(null);
  const [ask, setAsk] = useState(null);
  const fade = useRef(new Animated.Value(0)).current;
  const timer = useRef(null);

  const toast = useCallback((text, kind = 'ok') => {
    if (timer.current) clearTimeout(timer.current);
    setMsg({ text, kind });
    Animated.timing(fade, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    timer.current = setTimeout(() => {
      Animated.timing(fade, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => setMsg(null));
    }, 2600);
  }, [fade]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const confirm = useCallback((opts) => setAsk(opts), []);
  const value = useMemo(() => ({ toast, confirm }), [toast, confirm]);
  const tone = msg ? (msg.kind === 'err' ? 'danger' : msg.kind === 'warn' ? 'warn' : 'brand') : 'brand';
  const tc = toneColors(t, tone);

  return (
    <UICtx.Provider value={value}>
      {children}
      {msg ? (
        <Animated.View pointerEvents="none" accessibilityLiveRegion="polite"
          style={{ position: 'absolute', left: space.lg, right: space.lg, bottom: insets.bottom + 84, opacity: fade, backgroundColor: t.dark ? t.raised : '#101613', borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: space.lg, flexDirection: 'row', alignItems: 'center', gap: space.sm, borderLeftWidth: 4, borderLeftColor: tc.fg }}>
          <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '600', flex: 1 }}>{msg.text}</Text>
        </Animated.View>
      ) : null}
      <Modal visible={!!ask} transparent animationType="fade" onRequestClose={() => setAsk(null)} statusBarTranslucent>
        <View style={{ flex: 1, justifyContent: 'center', padding: space.xl, backgroundColor: t.overlay }}>
          <View style={{ backgroundColor: t.card, borderRadius: radius.lg, padding: space.lg, gap: space.md }}>
            <T v="h2">{ask?.title}</T>
            {ask?.description ? <T tone="sub">{ask.description}</T> : null}
            <Row style={{ justifyContent: 'flex-end', marginTop: space.sm }}>
              <Button label="Cancel" variant="ghost" full={false} onPress={() => setAsk(null)} />
              <Button label={ask?.confirmLabel || 'OK'} tone={ask?.danger ? 'danger' : 'brand'} full={false}
                onPress={() => { const fn = ask?.onConfirm; setAsk(null); if (fn) fn(); }} />
            </Row>
          </View>
        </View>
      </Modal>
    </UICtx.Provider>
  );
}
