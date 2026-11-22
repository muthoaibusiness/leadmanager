import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import useNavState from '../../hooks/useNavState.js';
import useLeadBook from '../../hooks/useLeadBook.js';
import useMediaQuery from '../../hooks/useMediaQuery.js';
import { planProjects } from '../../lib/projects.js';
import { byCode, STATUS, taka } from '../../lib/floorPlan.js';
import { textFloor, landmarks, floorCode, shortCode, shopLabel, takaShort } from '../../lib/floorText.js';
import BookPanel from './BookPanel.jsx';
import ShopGrid from './ShopGrid.jsx';
import './ShopBooking.css';

// Booking: choose a floor, then a shop. On a computer each floor plan is
// redrawn in CSS: every shop a tile at its own position and size, with the
// building outline, lifts, stairs, escalators and the rest drawn around them.
// On a phone there is no plan: a grid of shop cells, five per row (ShopGrid).
// An available shop can be booked for a customer: the same hold request the
// project console sends (management approves it). Fonts, sizes and colours
// follow the Citizen Avenue Mall page (see the tokens in ShopBooking.css).

const PHONE_MQ = '(max-width: 720px)';

// The project's own statuses (Landowner, Reserved…) that this floor uses, for the legend.
const customStatuses = (shops) => {
  const seen = new Map();
  shops.forEach(s => { if (s.look.color && !seen.has(s.look.label)) seen.set(s.look.label, { label: s.look.label, color: s.look.color }); });
  return [...seen.values()];
};

const ZOOMS = [1, 1.5, 2, 3]; // plan width as a multiple of its box; 1 = the whole floor fits
const sortPlans = (plans) => [...plans].sort((a, b) => (b.order ?? 0) - (a.order ?? 0) || byCode(a.name || '', b.name || ''));

export default function ShopBookingView() {
  const { dbVersion } = useApp();
  void dbVersion; // re-read the store after a sync or a status change
  useLeadBook(true); // the customer search reads leads, which are not in the boot snapshot
  const phone = useMediaQuery(PHONE_MQ);
  const projects = planProjects().filter(p => p.floorPlans.length);
  const [projId, setProjId] = useNavState('booking.project', null);
  const [floorId, setFloorId] = useNavState('booking.floor', null);
  const [shopCode, setShopCode] = useNavState('booking.shop', null);
  const [zoom, setZoom] = useNavState('booking.zoom', 1);

  const project = projects.find(p => p.id === projId) || projects[0] || null;
  const plans = sortPlans(project?.floorPlans || []);
  // The picked floor, else the ground floor (order 0), else the top one.
  const plan = plans.find(p => p.id === floorId) || plans.find(p => p.order === 0) || plans[0] || null;
  const floor = project && plan ? textFloor(project, plan) : null;
  const shop = floor?.shops.find(s => s.code === shopCode) || null;
  const lm = landmarks(plan);

  if (!project || !plan || !floor) return <div className="bk-empty">No project has a floor plan yet. Add one in Projects → Available Units.</div>;

  const pickProject = (id) => { setProjId(id); setFloorId(null); setShopCode(null); };
  const pickFloor = (p) => { setFloorId(p.id); setShopCode(null); };

  if (phone) {
    return <ShopGrid project={project} projects={projects} plans={plans} plan={plan} floor={floor}
      pickProject={pickProject} pickFloor={pickFloor} shopCode={shopCode} setShopCode={setShopCode} />;
  }

  const zi = Math.max(0, ZOOMS.indexOf(zoom));

  return (
    <div className="bk">
      <div className="bk-layout">
        <nav className="bk-floors" aria-label="Floors">
          {plans.map(p => {
            const counts = textFloor(project, p).counts;
            return (
              <button key={p.id} type="button" className="bk-floor"
                aria-pressed={plan.id === p.id} onClick={() => pickFloor(p)}>
                <span className="bk-fl">{floorCode(p.name)}</span>
                <span className="bk-fname">{p.name}</span>
                <span className="bk-fc">{counts.total ? counts.available : '—'}</span>
              </button>
            );
          })}
        </nav>

        <section className="bk-map" aria-label={`${plan.name} shops`}>
          <div className="bk-maphead">
            <h3>{plan.name}</h3>
            {projects.length > 1 && (
              <select className="bk-sel" value={project.id} onChange={e => pickProject(e.target.value)} aria-label="Project">
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
            <div className="bk-zoom" role="group" aria-label="Zoom the plan">
              <button type="button" className="bk-zbtn" aria-label="Zoom out" disabled={zi === 0} onClick={() => setZoom(ZOOMS[zi - 1])}>−</button>
              <button type="button" className="bk-zbtn wide" onClick={() => setZoom(1)} aria-label="Fit the whole floor">{zoom === 1 ? 'Fit' : `${Math.round(zoom * 100)}%`}</button>
              <button type="button" className="bk-zbtn" aria-label="Zoom in" disabled={zi === ZOOMS.length - 1} onClick={() => setZoom(ZOOMS[zi + 1])}>+</button>
            </div>
          </div>
          <div className="bk-legend">
            {floor.counts.total ? (
              <>
                <span><i className="bk-sw s-available" />Available <b>{floor.counts.available}</b></span>
                <span><i className="bk-sw s-hold" />On hold <b>{floor.counts.hold}</b></span>
                <span><i className="bk-sw s-sold" />Sold <b>{floor.counts.sold}</b></span>
                {customStatuses(floor.shops).map(c => <span key={c.label}><i className="bk-sw" style={{ background: c.color }} />{c.label}</span>)}
              </>
            ) : <span>Parking level: no shops for sale on this floor.</span>}
          </div>
          <div className="bk-stage">
            {/* The plan keeps the drawing's shape; every tile sits at its box's
                own position and size, as a percentage of it. */}
            <div className="bk-plan" style={{ '--asp': floor.aspect, '--z': zoom }}>
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
                  <button key={s.code} type="button" className={`bk-cell s-${s.status}`} aria-pressed={shopCode === s.code}
                    style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%`, width: `${s.w * 100}%`, height: `${s.h * 100}%`, ...(s.look.color ? { '--bk-c': s.look.color } : null) }}
                    onClick={() => setShopCode(s.code)}
                    aria-label={`${s.code}, ${s.size} sq ft, ${s.look.label}`}>
                    <span className="bk-cell-id">{shortCode(s.code)}</span>
                    {hw >= 0.04 && <span className="bk-cell-m">{s.size} sft</span>}
                    {hw >= 0.06 && s.w >= 0.075 && <span className="bk-cell-p">{s.status === 'available' ? takaShort(s.price) : s.look.label}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <aside className={`bk-detail${shop ? ' has-shop' : ''}`} aria-live="polite">
          {!shop ? (
            <div className="bk-empty bk-empty-lg">
              <Mi>touch_app</Mi>
              <b>{!floor.counts.total ? 'No shops on this floor' : 'Select a shop'}</b>
              <span>{!floor.counts.total ? 'Pick another floor to book a shop.' : 'Pick a tile on the plan to see its price and book it for a customer.'}</span>
            </div>
          ) : (
            <div className="bk-card">
              <div className="bk-sd-head">
                <div>
                  <span className="bk-eyebrow">{plan.name}{shop.category ? ` · ${shop.category}` : ''}</span>
                  <h3>{shopLabel(shop.code)}</h3>
                </div>
                <span className={`bk-pill s-${shop.status}`} style={shop.look.color ? { '--bk-c': shop.look.color } : undefined}>
                  <i className="bk-dot" />{shop.look.label || STATUS[shop.status]?.label}
                </span>
                <button type="button" className="bk-close" aria-label="Close" onClick={() => setShopCode(null)}><Mi>close</Mi></button>
              </div>
              <div className="bk-sd-price">
                <div className="bk-price">{shop.price ? taka(shop.price) : 'Price on request'}</div>
                {shop.rate > 0 && <span className="bk-fx">{taka(shop.rate)} / sq ft</span>}
              </div>
              <div className="bk-pay">
                <div><span>Size</span><b>{shop.size ? `${shop.size.toLocaleString('en-IN')} sq ft` : '—'}</b></div>
                <div><span>Type</span><b>{shop.type || '—'}</b></div>
                <div><span>Ownership</span><b>{shop.ownership || '—'}</b></div>
                <div><span>Floor</span><b>{floorCode(plan.name)} · {plan.name}</b></div>
              </div>
              <BookPanel key={`${project.id}:${shop.code}`} project={project} shop={shop} />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
