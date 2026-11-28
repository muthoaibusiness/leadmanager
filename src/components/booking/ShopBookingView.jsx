import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import useNavState from '../../hooks/useNavState.js';
import useLeadBook from '../../hooks/useLeadBook.js';
import useMediaQuery from '../../hooks/useMediaQuery.js';
import { planProjects, maskProject, projectsFor } from '../../lib/projects.js';
import { canCustomers, canPrices } from '../../lib/constants.js';
import { byCode } from '../../lib/floorPlan.js';
import { textFloor, landmarks, floorCode } from '../../lib/floorText.js';
import ShopCard from './ShopCard.jsx';
import FloorCanvas from './FloorCanvas.jsx';
import ProjectList from './ProjectList.jsx';
import ShopGrid from './ShopGrid.jsx';
import StackGrid from './StackGrid.jsx';
import ProjectOverview from './ProjectOverview.jsx';
import ProjectDocs from './ProjectDocs.jsx';
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

const ZOOMS = [1, 1.5, 2, 3, 4]; // the +/- steps: plan width as a multiple of its box; 1 = the whole floor fits
const ZMAX = ZOOMS[ZOOMS.length - 1];
// the mouse wheel zooms smoothly in between the steps
const clampZoom = (z) => Math.min(ZMAX, Math.max(1, Math.round(z * 100) / 100));
const sortPlans = (plans) => [...plans].sort((a, b) => (b.order ?? 0) - (a.order ?? 0) || byCode(a.name || '', b.name || ''));

// A project opens on three tabs: Overview (figures, customers, holds), Booking (the plan) and Documents.
const PTABS = [['overview', 'Overview', 'insights'], ['booking', 'Booking', 'event_seat'], ['docs', 'Documents', 'description']];

export default function ShopBookingView() {
  const { bookProj, setBookProj, user } = useApp();
  const [ptab, setPtab] = useNavState('booking.ptab', 'booking');
  // customers and prices the account may not see never reach the booking screens
  const access = { customers: canCustomers(user), prices: canPrices(user) };
  const allProjects = projectsFor(user, planProjects()).map(p => maskProject(p, access));
  const project = allProjects.find(p => p.id === bookProj) || null;
  if (!project) return <ProjectList projects={allProjects} onPick={(id) => setBookProj(id)} />;
  return (
    <div className="bk bkx">
      <div className="bkx-head">
        <button type="button" className="bk-chip bk-back" onClick={() => setBookProj(null)} title="All projects"><Mi>arrow_back</Mi>Projects</button>
        <h2>{project.name}</h2>
        <div className="rqx-tabs" role="tablist" aria-label="Project">
          {PTABS.map(([k, l, ic]) => (
            <button key={k} type="button" role="tab" className="bk-chip" aria-selected={ptab === k} aria-pressed={ptab === k} onClick={() => setPtab(k)}><Mi>{ic}</Mi>{l}</button>
          ))}
        </div>
      </div>
      <div className="bkx-body">
        {ptab === 'overview' ? <ProjectOverview project={project} />
          : ptab === 'docs' ? <ProjectDocs project={project} />
          : <ProjectBooking project={project} onBack={() => setBookProj(null)} />}
      </div>
    </div>
  );
}

// The Booking tab: the project's floors and units (the drawn plan, the building grid, or on a phone the unit grid).
function ProjectBooking({ project, onBack }) {
  const { dbVersion } = useApp();
  void dbVersion; // re-read the store after a sync or a status change
  useLeadBook(true); // the customer search reads leads, which are not in the boot snapshot
  const phone = useMediaQuery(PHONE_MQ);
  const [floorId, setFloorId] = useNavState('booking.floor', null);
  const [shopCode, setShopCode] = useNavState('booking.shop', null);
  const [zoom, setZoom] = useNavState('booking.zoom', 1);

  const plans = sortPlans(project?.floorPlans || []);
  // The picked floor, else the ground floor if it has units, else the lowest floor that does.
  const hasShops = (p) => textFloor(project, p).counts.total > 0;
  const plan = plans.find(p => p.id === floorId)
    || [...plans].reverse().find(p => p.order === 0 && hasShops(p)) || [...plans].reverse().find(hasShops) // the lowest floor that has units
    || plans.find(p => p.order === 0) || plans[0] || null;
  const floor = project && plan ? textFloor(project, plan) : null;
  const shop = floor?.shops.find(s => s.code === shopCode) || null;
  const lm = landmarks(plan);

  if (!plan || !floor) return <div className="bk-empty">This project has no floor plan yet. Add one in Projects → Available Units.</div>;

  const backToProjects = onBack;
  const pickFloor = (p) => { setFloorId(p.id); setShopCode(null); };

  // A tower whose floors are marked as grid floors is booked from one building view: a row per floor.
  // Phones get the same building view as computers (ShopBooking.css lays it out for a narrow screen).
  if (plans.some(p => p.grid)) return <StackGrid project={project} plans={plans} shopCode={shopCode} setShopCode={setShopCode} onBack={backToProjects} />;

  if (phone) {
    return <ShopGrid project={project} plans={plans} plan={plan} floor={floor}
      onBack={backToProjects} pickFloor={pickFloor} shopCode={shopCode} setShopCode={setShopCode} />;
  }

  const zoomOut = () => setZoom([...ZOOMS].reverse().find(z => z < zoom - 0.01) ?? 1);
  const zoomIn = () => setZoom(ZOOMS.find(z => z > zoom + 0.01) ?? ZMAX);
  // The floor list leaves out floors with no units; the floor on screen always stays in it.
  const listed = plans.filter(p => p.id === plan.id || hasShops(p));
  // One card width for every floor: sized for the widest floor's drawing, so
  // switching floors never moves the columns. Each plan sits centred inside it.
  const frameAsp = Math.max(...plans.map(p => textFloor(project, p).aspect));

  return (
    <div className="bk">
      <div className="bk-layout" style={{ '--asp': frameAsp }}>
        <nav className="bk-floors" aria-label="Floors">
          {listed.map(p => {
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
              <button type="button" className="bk-zbtn" aria-label="Zoom out" disabled={zoom <= 1} onClick={zoomOut}>−</button>
              <button type="button" className="bk-zbtn wide" onClick={() => setZoom(1)} aria-label="Fit the whole floor">{zoom === 1 ? 'Fit' : `${Math.round(zoom * 100)}%`}</button>
              <button type="button" className="bk-zbtn" aria-label="Zoom in" disabled={zoom >= ZMAX} onClick={zoomIn}>+</button>
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
          <FloorCanvas floor={floor} lm={lm} zoom={zoom} onZoom={(z) => setZoom(clampZoom(z))} shopCode={shopCode} onPick={setShopCode} />
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
