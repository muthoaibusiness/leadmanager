// Colours and sizes for the phone app. Two palettes, picked by the phone's
// light/dark setting. The brand green and the dark surfaces are the web app's.
import { useColorScheme } from 'react-native';

const light = {
  dark: false,
  bg: '#F3F5F4', card: '#FFFFFF', raised: '#FFFFFF', input: '#FFFFFF',
  text: '#0E1512', sub: '#55625C', mute: '#8A9690', line: '#E1E7E3',
  brand: '#178A3F', onBrand: '#FFFFFF', brandSoft: '#E2F4E8',
  danger: '#D03A2B', dangerSoft: '#FCEAE8',
  warn: '#B86E00', warnSoft: '#FDF0DC',
  info: '#1F5FD1', infoSoft: '#E5EDFC',
  purple: '#6D3FD0', purpleSoft: '#EEE8FB',
  teal: '#0B7F86', tealSoft: '#DDF3F4',
  overlay: 'rgba(8,14,11,0.45)',
};

const dark = {
  dark: true,
  bg: '#0A0F0C', card: '#131A16', raised: '#19221D', input: '#0F1512',
  text: '#EEF3F0', sub: '#A6B3AD', mute: '#72807A', line: '#242F29',
  brand: '#5EC564', onBrand: '#06210E', brandSoft: '#163220',
  danger: '#F2766A', dangerSoft: '#3A1A17',
  warn: '#F0A92B', warnSoft: '#37280F',
  info: '#6FA3FF', infoSoft: '#15233F',
  purple: '#A98BF5', purpleSoft: '#261C40',
  teal: '#4FC3CB', tealSoft: '#102F31',
  overlay: 'rgba(0,0,0,0.6)',
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };

export function useTheme() {
  return useColorScheme() === 'dark' ? dark : light;
}

// Which tone a lead status wears. One place, so a status reads the same colour
// in the list, the detail header, the pipeline and the reports.
const STATUS_TONE = {
  NEW: 'info',
  CONTACTED: 'teal',
  INTERESTED: 'brand',
  MEETING_SET: 'purple',
  SITE_VISIT_SCHEDULED: 'purple',
  SITE_VISIT_DONE: 'teal',
  NEGOTIATING: 'warn',
  DEAL_CLOSED_WON: 'brand',
  DEAL_CLOSED_LOST: 'danger',
  NOT_INTERESTED: 'danger',
  FOLLOW_UP: 'warn',
  FORWARDED: 'info',
  OFFER_SENT: 'warn',
};
export function toneColors(t, tone) {
  switch (tone) {
    case 'brand': return { fg: t.brand, bg: t.brandSoft };
    case 'danger': return { fg: t.danger, bg: t.dangerSoft };
    case 'warn': return { fg: t.warn, bg: t.warnSoft };
    case 'info': return { fg: t.info, bg: t.infoSoft };
    case 'purple': return { fg: t.purple, bg: t.purpleSoft };
    case 'teal': return { fg: t.teal, bg: t.tealSoft };
    default: return { fg: t.sub, bg: t.line };
  }
}
export const statusTone = (status) => STATUS_TONE[status] || 'neutral';
