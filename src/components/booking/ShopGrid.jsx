import { useState } from 'react';
import Mi from '../Mi.jsx';
import useNavState from '../../hooks/useNavState.js';
import { byCode, taka } from '../../lib/floorPlan.js';
import { textFloor, floorCode, shortCode, shopLabel, codeKey } from '../../lib/floorText.js';
import ShopCard from './ShopCard.jsx';

// Booking on a phone: no floor plan, a grid of shop cells, five per row, in
// shop-number order. Floors are a column on the left (F5 … FB), a filter sits
// above the grid (Open / Held / Sold / All), and a tap on a cell opens a bar at
// the bottom with the price and Book; Book opens the booking sheet.
// The page itself never scrolls (see .pg-fit); only the grid does.

const FILTERS = [
  ['open', 'Open', s => s.status === 'available'],
  ['held', 'Held', s => s.status === 'hold'],
  ['sold', 'Sold', s => s.status === 'sold'],
  ['all', 'All', () => true],
];

const customStatuses = (shops) => {
  const seen = new Map();
  shops.forEach(s => { if (s.look.color && !seen.has(s.look.label)) seen.set(s.look.label, { label: s.look.label, color: s.look.color }); });
  return [...seen.values()];
};

export default function ShopGrid({ project, plans, plan, floor, onBack, pickFloor, shopCode, setShopCode }) {
  const [filter, setFilter] = useNavState('booking.filter', 'open');
  // A unit already picked (a link to it, or Back) opens straight in its panel.
  const [sheet, setSheet] = useState(() => !!shopCode);

  const shops = [...floor.shops].sort((a, b) => byCode(a.code, b.code));
  const test = (FILTERS.find(f => f[0] === filter) || FILTERS[0])[2];
  const shown = shops.filter(test);
  const shop = shops.find(s => s.code === shopCode) || null;
  const noShops = floor.counts.total === 0;

  // One tap opens the unit's booking panel, as in a tower's building view; closing it clears the pick.
  const pick = (s) => { setShopCode(s.code); setSheet(true); };
  const close = () => { setSheet(false); setShopCode(null); };
  // The floor list leaves out floors with no shops (roof, ground with only a lobby…). The floor on
  // screen always stays in it, and a project with no shops anywhere still lists every floor.
  const floorsWithShops = plans.map(p => ({ p, c: textFloor(project, p).counts })).filter(({ p, c }) => c.total > 0 || p.id === plan.id);
  const railFloors = floorsWithShops.length ? floorsWithShops : plans.map(p => ({ p, c: textFloor(project, p).counts }));
  const done = () => { setSheet(false); setShopCode(null); };

  return (
    <div className={`bkm${shop ? ' has-dock' : ''}`}>
      <nav className="bkm-rail" aria-label="Floors" style={{ '--fls': railFloors.length }}>
        {railFloors.map(({ p, c }) => {
          return (
            <button key={p.id} type="button" className="bkm-fl" aria-pressed={plan.id === p.id}
              aria-label={`${p.name}, ${c.total ? `${c.available} open` : 'no shops'}`}
              onClick={() => { pickFloor(p); setSheet(false); }}>
              <b>{floorCode(p.name)}</b>
              <span>{c.total ? c.available : '—'}</span>
            </button>
          );
        })}
      </nav>

      <div className="bkm-main">
        <button type="button" className="bk-chip bk-back" onClick={onBack}><Mi>arrow_back</Mi>{project.name}</button>
        <div className="bkm-chips" role="group" aria-label="Show shops">
          {FILTERS.map(([k, label, fn]) => (
            <button key={k} type="button" className="bk-chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>
              {label}<i>{shops.filter(fn).length}</i>
            </button>
          ))}
        </div>

        {noShops ? (
          <div className="bk-empty">
            <b>No shops on this floor</b>
            <span>{plan.name} is a parking level. Pick another floor.</span>
          </div>
        ) : (
          <>
            <div className="bk-legend">
              <span><i className="bk-sw s-available" />Open</span>
              <span><i className="bk-sw s-hold" />Held</span>
              <span><i className="bk-sw s-sold" />Sold</span>
              {customStatuses(floor.shops).map(c => <span key={c.label}><i className="bk-sw" style={{ background: c.color }} />{c.label}</span>)}
              {codeKey(floor.shops.map(s => s.code)).map(k => <span key={k.code} className="bk-ck"><b>{k.code}</b>= {k.name}</span>)}
            </div>
            <div className="bkm-grid" role="list">
              {shown.map(s => (
                <button key={s.code} type="button" role="listitem" className={`bkm-tile s-${s.status}${shortCode(s.code).length > 6 ? ' wide' : ''}`}
                  style={s.look.color ? { '--bk-c': s.look.color } : undefined}
                  aria-pressed={shopCode === s.code} onClick={() => pick(s)}
                  aria-label={`${shopLabel(s.code)}, ${s.size} sq ft, ${s.look.label}`}>
                  <span className="bkm-code">{shortCode(s.code)}</span>
                  <span className="bkm-sft">{s.size || '—'}</span>
                </button>
              ))}
              {!shown.length && <div className="bk-empty bkm-none">No {filter === 'all' ? '' : filter + ' '}shops on this floor.</div>}
            </div>
          </>
        )}
      </div>

      {shop && sheet && (
        <>
          <div className="bkm-scrim" onClick={close} />
          <div className="bkm-sheet" role="dialog" aria-label={`Book ${shopLabel(shop.code)}`}>
            <div className="bkm-grab" />
            <div className="bkm-sheet-h">
              <div>
                <h3>{shopLabel(shop.code)}</h3>
                <div className="bkm-sheet-p">{shop.status === 'sold' ? <b>{shop.size ? `${shop.size} sq ft` : shop.look.label}</b> : <><b>{shop.price ? taka(shop.price) : 'Price on request'}</b>{shop.size ? <span> · {shop.size} sq ft</span> : null}</>}{shop.beds ? <span> · {shop.beds} bed{shop.beds > 1 ? 's' : ''}</span> : null}</div>
              </div>
              <button type="button" className="bk-x" aria-label="Close" onClick={close}><Mi>close</Mi></button>
            </div>
            <ShopCard key={`${project.id}:${shop.code}`} bare project={project} plan={plan} shop={shop} onClose={close} onDone={done} />
          </div>
        </>
      )}
    </div>
  );
}
