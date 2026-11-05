import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { ROLES, STATUS_LABELS } from '../../lib/constants.js';
import { queryLeads, getHoldRequests } from '../../lib/db.js';
import { hasColumn } from '../../lib/supabase.js';
import { planProjects, findUnit, unitSize, unitPrice, placedUnitIds, deleteFloorPlan } from '../../lib/projects.js';
import { toPx, byCode, STATUS, taka, statusLook } from '../../lib/floorPlan.js';
import { Menu, MenuItem, MenuSep } from '../ui/menu.jsx';
import useProjectNav from '../../hooks/useProjectNav.js';
import useChanged from '../../hooks/useChanged.js';
import FloorPlanCanvas from './FloorPlanCanvas.jsx';
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
//  - right: the picked unit's card.
// Picking an available unit and pressing Continue opens the project console
// with that unit already chosen. Management also adds, edits and deletes
// plans (FloorPlanEditor).

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
// shortcut: the floor summary (counts, area, values) under the unit details is
// hidden for now; set true to bring it back.
const SHOW_FLOOR_SUMMARY = false;
const shortCode = (code) => {
  const m = /^([A-Za-z][A-Za-z ]*?)([\s\-_./]*\d.*)$/.exec(code || '');
  if (!m) return code;
  const head = m[1].trim();
  return (SHORT_WORDS[head.toLowerCase().replace(/\s+/g, '')]
    ?? head.split(/\s+/).map(w => (w.length <= 3 ? w : w[0].toUpperCase())).join('')) + m[2];
};

export default function AvailableUnitsView() {
  const { user, dbVersion, refreshDB, planSel, setPlanSel, setPlanEdit, openModal, setPropSel, setConsoleAdmin, setConsoleUnit, setPanLead, modal, consoleUnit } = useApp();
  void dbVersion; // re-read the store when realtime or a save changes it
  const toast = useProjectToast();
  const isAdmin = user?.role === ROLES.MGMT;
  const [stat, setStat] = useState('all');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null);     // unit code
  const [hover, setHover] = useState(null); // box id
  const [canSave, setCanSave] = useState(null); // floor_plans column present (null = still asking)
  const cardRef = useRef(null);
  const pnav = useProjectNav();
  const ctaRef = useRef(null);
  const [ctaOn, setCtaOn] = useState(false); // phone Continue bar: the unit card is still below it
  const gridRef = useRef(null);
  const [paneH, setPaneH] = useState(0); // desktop: the columns' height, fitted to the screen (0 = not fitted)
  const [tab, setTab] = useState('details'); // right panel: Details (unit + floor) | Customers

  // Saving needs migration 0021's column; only Management is told about it.
  useEffect(() => {
    if (!isAdmin) return;
    let live = true;
    hasColumn('properties', 'floor_plans', 'Floor plans cannot be saved. Apply supabase/migrations/0021_floor_plans.sql.')
      .then(ok => { if (live) setCanSave(ok); });
    return () => { live = false; };
  }, [isAdmin]);

  // Customers tab: leads interested in this project, fetched when the tab opens.
  const [people, setPeople] = useState({ key: '', rows: [], total: 0, failed: false });

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

  const peopleKey = tab === 'people' && proj ? `${proj.id}|${user?.id}` : '';
  useEffect(() => {
    if (!peopleKey) return;
    let live = true;
    queryLeads({ user, involved: true, project: proj.name }, { page: 0, size: 25, sort: 'updated' }).then(res => {
      if (live) setPeople(res ? { key: peopleKey, rows: res.rows, total: res.total, failed: false } : { key: peopleKey, rows: [], total: 0, failed: true });
    });
    return () => { live = false; };
  }, [peopleKey]); // eslint-disable-line react-hooks/exhaustive-deps -- proj/user are read through the key
  const peopleReady = people.key === peopleKey;

  const pickProject = (id) => setPlanSel({ projectId: id, planId: null });
  const pickPlan = (id) => setPlanSel({ projectId: proj.id, planId: id });
  const editPlan = (planId) => { setPlanEdit({ projectId: proj.id, planId }); openModal('floorplan-editor'); };
  // An available unit goes along as the console's picked unit.
  const openConsole = (r) => {
    setConsoleAdmin(false);
    setConsoleUnit(r && r.status === 'available' ? { projectId: proj.id, variantId: r.loc.variant.id, unitId: r.code } : null);
    setPropSel(proj.id);
    openModal('project-console');
  };

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
  const flat = groups.flatMap(g => g.rows).filter(r => r.loc);
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
    if (code) setTab('details');
    // The Book This drawer is open beside the page: hand it the newly picked unit.
    const r = code && modal === 'project-console' && consoleUnit ? items.find(x => x.code === code && x.loc) : null;
    if (r?.status === 'available') setConsoleUnit({ projectId: proj.id, variantId: r.loc.variant.id, unitId: r.code });
    if (fromPlan && window.matchMedia('(max-width: 860px)').matches) cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  const openOwner = (r) => (r.loc.unit.clientId ? setPanLead(r.loc.unit.clientId) : select(r.code));
  const step = (d) => {
    if (!flat.length) return;
    const i = flat.findIndex(r => r.code === sel);
    select(flat[(i + d + flat.length) % flat.length].code);
  };

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
  const canGo = cur?.status === 'available';

  // Phones: the Continue bar rides the bottom of the screen only while
  // the unit card, which has its own Continue, is still below the bar's line.
  // Once the card reaches that line the bar goes, so it never covers the card.
  // The bar's box stays mounted (empty, zero height) to mark the line.
  useEffect(() => {
    if (!canGo) return;
    let raf = 0;
    const check = () => {
      raf = 0;
      const c = cardRef.current, b = ctaRef.current;
      if (c && b) setCtaOn(c.getBoundingClientRect().top >= b.getBoundingClientRect().bottom);
    };
    const queue = () => { if (!raf) raf = requestAnimationFrame(check); };
    queue();
    // capture: scroll does not bubble, and the page scroller is an app-shell element
    document.addEventListener('scroll', queue, { capture: true, passive: true });
    window.addEventListener('resize', queue);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('scroll', queue, { capture: true });
      window.removeEventListener('resize', queue);
      setCtaOn(false);
    };
  }, [canGo]);

  const tileTitle = (r) => [r.code, r.type, r.size ? `${r.size.toLocaleString('en-IN')} sqft` : '', look(r).label].filter(Boolean).join(' · ');

  const chips = [...plans.map(fp => ({ id: fp.id, name: fp.name || 'Floor plan' })), ...(others.length ? [{ id: OTHER, name: plans.length ? 'Other units' : 'All units' }] : [])];
  const chipName = chip === ALL ? 'All floors' : chips.find(c => c.id === chip)?.name || '';
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
  // Floor details: the chosen floor's (or every floor's) units by status, area and rate.
  const real = items.filter(r => r.loc);
  const fArea = real.reduce((n, r) => n + (r.size || 0), 0);
  const priced = real.filter(r => r.price > 0 && r.size > 0);
  const fRates = priced.map(r => r.price / r.size);
  const statusRows = [['available', 'Available', counts.available], ['hold', 'On hold', counts.hold], ['sold', 'Sold', counts.sold], ...customs.map(c => ['c:' + c.id, c.name, counts['c:' + c.id], c.color])]
    .filter(([, , n]) => n > 0);
  // Floor totals from the units' imported inventory rows (`sheet`), when they have them.
  const sh = real.map(r => r.loc.unit.sheet).filter(Boolean);
  const sum = (k, rows = sh) => rows.reduce((n, x) => n + (x[k] || 0), 0);
  const wecon = sh.filter(x => x.ownership !== 'Landowner');
  const fCategory = sh.find(x => x.category)?.category || '';
  const owners = real.filter(r => r.loc.unit.clientName || r.loc.unit.heldByName);
  // Reservation requests (hold_requests) of the picked unit only; the store
  // keeps them newest first.
  const reqs = proj && cur ? getHoldRequests().filter(h => h.propertyId === proj.id && h.unitId === cur.code) : [];
  const reqCount = (s) => reqs.filter(h => h.status === s).length;
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

  return (
    <div className="fpv">
      <ProjectsToaster />
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
          <div className="fpv-bar">
            <select name="project" className="fsel fpv-proj" value={proj.id} onChange={e => pickProject(e.target.value)} aria-label="Project">
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name || 'Untitled project'}{p.floorPlans.length ? ` · ${p.floorPlans.length} plan${p.floorPlans.length > 1 ? 's' : ''}` : ' · no plan yet'}</option>
              ))}
            </select>
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
                <label className="fpv-search"><Mi>search</Mi><input name="unit-search" value={q} onChange={e => setQ(e.target.value)} placeholder="Find a unit…" aria-label="Find a unit by name" /></label>
              </div>
            )}
            {/* One Manage menu: this project's consoles and floor plans, and new
                properties (Management). Edit / Delete need a single floor picked. */}
            <Menu label="Manage this project" trigger={<button type="button" className="btn btn-g btn-sm fpv-manage"><Mi>tune</Mi>Manage<Mi>expand_more</Mi></button>}>
              {isAdmin && <MenuItem icon="settings" onSelect={() => pnav.openConsole(proj.id, true)}>Admin console</MenuItem>}
              <MenuItem icon="storefront" onSelect={() => pnav.openConsole(proj.id, false)}>Agent console</MenuItem>
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
          </div>

          {noUnits ? (
            <div className="empty fpv-empty">
              <Mi>grid_view</Mi>
              <p>No units in {proj.name || 'this project'} yet.</p>
              {isAdmin && <button type="button" className="btn btn-p" onClick={() => editPlan(null)} disabled={canSave === false}><Mi>add</Mi>Add floor plan</button>}
            </div>
          ) : (
            <>
              {/* Floor rail · floor map · details. */}
              <div ref={gridRef} className={`fpv-grid is-rail${viewPlan ? '' : ' no-plan'}${paneH ? ' is-fit' : ''}`}
                style={paneH ? { '--fpv-h': `${paneH}px` } : undefined}>
                {/* Floors, top floor first, each with its unit count. */}
                <nav className="fpr" aria-label="Floors">
                  {railList.map(f => (
                    <button key={f.id} type="button" className={`fpr-btn${f.id === chip ? ' on' : ''}`} aria-pressed={f.id === chip}
                      aria-label={`${f.name}, ${f.total} units, ${f.free} available`} title={`${f.free} available`} onClick={() => pickPlan(f.id)}>
                      <b>{f.name}</b><span>{f.total} unit{f.total === 1 ? '' : 's'}</span>
                    </button>
                  ))}
                </nav>

                {/* The floor: its boxes drawn as a clean vector map. Units on no
                    plan (or a project without plans) show as tiles instead. */}
                {viewPlan ? (
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

                <aside className="fpv-side">
                  <div className="fpt" role="tablist" aria-label="Details">
                    {[['details', 'apartment', 'Details'], ['people', 'group', 'Customers']].map(([k, ic, l]) => (
                      <button key={k} type="button" role="tab" id={`fpt-${k}`} aria-controls="fpt-panel" aria-selected={tab === k}
                        className={tab === k ? 'on' : ''} onClick={() => setTab(k)}><Mi>{ic}</Mi>{l}</button>
                    ))}
                  </div>
                  <section id="fpt-panel" role="tabpanel" aria-labelledby={`fpt-${tab}`} className="fpv-card" ref={cardRef} aria-live="polite">
                    {/* Details: the picked unit (its full inventory row, the package price
                        first because that is what gets quoted), then the floor. Each fact
                        shows once. */}
                    {tab === 'details' && (
                      <>
                        {cur ? (() => {
                          const x = cur.loc.unit.sheet || {};
                          const quote = x.package || cur.price || 0;
                          const rows = [
                            ['Area', cur.size ? `${cur.size.toLocaleString('en-IN')} sft` : ''],
                            ['Area range', x.areaRange ? `${x.areaRange} sft` : ''],
                            ['Ownership', x.ownership || ''],
                            ['Bottom price', x.bottomRate ? `${taka(x.bottomRate)} / sft` : '', true],
                            ['Value of shop', x.value ? taka(x.value) : ''],
                            ['Utility', x.utility ? `${taka(x.utility)}${x.utilityRate ? ` · ${taka(x.utilityRate)} / sft` : ''}` : ''],
                            ['Common fund', x.commonFund ? taka(x.commonFund) : ''],
                            ['Total value', x.total ? taka(x.total) : ''],
                            ['Client', cur.loc.unit.clientName || '', true],
                            ['Booked until', cur.loc.unit.holdUntil ? new Date(cur.loc.unit.holdUntil).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : ''],
                            ['Held by', cur.status !== 'available' && !cur.loc.unit.holdUntil ? cur.loc.unit.heldByName || '' : ''],
                          ].filter(([, v]) => v);
                          return (
                            <div className="fpu">
                              <div className="fpu-hd">
                                <h2>{cur.code}</h2>
                                <span className="fpu-st"><i className={`fp-dot st-${cur.status}`} style={look(cur).color ? { background: look(cur).color } : undefined} />{look(cur).label}</span>
                              </div>
                              <p className="fpu-sub">{[curFloor, x.category || cur.type].filter(Boolean).join(' · ')}</p>
                              {quote > 0
                                ? <p className="fpu-price"><b>{taka(quote)}</b><span>package price</span></p>
                                : <p className="fpu-price is-none"><span>{x.ownership === 'Landowner' ? 'Landowner shop, not for sale by Wecon' : 'Not priced yet'}</span></p>}
                              <dl className="fpk">
                                {rows.map(([k, v, sep], i) => <div key={k} className={sep && i ? 'sep' : undefined}><dt>{k}</dt><dd>{v}</dd></div>)}
                              </dl>
                              {cur.status !== 'available' && (cur.loc.unit.clientName || booking) && (
                                <section className="fpb" aria-label={`Current booking for ${cur.code}`}>
                                  <h3>Current booking</h3>
                                  <dl className="fpk">
                                    {[
                                      ['Customer', cur.loc.unit.clientName || booking?.clientName || ''],
                                      ['Phone', booking?.clientPhone || ''],
                                      ['Requested by', booking?.agentName || cur.loc.unit.heldByName || ''],
                                      ['Requested', booking?.createdAt ? new Date(booking.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''],
                                      ['Request', booking ? (booking.status === 'pending' ? 'Waiting for approval' : booking.status === 'approved' ? `Approved by ${booking.decidedBy || 'management'}` : 'Rejected') : ''],
                                      ['Offer', booking?.dealTotal ? taka(booking.dealTotal) : ''],
                                    ].filter(([, v]) => v).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
                                  </dl>
                                  {cur.loc.unit.clientId
                                    ? <button type="button" className="btn btn-g btn-sm btn-full" onClick={() => setPanLead(cur.loc.unit.clientId)}><Mi>contact_phone</Mi>Contact Customer</button>
                                    : <p className="fpv-none">This booking names no prospect, so there is no record to open.</p>}
                                </section>
                              )}
                              <div className="fpu-act">
                                <button type="button" className="btn btn-g btn-sm" onClick={() => step(-1)} aria-label="Previous unit"><Mi>chevron_left</Mi></button>
                                {canGo
                                  ? <button type="button" className="btn btn-p btn-sm" onClick={() => openConsole(cur)}><Mi>shopping_cart</Mi>Reserve This {cur.code}</button>
                                  : <button type="button" className="btn btn-g btn-sm" onClick={() => openConsole(null)}><Mi>storefront</Mi>Open console</button>}
                                <button type="button" className="btn btn-g btn-sm" onClick={() => step(1)} aria-label="Next unit"><Mi>chevron_right</Mi></button>
                              </div>
                            </div>
                          );
                        })() : (
                          <p className="fpu-none"><Mi>touch_app</Mi>Pick a shop on the map to see its price and status.</p>
                        )}

                        {SHOW_FLOOR_SUMMARY && <section className="fpf" aria-label={`${chipName || 'Floor'} details`}>
                          <h3>{chipName || 'Floor'}</h3>
                          <p className="fpu-sub">{[fCategory || fTypes.join(', '), `${real.length} unit${real.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</p>
                          {real.length > 0 && (
                            <div className="fpd-bar" aria-hidden="true">
                              {statusRows.map(([k, , n, c]) => <i key={k} className={`st-${k.startsWith('c:') ? 'c' : k}`} style={{ flexGrow: n, ...(c ? { '--st-c': c } : {}) }} />)}
                            </div>
                          )}
                          <dl className="fpd-rows">
                            {statusRows.map(([k, l, n, c]) => (
                              <div key={k}><dt><i className={`fp-dot${k.startsWith('c:') ? '' : ' st-' + k}`} style={c ? { background: c } : undefined} />{l}</dt>
                                <dd>{n}</dd><dd className="fpd-pct">{Math.round(n / real.length * 100)}%</dd></div>
                            ))}
                          </dl>
                          <dl className="fpk">
                            <div className="sep"><dt>Sellable area</dt><dd>{fArea.toLocaleString('en-IN')} sft</dd></div>
                            <div><dt>Rate / sft</dt><dd>{fRates.length ? (Math.min(...fRates) === Math.max(...fRates) ? taka(fRates[0]) : `${taka(Math.min(...fRates))} - ${Math.round(Math.max(...fRates)).toLocaleString('en-IN')}`) : '-'}</dd></div>
                            {sh.length > 0 && <div><dt>Wecon</dt><dd>{wecon.length} units · {sum('area', wecon).toLocaleString('en-IN')} sft</dd></div>}
                            {sh.length > 0 && <div><dt>Landowner</dt><dd>{sh.length - wecon.length} units · {(sum('area') - sum('area', wecon)).toLocaleString('en-IN')} sft</dd></div>}
                            {sum('value') > 0 && <div className="sep"><dt>Value of shops</dt><dd>{taka(sum('value'))}</dd></div>}
                            {sum('utility') > 0 && <div><dt>Total utility</dt><dd>{taka(sum('utility'))}</dd></div>}
                            {sum('commonFund') > 0 && <div><dt>Common fund</dt><dd>{taka(sum('commonFund'))}</dd></div>}
                            {sum('total') > 0 && <div><dt>Total value</dt><dd>{taka(sum('total'))}</dd></div>}
                            {sum('package') > 0 && <div><dt>Package value</dt><dd>{taka(sum('package'))}</dd></div>}
                            <div className={sum('value') > 0 ? undefined : 'sep'}><dt>Available value</dt><dd>{taka(real.filter(r => r.status === 'available').reduce((n, r) => n + (r.price || 0), 0))}</dd></div>
                            {priced.length < real.length && <div><dt>Not priced</dt><dd>{real.length - priced.length} unit{real.length - priced.length === 1 ? '' : 's'}</dd></div>}
                          </dl>
                        </section>}
                      </>
                    )}
                    {/* Customers: who holds or bought a unit on this floor (from the units),
                        then the project's prospects (leads whose interest names the project). */}
                    {tab === 'people' && (
                        <>
                          <h4 className="fpd-sub is-first">On this floor</h4>
                          {owners.length ? (
                            <ul className="fpp-list">
                              {owners.map(r => (
                                <li key={r.code}><button type="button" onClick={() => openOwner(r)}>
                                  <b>{r.loc.unit.clientName || 'No client named'}</b><span>{r.code} · {look(r).label}{r.loc.unit.heldByName ? ` · ${r.loc.unit.heldByName}` : ''}</span>
                                </button></li>
                              ))}
                            </ul>
                          ) : <p className="fpv-none">No customer is linked to a unit on this floor. Holds and sales made in the project console show here.</p>}
                          <h4 className="fpd-sub">Reservation requests{cur ? ` · ${cur.code}` : ''}</h4>
                          {!cur ? <p className="fpv-none">Pick a unit to see its reservation history.</p> : reqs.length ? (
                            <>
                              <p className="fpr-sum">{reqs.length} requested · {reqCount('pending')} pending · {reqCount('approved')} approved · {reqCount('rejected')} rejected</p>
                              <ul className="fpp-list">
                                {reqs.map(h => (
                                  <li key={h.id}><button type="button" onClick={() => h.clientId ? setPanLead(h.clientId) : select(h.unitId)}>
                                    <b>{h.clientName || 'No client named'}</b>
                                    <span>{[h.status === 'pending' ? 'Pending' : h.status === 'approved' ? 'Approved' : 'Rejected', h.agentName,
                                      h.createdAt ? new Date(h.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : ''].filter(Boolean).join(' · ')}</span>
                                  </button></li>
                                ))}
                              </ul>
                            </>
                          ) : <p className="fpv-none">No reservation requests for {cur.code} yet. Reserve This sends one to management.</p>}
                          <h4 className="fpd-sub">Prospects for {proj.name || 'this project'}{peopleReady && people.total ? ` · ${people.total}` : ''}</h4>
                          {!peopleReady ? <p className="fpv-none" role="status">Loading prospects…</p>
                            : people.failed ? <p className="fpv-none" role="alert">Prospects could not be loaded. Check the connection and open this tab again.</p>
                            : !people.rows.length ? <p className="fpv-none">No leads name this project in their interest yet.</p>
                            : (
                              <ul className="fpp-list">
                                {people.rows.map(l => (
                                  <li key={l.id}><button type="button" onClick={() => setPanLead(l.id)}>
                                    <b>{l.name || l.phone || 'Unnamed lead'}</b><span>{STATUS_LABELS[l.status] || l.status}{l.assignedToName ? ` · ${l.assignedToName}` : ''}</span>
                                  </button></li>
                                ))}
                              </ul>
                            )}
                          {peopleReady && people.total > people.rows.length && <p className="fpv-none">Showing the {people.rows.length} most recently updated.</p>}
                        </>
                    )}
                  </section>
                </aside>

                <div className="fpv-cta" ref={ctaRef}>
                  {canGo && ctaOn && (
                    <button type="button" className="btn btn-p" onClick={() => openConsole(cur)}>
                      <Mi>shopping_cart</Mi>Reserve This {cur.code}
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
