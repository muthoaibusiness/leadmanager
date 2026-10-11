import { useLayoutEffect, useRef, useState } from 'react';
import './bellows-crumb.css';

// BellowsCrumb — a breadcrumb that behaves like a camera bellows. When the
// trail is wider than its room, ancestor segments fold into narrow slivers
// (label clipped, three fold lines, a fade on the text edge) and the current
// segment stays fully extended. Hovering or focusing a sliver expands it to its
// natural width while its neighbours share what is left in proportion: no
// level is ever dropped (unlike an ellipsis-menu breadcrumb). With room to
// spare, every segment sits at its natural width.
//
// The conservation trick is arithmetic, not physics: every segment's
// flex-basis animates on the exact same CSS transition (duration + easing), so
// at any instant t each sits at start_i + (end_i - start_i) * e(t). Because
// sum(start_i) == sum(end_i) by construction, the row's total width never
// wobbles mid-spring, even with an overshooting bezier, and no per-frame JS
// runs.
//
// Natural widths come from a hidden ghost copy of the trail (absolute,
// invisible, nowrap, same type as the real row), so measuring the visible,
// already-clipped row can never feed back into itself. Widths are written
// straight onto the segments in a layout effect, before paint.
//
//   items: [{ id, label }] root → current; the last item is the current page.
//   onNavigate(item, index): a non-current crumb was activated.

const SEP_WIDTH = 14; // the "/" separator's box (.bcr-sep): fixed, so never measured
const PLEAT = 20;     // the width a folded segment rests at

function computeWidths(natural, available, expandedIndex, pleat) {
  const n = natural.length;
  if (n === 0) return [];
  const safeAvail = Math.max(available, pleat * n);
  if (n === 1) return [safeAvail];
  const floorTotal = pleat * (n - 1);
  const maxExpanded = Math.max(pleat, safeAvail - floorTotal);
  const expandedWidth = Math.min(natural[expandedIndex] ?? pleat, maxExpanded);
  const extra = safeAvail - expandedWidth - floorTotal; // >= 0: expandedWidth is capped above
  const othersSum = natural.reduce((sum, w, i) => (i === expandedIndex ? sum : sum + w), 0) || 1;
  return natural.map((w, i) => (i === expandedIndex ? expandedWidth : pleat + extra * (w / othersSum)));
}

// A pointerleave into another part of the trail (a sibling segment, or the
// separator gap between two) is the pointer in transit, not leaving. Clearing
// the hover there shrinks the open segment away from the cursor, lands a
// different one under it, and loops enter/leave: a flicker. Only an exit from
// the whole trail collapses.
const inTrail = (el) => !!el?.closest?.('[data-bellows-seg], [data-bellows-sep]');

export default function BellowsCrumb({ items, onNavigate, pleat = PLEAT, ariaLabel = 'Breadcrumb', className = '' }) {
  const navRef = useRef(null);
  const segRefs = useRef([]);
  const ghostRefs = useRef([]);
  const [hovered, setHovered] = useState(null);
  const [focused, setFocused] = useState(null);

  const last = items.length - 1;
  const expandedIndex = hovered ?? focused ?? last;
  const signature = items.map(i => `${i.id}\u0000${i.label}`).join('\u0001');

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return undefined;
    const n = items.length;
    const fit = () => {
      const natural = ghostRefs.current.slice(0, n).map(el => el?.getBoundingClientRect().width ?? 0);
      if (natural.length < n || natural.some(w => w === 0)) return; // not laid out yet
      // When the whole trail fits, every segment sits at its natural width
      // (spare room stays empty rather than spreading the crumbs apart); the
      // bellows only folds when it runs out of room.
      const room = nav.clientWidth - SEP_WIDTH * Math.max(0, n - 1);
      const widths = natural.reduce((s, w) => s + w, 0) <= room ? natural : computeWidths(natural, room, expandedIndex, pleat);
      segRefs.current.slice(0, n).forEach((el, i) => {
        if (!el) return;
        el.style.flexBasis = `${widths[i]}px`;
        el.toggleAttribute('data-pleated', widths[i] < natural[i] - 1);
      });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(nav);
    let live = true;
    document.fonts?.ready.then(() => { if (live) fit(); });
    return () => { live = false; ro.disconnect(); };
  }, [signature, expandedIndex, pleat, items.length]);

  const onLeave = (e) => { if (!inTrail(e.relatedTarget)) setHovered(null); };
  const onBlur = (e) => {
    if (e.relatedTarget instanceof Element && e.relatedTarget.hasAttribute('data-bellows-seg')) return; // a sibling's focus takes over
    setFocused(null);
  };

  const trail = [];
  items.forEach((item, i) => {
    const current = i === last;
    const common = {
      'data-bellows-seg': i,
      'data-state': i === expandedIndex ? 'expanded' : 'pleated',
      className: `bcr-seg${current ? ' bcr-cur' : ''}`,
      title: item.label,
      onPointerEnter: () => setHovered(i),
      onPointerLeave: onLeave,
      onFocus: () => setFocused(i),
      onBlur,
    };
    trail.push(
      <li key={item.id} ref={el => { segRefs.current[i] = el; }} className="bcr-li">
        {current
          ? <span {...common} aria-current="page" tabIndex={0}>{item.label}</span>
          : <button type="button" {...common} onClick={() => onNavigate?.(item, i)}>{item.label}</button>}
        <span className="bcr-folds" aria-hidden="true"><i /><i /><i /></span>
      </li>,
    );
    if (!current) {
      trail.push(
        <li key={`sep-${item.id}`} className="bcr-sep" aria-hidden="true" data-bellows-sep="" onPointerLeave={onLeave}>/</li>,
      );
    }
  });

  return (
    <nav ref={navRef} aria-label={ariaLabel} className={`bcr${className ? ` ${className}` : ''}`}>
      <ol className="bcr-ol">{trail}</ol>
      {/* measurement ghost: the full trail at natural width, out of flow */}
      <ol className="bcr-ghost" aria-hidden="true">
        {items.map((item, i) => (
          <li key={item.id} ref={el => { ghostRefs.current[i] = el; }} className="bcr-seg bcr-cur">{item.label}</li>
        ))}
      </ol>
    </nav>
  );
}
