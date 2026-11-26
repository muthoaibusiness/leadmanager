import { shortCode, takaShort } from '../../lib/floorText.js';

// The floor plan, redrawn in CSS: every unit a tile at its own position and size, with the lifts,
// stairs and the rest of the building drawn around them. Shared by the Booking page and the
// request pop-up. `focus`: a unit code to point at; the others fade and it pulses.
// A narrow tile gets a smaller type so its number is never cut off: the number
// (mono, about 0.62 em a character) has to fit the tile's width less its padding.
const codeFit = (s) => {
  if (s.w >= 0.3 && s.shape) return { fontSize: 'max(15px, 3.2cqw)' }; // a big tile (an apartment) gets big type
  const em = (s.w * 100 - 1.5) / (0.62 * shortCode(s.code).length); // in cqw
  return em < 1.75 ? { fontSize: `max(6.5px, ${Math.max(em, 0.5).toFixed(2)}cqw)` } : null;
};


export default function FloorCanvas({ floor, lm, zoom = 1, shopCode = null, onPick, focus = null }) {
  return (
    <div className="bk-stage">
      {/* The plan keeps the drawing's shape; every tile sits at its box's
          own position and size, as a percentage of it. */}
      <div className={`bk-plan${focus ? ' has-focus' : ''}`} style={{ '--asp': floor.aspect, '--z': zoom }}>
        {lm.hull && <div className="bk-hull-wrap" aria-hidden="true"><div className="bk-hull" style={{ clipPath: lm.hull }} /></div>}
        {lm.marks.map((m, i) => (
          <div key={i} className={`bk-mark k-${m.kind}`} aria-hidden="true"
            style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%`, width: `${m.w * 100}%`, height: `${m.h * 100}%`, ...(m.clip ? { clipPath: `polygon(${m.clip.map(([x, y]) => `${x * 100}% ${y * 100}%`).join(', ')})` } : null) }}>
            {m.label && <span>{m.label}</span>}
          </div>
        ))}
        {floor.shops.map(s => {
          // Tile height measured in plan widths, so "room for a second
          // line" does not depend on the drawing's aspect ratio.
          const hw = s.h / floor.aspect;
          return (
            <button key={s.code} type="button" className={`bk-cell s-${s.status}${s.w >= 0.3 && s.shape ? " big" : ""}`} data-unit={s.shape && /^[AB][0-9]/.test(s.code) ? String(s.code).charAt(0) : undefined} aria-pressed={shopCode === s.code} data-custom={s.look.color ? 'true' : undefined} data-focus={focus === s.code ? 'true' : undefined}
              style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%`, width: `${s.w * 100}%`, height: `${s.h * 100}%`, ...(s.look.color ? { '--bk-c': s.look.color } : null), ...codeFit(s), ...(s.shape ? { clipPath: `polygon(${s.shape.map(([x, y]) => `${x * 100}% ${y * 100}%`).join(', ')})` } : null) }}
              onClick={() => onPick?.(s.code)}
              aria-label={`${s.code}, ${s.size} sq ft${s.beds ? `, ${s.beds} beds` : ''}, ${s.look.label}`}>
              {s.shape && <svg className="bk-shape" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon points={s.shape.map(([x, y]) => `${x * 100},${y * 100}`).join(' ')} /></svg>}
              <span className="bk-cell-id">{shortCode(s.code)}</span>
              {hw >= 0.05 && <span className="bk-cell-m">{s.size}{s.w >= 0.075 ? " sft" : ""}</span>}
              {hw >= 0.085 && s.w >= 0.085 && <span className="bk-cell-p">{s.status === 'available' ? (takaShort(s.price) || (s.size ? `${s.size} sft` : '')) : s.look.label}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
