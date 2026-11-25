import Mi from '../Mi.jsx';
import { takaShort, stackOf } from '../../lib/floorText.js';
import ShopCard from './ShopCard.jsx';

// Booking for a residential tower: the whole building on one screen, a row per floor (top floor
// first) and a column per unit type (Unit A, Unit B …). Floors marked `grid: true` in the project's
// floor plans take part; the others (ground, roof) are left out.
// A column's caption comes from the unit type's `position` (Front, Back …).

const STATUS_LABEL = { available: 'Available', hold: 'On hold', sold: 'Sold' };

// The building grid itself. `focus`: a unit to point at (the others fade); `onPick` makes units clickable.
export function StackTable({ rows, cols, shopCode = null, onPick, focus = null }) {
  return (
    <div className={`stk${focus ? ' stk-focus' : ''}`} style={{ '--cols': cols.length, '--rows': rows.length }}>
      <div className="stk-row stk-head">
        <span />
        {cols.map(v => (
          <span key={v.id} className="stk-col"><b>{v.name}</b>{v.position && <i>{v.position}</i>}</span>
        ))}
      </div>
      {rows.map(({ plan, shops }) => (
        <div key={plan.id} className={`stk-row${shops.length ? '' : ' stk-off'}`}>
          <span className="stk-fl">{plan.name}</span>
          {cols.map(v => {
            const s = shops.find(x => x.variantId === v.id);
            if (!s) return <span key={v.id} className="stk-cell stk-none" />;
            return (
              <button key={v.id} type="button" className={`stk-cell bk-cell s-${s.status}`} aria-pressed={shopCode === s.code}
                data-custom={s.look.color ? 'true' : undefined} data-focus={focus === s.code ? 'true' : undefined}
                style={s.look.color ? { '--bk-c': s.look.color } : undefined}
                onClick={onPick ? () => onPick(s.code) : undefined} disabled={!onPick && focus !== s.code}
                aria-label={`${s.code}, ${plan.name}, ${s.look.label}`}>
                <b>{s.code}</b>
                <span>{s.look.color ? s.look.label : STATUS_LABEL[s.status] || s.look.label}</span>
                <em>{s.status === 'available' && s.price ? takaShort(s.price) : `${s.size || ''}${s.size ? ' sft' : ''}`}</em>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default function StackGrid({ project, plans, shopCode, setShopCode, onBack }) {
  const { rows, cols, all } = stackOf(project, plans);
  const shop = all.find(s => s.code === shopCode) || null;

  const n = (st, custom) => all.filter(s => s.status === st && !!s.look.color === custom).length;
  const land = all.filter(s => s.look.color);
  const legend = [['available', 'Available', n('available', false)], ['hold', 'On hold', n('hold', false)], ['sold', 'Sold', n('sold', false)]];

  return (
    <div className="bk">
      <div className="bk-layout stk-layout">
        <section className="bk-map stk-map" aria-label={`${project.name} units`}>
          <div className="bk-maphead">
            <h3>All floors</h3>
            <button type="button" className="bk-chip bk-back" onClick={onBack} title="Back to all projects"><Mi>arrow_back</Mi>{project.name}</button>
          </div>
          <div className="bk-legend">
            {legend.map(([k, l, c]) => <span key={k}><i className={`bk-sw s-${k}`} />{l} <b>{c}</b></span>)}
            {land.length > 0 && <span><i className="bk-sw" style={{ background: land[0].look.color }} />{land[0].look.label} <b>{land.length}</b></span>}
          </div>
          <StackTable rows={rows} cols={cols} shopCode={shopCode} onPick={setShopCode} />
        </section>

        <aside className={`bk-detail${shop ? ' has-shop' : ''}`} aria-live="polite">
          {!shop ? (
            <div className="bk-empty bk-empty-lg">
              <Mi>touch_app</Mi><b>Select a unit</b>
              <span>Pick a unit to see its price and book it for a customer.</span>
            </div>
          ) : (
            <ShopCard key={`${project.id}:${shop.code}`} project={project} plan={shop.plan} shop={shop} onClose={() => setShopCode(null)} />
          )}
        </aside>
      </div>
    </div>
  );
}
