// Constants and helpers for ui/metric-chart.jsx and ui/progress-metric-card.jsx,
// kept out of those files so they export only components (Fast Refresh).
import { CHART_COLORS } from '../charts/chartColors.js';

// A card's accent: the chart stroke and the trend text. Theme tokens rather
// than hex, so both repaint with the theme toggle.
export const ACCENTS = {
  emerald: { stroke: 'var(--green)', text: 'var(--green)' },
  rose: { stroke: 'var(--red)', text: 'var(--red)' },
  neutral: { stroke: 'var(--t2)', text: 'var(--t2)' },
  amber: { stroke: 'var(--orange)', text: 'var(--orange)' },
  accent: { stroke: 'var(--accent)', text: 'var(--accent)' },
};

// Several series without their own accent take these, in order.
export const SERIES_COLORS = CHART_COLORS;

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
export const formatCompact = (n) => compact.format(n);
