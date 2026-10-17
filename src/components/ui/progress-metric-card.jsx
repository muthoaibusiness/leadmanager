import { useCallback, useId, useMemo, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { MetricChart } from './metric-chart.jsx';
import { ACCENTS, SERIES_COLORS, formatCompact } from './metric-chart-utils.js';
import { PeriodSelect, ViewToggle } from './metric-controls.jsx';
import './progress-metric-card.css';

// ProgressMetricCard: a headline figure over a chart that fills the card's
// right side, with a period picker, a curve/bars switch and a footer of
// change + peak / low / avg. Adapted from a Tailwind .tsx to this project's
// plain-JSX + CSS stack (like ui/select.jsx): the utilities are .pmc-* CSS on
// theme tokens, and the chart and controls are ./metric-chart.jsx and
// ./metric-controls.jsx.
//
// @example
// <ProgressMetricCard title="Total orders" unit="orders" data={[{ value: 100, date: '18 Mar' }, …]} />
//
/**
 * @typedef {{ value: number, date: string }} SeriesPoint
 * @typedef {{ name: string, data: SeriesPoint[], accent?: string }} MetricSeries
 * @typedef {{ label: string, points?: number }} PeriodOption  points: how many of the latest points to show (all when absent)
 *
 * @typedef {object} ProgressMetricCardProps
 * @property {string} title
 * @property {string|number} [total]       Headline. Default: sum of the visible points
 * @property {string} [delta]              Footer change. Default: last point minus the one before
 * @property {string} [deltaLabel]         Default 'today'
 * @property {string} [percent]            Header change. Default: last vs first point
 * @property {'up'|'down'|'flat'} [trend]  Default: from the series
 * @property {string} [unit]               Appended to exact values in the tooltip
 * @property {string} [period]             Initial period label. Default 'Past 30 days'
 * @property {PeriodOption[]} [periodOptions]
 * @property {(o: PeriodOption) => void} [onPeriodChange]
 * @property {'curve'|'bars'} [defaultView]
 * @property {'emerald'|'rose'|'neutral'|'amber'|'accent'} [accent]  Default: from the trend
 * @property {SeriesPoint[]} [data]        One series; or
 * @property {MetricSeries[]} [series]     several named ones (wins over data)
 * @property {'sm'|'md'|'lg'} [size]
 * @property {boolean} [showStats]         Footer peak / low / avg. Default true
 * @property {(n: number) => string} [valueFormatter]
 * @property {(d: string) => string} [dateFormatter]
 * @property {boolean} [loading]
 * @property {string} [className]
 */

const DEFAULT_PERIODS = [
  { label: 'Past 7 days', points: 4 },
  { label: 'Past 14 days', points: 7 },
  { label: 'Past 30 days' },
];

// Change under this many percent counts as flat (neutral accent).
const NEUTRAL_PCT = 0.5;

const sliceWindow = (points, n) => (n && n < points.length ? points.slice(-n) : points);

/** @param {ProgressMetricCardProps} props */
export default function ProgressMetricCard({
  title,
  total,
  delta,
  deltaLabel = 'today',
  percent,
  trend,
  unit,
  period = 'Past 30 days',
  periodOptions,
  onPeriodChange,
  defaultView = 'curve',
  accent,
  data,
  series,
  size = 'md',
  showStats = true,
  valueFormatter,
  dateFormatter,
  loading = false,
  className,
}) {
  const gridId = `pmc-grid-${useId().replace(/:/g, '')}`;
  const shell = cn('pmc', `pmc-${size}`, className);

  const periods = periodOptions ?? DEFAULT_PERIODS;
  const [selectedLabel, setSelectedLabel] = useState(period);
  const [view, setView] = useState(defaultView);
  // The chart keeps clear of the header (title row, legend), however tall it
  // wraps on a narrow card.
  const [topInset, setTopInset] = useState(56);
  const measureTop = useCallback((el) => {
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setTopInset(el.offsetTop + el.offsetHeight + 12));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // One plain `data` list becomes a single series.
  const baseSeries = useMemo(
    () => (series?.length ? series : [{ name: title, data: data ?? [], accent }]),
    [series, data, title, accent],
  );

  const selectedOption = periods.find((p) => p.label === selectedLabel) ?? periods[periods.length - 1];

  const visibleSeries = useMemo(
    () => baseSeries.map((s) => ({ ...s, data: sliceWindow(s.data, selectedOption?.points) })),
    [baseSeries, selectedOption],
  );

  const primary = visibleSeries[0];
  const isMulti = visibleSeries.length > 1;
  const hasData = (primary?.data.length ?? 0) >= 2;

  // Every figure comes from the primary series, so the card stays consistent
  // and follows the period; the props win when given.
  const stats = useMemo(() => {
    const vals = primary?.data.map((d) => d.value) ?? [];
    const sum = vals.reduce((a, b) => a + b, 0);
    const first = vals[0] ?? 0;
    const last = vals[vals.length - 1] ?? 0;
    const prev = vals[vals.length - 2] ?? first;
    const net = last - first;
    return {
      sum,
      net,
      pct: first ? (net / first) * 100 : 0,
      step: last - prev,
      peak: vals.length ? Math.max(...vals) : 0,
      low: vals.length ? Math.min(...vals) : 0,
      avg: vals.length ? sum / vals.length : 0,
    };
  }, [primary]);

  const resolvedTrend = trend ?? (Math.abs(stats.pct) < NEUTRAL_PCT ? 'flat' : stats.net >= 0 ? 'up' : 'down');
  const resolvedAccent = accent ?? (resolvedTrend === 'up' ? 'emerald' : resolvedTrend === 'down' ? 'rose' : 'neutral');
  const color = ACCENTS[resolvedAccent] ?? ACCENTS.neutral;
  const TrendIcon = resolvedTrend === 'flat' ? ArrowRight : resolvedTrend === 'down' ? ArrowDown : ArrowUp;

  const fmtCompact = valueFormatter ?? formatCompact;
  const fmtFull = valueFormatter ?? ((n) => n.toLocaleString() + (unit ? ` ${unit}` : ''));
  const fmtDate = dateFormatter ?? ((d) => d);
  const sign = (n) => (n >= 0 ? '+' : '−') + fmtCompact(Math.abs(n));

  const displayTotal = total ?? fmtCompact(stats.sum);
  const displayDelta = delta ?? sign(stats.step);
  const displayPercent = percent ?? `${Math.abs(stats.pct).toFixed(1)}%`;

  // Series colour: its own accent, else the palette (several), else the card's.
  const chartSeries = visibleSeries.map((s, i) => ({
    name: s.name,
    data: s.data,
    color: s.accent ? (ACCENTS[s.accent] ?? ACCENTS.neutral).stroke : isMulti ? SERIES_COLORS[i % SERIES_COLORS.length] : color.stroke,
  }));


  const handlePeriodChange = (option) => {
    setSelectedLabel(option.label);
    onPeriodChange?.(option);
  };

  if (loading) {
    return (
      <div className={shell} aria-busy="true">
        <div className="pmc-content">
          <div className="pmc-head">
            <div className="pmc-sk" style={{ height: 20, width: 128 }} />
            <div className="pmc-sk" style={{ height: 20, width: 96 }} />
          </div>
          <div className="pmc-sk" style={{ marginTop: 24, height: 56, width: 192 }} />
          <div className="pmc-sk pmc-sk-soft" style={{ marginTop: 'auto', marginBottom: 20, height: 96, width: '100%' }} />
        </div>
        <div className="pmc-foot"><div className="pmc-sk" style={{ height: 16, width: 160 }} /></div>
      </div>
    );
  }

  if (!hasData) {
    return (
      <div className={shell}>
        <div className="pmc-content">
          <h3 className="pmc-title">{title}</h3>
          <div className="pmc-empty">
            <p className="pmc-empty-t">No data yet</p>
            <p className="pmc-empty-s">Metrics will appear once data is available.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={shell} style={{ '--pmc-accent': color.stroke }}>
      <div className="pmc-main">
        {/* The chart, on the right and behind the content */}
        <div className="pmc-region">
          <div className="pmc-glow" />
          <div className="pmc-dots">
            <svg width="100%" height="100%" aria-hidden="true">
              <defs>
                <pattern id={gridId} width="14" height="14" patternUnits="userSpaceOnUse">
                  <circle cx="1" cy="1" r="1" fill="currentColor" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill={`url(#${gridId})`} />
            </svg>
          </div>
          <MetricChart series={chartSeries} view={view} topInset={topInset} valueFormatter={fmtFull} dateFormatter={fmtDate} />
        </div>

        {/* Content: lets the pointer through to the chart, except its controls */}
        <div className="pmc-content">
          <div ref={measureTop}>
            <div className="pmc-head">
              <div className="pmc-head-l">
                <h3 className="pmc-title">{title}</h3>
                <ViewToggle value={view} onChange={setView} />
              </div>
              <div className="pmc-head-r">
                <span className="pmc-trend" style={{ color: color.text }}>
                  <TrendIcon size={16} strokeWidth={2.5} aria-hidden="true" />
                  {displayPercent}
                </span>
                <PeriodSelect value={selectedLabel} options={periods} onChange={handlePeriodChange} accentText={color.text} />
              </div>
            </div>

            {/* Legend, several series only */}
            {isMulti && (
              <div className="pmc-legend">
                {chartSeries.map((s) => (
                  <span key={s.name} className="pmc-legend-i"><i style={{ background: s.color }} />{s.name}</span>
                ))}
              </div>
            )}
          </div>

          <div className="pmc-total">{displayTotal}</div>
        </div>
      </div>

      {/* Footer: change on the left, peak / low / avg on the right */}
      <div className="pmc-foot">
        <div>
          <span className="pmc-delta" style={{ color: color.text }}>{displayDelta}</span>{' '}
          <span className="pmc-muted">{deltaLabel}</span>
        </div>
        {showStats && (
          <div className="pmc-stats">
            <span><b>{fmtCompact(stats.peak)}</b> peak</span>
            <span className="pmc-sep">·</span>
            <span><b>{fmtCompact(stats.low)}</b> low</span>
            <span className="pmc-sep">·</span>
            <span><b>{fmtCompact(Math.round(stats.avg))}</b> avg</span>
          </div>
        )}
      </div>
    </div>
  );
}
