import { useState, useEffect, useRef } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { ROLES } from '../../lib/constants.js';
import { hasColumn } from '../../lib/supabase.js';
import { planProjects, findUnit, unitSize, unitPrice, deleteFloorPlan } from '../../lib/projects.js';
import { toPx, byCode, STATUS, taka } from '../../lib/floorPlan.js';
import useChanged from '../../hooks/useChanged.js';
import FloorPlanCanvas from './FloorPlanCanvas.jsx';
import ProjectsToaster from './ProjectsToaster.jsx';
import { useProjectToast } from './projectToast.js';
import './FloorPlan.css';

// Projects → Available Units. Every signed-in user who can open Projects sees
// the project's floor plans with each unit's box colored by its live status
// (the same units the Projects KPIs, the console grid, holds and deals use).
// Management also adds, edits and deletes plans (FloorPlanEditor).

const SQM = 0.09290304;
const sortPlans = (plans) => [...plans].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || byCode(a.name || '', b.name || ''));

export default function AvailableUnitsView() {
  const { user, dbVersion, refreshDB, planSel, setPlanSel, setPlanEdit, openModal, setPropSel, setConsoleAdmin } = useApp();
  void dbVersion; // re-read the store when realtime or a save changes it
  const toast = useProjectToast();
  const isAdmin = user?.role === ROLES.MGMT;
  const [stat, setStat] = useState('all');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null);     // unit code
  const [hover, setHover] = useState(null); // box id
  const [canSave, setCanSave] = useState(null); // floor_plans column present (null = still asking)
  const cardRef = useRef(null);

  // Saving needs migration 0020's column; only Management is told about it.
  useEffect(() => {
    if (!isAdmin) return;
    let live = true;
    hasColumn('properties', 'floor_plans', 'Floor plans cannot be saved. Apply supabase/migrations/0020_floor_plans.sql.')
      .then(ok => { if (live) setCanSave(ok); });
    return () => { live = false; };
  }, [isAdmin]);

  const projects = planProjects();
  const proj = projects.find(p => p.id === planSel.projectId) || projects[0] || null;
  const plans = proj ? sortPlans(proj.floorPlans) : [];
  const plan = plans.find(fp => fp.id === planSel.planId) || plans[0] || null;
  if (useChanged(`${proj?.id}|${plan?.id}`)) { setSel(null); setStat('all'); setQ(''); }

  const pickProject = (id) => setPlanSel({ projectId: id, planId: null });
  const pickPlan = (id) => setPlanSel({ projectId: proj.id, planId: id });
  const editPlan = (planId) => { setPlanEdit({ projectId: proj.id, planId }); openModal('floorplan-editor'); };
  const openConsole = () => { setConsoleAdmin(false); setPropSel(proj.id); openModal('project-console'); };

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

  // Each box, joined to its unit.
  const rows = (plan?.boxes || []).map(b => {
    const loc = proj ? findUnit(proj, b.unitId) : null;
    const status = loc ? loc.unit.status : 'unlinked';
    return { box: b, code: b.unitId || '—', loc, status, type: loc?.variant.name || '', size: loc ? unitSize(loc.unit, loc.variant) : 0, price: loc ? unitPrice(loc.unit, loc.variant) : 0 };
  });
  const counts = { available: 0, hold: 0, sold: 0 };
  rows.forEach(r => { if (counts[r.status] != null) counts[r.status]++; });
  const term = q.trim().toUpperCase();
  const shown = (r) => (stat === 'all' || r.status === stat) && (!term || r.code.toUpperCase().includes(term));

  // List order: by type, then code; units that point nowhere last.
  const groups = [];
  rows.filter(shown).sort((a, b) => (a.status === 'unlinked') - (b.status === 'unlinked') || byCode(a.type, b.type) || byCode(a.code, b.code))
    .forEach(r => {
      const name = r.status === 'unlinked' ? 'Not linked' : r.type || 'Units';
      let g = groups.find(x => x.name === name);
      if (!g) groups.push(g = { name, rows: [] });
      g.rows.push(r);
    });
  const flat = groups.flatMap(g => g.rows).filter(r => r.loc);
  const cur = rows.find(r => r.code === sel && r.loc) || null;

  const select = (code, fromPlan) => {
    setSel(code);
    if (fromPlan && window.matchMedia('(max-width: 860px)').matches) cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  const step = (d) => {
    if (!flat.length) return;
    const i = flat.findIndex(r => r.code === sel);
    select(flat[(i + d + flat.length) % flat.length].code);
  };

  const W = plan?.image?.width || 1, H = plan?.image?.height || 1;
  const boxes = rows.map(r => ({
    id: r.box.id, ...toPx(r.box, W, H), label: r.code, status: r.status, dim: !shown(r),
    aria: r.loc ? `${r.code}, ${r.type}, ${r.size} sqft, ${STATUS[r.status].label}` : `${r.code}, not linked to a unit`,
  }));
  const selBoxId = cur ? cur.box.id : null;

  return (
    <div className="fpv">
      <ProjectsToaster />
      {isAdmin && canSave === false && (
        <div className="fp-banner" role="status">
          <Mi>database</Mi>
          <div><b>Floor plans need database update 0020.</b> Apply <code>supabase/migrations/0020_floor_plans.sql</code> in Supabase; until then plans can be viewed but not saved.</div>
        </div>
      )}

      {!proj ? (
        <div className="empty"><Mi>map</Mi><p>No projects yet{isAdmin ? ' — add a property first.' : '.'}</p></div>
      ) : (
        <>
          <div className="fpv-bar">
            <select className="fsel fpv-proj" value={proj.id} onChange={e => pickProject(e.target.value)} aria-label="Project">
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name || 'Untitled project'}{p.floorPlans.length ? ` · ${p.floorPlans.length} plan${p.floorPlans.length > 1 ? 's' : ''}` : ' · no plan yet'}</option>
              ))}
            </select>
            {plans.length > 0 && (
              <div className="fpv-floors" role="tablist" aria-label="Floor plans">
                {plans.map(fp => (
                  <button key={fp.id} type="button" role="tab" aria-selected={fp.id === plan?.id} className={`fpv-floor${fp.id === plan?.id ? ' on' : ''}`} onClick={() => pickPlan(fp.id)}>{fp.name || 'Floor plan'}</button>
                ))}
              </div>
            )}
            {isAdmin && plan && (
              <div className="fpv-admin">
                <button type="button" className="btn btn-g btn-sm" onClick={() => editPlan(plan.id)}><Mi>edit</Mi>Edit plan</button>
                <button type="button" className="btn btn-g btn-sm fpv-del" onClick={removePlan} disabled={canSave === false} aria-label="Delete plan" title="Delete plan"><Mi>delete</Mi></button>
              </div>
            )}
          </div>

          {!plan ? (
            <div className="empty fpv-empty">
              <Mi>map</Mi>
              <p>No floor plans yet for {proj.name || 'this project'}.</p>
              {isAdmin && <button type="button" className="btn btn-p" onClick={() => editPlan(null)} disabled={canSave === false}><Mi>add</Mi>Add floor plan</button>}
            </div>
          ) : (
            <div className="fpv-grid">
              <div className="fpv-planwrap">
                <div className="fpv-filters">
                  <div className="fpv-chips" role="group" aria-label="Filter by status">
                    {[['all', 'All', rows.length], ['available', 'Available', counts.available], ['hold', 'On hold', counts.hold], ['sold', 'Sold', counts.sold]].map(([k, l, n]) => (
                      <button key={k} type="button" aria-pressed={stat === k} className={`fpv-chip ch-${k}${stat === k ? ' on' : ''}`} onClick={() => setStat(k)}>
                        {k !== 'all' && <i className={`fp-dot st-${k}`} />}{l}<b>{n}</b>
                      </button>
                    ))}
                  </div>
                  <label className="fpv-search"><Mi>search</Mi><input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a unit…" aria-label="Find a unit by name" /></label>
                </div>
                <FloorPlanCanvas className="fpv-stage" image={plan.image} boxes={boxes} label={`${plan.name || 'Floor plan'} of ${proj.name || 'the project'}`}
                  selectedId={selBoxId} hoverId={hover}
                  onSelect={(id) => { const r = rows.find(x => x.box.id === id); if (r) select(r.code, true); }}
                  onHover={setHover} />
                <div className="fp-legend">
                  {['available', 'hold', 'sold'].map(s => <span key={s}><i className={`fp-sw st-${s}`} />{STATUS[s].label}</span>)}
                  {rows.some(r => r.status === 'unlinked') && <span><i className="fp-sw st-unlinked" />Not linked</span>}
                </div>
              </div>

              <aside className="fpv-side">
                <section className="fpv-card" ref={cardRef} aria-live="polite">
                  {cur ? (
                    <>
                      <div className="fpv-eyebrow">{plan.name || 'Floor plan'} · {cur.type}</div>
                      <div className="fpv-name"><h2>{cur.code}</h2><span className={`fp-pill st-${cur.status}`}>{STATUS[cur.status].label}</span></div>
                      <div className="fpv-area">
                        <span className="big">{cur.size ? cur.size.toLocaleString('en-IN') : '—'}</span><span className="unit">sqft</span>
                        {cur.size > 0 && <span className="unit">· {(cur.size * SQM).toFixed(1)} m²</span>}
                      </div>
                      <dl className="fpv-meta">
                        <dt>Price</dt><dd>{cur.price ? <>{taka(cur.price)}{cur.size > 0 && <span className="fpv-rate"> · {taka(cur.price / cur.size)}/sqft</span>}</> : '—'}</dd>
                        <dt>Floor</dt><dd>{plan.name || '—'}</dd>
                        {cur.loc.unit.clientName && <><dt>Client</dt><dd>{cur.loc.unit.clientName}</dd></>}
                        {cur.loc.unit.holdUntil
                          ? <><dt>Booked</dt><dd>Until {new Date(cur.loc.unit.holdUntil).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</dd></>
                          : cur.loc.unit.heldByName && cur.status !== 'available' && <><dt>By</dt><dd>{cur.loc.unit.heldByName}</dd></>}
                      </dl>
                      <div className="fpv-nav">
                        <button type="button" className="btn btn-g btn-sm" onClick={() => step(-1)}><Mi>chevron_left</Mi>Prev</button>
                        <button type="button" className="btn btn-g btn-sm" onClick={() => step(1)}>Next<Mi>chevron_right</Mi></button>
                      </div>
                      <button type="button" className="btn btn-p btn-sm fpv-open" onClick={openConsole}><Mi>storefront</Mi>Open project console</button>
                    </>
                  ) : (
                    <div className="fpv-hint"><Mi>touch_app</Mi><span>Pick a unit on the plan or in the list to see its details.</span></div>
                  )}
                </section>

                <section className="fpv-list" aria-label="Units on this plan">
                  {groups.length === 0 && <div className="fpv-none">{rows.length ? 'No units match.' : 'No units on this plan yet.'}</div>}
                  {groups.map(g => (
                    <div key={g.name} className="fpv-group">
                      <div className="fpv-ghd"><span>{g.name}</span><span>{g.rows.length}</span></div>
                      {g.rows.map(r => (
                        <button key={r.box.id} type="button" className={`fpv-row${r.code === sel && r.loc ? ' on' : ''}`} aria-pressed={r.code === sel && !!r.loc}
                          disabled={!r.loc} onClick={() => select(r.code)} onMouseEnter={() => setHover(r.box.id)} onMouseLeave={() => setHover(null)}>
                          <i className={`fp-dot st-${r.status}`} />
                          <span className="fpv-code">{r.code}</span>
                          <span className="fpv-st">{STATUS[r.status].short}</span>
                          <span className="fpv-sz">{r.size ? `${r.size.toLocaleString('en-IN')} sqft` : ''}</span>
                        </button>
                      ))}
                    </div>
                  ))}
                </section>
              </aside>
            </div>
          )}
        </>
      )}
    </div>
  );
}
