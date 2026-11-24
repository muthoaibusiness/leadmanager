import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import useNavState from '../../hooks/useNavState.js';
import useLeadBook from '../../hooks/useLeadBook.js';
import useMediaQuery from '../../hooks/useMediaQuery.js';
import { planProjects } from '../../lib/projects.js';
import { byCode } from '../../lib/floorPlan.js';
import { textFloor, landmarks, floorCode } from '../../lib/floorText.js';
import ShopCard from './ShopCard.jsx';
import FloorCanvas from './FloorCanvas.jsx';
import ProjectList from './ProjectList.jsx';
import ShopGrid from './ShopGrid.jsx';
import './ShopBooking.css';

// Booking: choose a project, then a floor, then a shop. On a computer each floor plan is
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
  shops.forEach(s => { if (!s.look.color) return; const e = seen.get(s.look.label) || { label: s.look.label, color: s.look.color, n: 0 }; e.n++; seen.set(s.look.label, e); });
  return [...seen.values()];
};

const ZOOMS = [1, 1.5, 2, 3]; // plan width as a multiple of its box; 1 = the whole floor fits
const sortPlans = (plans) => [...plans].sort((a, b) => (b.order ?? 0) - (a.order ?? 0) || byCode(a.name || '', b.name || ''));

export default function ShopBookingView() {
  const { dbVersion } = useApp();
  void dbVersion; // re-read the store after a sync or a status change
  useLeadBook(true); // the customer search reads leads, which are not in the boot snapshot
  const phone = useMediaQuery(PHONE_MQ);
  const allProjects = planProjects(); // the list page shows every project
  const projects = allProjects.filter(p => p.floorPlans.length);
  const [projId, setProjId] = useNavState('booking.project', null);
  const [floorId, setFloorId] = useNavState('booking.floor', null);
  const [shopCode, setShopCode] = useNavState('booking.shop', null);
  const [zoom, setZoom] = useNavState('booking.zoom', 1);

  const project = projects.find(p => p.id === projId) || null; // none picked yet: the project list
  const plans = sortPlans(project?.floorPlans || []);
  // The picked floor, else the ground floor if it has units, else the lowest floor that does.
  const hasShops = (p) => textFloor(project, p).counts.total > 0;
  const plan = plans.find(p => p.id === floorId)
    || [...plans].reverse().find(p => p.order === 0 && hasShops(p)) || [...plans].reverse().find(hasShops) // the lowest floor that has units
    || plans.find(p => p.order === 0) || plans[0] || null;
  const floor = project && plan ? textFloor(project, plan) : null;
  const shop = floor?.shops.find(s => s.code === shopCode) || null;
  const lm = landmarks(plan);

  if (!project) return <ProjectList projects={allProjects} onPick={(id) => { setProjId(id); setFloorId(null); setShopCode(null); }} />;
  if (!plan || !floor) return <div className="bk-empty">This project has no floor plan yet. Add one in Projects → Available Units.</div>;

  const backToProjects = () => { setProjId(null); setFloorId(null); setShopCode(null); };
  const pickFloor = (p) => { setFloorId(p.id); setShopCode(null); };

  if (phone) {
    return <ShopGrid project={project} plans={plans} plan={plan} floor={floor}
      onBack={backToProjects} pickFloor={pickFloor} shopCode={shopCode} setShopCode={setShopCode} />;
  }

  const zi = Math.max(0, ZOOMS.indexOf(zoom));
  // One card width for every floor: sized for the widest floor's drawing, so
  // switching floors never moves the columns. Each plan sits centred inside it.
  const frameAsp = Math.max(...plans.map(p => textFloor(project, p).aspect));

  return (
    <div className="bk">
      <div className="bk-layout" style={{ '--asp': frameAsp }}>
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
            <button type="button" className="bk-chip bk-back" onClick={backToProjects} title="Back to all projects"><Mi>arrow_back</Mi>{project.name}</button>
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
                <span><i className="bk-sw s-hold" />On hold <b>{floor.shops.filter(x => x.status === 'hold' && !x.look.color).length}</b></span>
                <span><i className="bk-sw s-sold" />Sold <b>{floor.shops.filter(x => x.status === 'sold' && !x.look.color).length}</b></span>
                {customStatuses(floor.shops).map(c => <span key={c.label}><i className="bk-sw" style={{ background: c.color }} />{c.label} <b>{c.n}</b></span>)}
              </>
            ) : <span>{plan.note || 'No units for sale on this floor.'}</span>}
          </div>
          <FloorCanvas floor={floor} lm={lm} zoom={zoom} shopCode={shopCode} onPick={setShopCode} />
        </section>

        <aside className={`bk-detail${shop ? ' has-shop' : ''}`} aria-live="polite">
          {!shop ? (
            <div className="bk-empty bk-empty-lg">
              <Mi>touch_app</Mi>
              <b>{!floor.counts.total ? 'No units on this floor' : 'Select a shop'}</b>
              <span>{!floor.counts.total ? 'Pick another floor to book a unit.' : 'Pick a tile on the plan to see its price and book it for a customer.'}</span>
            </div>
          ) : (
            <ShopCard key={`${project.id}:${shop.code}`} project={project} plan={plan} shop={shop} onClose={() => setShopCode(null)} />
          )}
        </aside>
      </div>
    </div>
  );
}
