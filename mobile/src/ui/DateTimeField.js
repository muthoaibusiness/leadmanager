// Date and time picker made of chips: a strip of days, then the hour and the
// minute. No native picker, so it behaves the same on Android and iOS.
//
// The value is a wall-clock string, 'YYYY-MM-DDTHH:MM' (what a web
// datetime-local input holds), or '' while incomplete. The caller decides which
// time zone it is read in (see src/lib/companyTime.js for follow-ups).
import { useMemo } from 'react';
import { ScrollView, View } from 'react-native';
import { Chip, T } from './index';
import { space } from '../theme';

const p2 = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const hourLabel = (h) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;

export const splitLocal = (v) => {
  const m = /^(\d{4}-\d{2}-\d{2})?T?(\d{2})?:?(\d{2})?$/.exec(v || '');
  return { date: m?.[1] || '', hour: m?.[2] ?? '', minute: m?.[3] ?? '' };
};
const join = ({ date, hour, minute }) => (date && hour !== '' && minute !== '' ? `${date}T${hour}:${minute}` : '');

// `parts` keeps a half-made choice (a day with no hour yet) between renders, so
// the field is controlled by { parts, onParts }; `valueOf(parts)` is the string.
export const emptyParts = { date: '', hour: '', minute: '00' };
export const valueOf = join;
export const partsOf = (v) => { const s = splitLocal(v); return { date: s.date, hour: s.hour, minute: s.minute === '' ? '00' : s.minute }; };

export default function DateTimeField({ label = 'Date & time', parts, onParts, days = 30, minHour = 8, maxHour = 22, minuteStep = 15 }) {
  const dayList = useMemo(() => {
    const out = [];
    const base = new Date();
    for (let i = 0; i < days; i++) {
      const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
      out.push({ key: dayKey(d), label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : `${WD[d.getDay()]} ${d.getDate()} ${MO[d.getMonth()]}` });
    }
    return out;
  }, [days]);
  const hours = useMemo(() => { const out = []; for (let h = minHour; h <= maxHour; h++) out.push(h); return out; }, [minHour, maxHour]);
  const minutes = useMemo(() => { const out = []; for (let m = 0; m < 60; m += minuteStep) out.push(m); return out; }, [minuteStep]);
  const set = (patch) => onParts({ ...parts, ...patch });

  return (
    <View style={{ gap: space.sm }}>
      <T v="small" tone="sub" style={{ fontWeight: '600' }}>{label}</T>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: space.sm }}>
        {dayList.map((d) => <Chip key={d.key} label={d.label} active={parts.date === d.key} onPress={() => set({ date: d.key })} />)}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: space.sm }}>
        {hours.map((h) => <Chip key={h} label={hourLabel(h)} active={parts.hour === p2(h)} onPress={() => set({ hour: p2(h) })} />)}
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
        <T v="small" tone="mute">Minute</T>
        {minutes.map((m) => <Chip key={m} label={`:${p2(m)}`} active={parts.minute === p2(m)} onPress={() => set({ minute: p2(m) })} />)}
      </View>
    </View>
  );
}
