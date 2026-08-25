// The one inline loading indicator, for anything that fetches after first paint.
//
// Deliberately NOT LoadingRadar: that one is 150px and owns the whole screen,
// which is right for boot and login and wrong for a table swapping a page or a
// KPI card resolving its count. This is a small accent-coloured arc that can sit
// inside a cell, a card, or a panel without moving the layout around it.
//
// Colour comes from `currentColor` by default, so it inherits whatever it is
// placed in; `tone="accent"` opts into the brand green (--accent), which is what
// the block form uses.

// size: px diameter. 14 sits on a line of text, 18 in a card, 26+ for a block.
export default function Spinner({ size = 16, tone = 'accent', className = '', label = 'Loading' }) {
  return (
    <span
      className={`spin${tone ? ' spin-' + tone : ''}${className ? ' ' + className : ''}`}
      style={{ width: size, height: size, borderWidth: Math.max(1.5, size / 9) }}
      role="status"
      aria-label={label}
    />
  );
}

// Centred spinner + caption, for a region that has nothing to show yet — an
// empty table body, a panel waiting on its first fetch, a view waiting on the
// lead book. Fills its container rather than the screen.
export function LoadingBlock({ label = 'Loading…', size = 26, pad = 28 }) {
  return (
    <div className="spin-block" style={{ padding: pad }}>
      <Spinner size={size} />
      {label && <span className="spin-lbl">{label}</span>}
    </div>
  );
}

// A thin indeterminate bar for the top of a region that already HAS content and
// is refreshing it — a table moving to the next page, a filter being applied.
// Nothing shifts: it is absolutely positioned against the nearest positioned
// ancestor, so it overlays rather than inserts.
export function LoadingBar() {
  return <span className="spin-bar" role="status" aria-label="Loading" />;
}
