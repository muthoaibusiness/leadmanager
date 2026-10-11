import { useState, useEffect, useRef } from 'react';
import useNavState from '../../hooks/useNavState.js';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { ROLES } from '../../lib/constants.js';
import { hasColumn } from '../../lib/supabase.js';
import { planProjects, findUnit, unitSize, unitPrice, placedUnitIds, deleteFloorPlan } from '../../lib/projects.js';
import { toPx, byCode, STATUS, taka, statusLook } from '../../lib/floorPlan.js';
import { Select, SelectTrigger, SelectValue, SelectPopover, SelectListBox, SelectItem } from '../ui/select.jsx';
import { Menu, MenuItem, MenuSep } from '../ui/menu.jsx';
import useProjectNav from '../../hooks/useProjectNav.js';
import useChanged from '../../hooks/useChanged.js';
import FloorPlanCanvas from './FloorPlanCanvas.jsx';
import ProjectsToaster from './ProjectsToaster.jsx';
import { useProjectToast } from './projectToast.js';
import './FloorPlan.css';

// Projects → Available Units. Every signed-in user who can open Projects sees
// the project's units, each colored by its live status (the same units the
// Projects KPIs, the console grid, holds and deals use), two ways:
//  - Grid: a seat-map of unit tiles, one floor chip per floor plan plus
//    "Other units" for units on no plan. Works with or without plan images.
//  - Plan: the uploaded floor plan drawing with a box per unit.
// Picking an available unit and pressing Continue opens the project console
// with that unit already chosen. Management also adds, edits and deletes
// plans (FloorPlanEditor).

const SQM = 0.09290304;
const OTHER = 'other'; // the chip for units on no floor plan
const ALL = 'all-floors'; // Grid: every floor at once, grouped by floor
const sortPlans = (plans) => [...plans].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || byCode(a.name || '', b.name || ''));
const unitRow = (loc) => ({ code: loc.unit.id, loc, status: loc.unit.status, type: loc.variant.name || '', size: unitSize(loc.unit, loc.variant), price: unitPrice(loc.unit, loc.variant) });

export default function AvailableUnitsView() {
  const { user, dbVersion, refreshDB, planSel, setPlanSel, setPlanEdit, openModal, setPropSel, setConsoleAdmin, setConsoleUnit } = useApp();
  void dbVersion; // re-read the store when realtime or a save changes it
  const toast = useProjectToast();
  const isAdmin = user?.role === ROLES.MGMT;
  const [mode, setMode] = useNavState('units.mode', 'grid'); // 'grid' | 'plan'
  const [stat, setStat] = useState('all');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null);     // unit code
  const [hover, setHover] = useState(null); // box id
  const [canSave, setCanSave] = useState(null); // floor_plans column present (null = still asking)
  const cardRef = useRef(null);
  const pnav = useProjectNav();
  const ctaRef = useRef(null);
  const [ctaOn, setCtaOn] = useState(false); // phone Continue bar: the unit card is still below it

  // Saving needs migration 0021's column; only Management is told about it.
  useEffect(() => {
    if (!isAdmin) return;
    let live = true;
    hasColumn('properties', 'floor_plans', 'Floor plans cannot be saved. Apply supabase/migrations/0021_floor_plans.sql.')
      .then(ok => { if (live) setCanSave(ok); });
    return () => { live = false; };
  }, [isAdmin]);

  const projects = planProjects();
  const proj = projects.find(p => p.id === planSel.projectId) || projects[0] || null;
  const plans = proj ? sortPlans(proj.floorPlans) : [];
  const plan = plans.find(fp => fp.id === planSel.planId) || plans[0] || null;
  const customs = proj?.unitStatuses || []; // the project's own unit statuses

  // Units on no floor plan: the grid's last chip ("All units" when there are no plans).
  const placed = proj ? placedUnitIds(proj) : new Set();
  const others = proj ? proj.variants.flatMap(v => (v.units || []).filter(u => !placed.has(u.id)).map(u => unitRow({ variant: v, unit: u }))) : [];
  // Grid opens on All floors (no floor picked yet) when there is more than one.
  const floorCount = plans.length + (others.length ? 1 : 0);
  const chip = mode === 'plan' ? plan?.id || null
    : (planSel.planId === ALL || !planSel.planId) && floorCount > 1 ? ALL
    : planSel.planId === OTHER && others.length ? OTHER
    : plan?.id || (others.length ? OTHER : null);
  const chipPlan = chip === OTHER || chip === ALL ? null : plan;
  if (useChanged(`${proj?.id}|${chip}`)) { setSel(null); setStat('all'); setQ(''); }

  // Every plan image of the open project, fetched once the browser is idle, so
  // switching floors (or to Plan view) shows the drawing at once instead of
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
  const term = q.trim().toUpperCase();
  const shown = (r) => (stat === 'all' || kindOf(r) === stat) && (!term || r.code.toUpperCase().includes(term));

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

  const select = (code, fromPlan) => {
    setSel(code);
    if (fromPlan && mode === 'plan' && window.matchMedia('(max-width: 860px)').matches) cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  const step = (d) => {
    if (!flat.length) return;
    const i = flat.findIndex(r => r.code === sel);
    select(flat[(i + d + flat.length) % flat.length].code);
  };

  const W = chipPlan?.image?.width || 1, H = chipPlan?.image?.height || 1;
  // A unit's custom status (name + colour, project unitStatuses) or its base one.
  const look = (r) => (r?.loc ? statusLook(proj?.unitStatuses, r.loc.unit) : { status: r?.status, label: STATUS[r?.status]?.label || '', color: null });
  const tint = (r) => { const c = look(r).color; return c ? { '--st-c': c } : undefined; };
  const boxes = rows.map(r => ({
    id: r.box.id, ...toPx(r.box, W, H), label: r.code, sub: r.size ? `${r.size.toLocaleString('en-IN')} sqft` : '', status: r.status, color: look(r).color, dim: !shown(r),
    aria: r.loc ? `${r.code}, ${r.type}, ${r.size} sqft, ${look(r).label}` : `${r.code}, not linked to a unit`,
  }));
  const selBoxId = cur?.box ? cur.box.id : null;
  const canGo = cur?.status === 'available';

  // Phones (grid): the Continue bar rides the bottom of the screen only while
  // the unit card, which has its own Continue, is still below the bar's line.
  // Once the card reaches that line the bar goes, so it never covers the card.
  // The bar's box stays mounted (empty, zero height) to mark the line.
  useEffect(() => {
    if (mode !== 'grid' || !canGo) return;
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
  }, [mode, canGo]);

  const tileTitle = (r) => [r.code, r.type, r.size ? `${r.size.toLocaleString('en-IN')} sqft` : '', look(r).label].filter(Boolean).join(' · ');

  const chips = mode === 'plan' ? plans.map(fp => ({ id: fp.id, name: fp.name || 'Floor plan' }))
    : [...plans.map(fp => ({ id: fp.id, name: fp.name || 'Floor plan' })), ...(others.length ? [{ id: OTHER, name: plans.length ? 'Other units' : 'All units' }] : [])];
  const chipName = chip === ALL ? 'All floors' : chips.find(c => c.id === chip)?.name || '';
  // Floor dropdown: top floor first (plans sort bottom-up), units on no plan last,
  // each with how many of its units are available.
  const freeOn = (c) => (c.id === OTHER ? others.filter(r => r.status === 'available').length
    : (plans.find(fp => fp.id === c.id)?.boxes || []).filter(b => findUnit(proj, b.unitId)?.unit.status === 'available').length);
  const floorList = [...chips.filter(c => c.id !== OTHER).reverse(), ...chips.filter(c => c.id === OTHER)].map(c => ({ ...c, free: freeOn(c) }));
  // First item: every floor at once (Grid; picking it in Plan view switches to Grid).
  if (floorList.length > 1) floorList.unshift({ id: ALL, name: 'All floors', free: floorList.reduce((n, f) => n + f.free, 0) });
  const pickFloor = (id) => { if (id === ALL && mode === 'plan') setMode('grid'); pickPlan(id); };
  // Unit tiles grouped by type: Grid view's main area and Plan view's side panel.
  // Hovering one lights its box on the plan drawing.
  const tiles = () => (
    <>
      {groups.length === 0 && <div className="fpv-none">{items.length ? 'No units match.' : `No units on this ${mode === 'grid' ? 'floor' : 'plan'} yet.`}</div>}
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
                  <span className="fps-code">{r.code}</span>
                  {r.size > 0 && <span className="fps-sz">{r.size.toLocaleString('en-IN')} sft</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
  const noUnits = mode === 'grid' && !chips.length;
  const noPlan = mode === 'plan' && !plan;


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
            <div className="fpv-mode" role="group" aria-label="View">
              {[['grid', 'grid_view', 'Grid'], ['plan', 'map', 'Plan']].map(([k, ic, l]) => (
                <button key={k} type="button" aria-pressed={mode === k} className={mode === k ? 'on' : ''} onClick={() => setMode(k)}><Mi>{ic}</Mi>{l}</button>
              ))}
            </div>
            {/* Floor: one dropdown for both views, top floor first, each floor
                with its available count. */}
            {floorList.length > 0 && (
              <Select className="fpv-floorsel" value={chip || ''} onChange={pickFloor} name="floor">
                <SelectTrigger aria-label="Floor"><SelectValue placeholder="Pick a floor" /></SelectTrigger>
                <SelectPopover>
                  <SelectListBox>
                    {floorList.map(f => <SelectItem key={f.id} value={f.id} description={`${f.free} available`}>{f.name}</SelectItem>)}
                  </SelectListBox>
                </SelectPopover>
              </Select>
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

          {noPlan || noUnits ? (
            <div className="empty fpv-empty">
              <Mi>{noUnits ? 'grid_view' : 'map'}</Mi>
              <p>{noUnits ? `No units in ${proj.name || 'this project'} yet.` : `No floor plans yet for ${proj.name || 'this project'}.`}</p>
              {isAdmin && noPlan && <button type="button" className="btn btn-p" onClick={() => editPlan(null)} disabled={canSave === false}><Mi>add</Mi>Add floor plan</button>}
            </div>
          ) : (
            <div className={`fpv-grid${mode === 'grid' ? ' is-seats' : ''}`}>
              <div className="fpv-planwrap">
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

                {mode === 'grid' ? (
                  // The chosen floor's units, between the plan's optional landmarks.
                  <>
                    <section className="fpv-seats" aria-label={`Units on ${chipName || 'this floor'}`}>
                      {chipPlan?.topLabel && <div className="fps-mark">{chipPlan.topLabel}</div>}
                      {tiles()}
                      {chipPlan?.bottomLabel && <div className="fps-mark">{chipPlan.bottomLabel}</div>}
                    </section>
                    <div className="fp-legend">
                      <span><i className="fps-sw st-available" />Available</span>
                      <span><i className="fps-sw is-sel" />Selected</span>
                      <span><i className="fps-sw st-hold" />On hold</span>
                      <span><i className="fps-sw st-sold" />Sold</span>
                      {customs.map(s => <span key={s.id}><i className="fps-sw has-c" style={{ '--st-c': s.color }} />{s.name}</span>)}
                    </div>
                  </>
                ) : (
                  <>
                    <FloorPlanCanvas className="fpv-stage" image={chipPlan.image} boxes={boxes} label={`${chipPlan.name || 'Floor plan'} of ${proj.name || 'the project'}`}
                      selectedId={selBoxId} hoverId={hover}
                      onSelect={(id) => { const r = rows.find(x => x.box.id === id); if (r) select(r.code, true); }}
                      onHover={setHover} />
                    <div className="fp-legend">
                      {['available', 'hold', 'sold'].map(s => <span key={s}><i className={`fp-sw st-${s}`} />{STATUS[s].label}</span>)}
                      {customs.map(s => <span key={s.id}><i className="fp-sw has-c" style={{ '--st-c': s.color }} />{s.name}</span>)}
                      {rows.some(r => r.status === 'unlinked') && <span><i className="fp-sw st-unlinked" />Not linked</span>}
                    </div>
                  </>
                )}
              </div>

              <aside className="fpv-side">
                <section className="fpv-card" ref={cardRef} aria-live="polite">
                  {cur ? (
                    <>
                      <div className="fpv-eyebrow">{curFloor ? `${curFloor} · ` : ''}{cur.type}</div>
                      <div className="fpv-name"><h2>{cur.code}</h2><span className={`fp-pill st-${cur.status}${look(cur).color ? ' has-c' : ''}`} style={tint(cur)}>{look(cur).label}</span></div>
                      <div className="fpv-area">
                        <span className="big">{cur.size ? cur.size.toLocaleString('en-IN') : '—'}</span><span className="unit">sqft</span>
                        {cur.size > 0 && <span className="unit">· {(cur.size * SQM).toFixed(1)} m²</span>}
                      </div>
                      <dl className="fpv-meta">
                        <dt>Price</dt><dd>{cur.price ? <>{taka(cur.price)}{cur.size > 0 && <span className="fpv-rate"> · {taka(cur.price / cur.size)}/sqft</span>}</> : '—'}</dd>
                        <dt>Floor</dt><dd>{curFloor || '—'}</dd>
                        {cur.loc.unit.clientName && <><dt>Client</dt><dd>{cur.loc.unit.clientName}</dd></>}
                        {cur.loc.unit.holdUntil
                          ? <><dt>Booked</dt><dd>Until {new Date(cur.loc.unit.holdUntil).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</dd></>
                          : cur.loc.unit.heldByName && cur.status !== 'available' && <><dt>By</dt><dd>{cur.loc.unit.heldByName}</dd></>}
                      </dl>
                      <div className="fpv-nav">
                        <button type="button" className="btn btn-g btn-sm" onClick={() => step(-1)}><Mi>chevron_left</Mi>Prev</button>
                        <button type="button" className="btn btn-g btn-sm" onClick={() => step(1)}>Next<Mi>chevron_right</Mi></button>
                      </div>
                      {canGo
                        ? <button type="button" className="btn btn-p btn-sm fpv-open" onClick={() => openConsole(cur)}><Mi>shopping_cart</Mi>Continue with {cur.code}</button>
                        : <button type="button" className="btn btn-g btn-sm fpv-open" onClick={() => openConsole(null)}><Mi>storefront</Mi>Open project console</button>}
                    </>
                  ) : (
                    <div className="fpv-hint"><Mi>touch_app</Mi><span>{mode === 'grid' ? 'Pick an available unit to continue with it.' : 'Pick a unit on the plan or in the list to see its details.'}</span></div>
                  )}
                </section>

                {mode === 'plan' && (
                  <section className="fpv-seats" aria-label="Units on this plan">{tiles()}</section>
                )}
              </aside>

              {mode === 'grid' && (
                <div className="fpv-cta" ref={ctaRef}>
                  {canGo && ctaOn && (
                    <button type="button" className="btn btn-p" onClick={() => openConsole(cur)}>
                      <Mi>shopping_cart</Mi>Continue with {cur.code}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
