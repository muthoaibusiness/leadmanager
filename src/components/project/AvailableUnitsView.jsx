import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import Mi from '../Mi.jsx';
import BackButton from '../BackButton.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { ROLES } from '../../lib/constants.js';
import { countLeads, getHoldRequests, getLead, ensureLead } from '../../lib/db.js';
import { seedNextPage, usePageOverlay } from '../../hooks/useNavHistory.js';
import useIsPhone from '../../hooks/useIsPhone.js';
import { hasColumn } from '../../lib/supabase.js';
import { planProjects, findUnit, unitSize, unitPrice, placedUnitIds, deleteFloorPlan } from '../../lib/projects.js';
import { toPx, byCode, STATUS, taka, statusLook } from '../../lib/floorPlan.js';
import { Menu, MenuItem, MenuSep } from '../ui/menu.jsx';
import { Select, SelectTrigger, SelectPopover, SelectListBox, SelectItem } from '../ui/select.jsx';
import useProjectNav from '../../hooks/useProjectNav.js';
import useChanged from '../../hooks/useChanged.js';
import FloorPlanCanvas from './FloorPlanCanvas.jsx';
import ProjectConsole from './ProjectConsole.jsx';
import ProjectsToaster from './ProjectsToaster.jsx';
import Loader from '../ui/loader.jsx';
import { useProjectToast } from './projectToast.js';
import './FloorPlan.css';

// Projects → Available Units. Every signed-in user who can open Projects sees
// the project's units, each colored by its live status (the same units the
// Projects KPIs, the console grid, holds and deals use), side by side:
//  - left, Grid: a seat-map of unit tiles for the floor picked in the Floor
//    dropdown (one per floor plan, plus "Other units" for units on no plan and
//    "All floors"). Works with or without plan images.
//  - middle, Plan: that floor's uploaded drawing with a box per unit; with All
//    floors, the picked unit's floor (the top floor until one is picked). Left
//    out when the project has no plans.
//  - right, Deal overview: an available unit's Deal cart (ProjectConsole,
//    embedded), so picking a unit goes straight to reserving it. A taken unit
//    shows its status and current booking instead.
// Management also adds, edits and deletes plans (FloorPlanEditor).

const OTHER = 'other'; // the chip for units on no floor plan
const ALL = 'all-floors'; // Grid: every floor at once, grouped by floor
const sortPlans = (plans) => [...plans].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || byCode(a.name || '', b.name || ''));
const unitRow = (loc) => ({ code: loc.unit.id, loc, status: loc.unit.status, type: loc.variant.name || '', size: unitSize(loc.unit, loc.variant), price: unitPrice(loc.unit, loc.variant) });
// A unit tile's label: each word before the number cut to its initial, so
// "Office-16" reads "O-16", "SHOP-401" "S-401" and "Food Court-3" "FC-3".
// Words of up to 3 letters are kept ("SR-12", "A-101"); a code with no word
// in front of a number stays whole. Only the tile shows it: titles, search
// results, the unit card and everything outside the grid keep the full code.
// SHORT_WORDS: types whose initial would read as a commoner one's (a
// Showroom is "SH", so it never looks like a Shop's "S").
const SHORT_WORDS = { showroom: 'SH' };
// Unit colours on an artwork plan, by status: the tones live in FloorPlan.css
// (.is-art .art-<key>). Available is the artwork's own paint; a custom status
// matches by name (Landowner, Reserved), else uses its own colour as the edge.
const ART = new Set(['hold', 'landowner', 'reserved']);
const shortCode = (code) => {
  const m = /^([A-Za-z][A-Za-z ]*?)([\s\-_./]*\d.*)$/.exec(code || '');
  if (!m) return code;
  const head = m[1].trim();
  return (SHORT_WORDS[head.toLowerCase().replace(/\s+/g, '')]
    ?? head.split(/\s+/).map(w => (w.length <= 3 ? w : w[0].toUpperCase())).join('')) + m[2];
};

export default function AvailableUnitsView() {
  const { user, dbVersion, refreshDB, planSel, setPlanSel, setPlanEdit, openModal, setPanLead, nav, setProjTab } = useApp();
  void dbVersion; // re-read the store when realtime or a save changes it
  const toast = useProjectToast();
  const isAdmin = user?.role === ROLES.MGMT;
  const [stat, setStat] = useState('all');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null);     // unit code
  // The unit whose Deal cart is open: picked while available, kept after the
  // deal holds it, so the cart stays up through Hold and payment.
  const [dealCode, setDealCode] = useState(null);
  const [hover, setHover] = useState(null); // box id
  const [canSave, setCanSave] = useState(null); // floor_plans column present (null = still asking)
  const cardRef = useRef(null);
  const pnav = useProjectNav();
  const phone = useIsPhone();
  const gridRef = useRef(null);
  const [paneH, setPaneH] = useState(0); // desktop: the columns' height, fitted to the screen (0 = not fitted)
  const [tab, setTab] = useState('deal'); // right panel: Deal overview | Customers

  // Saving needs migration 0021's column; only Management is told about it.
  useEffect(() => {
    if (!isAdmin) return;
    let live = true;
    hasColumn('properties', 'floor_plans', 'Floor plans cannot be saved. Apply supabase/migrations/0021_floor_plans.sql.')
      .then(ok => { if (live) setCanSave(ok); });
    return () => { live = false; };
  }, [isAdmin]);

  // Customers tab: how many leads name this project, counted when the tab opens.
  const [people, setPeople] = useState({ key: '', total: null });
  const [openReq, setOpenReq] = useState(null); // the reservation request shown expanded
  const [peopleOpen, setPeopleOpen] = useState(false); // phones: the Customers sheet (from Manage)

  const projects = planProjects();
  // Opens on Citizen Avenue Mall when it is in the list, else the first project with plans.
  const proj = projects.find(p => p.id === planSel.projectId) || projects.find(p => /citizen avenue/i.test(p.name || '')) || projects[0] || null;
  const plans = proj ? sortPlans(proj.floorPlans) : [];
  // Opens on the 1st Floor when the project has one, else the lowest floor with units.
  const plan = plans.find(fp => fp.id === planSel.planId) || plans.find(fp => /^1st\b/i.test(fp.name || '') && (fp.boxes || []).length)
    || plans.find(fp => (fp.boxes || []).length) || plans[0] || null;
  const customs = proj?.unitStatuses || []; // the project's own unit statuses

  // Units on no floor plan: the grid's last chip ("All units" when there are no plans).
  const placed = proj ? placedUnitIds(proj) : new Set();
  const others = proj ? proj.variants.flatMap(v => (v.units || []).filter(u => !placed.has(u.id)).map(u => unitRow({ variant: v, unit: u }))) : [];
  // All floors only when asked for (an old link).
  const floorCount = plans.length + (others.length ? 1 : 0);
  const chip = planSel.planId === ALL && floorCount > 1 ? ALL
    : planSel.planId === OTHER && others.length ? OTHER
    : plan?.id || (others.length ? OTHER : null);
  const chipPlan = chip === OTHER || chip === ALL ? null : plan;
  if (useChanged(`${proj?.id}|${chip}`)) { setSel(null); setStat('all'); setQ(''); }

  // Every plan image of the open project, fetched once the browser is idle, so
  // switching floors shows the drawing at once instead of
  // waiting on a ~200 KB download per floor.
  const planUrls = plans.map(fp => fp.image?.url).filter(Boolean).join('\n');
  useEffect(() => {
    if (!planUrls) return;
    const imgs = [];
    const go = () => planUrls.split('\n').forEach(u => { const i = new Image(); i.decoding = 'async'; i.src = u; imgs.push(i); });
    const ric = window.requestIdleCallback || ((f) => setTimeout(f, 300));
    const id = ric(go);
    return () => { (window.cancelIdleCallback || clearTimeout)(id); imgs.length = 0; };
  }, [planUrls]);

  // Phones have no Customers tab: the sheet opened from Manage counts instead.
  const peopleKey = (phone ? peopleOpen : tab === 'people') && proj ? `${proj.id}|${user?.id}` : '';
  useEffect(() => {
    if (!peopleKey) return;
    let live = true;
    // The same set the Prospects list shows with this project picked (leadWhere `project`).
    countLeads({ user, involved: true, project: proj.name }).then(n => { if (live) setPeople({ key: peopleKey, total: n }); });
    return () => { live = false; };
  }, [peopleKey]); // eslint-disable-line react-hooks/exhaustive-deps -- proj/user are read through the key
  const peopleReady = people.key === peopleKey;

  const pickProject = (id) => setPlanSel({ projectId: id, planId: null });
  const pickPlan = (id) => setPlanSel({ projectId: proj.id, planId: id });
  const editPlan = (planId) => { setPlanEdit({ projectId: proj.id, planId }); openModal('floorplan-editor'); };

  const removePlan = () => {
    toast.confirm({
      title: `Delete ${plan.name || 'this floor plan'}?`,
      description: 'The plan and its boxes are removed. Its units stay in the project.',
      confirmLabel: 'Delete',
      onConfirm: () => {
        deleteFloorPlan(proj.id, plan.id).then(res => {
          if (!res.ok) { toast.error('Plan not deleted', `${res.error.charAt(0).toUpperCase()}${res.error.slice(1)}.`); return; }
          setPlanSel({ projectId: proj.id, planId: null });
          refreshDB();
          toast.success('Floor plan deleted', `${plan.name || 'The plan'} was removed.`);
        });
      },
    });
  };

  // Each box of a plan, joined to its unit.
  const rowsOf = (fp) => (fp?.boxes || []).map(b => {
    const loc = proj ? findUnit(proj, b.unitId) : null;
    return loc ? { ...unitRow(loc), box: b } : { box: b, code: b.unitId || '—', loc: null, status: 'unlinked', type: '', size: 0, price: 0 };
  });
  const rows = rowsOf(chipPlan);
  // All floors: every placed unit with its floor (top floor first), then the rest.
  const allRows = chip !== ALL ? [] : [
    ...[...plans].reverse().flatMap(fp => rowsOf(fp).filter(r => r.loc).map(r => ({ ...r, floor: fp.name || 'Floor plan' }))),
    ...others.map(r => ({ ...r, floor: plans.length ? 'Other units' : 'All units' })),
  ];
  // What the counts, filters and list cover: the plan's boxes, the other units, or all.
  const items = chip === ALL ? allRows : chip === OTHER ? others : rows;
  // A unit's chip: its custom status ('c:<id>') when it has one, else its base.
  // So the chips add up to All and each custom status filters on its own.
  const kindOf = (r) => { const t = r.loc?.unit.tag; return t && customs.some(c => c.id === t) ? 'c:' + t : r.status; };
  const counts = { available: 0, hold: 0, sold: 0 };
  customs.forEach(c => { counts['c:' + c.id] = 0; });
  items.forEach(r => { const k = kindOf(r); if (counts[k] != null) counts[k]++; });
  // Tile labels: shortCode, except where two units in view would share one
  // ("Office-16" and "Outlet-16"); those keep their full codes.
  const codesByShort = new Map();
  items.forEach(r => { const s = shortCode(r.code); codesByShort.set(s, (codesByShort.get(s) || new Set()).add(r.code)); });
  const tileLabel = (r) => { const s = shortCode(r.code); return codesByShort.get(s).size > 1 ? r.code : s; };
  const term = q.trim().toUpperCase();
  const shown = (r) => (stat === 'all' || kindOf(r) === stat)
    && (!term || r.code.toUpperCase().includes(term) || tileLabel(r).toUpperCase().includes(term));

  // List order: by floor (All floors) or by type, then code; units that point nowhere last.
  const groups = [];
  const floorRank = new Map();
  allRows.forEach(r => { if (!floorRank.has(r.floor)) floorRank.set(r.floor, floorRank.size); });
  items.filter(shown).sort((a, b) => (a.status === 'unlinked') - (b.status === 'unlinked')
    || (chip === ALL ? floorRank.get(a.floor) - floorRank.get(b.floor) : byCode(a.type, b.type)) || byCode(a.code, b.code))
    .forEach(r => {
      const name = chip === ALL ? r.floor : r.status === 'unlinked' ? 'Not linked' : r.type || 'Units';
      let g = groups.find(x => x.name === name);
      if (!g) groups.push(g = { name, rows: [] });
      g.rows.push(r);
    });
  // All floors: each floor's header says how many of its units are available.
  if (chip === ALL) groups.forEach(g => { g.note = `${allRows.filter(r => r.floor === g.name && r.status === 'available').length} available`; });
  const cur = items.find(r => r.code === sel && r.loc) || null;
  const curFloor = cur ? (chipPlan || plans.find(fp => (fp.boxes || []).some(b => b.unitId === cur.code)))?.name || '' : '';
  // The drawing in the middle: the picked floor's. With All floors, the picked
  // unit's floor (the top floor until a unit is picked).
  const curPlan = cur?.box ? plans.find(fp => (fp.boxes || []).includes(cur.box)) || null : null;
  const viewPlan = chip === ALL ? (cur ? curPlan : plans[plans.length - 1] || null) : chipPlan;
  const viewRows = viewPlan === chipPlan ? rows : rowsOf(viewPlan);

  // Whole-page loader (Meta CAPI's): the page shows once, complete, after the
  // shown floor's drawing and its tint layers have loaded, not piece by piece.
  // A failed image still counts as done; 8s caps a slow network.
  const viewUrls = viewPlan?.image?.url ? [viewPlan.image.url, ...Object.values(viewPlan.image.tints || {})].join('\n') : '';
  const [readyUrls, setReadyUrls] = useState(null);
  useEffect(() => {
    if (!viewUrls) return;
    let live = true, left = viewUrls.split('\n').length;
    const done = () => { if (live && --left <= 0) { live = false; setReadyUrls(viewUrls); } };
    const imgs = viewUrls.split('\n').map(u => { const i = new Image(); i.onload = i.onerror = done; i.src = u; return i; });
    const cap = setTimeout(() => { if (live) { live = false; setReadyUrls(viewUrls); } }, 8000);
    return () => { live = false; clearTimeout(cap); imgs.forEach(i => { i.onload = i.onerror = null; }); };
  }, [viewUrls]);
  // Only the first load waits; switching floors after that keeps the page up.
  const [booted, setBooted] = useState(false);
  const pageReady = booted || !proj || !viewUrls || readyUrls === viewUrls;
  if (pageReady && !booted) setBooted(true);

  const select = (code, fromPlan) => {
    setSel(code);
    if (code) setTab('deal');
    setDealCode(!phone && code && items.find(x => x.code === code && x.loc)?.status === 'available' ? code : null);
    if (fromPlan && window.matchMedia('(max-width: 860px)').matches) cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  // See more: Prospects, opened with this project picked in its own filter.
  const seeProspects = () => { seedNextPage({ 'leads.project': proj.name }); nav('leads'); };

  const W = viewPlan?.image?.width || 1, H = viewPlan?.image?.height || 1;
  // A unit's custom status (name + colour, project unitStatuses) or its base one.
  const look = (r) => (r?.loc ? statusLook(proj?.unitStatuses, r.loc.unit) : { status: r?.status, label: STATUS[r?.status]?.label || '', color: null });
  const artLook = (r) => {
    if (!r.loc) return null;
    const l = look(r), key = (l.color ? l.label : r.status).toLowerCase();
    if (key === 'available' && viewPlan?.image?.tints?.available) return { key }; // the plan's own available tint
    return ART.has(key) ? { key } : l.color ? { edge: l.color } : null;
  };
  const tint = (r) => { const l = look(r); return l.color ? { '--st-c': l.color, '--st-ink': l.ink } : undefined; };
  const boxes = viewRows.map(r => ({
    id: r.box.id, ...toPx(r.box, W, H), pts: r.box.shape?.map(([x, y]) => [x * W, y * H]), art: artLook(r), label: r.code, sub: r.size ? `${r.size.toLocaleString('en-IN')} sft` : '', note: r.loc ? look(r).label : '', status: r.status, color: look(r).color, dim: !shown(r),
    aria: r.loc ? `${r.code}, ${r.type}, ${r.size} sqft, ${look(r).label}` : `${r.code}, not linked to a unit`,
  }));
  const selBoxId = cur?.box ? cur.box.id : null;
  const dealOn = !!cur && cur.code === dealCode;
  // Phone sheets: Back (or the phone's back gesture) closes them, as it does other overlays.
  const closeSheet = () => { setDealCode(null); setSel(null); };
  usePageOverlay(phone && dealOn, closeSheet);
  const closePeople = () => setPeopleOpen(false);
  usePageOverlay(phone && peopleOpen, closePeople);
  // A tablet turned to phone width drops a cart the desktop panel opened: on
  // phones the sheet opens from the dock's Reserve now only.
  if (useChanged(phone) && phone && dealCode) setDealCode(null);
  // Phones: the dock takes the bottom of the screen and the scroller shrinks
  // above it (FloorPlan.css); bring the picked tile back into the room left.
  useEffect(() => {
    if (phone && sel) gridRef.current?.querySelector('.fps-tile.on')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [phone, sel]);

  const tileTitle = (r) => [r.code, r.type, r.size ? `${r.size.toLocaleString('en-IN')} sqft` : '', look(r).label].filter(Boolean).join(' · ');

  const chips = [...plans.map(fp => ({ id: fp.id, name: fp.name || 'Floor plan' })), ...(others.length ? [{ id: OTHER, name: plans.length ? 'Other units' : 'All units' }] : [])];
  const chipName = chip === ALL ? 'All floors' : chips.find(c => c.id === chip)?.name || '';
  // Phones: the floor row's arrows step one chip (bottom floor first, Other units last).
  const pos = chips.findIndex(c => c.id === chip);
  // Floor dropdown: top floor first (plans sort bottom-up), units on no plan last,
  // each with how many of its units are available.
  const unitsOn = (c) => (c.id === OTHER ? others.length : (plans.find(fp => fp.id === c.id)?.boxes || []).filter(b => findUnit(proj, b.unitId)).length);
  const freeOn = (c) => (c.id === OTHER ? others.filter(r => r.status === 'available').length
    : (plans.find(fp => fp.id === c.id)?.boxes || []).filter(b => findUnit(proj, b.unitId)?.unit.status === 'available').length);
  const floorList = [...chips.filter(c => c.id !== OTHER).reverse(), ...chips.filter(c => c.id === OTHER)].map(c => ({ ...c, free: freeOn(c), total: unitsOn(c) }));
  // First item: every floor at once.
  if (floorList.length > 1) floorList.unshift({ id: ALL, name: 'All floors', free: floorList.reduce((n, f) => n + f.free, 0) });
  // Floor rail: every floor by name with its unit count, top floor first.
  const railList = floorList.filter(f => f.id !== ALL);
  // The floor's units: the map header's category and From rate, and the Customers tab.
  const real = items.filter(r => r.loc);
  const fRates = real.filter(r => r.price > 0 && r.size > 0).map(r => r.price / r.size);
  const sh = real.map(r => r.loc.unit.sheet).filter(Boolean);
  const fCategory = sh.find(x => x.category)?.category || '';
  // Customers tab, floor: units on it held or bought by a named customer.
  const floorCustomers = real.filter(r => r.loc.unit.clientId || r.loc.unit.clientName).length;
  // Reservation requests (hold_requests), newest first: the project's, for the
  // Customers tab, and the picked unit's, for its booking.
  const projReqs = proj ? getHoldRequests().filter(h => h.propertyId === proj.id) : [];
  const reqs = cur ? projReqs.filter(h => h.unitId === cur.code) : [];
  // The picked unit's live booking: its newest request that is not rejected.
  const booking = cur && cur.status !== 'available' ? reqs.find(h => h.unitId === cur.code && h.status !== 'rejected') || null : null;
  const fTypes = [...new Set(real.map(r => r.type).filter(Boolean))];
  // Unit tiles grouped by type (the left column). Hovering one lights its box
  // on the plan drawing.
  const tiles = () => (
    <>
      {groups.length === 0 && <div className="fpv-none">{items.length ? 'No units match.' : 'No units on this floor yet.'}</div>}
      {groups.map(g => (
        <div key={g.name} className="fps-group">
          {(groups.length > 1 || chip === ALL) && <div className="fpv-ghd"><span>{g.name}</span><span>{g.note ?? g.rows.length}</span></div>}
          <div className="fps-tiles">
            {g.rows.map(r => {
              const on = r.code === sel && !!r.loc;
              return (
                <button key={r.code + (r.box?.id || '')} type="button" className={`fps-tile st-${r.status}${look(r).color ? ' has-c' : ''}${on ? ' on' : ''}`} style={tint(r)} aria-pressed={on}
                  disabled={!r.loc} title={tileTitle(r)} aria-label={tileTitle(r)} onClick={() => select(on ? null : r.code)}
                  onMouseEnter={() => r.box && setHover(r.box.id)} onMouseLeave={() => setHover(null)}>
                  <span className="fps-code">{tileLabel(r)}</span>
                  {r.size > 0 && <span className="fps-sz">{r.size.toLocaleString('en-IN')} sft</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
  const noUnits = !chips.length;

  // Desktop: the three columns fill the screen under the filters, so the page
  // itself stays put; the grid scrolls in its own column while the plan and
  // the unit card stay in view. Not below 1280px, where the columns stack and
  // the page scrolls as before.
  const hasGrid = !!proj && !noUnits;
  useLayoutEffect(() => {
    const el = gridRef.current;
    const sc = el?.closest('.pg-body');
    if (!hasGrid || !el || !sc) return;
    const mq = window.matchMedia('(min-width: 1280px)');
    const fit = () => {
      if (!mq.matches) { setPaneH(0); return; }
      const top = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
      const h = Math.floor(sc.clientHeight - top - parseFloat(getComputedStyle(sc).paddingBottom));
      // Always fit on desktop (the page does not scroll here); never below 320px.
      setPaneH(Math.max(320, h));
    };
    fit();
    // the scroller's size, and anything above the grid that grows or wraps
    const ro = new ResizeObserver(fit);
    ro.observe(sc);
    const inner = el.closest('.pg-inner');
    if (inner) ro.observe(inner);
    mq.addEventListener('change', fit);
    return () => { ro.disconnect(); mq.removeEventListener('change', fit); };
  }, [hasGrid, pageReady]); // pageReady: the grid mounts only once the loader goes


  if (!pageReady) return <Loader className="fpv-loader" title="Loading Available Units…" subtitle="Fetching floor plans, units and their status" />;

  // Phones: the picked unit docks at the bottom; a free one adds Reserve now,
  // which opens its Deal cart (the sheet below).
  // A taken unit: its status and current booking. The desktop panel's card,
  // and the phone sheet's (opened by the dock's status button), whose own
  // header already names the unit, so the card there starts at the status.
  const statusPill = () => <span className="fpu-st"><i className={`fp-dot st-${cur.status}`} style={look(cur).color ? { background: look(cur).color } : undefined} />{look(cur).label}</span>;
  const takenCard = () => (
    <div className="fpu">
      {!phone && <div className="fpu-hd"><h2>{cur.code}</h2>{statusPill()}</div>}
      {/* phones: the sheet's header names the unit; the status sits at the end of the floor line */}
      <p className="fpu-sub">{[curFloor, cur.loc.unit.sheet?.category || cur.type].filter(Boolean).join(' · ')}{phone && statusPill()}</p>
      {(cur.loc.unit.clientName || booking) ? (
        <section className="fpb" aria-label={`Current booking for ${cur.code}`}>
          <h3>Current booking</h3>
          <dl className="fpk">
            {[
              ['Customer', cur.loc.unit.clientName || booking?.clientName || ''],
              ['Phone', booking?.clientPhone || ''],
              ['Requested by', booking?.agentName || cur.loc.unit.heldByName || ''],
              ['Requested', booking?.createdAt ? new Date(booking.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''],
              ['Request', booking ? (booking.status === 'pending' ? 'Waiting for approval' : booking.status === 'approved' ? `Approved by ${booking.decidedBy || 'management'}` : 'Rejected') : ''],
              ['Booked until', cur.loc.unit.holdUntil ? new Date(cur.loc.unit.holdUntil).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : ''],
              ['Offer', booking?.dealTotal ? taka(booking.dealTotal) : ''],
            ].filter(([, v]) => v).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
          {cur.loc.unit.clientId
            ? <button type="button" className="btn btn-g btn-sm btn-full" onClick={() => setPanLead(cur.loc.unit.clientId)}><Mi>contact_phone</Mi>Contact Customer</button>
            : <p className="fpv-none">This booking names no prospect, so there is no record to open.</p>}
        </section>
      ) : <p className="fpv-none">Not available to reserve.</p>}
    </div>
  );
  // Phones: the picked unit docks at the bottom. A free unit's button is
  // Reserve now (the Deal cart); a taken unit's reads its status and opens
  // the same sheet with its details only.
  const free = cur?.status === 'available';
  const dock = phone && cur && !dealOn && (
    <div className="fpv-rsv" aria-live="polite">
      <div><b>{tileLabel(cur)}</b><span>{[cur.size > 0 && `${cur.size.toLocaleString('en-IN')} sft`, look(cur).label].filter(Boolean).join(' · ')}</span></div>
      {free
        ? <button type="button" className="btn btn-p" onClick={() => setDealCode(cur.code)}><Mi>send</Mi>Reserve now</button>
        : <button type="button" className="btn fpv-rsv-st" style={look(cur).color ? { '--st-c': look(cur).color } : undefined} onClick={() => setDealCode(cur.code)}><i className={`fp-dot st-${cur.status}`} />{look(cur).label}</button>}
    </div>
  );
  // Phones: the sheet over the page: a free unit's Deal cart, a taken unit's details.
  const sheet = phone && dealOn && (
    <div className="fps-sheet" role="dialog" aria-modal="true" aria-labelledby="fps-sheet-t">
      <button type="button" className="fps-scrim" aria-label="Close" onClick={closeSheet} />
      <div className="fps-panel">
        <div className="fps-hd">
          <div>
            <h2 id="fps-sheet-t">{free ? 'Reserve ' : ''}<i>{cur.code}</i></h2>
            <p>{[proj.name, curFloor].filter(Boolean).join(' · ')}</p>
          </div>
          <button type="button" className="fps-x" onClick={closeSheet} aria-label="Close"><Mi>close</Mi></button>
        </div>
        {free ? <ProjectConsole key={cur.code} embed={{ projectId: proj.id, variantId: cur.loc.variant.id, unitId: cur.code }} /> : takenCard()}
      </div>
    </div>
  );

  // Customers: three counts, no lists. See more opens Prospects on this project.
  // The desktop's tab; on phones a sheet opened from Manage.
  const peoplePanel = () => (
    <>
      <dl className="fpq">
        <div><dt>Interested in {proj.name || 'this project'}</dt><dd>{peopleReady ? (people.total ?? '-') : '…'}</dd></div>
        <div><dt>Customers on {chipName || 'this floor'}</dt><dd>{floorCustomers}</dd></div>
        <div><dt>Reservation requests</dt><dd>{projReqs.length}</dd></div>
      </dl>
      {/* Each request's customer, newest first, right under its count.
          The row is the toggle: click opens its details, click again closes. */}
      <ul className="fpq-list" aria-label="Reservation requests">
        {projReqs.length ? projReqs.map(h => {
          const open = openReq === h.id;
          // The customer's lead, through the unit it holds, for the location.
          const loc = findUnit(proj, h.unitId);
          const lead = loc?.unit.clientId ? getLead(loc.unit.clientId) : null;
          const when = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
          return (
            <li key={h.id}>
              <button type="button" aria-expanded={open} aria-controls={`fpq-${h.id}`}
                onClick={() => { setOpenReq(open ? null : h.id); if (!open && loc?.unit.clientId) ensureLead(loc.unit.clientId).then(got => got && refreshDB()); }}>
                <b>{h.clientName || 'No customer named'}</b>
                <em>{h.status === 'pending' ? 'Pending' : h.status === 'approved' ? 'Approved' : 'Rejected'}</em>
              </button>
              {open && (
                <dl id={`fpq-${h.id}`} className="fpk">
                  {/* Customer info first; the request's own details after a light rule. */}
                  {[
                    ['Number', h.clientPhone || lead?.phone],
                    ['Location', lead?.city],
                    ['Interest', h.unitId],
                    ['Area', loc ? `${unitSize(loc.unit, loc.variant).toLocaleString('en-IN')} sft` : ''],
                  ].filter(([, v]) => v).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
                  {[
                    ['Offer', h.dealTotal ? taka(h.dealTotal) : ''],
                    ['Rate', h.offerRate ? `${taka(h.offerRate)} / sft` : ''],
                    ['Requested by', h.agentName],
                    ['Requested', when(h.createdAt)],
                    ['Decided', h.decidedAt ? [when(h.decidedAt), h.decidedBy].filter(Boolean).join(' · ') : ''],
                    ['Booked until', when(h.holdUntil)],
                  ].filter(([, v]) => v).map(([k, v], i) => <div key={k} className={i ? undefined : 'sep'}><dt>{k}</dt><dd>{v}</dd></div>)}
                </dl>
              )}
            </li>
          );
        }) : <li className="is-empty">No reservation requests yet.</li>}
      </ul>
      <button type="button" className="btn btn-g btn-sm btn-full" onClick={seeProspects}>See more<Mi>arrow_forward</Mi></button>
    </>
  );
  const peopleSheet = phone && peopleOpen && proj && (
    <div className="fps-sheet fpv-people" role="dialog" aria-modal="true" aria-labelledby="fpv-people-t">
      <button type="button" className="fps-scrim" aria-label="Close" onClick={closePeople} />
      <div className="fps-panel">
        <div className="fps-hd">
          <div><h2 id="fpv-people-t">Customers</h2><p>{proj.name}</p></div>
          <button type="button" className="fps-x" onClick={closePeople} aria-label="Close"><Mi>close</Mi></button>
        </div>
        {peoplePanel()}
      </div>
    </div>
  );

  // One Manage menu: this project's consoles and floor plans, and new
  // properties (Management). Edit / Delete need a single floor picked.
  const manageMenu = () => (
    <Menu label="Manage this project" trigger={<button type="button" className="btn btn-g btn-sm fpv-manage"><Mi>tune</Mi>Manage<Mi>expand_more</Mi></button>}>
      {isAdmin && <MenuItem icon="settings" onSelect={() => pnav.openConsole(proj.id, true)}>Admin console</MenuItem>}
      <MenuItem icon="storefront" onSelect={() => pnav.openConsole(proj.id, false)}>Agent console</MenuItem>
      {phone && <MenuItem icon="group" onSelect={() => setPeopleOpen(true)}>Customers</MenuItem>}
      {isAdmin && (
        <>
          <MenuSep />
          <MenuItem icon="add_location_alt" disabled={canSave === false} onSelect={() => editPlan(null)}>Add floor plan</MenuItem>
          <MenuItem icon="edit" disabled={!chipPlan} hint={chipPlan ? chipPlan.name : 'pick a floor'} onSelect={() => editPlan(chipPlan.id)}>Edit floor plan</MenuItem>
          <MenuItem icon="delete" danger disabled={!chipPlan || canSave === false} onSelect={removePlan}>Delete floor plan</MenuItem>
          <MenuSep />
          <MenuItem icon="add_business" onSelect={pnav.addProperty}>Add property</MenuItem>
        </>
      )}
    </Menu>
  );

  return (
    <div className="fpv">
      <ProjectsToaster />
      {sheet}
      {peopleSheet}
      {dock}
      {isAdmin && canSave === false && (
        <div className="fp-banner" role="status">
          <Mi>database</Mi>
          <div><b>Floor plans need database update 0021.</b> Apply <code>supabase/migrations/0021_floor_plans.sql</code> in Supabase; until then plans can be viewed but not saved.</div>
        </div>
      )}

      {!proj ? (
        <div className="empty"><Mi>map</Mi><p>No projects yet{isAdmin ? ' — add a property first.' : '.'}</p></div>
      ) : (
        <>
          {phone && (
            <div className="fpv-ph">
              {/* One row: Back (the previous page, or the menu it was opened from: BackButton), the page name,
                  and Available Units / the project list. */}
              <div className="fpv-ph-top">
                <BackButton />
                <h1>Available units</h1>
                <div className="fpv-vt" role="group" aria-label="Projects view">
                  <button type="button" aria-pressed aria-label="Available Units"><Mi>grid_on</Mi></button>
                  <button type="button" aria-pressed={false} aria-label="Project list" onClick={() => setProjTab('list')}><Mi>format_list_bulleted</Mi></button>
                </div>
              </div>
              {/* The project, then Manage (tune): consoles, floor plans, Customers. */}
              <div className="fpv-ph-pj">
                <Select className="fpv-projsel" value={proj.id} onChange={pickProject} name="project">
                  <SelectTrigger aria-label="Project"><span className="fpv-projsel-tx">{proj.name || 'Untitled project'}</span></SelectTrigger>
                  <SelectPopover className="fpv-projsel-list">
                    <SelectListBox>
                      {projects.map(p => <SelectItem key={p.id} value={p.id} description={`${p.floorPlans.length} plan${p.floorPlans.length === 1 ? '' : 's'}`}>{p.name || 'Untitled project'}</SelectItem>)}
                    </SelectListBox>
                  </SelectPopover>
                </Select>
                {manageMenu()}
              </div>
            </div>
          )}
          <div className="fpv-bar">
            {!phone && <select name="project" className="fsel fpv-proj" value={proj.id} onChange={e => pickProject(e.target.value)} aria-label="Project">
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name || 'Untitled project'}{p.floorPlans.length ? ` · ${p.floorPlans.length} plan${p.floorPlans.length > 1 ? 's' : ''}` : ' · no plan yet'}</option>
              ))}
            </select>}
            {/* Status chips and search, on the project's row: they filter the map. */}
            {!noUnits && (
              <div className="fpv-filters">
                <div className="fpv-chips" role="group" aria-label="Filter by status">
                  {[['all', 'All', items.length], ['available', 'Available', counts.available], ['hold', 'On hold', counts.hold], ['sold', 'Sold', counts.sold]].map(([k, l, n]) => (
                    <button key={k} type="button" aria-pressed={stat === k} className={`fpv-chip ch-${k}${stat === k ? ' on' : ''}`} onClick={() => setStat(k)}>
                      {k !== 'all' && <i className={`fp-dot st-${k}`} />}{l}<b>{n}</b>
                    </button>
                  ))}
                  {/* the project's own statuses, each in its colour */}
                  {customs.map(c => (
                    <button key={c.id} type="button" aria-pressed={stat === 'c:' + c.id} className={`fpv-chip ch-custom${stat === 'c:' + c.id ? ' on' : ''}`}
                      style={{ '--st-c': c.color }} onClick={() => setStat('c:' + c.id)}>
                      <i className="fp-dot" style={{ background: c.color }} />{c.name}<b>{counts['c:' + c.id]}</b>
                    </button>
                  ))}
                </div>
                {!phone && <label className="fpv-search"><Mi>search</Mi><input name="unit-search" value={q} onChange={e => setQ(e.target.value)} placeholder="Find a unit…" aria-label="Find a unit by name" /></label>}
              </div>
            )}
            {!phone && manageMenu()}
          </div>

          {noUnits ? (
            <div className="empty fpv-empty">
              <Mi>grid_view</Mi>
              <p>No units in {proj.name || 'this project'} yet.</p>
              {isAdmin && <button type="button" className="btn btn-p" onClick={() => editPlan(null)} disabled={canSave === false}><Mi>add</Mi>Add floor plan</button>}
            </div>
          ) : (
            <>
              {/* Phones: the floor row, as a calendar's month row: the floor with its
                  free count, and arrows that step one floor down or up. */}
              {phone && (
                <div className="fpv-fh">
                  <div><h2>{chipName || 'Units'}</h2><small>{counts.available} of {items.length} free{chipPlan && ` · floor ${pos + 1} of ${plans.length}`}</small></div>
                  {/* All floors (old links) is on no step, so both arrows rest */}
                  <button type="button" className="fpv-fh-btn" disabled={pos < 0 || !chips[pos - 1]} aria-label="Floor below" onClick={() => pickPlan(chips[pos - 1].id)}><Mi>arrow_downward</Mi></button>
                  <button type="button" className="fpv-fh-btn" disabled={pos < 0 || !chips[pos + 1]} aria-label="Floor above" onClick={() => pickPlan(chips[pos + 1].id)}><Mi>arrow_upward</Mi></button>
                </div>
              )}
              {/* Floor rail · floor map · details. */}
              <div ref={gridRef} className={`fpv-grid is-rail${viewPlan && !phone ? '' : ' no-plan'}${phone ? ' is-phone' : ''}${paneH ? ' is-fit' : ''}`}
                style={paneH ? { '--fpv-h': `${paneH}px` } : undefined}>
                {/* Floors, top floor first, each with its unit count. Phones use the dropdown above. */}
                {!phone && <nav className="fpr" aria-label="Floors">
                  {railList.map(f => (
                    <button key={f.id} type="button" className={`fpr-btn${f.id === chip ? ' on' : ''}`} aria-pressed={f.id === chip}
                      aria-label={`${f.name}, ${f.total} units, ${f.free} available`} title={`${f.free} available`} onClick={() => pickPlan(f.id)}>
                      <b>{f.name}</b><span>{f.total} unit{f.total === 1 ? '' : 's'}</span>
                    </button>
                  ))}
                </nav>}

                {/* The floor: its boxes drawn as a clean vector map. Units on no
                    plan (or a project without plans) show as tiles instead. */}
                {/* Phones: the console's unit grid, not the drawing (too small to tap). */}
                {viewPlan && !phone ? (
                  <section className="fpv-planwrap fpm" aria-label={`${viewPlan.name || 'Floor plan'} map`}>
                    <header className="fpm-hd">
                      <h3>{viewPlan.name || 'Floor plan'}{fCategory || fTypes.length ? <span> · {fCategory || fTypes.join(', ')}</span> : null}</h3>
                      {fRates.length > 0 && <em>From {taka(Math.min(...fRates))}/sft</em>}
                    </header>
                    {viewPlan.topLabel && <div className="fps-mark">{viewPlan.topLabel}</div>}
                    <FloorPlanCanvas className={`fpv-stage ${viewPlan.image?.source === 'artwork' ? 'is-art' : 'is-bare'}`} image={viewPlan.image} boxes={boxes} label={`${viewPlan.name || 'Floor plan'} of ${proj.name || 'the project'}`}
                      selectedId={selBoxId} hoverId={hover}
                      onSelect={(id) => { const r = viewRows.find(x => x.box.id === id); if (r) select(r.code === sel ? null : r.code, true); }}
                      onHover={setHover} />
                    {viewPlan.bottomLabel && <div className="fps-mark">{viewPlan.bottomLabel}</div>}
                    {/* The artwork paints every shop alike, so a status legend would mislead;
                        the status chips above carry the counts. */}
                    {viewPlan.image?.source !== 'artwork' && <div className="fp-legend fpm-legend">
                      {['available', 'hold', 'sold'].map(s => <span key={s}><i className={`fp-sw st-${s}`} />{STATUS[s].label} ({counts[s]})</span>)}
                      {customs.map(s => <span key={s.id}><i className="fp-sw has-c" style={{ '--st-c': s.color }} />{s.name} ({counts['c:' + s.id]})</span>)}
                      {viewRows.some(r => r.status === 'unlinked') && <span><i className="fp-sw st-unlinked" />Not linked</span>}
                    </div>}
                  </section>
                ) : (
                  <section className="fpv-seats" aria-label={`Units on ${chipName || 'this floor'}`}>
                    <div className="fps-top"><span>{chipName || 'Units'}</span><em>{cur ? `${cur.code} selected` : `${counts.available} available`}</em></div>
                    {tiles()}
                  </section>
                )}

                {/* Phones have no panel: the picked unit docks at the bottom, Customers is in Manage. */}
                {!phone && <aside className="fpv-side">
                  <div className="fpt" role="tablist" aria-label="Unit panel">
                    {[['deal', 'shopping_bag', 'Deal overview'], ['people', 'group', 'Customers']].map(([k, ic, l]) => (
                      <button key={k} type="button" role="tab" id={`fpt-${k}`} aria-controls="fpt-panel" aria-selected={tab === k}
                        className={tab === k ? 'on' : ''} onClick={() => setTab(k)}><Mi>{ic}</Mi>{l}</button>
                    ))}
                  </div>
                  <section id="fpt-panel" role="tabpanel" aria-labelledby={`fpt-${tab}`} className="fpv-card" ref={cardRef} aria-live="polite">
                    {/* Deal overview: an available unit opens its Deal cart right here
                        (the project console's, keyed by unit so each pick starts fresh).
                        A taken unit shows who has it instead. */}
                    {tab === 'deal' && (
                      !cur ? <p className="fpu-none"><Mi>touch_app</Mi>Pick a shop on the map to start a deal.</p>
                      : phone && cur.status === 'available' ? <p className="fpu-none"><Mi>shopping_bag</Mi>{cur.code} is free: Reserve now starts its deal.</p>
                      : dealOn ? <ProjectConsole key={cur.code} embed={{ projectId: proj.id, variantId: cur.loc.variant.id, unitId: cur.code }} />
                      : takenCard()
                    )}
                    {tab === 'people' && peoplePanel()}
                  </section>
                </aside>}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
