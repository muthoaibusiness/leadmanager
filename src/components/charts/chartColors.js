// Series palette for the SVG charts (Charts.jsx). Kept out of that file so it
// exports only components (Fast Refresh).
//
// Fixed slot order, validated (CVD ΔE + contrast) against both themes' chart
// surfaces — see index.css `--chart-1..8` for the per-theme hex. Referencing
// the CSS vars (not raw hex) means every chart repaints with the theme toggle
// for free. Never cycle/reorder these per chart — identity must stay fixed.
export const CHART_COLORS = [
  'var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)',
  'var(--chart-5)', 'var(--chart-6)', 'var(--chart-7)', 'var(--chart-8)',
];
