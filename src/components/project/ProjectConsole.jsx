import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { getProjectById, setUnitStatus, reservedTag, toProject, pricedVariant, unitPrice, unitSize, planProjects, projectFloors } from '../../lib/projects.js';
import { statusLook } from '../../lib/floorPlan.js';
import { Building2, ChevronRight, ChevronsUpDown, DoorOpen, Layers, Store } from 'lucide-react';
import { Select, SelectTrigger, SelectValue, SelectPopover, SelectListBox, SelectItem } from '../ui/select.jsx';
import { createHoldRequest, getLeads, getLead } from '../../lib/db.js';
import { computeDeal, emptyDeal } from '../../lib/deal.js';
import ProjectCatalog from './ProjectCatalog.jsx';
import ProjectInvoice from './ProjectInvoice.jsx';
import { downloadOfferPdf } from '../../lib/offerPdf.js';
import AddLeadModal from '../modals/AddLeadModal.jsx';
import { Ring, Meter } from '../dashboards/MobileBits.jsx';
import { useProjectToast } from './projectToast.js';
import './ProjectConsole.css';
import { fmtBDT } from '../../lib/helpers.js';
import { ROLES } from '../../lib/constants.js';
import useLeadBook from '../../hooks/useLeadBook.js';
import useChanged from '../../hooks/useChanged.js';
import useNow from '../../hooks/useNow.js';

const STAGES = [
  { key: 'offer', label: 'Offer' },
  { key: 'hold', label: 'Hold' },
  { key: 'payment', label: 'Payment' },
  { key: 'closed', label: 'Closed' },
];
const stageIdx = (s) => ({ browse: 0, offer: 0, hold: 1, payment: 2, closed: 3 }[s] ?? 0);
// Short BDT — crore / lakh (e.g. 1.25 Cr, 12.5 L).
const crShort = (n) => (n >= 1e7 ? (n / 1e7).toFixed(2) + ' Cr' : n >= 1e5 ? (n / 1e5).toFixed(1) + ' L' : fmtBDT(n));
// Compact amount, trailing-zero trimmed (8 L, 3.5 L, 1.25 Cr).
const amtShort = (n) => (n >= 1e7 ? +(n / 1e7).toFixed(2) + ' Cr' : n >= 1e5 ? +(n / 1e5).toFixed(1) + ' L' : fmtBDT(n));

// Live countdown to a target ISO time → {d,h,m,s} string, or 'expired'.
// Ticks only while `active`: the console stays mounted on every page.
function useCountdown(targetMs, active) {
  const diff = targetMs - useNow(1000, active);
  if (diff <= 0) return 'expired';
  const d = Math.floor(diff / 86400000), h = Math.floor(diff / 3600000) % 24, m = Math.floor(diff / 60000) % 60, s = Math.floor(diff / 1000) % 60;
  return `${d}d ${h}h ${m}m ${s}s`;
}

// One breadcrumb step: an icon, the current value and a dropdown of the
// alternatives. `current` marks the last step (the unit being sold).
export function Crumb({ label, icon: Icon, items, value, onChange, placeholder, disabled, current }) {
  return (
    <Select className={`pcb-crumb${current ? ' is-current' : ''}`} value={value} onChange={onChange} placeholder={placeholder} disabled={disabled}>
      <SelectTrigger aria-label={label}><Icon size={16} aria-hidden="true" /><SelectValue /><ChevronsUpDown className="pcb-ud" size={14} aria-hidden="true" /></SelectTrigger>
      <SelectPopover>
        <SelectListBox>
          {items.map(it => <SelectItem key={it.value} value={it.value} description={it.description} disabled={it.disabled}>{it.label}</SelectItem>)}
        </SelectListBox>
      </SelectPopover>
    </Select>
  );
}

export default function ProjectConsole() {
  const { modal, closeModal, propSel, setPropSel, propDraft, setPropDraft, user, refreshDB, dbVersion, consoleAdmin, consoleUnit, setConsoleUnit } = useApp();
  const toast = useProjectToast();
  const isOpen = modal === 'project-console';
  // Gated on isOpen — App.jsx mounts this on every page and it renders nothing
  // until opened, so an ungated call pulled the whole lead book everywhere.
  useLeadBook(isOpen);
  const isAdmin = user?.role === ROLES.MGMT;
  // Book This (Available Units) hands over a unit: open as a side drawer with
  // only the Deal cart, like the Prospects lead panel. Anywhere else: the full console.
  const dealOnly = !!consoleUnit && !consoleAdmin;

  const [admin, setAdmin] = useState(false); // admin "back view" toggle
  const [vid, setVid] = useState(null);
  const [floorSel, setFloorSel] = useState(null); // floor name in the breadcrumb
  const [deal, setDeal] = useState(emptyDeal);
  const [lightbox, setLightbox] = useState(null);
  const [cq, setCq] = useState(''); // client search query
  const [clientTab, setClientTab] = useState('search'); // 'search' | 'create'
  const [leadOpen, setLeadOpen] = useState(false); // Create lead form over the console
  const [moreOpen, setMoreOpen] = useState(false); // Deal cart: More details (prices, add-ons, attachments)
  const [startedAt] = useState(() => Date.now()); // fast-close window anchor
  const [actsEl, setActsEl] = useState(null); // header slot for the catalog's Discard / Save

  void dbVersion;
  // Add Property opens an unsaved draft (propDraft) instead of a stored record;
  // it becomes a real project only when ProjectCatalog saves it.
  const stored = isOpen && propSel ? getProjectById(propSel) : null;
  const isNew = isOpen && !stored && !!propDraft && propDraft.id === propSel;
  const p = stored || (isNew ? toProject(propDraft) : null);
  // dbVersion: `p` can be the same cached object after an in-place edit.
  const variants = useMemo(() => (p ? p.variants : []), [p, dbVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  // Floors (plan, else sheet floor, else Other units); a type is offered only
  // on floors it has units on, so the picked type follows the picked floor.
  const floors = useMemo(() => (p ? projectFloors(p) : []), [p, dbVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  // Opens on the 1st Floor when there is one, as Available Units does.
  const floor = floors.find(f => f.name === floorSel) || floors.find(f => /^1st\b/i.test(f.name)) || floors[0] || null;
  const onFloor = (u) => !floor || floor.ids.has(u.id);
  const hasFloor = (v) => v.units.some(onFloor);
  const variant = variants.find(v => v.id === vid && hasFloor(v)) || variants.find(hasFloor) || variants[0] || null;

  // reset when opening a different project. Available Units → Continue hands
  // over a unit (consoleUnit) to start the deal with, if it is still available.
  const opened = useChanged(`${isOpen}:${propSel}`) && isOpen;
  if (opened) {
    const pick = consoleUnit && consoleUnit.projectId === propSel ? variants.find(v => v.id === consoleUnit.variantId) : null;
    const pickOk = !!pick?.units.some(u => u.id === consoleUnit.unitId && u.status === 'available');
    setVid(pick ? pick.id : null);
    setFloorSel(pick ? (floors.find(f => f.ids.has(consoleUnit.unitId))?.name ?? null) : null);
    // The lead panel's unit picker also hands over its lead as the client.
    const cl = consoleUnit?.client ? { client: consoleUnit.client } : {};
    setDeal(pickOk ? { ...emptyDeal(), ...cl, variantId: pick.id, unitId: consoleUnit.unitId } : emptyDeal());
    setCq(''); setClientTab('search'); setLeadOpen(false); setAdmin(!!consoleAdmin);
  }
  // Drawer open, another available unit clicked on the page behind: follow it.
  // The picked client stays; a deal already in the cart is never swapped.
  if (useChanged(consoleUnit?.unitId) && isOpen && !opened && dealOnly && consoleUnit && deal.stage === 'browse') {
    const v = variants.find(x => x.id === consoleUnit.variantId);
    if (v?.units.some(u => u.id === consoleUnit.unitId && u.status === 'available')) {
      setVid(v.id);
      setFloorSel(floors.find(f => f.ids.has(consoleUnit.unitId))?.name ?? null);
      setDeal(d => ({ ...emptyDeal(), client: d.client, variantId: v.id, unitId: consoleUnit.unitId }));
    }
  }
  // keep deal.variantId in sync; reset unit when variant changes. Skipped on
  // the opening render: `variant` there still reflects the old vid.
  if (useChanged(variant?.id) && variant && !opened) setDeal(d => (d.variantId === variant.id ? d : { ...emptyDeal(), variantId: variant.id }));

  // returning to the console after admin edits — sanitize the deal so it can't
  // reference a variant/unit that was deleted or is no longer available.
  const proj = useChanged(admin) && !admin && propSel ? getProjectById(propSel) : null;
  if (proj) {
    setDeal(d => {
      const v = proj.variants.find(x => x.id === d.variantId);
      if (!v) return { ...emptyDeal(), variantId: proj.variants[0]?.id || null };
      let nd = d;
      if (d.unitId && !v.units.some(u => u.id === d.unitId && u.status === 'available')) nd = { ...nd, unitId: null };
      const addons = {};
      Object.keys(d.addons || {}).forEach(k => { if (proj.addons.some(a => a.id === k)) addons[k] = d.addons[k]; });
      if (Object.keys(addons).length !== Object.keys(d.addons || {}).length) nd = { ...nd, addons };
      return nd;
    });
  }

  const locked = deal.stage !== 'browse'; // editing locked once in the cart
  // The picked unit was sold or held from Available Units or by someone else
  // (realtime): drop it from a deal not yet sent, so it is never offered.
  if (!locked && deal.unitId && variant && !variant.units.some(u => u.id === deal.unitId && u.status === 'available')) setDeal(d => ({ ...d, unitId: null }));
  const fastTarget = startedAt + (p?.fastCloseDays || 0) * 86400000;
  const countdown = useCountdown(fastTarget, isOpen);

  // The picked unit's own size and price, when it has them, price the deal.
  const pv = variant && deal.unitId ? pricedVariant(variant, deal.unitId) : variant;
  const calc = pv ? computeDeal(deal, pv, p) : null;

  // ✕, the backdrop and Esc all close through here. Closing never writes: an
  // unsaved new project just goes away, and unsaved catalog edits are dropped
  // only after the user confirms. A save in flight blocks closing.
  const catalogRef = useRef(null);
  // Offer step: shrink the offer sheet just enough that the Deal cart fits its
  // column with no scroll (never below 70%; past that the rail scrolls as before).
  const railRef = useRef(null);
  const sheetRef = useRef(null);
  const [sheetK, setSheetK] = useState(1);
  const offerStep = isOpen && deal.stage === 'offer';
  useLayoutEffect(() => {
    const rail = railRef.current, box = sheetRef.current;
    if (!offerStep || !rail || !box) { setSheetK(1); return; }
    const fit = () => {
      const sheet = box.firstElementChild;
      if (!sheet) return;
      const natural = sheet.scrollHeight;                    // unscaled height
      const shown = natural * (Number(box.dataset.k) || 1);  // height at the current scale
      const over = rail.scrollHeight - rail.clientHeight;    // how much the rail overflows now
      const k = Math.max(0.7, Math.min(1, (shown - over) / natural));
      setSheetK(Math.round(k * 100) / 100);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(rail);
    return () => ro.disconnect();
  }, [offerStep]);
  // In the Projects tab the question is a goey-toast confirmation that never
  // blocks the editor. Opened from another tab (Hold Requests), an existing
  // project keeps the browser confirm it always had.
  const [discardAsk, setDiscardAsk] = useState(false);
  const askIdRef = useRef(null);      // the open confirmation toast
  const askReturnRef = useRef(null);  // what had focus before it opened
  const backdropRef = useRef(false);  // this press started (and ended) on the backdrop
  const dropAsk = () => {
    const id = askIdRef.current;
    askIdRef.current = null;
    setDiscardAsk(false);
    if (id != null) toast.dismiss(id);
  };
  const closeNow = () => {
    dropAsk();
    askReturnRef.current = null;
    if (propDraft) setPropDraft(null);
    if (consoleUnit) setConsoleUnit(null); // the next opening starts with no unit picked
    closeModal();
  };
  // Stay (and Esc) hand focus back to where it was, so typing carries on.
  const cancelAsk = () => {
    const el = askReturnRef.current;
    askReturnRef.current = null;
    dropAsk();
    if (el && el.isConnected && el !== document.body) el.focus({ preventScroll: true });
  };
  // A save already in flight would land anyway, so Exit waits it out.
  const discardDraft = () => {
    if (catalogRef.current?.isSaving()) return false;
    closeNow();
  };
  const askDiscard = () => {
    if (askIdRef.current != null) return; // already asking: never stack a second toast
    askReturnRef.current = document.activeElement;
    setDiscardAsk(true);
    askIdRef.current = toast.confirm({
      title: 'Exit without saving?',
      description: isNew ? 'This new property will be lost.' : 'Your changes will be lost.',
      confirmLabel: 'Exit',
      cancelLabel: 'Stay',
      onConfirm: discardDraft,
      onCancel: cancelAsk,
      onDismiss: (id) => { if (askIdRef.current === id) { askIdRef.current = null; setDiscardAsk(false); } },
    });
  };
  const requestClose = () => {
    const cat = catalogRef.current;
    if (cat?.isSaving()) return;
    if (cat?.isDirty()) {
      if (toast.on) { askDiscard(); return; }
      if (!window.confirm('Exit without saving? Your changes will be lost.')) return;
    }
    closeNow();
  };
  // Pressing or typing anywhere in the editor puts the question away, so
  // editing carries on without a Stay first. Tab and modifier keys don't,
  // which keeps the toast's buttons reachable from the keyboard.
  const dismissAsk = (e) => {
    if (!discardAsk) return;
    if (e.type === 'keydown' && ['Tab', 'Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
    askReturnRef.current = null;
    dropAsk();
  };
  // Capture phase, so this runs before App.jsx's global Esc handler (which
  // would close the modal directly and skip the check above) and before goey's
  // own Escape handler. Esc first backs out of an open confirmation.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (leadOpen) return; // the Create lead form on top handles its own Esc
      // Book This drawer: closes only on its ✕ (browser Back still works); Esc
      // is left to whatever else has focus, and never reaches App's global close.
      if (dealOnly) { if (!(e.target instanceof Element && e.target.closest('[role="listbox"]'))) e.stopPropagation(); return; }
      // An open dropdown list (the PROJECT TYPE select) closes itself first.
      if (e.target instanceof Element && e.target.closest('[role="listbox"]')) return;
      e.stopPropagation();
      if (discardAsk) cancelAsk();
      else requestClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  if (!isOpen) return <div className="mov" onClick={closeModal} />;
  if (!p) return <div className="mov on" onClick={closeModal} />;

  const img0 = p.media?.images?.[0]?.url || p.images?.[0] || '';
  const docs = p.media?.docs || (p.documents || []).filter(d => /pdf|doc/i.test(d.type || d.url || ''));
  const links = p.media?.links || (p.driveLink ? [{ label: 'Drive', url: p.driveLink }] : []);
  const photos = p.media?.images || (p.images || []).map(u => ({ url: u }));

  const totalUnits = variants.reduce((s, v) => s + v.units.length, 0);
  const availUnits = variants.reduce((s, v) => s + v.units.filter(u => u.status === 'available').length, 0);
  const floorUnits = variant ? variant.units.filter(onFloor) : [];
  const vAvail = floorUnits.filter(u => u.status === 'available').length;
  // Floor (bottom) price + total project value are commercially sensitive — only
  // Team Leads and Management see them; initial/meeting agents do not.
  const canSeeFloor = [ROLES.TL, ROLES.MGMT, ROLES.MASTER].includes(user?.role);
  // Total project value at list rate = Σ units (a unit's own price, else its
  // block's rate × size).
  const projectValue = variants.reduce((s, v) => s + v.units.reduce((t, u) => t + unitPrice(u, v), 0), 0);

  // Offers can only go to an existing customer — search this user's leads.
  const myLeads = getLeads(user);
  const matches = cq.trim()
    ? myLeads.filter(l => ((l.name || '') + ' ' + (l.phone || '')).toLowerCase().includes(cq.toLowerCase())).slice(0, 6)
    : [];

  const setUnit = (u) => { if (!locked && u.status === 'available') setDeal(d => ({ ...d, unitId: u.id })); };
  const pickFloor = (name) => { setFloorSel(name); setDeal(d => ({ ...d, unitId: null })); };
  // A unit's tone on the 1st Floor artwork (Available Units ART, FloorPlan.css
  // .art-*): known statuses by name, any other project status by its own colour.
  const artOf = (u) => {
    const lk = statusLook(p.unitStatuses, u), key = (lk.color ? lk.label : u.status).toLowerCase();
    return ['available', 'hold', 'sold', 'landowner', 'reserved'].includes(key) ? { cls: 'art-' + key } : { cls: 'art-custom', style: { '--art-edge': lk.color } };
  };
  const unitWord = (u) => (statusLook(p.unitStatuses, u).color ? statusLook(p.unitStatuses, u).label : u.status === 'sold' ? 'Sold' : u.status === 'hold' ? 'On hold' : 'Available');
  const setRate = (k, v) => setDeal(d => ({ ...d, [k]: v === '' ? null : parseFloat(v) }));
  const toggleAddon = (id) => { if (!locked) setDeal(d => ({ ...d, addons: { ...d.addons, [id]: !d.addons[id] } })); };

  // ── funnel actions ──
  const addToCart = () => { if (deal.unitId && deal.client.id) setDeal(d => ({ ...d, stage: 'offer' })); };
  const holdUnit = () => {
    // TODO(role-gate): if calc.belowFloor, require manager-approval permission before allowing checkout.
    setUnitStatus(p.id, variant.id, deal.unitId, 'hold', { user, client: { id: deal.client.id, name: deal.client.name }, note: 'Hold requested', tag: reservedTag(p) });
    createHoldRequest({
      propertyId: p.id, propertyName: p.name, variantId: variant.id, variantName: variant.name, unitId: deal.unitId,
      clientName: deal.client.name, clientPhone: deal.client.phone, dealTotal: calc.dealTotal, offerRate: calc.offerRate,
    }, user);
    refreshDB();
    setDeal(d => ({ ...d, stage: 'hold', holdAt: Date.now() }));
    toast.success('Hold requested', `Unit ${deal.unitId} sent to management for approval.`, 'Hold request sent to management');
  };
  const releaseHold = () => {
    setUnitStatus(p.id, variant.id, deal.unitId, 'available', { user });
    refreshDB();
    setDeal(d => ({ ...d, stage: 'offer' }));
    toast.success('Unit released', `Unit ${deal.unitId} is available again.`, `Unit ${deal.unitId} released`);
  };
  const confirmDeal = () => {
    setUnitStatus(p.id, variant.id, deal.unitId, 'sold', { user, client: { id: deal.client.id, name: deal.client.name } });
    refreshDB();
    setDeal(d => ({ ...d, stage: 'closed' }));
    toast.success('Deal closed', `Unit ${deal.unitId} sold to ${deal.client.name}.`, `Deal closed · Unit ${deal.unitId} sold`);
  };
  const newDeal = () => setDeal({ ...emptyDeal(), variantId: variant?.id });

  const plans = calc ? [
    { id: 'full', name: 'Full payment', sub: '−1% extra', total: calc.dealTotal * 0.99, lines: [`One-time ${fmtBDT(calc.dealTotal * 0.99)}`] },
    { id: 'install', name: 'Installments', sub: '30% down + 12', total: calc.dealTotal, lines: [`Down ${fmtBDT(calc.dealTotal * 0.3)}`, `12 × ${fmtBDT(calc.dealTotal * 0.7 / 12)}`] },
    { id: 'loan', name: 'Bank loan', sub: '20% down, 80% financed', total: calc.dealTotal, lines: [`Down ${fmtBDT(calc.dealTotal * 0.2)}`, `Financed ${fmtBDT(calc.dealTotal * 0.8)}`] },
  ] : [];

  return (
    // Outside click = pressed AND released on the backdrop. A text selection
    // dragged across the modal edge is clicked on .mov too, and must not count.
    <div className={`mov on${dealOnly ? ' pc-drawer' : ''}`}
      onPointerDown={e => { backdropRef.current = e.target === e.currentTarget; }}
      onPointerUp={e => { backdropRef.current = backdropRef.current && e.target === e.currentTarget; }}
      onClick={e => { if (!dealOnly && backdropRef.current && e.target === e.currentTarget) requestClose(); backdropRef.current = false; }}>
      <div className={`modal pc-modal${dealOnly ? ' is-deal' : ''}`} onClick={e => e.stopPropagation()} onPointerDownCapture={dismissAsk} onKeyDownCapture={dismissAsk}>
        <div className={`pc-top${admin || isNew ? ' pc-top-edit' : ''}`}>
          <div className="pc-top-l"><Mi>storefront</Mi><b>{p.name || (isNew ? 'New property' : '')}</b></div>
          <div className="pc-top-r">
            {isAdmin && !isNew && !dealOnly && (
              <div className="pc-toggle">
                <button className={!admin ? 'on' : ''} onClick={() => setAdmin(false)}>Agent console</button>
                <button className={admin ? 'on' : ''} onClick={() => setAdmin(true)}>Admin console</button>
              </div>
            )}
            {/* The catalog editor's Discard and Save (ProjectCatalog portals
                them in). A new property's Discard closes it, so it takes the
                place of ✕; an existing project keeps ✕ to leave the console. */}
            {(admin || isNew) && <div className="pc-acts" ref={setActsEl} />}
            {!isNew && <button className="m-x" onClick={requestClose} aria-label="Close" title="Close"><Mi>close</Mi></button>}
          </div>
        </div>

        {admin || isNew ? (
          <div className="pc-adminview">
            <ProjectCatalog
              ref={catalogRef}
              actionsEl={actsEl}
              project={p}
              isNew={isNew}
              onDone={isNew ? requestClose : () => setAdmin(false)}
              onSaved={() => { dropAsk(); if (isNew) setPropDraft(null); setAdmin(false); }}
            />
          </div>
        ) : (
          <div className="pc-body">
            {/* ── main column ── (left out in the Book This drawer) */}
            {!dealOnly && <div className="pc-main">
              {/* hero — photo split when a cover exists, else green blueprint */}
              {img0 ? (
                <div className="phs">
                  <div className="phs-photo" style={{ backgroundImage: `url(${img0})` }}>
                    <div className="phs-badge"><span className="pch-dot" />{availUnits} of {totalUnits} available</div>
                  </div>
                  <div className="phs-info">
                    <h2 className="phs-name">{p.name}</h2>
                    <div className="phs-loc"><Mi>place</Mi>{p.address || [p.area, p.district].filter(Boolean).join(' · ')}</div>
                    <div className="phs-facts">
                      <div className="phs-fact"><span className="pch-fl">Handover</span><span className="pch-fv">{p.handover || '—'}</span></div>
                      <div className="phs-fact"><span className="pch-fl">Total units</span><span className="pch-fv">{totalUnits}</span></div>
                      {canSeeFloor && <div className="phs-fact"><span className="pch-fl">Project value</span><span className="pch-fv">{crShort(projectValue)}</span></div>}
                      <div className="phs-fact"><span className="pch-fl">Approval</span><span className="pch-fv">{p.approval ? <>{p.approval} ✓</> : '—'}</span></div>
                      {p.listing && <div className="phs-fact"><span className="pch-fl">Listing</span><span className="pch-fv">#{p.listing}</span></div>}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="pch">
                  <div className="pch-top">
                    <div className="pch-badge"><span className="pch-dot" />{availUnits} of {totalUnits} units available</div>
                    <svg className="pch-art" viewBox="0 0 200 150" fill="none" stroke="rgba(255,255,255,.55)" strokeWidth="2" strokeLinejoin="round">
                      <path d="M40 52 L100 22 L160 52" />
                      <rect x="40" y="52" width="120" height="88" />
                      <line x1="80" y1="52" x2="80" y2="140" /><line x1="120" y1="52" x2="120" y2="140" />
                      <line x1="40" y1="81" x2="160" y2="81" /><line x1="40" y1="110" x2="160" y2="110" />
                      <rect x="49" y="59" width="22" height="14" /><rect x="89" y="88" width="22" height="14" /><rect x="129" y="117" width="22" height="14" />
                    </svg>
                    <div className="pch-id">
                      <h2 className="pch-name">{p.name}</h2>
                      <div className="pch-loc"><Mi>place</Mi>{p.address || [p.area, p.district].filter(Boolean).join(' · ')}</div>
                    </div>
                  </div>
                  <div className="pch-facts">
                    <div className="pch-fact"><span className="pch-fl">Handover</span><span className="pch-fv">{p.handover || '—'}</span></div>
                    <div className="pch-fact"><span className="pch-fl">Total units</span><span className="pch-fv">{totalUnits}</span></div>
                    {canSeeFloor && <div className="pch-fact"><span className="pch-fl">Project value</span><span className="pch-fv">{crShort(projectValue)}</span></div>}
                    <div className="pch-fact"><span className="pch-fl">Approval</span><span className="pch-fv">{p.approval ? <>{p.approval} ✓</> : '—'}</span></div>
                    {p.listing && <div className="pch-fact"><span className="pch-fl">Listing</span><span className="pch-fv">#{p.listing}</span></div>}
                  </div>
                </div>
              )}

              {/* where am I: Project > Floor > Type > Unit, each a dropdown */}
              {variants.length > 0 && (
                <nav className="pcb" aria-label="Unit location">
                  <ol>
                    <li>
                      <Crumb label="Project" icon={Building2} value={p.id} disabled={locked || isNew} onChange={setPropSel}
                        items={planProjects().map(x => ({ value: x.id, label: x.name || 'Untitled project' }))} />
                    </li>
                    {floors.length > 1 && (
                      <li>
                        <ChevronRight className="pcb-sep" size={16} aria-hidden="true" />
                        <Crumb label="Floor" icon={Layers} value={floor?.name} disabled={locked} onChange={pickFloor}
                          items={floors.map(f => ({ value: f.name, label: f.name,
                            description: `${variants.reduce((n, v) => n + v.units.filter(u => f.ids.has(u.id) && u.status === 'available').length, 0)} open` }))} />
                      </li>
                    )}
                    <li>
                      <ChevronRight className="pcb-sep" size={16} aria-hidden="true" />
                      <Crumb label="Unit type" icon={Store} value={variant?.id} disabled={locked} onChange={setVid}
                        items={variants.filter(hasFloor).map(v => ({ value: v.id, label: v.name,
                          description: `${v.units.filter(u => onFloor(u) && u.status === 'available').length} open` }))} />
                    </li>
                    <li>
                      <ChevronRight className="pcb-sep" size={16} aria-hidden="true" />
                      <Crumb label="Unit" icon={DoorOpen} value={deal.unitId || undefined} placeholder="Pick a unit" disabled={locked} current
                        onChange={id => { const u = floorUnits.find(x => x.id === id); if (u) setUnit(u); }}
                        items={floorUnits.map(u => ({ value: u.id, label: u.id, description: unitWord(u), disabled: u.status !== 'available' }))} />
                    </li>
                  </ol>
                </nav>
              )}

              {/* unit grid */}
              {variant && (
                <div className="pc-sec pc-sec-units">
                  <div className="pc-sec-hd">{variant.name}{floor && floors.length > 1 ? ` · ${floor.name}` : ''} <span className="pc-sec-sub">{vAvail} available</span></div>
                  {/* Status counts for this floor and type, counted as Available Units
                      does: a unit with a project status (Landowner, Reserved, or any
                      the owner adds) counts there, not in its base, so they add up. */}
                  <div className="pcu-legend">
                    {[
                      ['available', 'Available', 'art-available'], ['hold', 'On hold', 'art-hold'], ['sold', 'Sold', 'art-sold'],
                      ...(p.unitStatuses || []).map(st => ['c:' + st.id, st.name, ['landowner', 'reserved'].includes(st.name.toLowerCase()) ? 'art-' + st.name.toLowerCase() : 'art-custom', st.color]),
                    ].map(([k, label, cls, color]) => {
                      const n = floorUnits.filter(u => (u.tag && (p.unitStatuses || []).some(st => st.id === u.tag) ? 'c:' + u.tag : u.status) === k).length;
                      return (
                        <span key={k} className="pcu-stat">
                          <span className="pcu-stat-l"><i className={`pcu-sw ${cls}`} style={cls === 'art-custom' ? { '--art-edge': color } : undefined} />{label}</span>
                          <b>{n}</b>
                        </span>
                      );
                    })}
                  </div>
                  <div className="pcu-grid">
                    {floorUnits.map(u => {
                      // A custom status (project unitStatuses) shows its own name and colour.
                      const lk = statusLook(p.unitStatuses, u);
                      const blocked = u.status !== 'available';
                      const t = [lk.color ? lk.label : u.status === 'sold' ? 'Sold' : u.status === 'hold' ? 'On hold' : 'Available'];
                      if (u.size > 0) t.push(u.size + ' sqft');
                      if (u.clientName) t.push('Client: ' + u.clientName);
                      if (u.holdUntil) t.push('Booked by management until ' + new Date(u.holdUntil).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }));
                      else if (u.heldByName) t.push('By: ' + u.heldByName);
                      return (
                        <button key={u.id} type="button" className={`pcu-t ${artOf(u).cls}${deal.unitId === u.id ? ' on' : ''}${blocked ? ' blocked' : ''}`}
                          style={artOf(u).style} aria-pressed={deal.unitId === u.id}
                          title={t.join('\n')} aria-label={t.join(', ')} aria-disabled={blocked || locked} onClick={() => setUnit(u)}>
                          <span className="pcu-code">{u.id.replace(/^U-/, '')}</span>
                          {unitSize(u, variant) > 0 && <span className="pcu-sz">{unitSize(u, variant).toLocaleString('en-IN')} sft</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

            </div>}

            {/* ── deal cart rail ── */}
            <aside className="pc-rail" ref={railRef}>
                {/* Deal overview (in place of the old stage tracker), the dashboard Overview
                    card's layout: the unit and where it is, the deal total, then progress. */}
                {variant && calc && deal.unitId && (() => {
                  const lead = deal.client.id ? getLead(deal.client.id) : null;
                  const vsList = pv.listRate > 0 ? Math.round((calc.offerRate / pv.listRate) * 100) : 0;
                  const stageN = stageIdx(deal.stage) + (deal.client.id ? 1 : 0);
                  return (
                    <div className="pdo">
                      {/* Left: the title. Right: the unit number, mall and floor under it. */}
                      <div className="pdo-hd">
                        <span className="pc-rail-ttl"><Mi>shopping_bag</Mi>Deal overview</span>
                        <div className="pdo-where">
                          <span className="pdo-unit">{deal.unitId}</span>
                          <span className="pdo-lbl">{(p.name || '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())}{floor ? ` · ${floor.name}` : ''}</span>
                        </div>
                      </div>
                      <div className="pdo-grid">
                        <div><span>Deal total</span><b>{crShort(calc.dealTotal)}</b></div>
                        <div><span>Rate</span><b>{fmtBDT(calc.offerRate)}<small>/sqft</small></b></div>
                        <div><span>Size</span><b>{pv.size.toLocaleString('en-IN')} sft</b></div>
                      </div>
                      <div className="pdo-cust">
                        {deal.client.id ? (
                          <>
                            <b>{deal.client.name}</b>
                            <span>{[deal.client.phone, lead?.city].filter(Boolean).join(' · ') || 'No phone or location'}</span>
                          </>
                        ) : <span className="pdo-none">No customer yet. Pick or create one below.</span>}
                      </div>
                      <div className="pdo-foot">
                        <Ring pct={Math.round((stageN / STAGES.length) * 100)} label={`Deal progress ${stageN} of ${STAGES.length}`} />
                        <div className="pdo-meters">
                          <Meter label="Progress" value={`Step ${Math.max(1, stageN)} of ${STAGES.length}`} pct={(stageN / STAGES.length) * 100} />
                          <Meter label="Offer vs list" value={vsList ? `${vsList}%` : '—'} pct={vsList} />
                        </div>
                      </div>
                    </div>
                  );
                })()}

              {/* Offer (moved from the main column): one line, your offer left,
                  the customer's offer right. Editable while browsing with a unit picked. */}
              {variant && calc && deal.stage === 'browse' && deal.unitId && (
                <div className="pco-duo">
                  <div className="pco-side">
                    <label className="pco-lbl" htmlFor="pco-offer">Your offer</label>
                    <div className="pco-input">
                      <span className="pco-cur">৳</span>
                      <input id="pco-offer" type="number" inputMode="decimal" disabled={locked} value={deal.offerRate ?? ''} placeholder={Math.round(pv.listRate)} onChange={e => setRate('offerRate', e.target.value)} />
                      <span className="pco-suf">/sqft</span>
                    </div>
                    <div className="pco-total">{crShort(calc.offerValue)}</div>
                  </div>
                  <div className="pco-side">
                    <label className="pco-lbl" htmlFor="pco-cust">Customer offer</label>
                    <div className="pco-input">
                      <span className="pco-cur">৳</span>
                      <input id="pco-cust" type="number" inputMode="decimal" disabled={locked} value={deal.custRate ?? ''} placeholder="—" onChange={e => setRate('custRate', e.target.value)} />
                      <span className="pco-suf">/sqft</span>
                    </div>
                    {calc.customerTotal != null ? (
                      <div className="pco-total alt">{crShort(calc.customerTotal)}
                        <small className={calc.gap === 0 ? '' : calc.gap > 0 ? 'pc-gap-hi' : 'pc-gap-lo'}>{calc.gap === 0 ? 'matched' : `${calc.gap > 0 ? 'you +' : 'client +'}${crShort(Math.abs(calc.gap))}`}</small>
                      </div>
                    ) : <div className="pco-total alt is-none">No offer yet</div>}
                  </div>
                </div>
              )}

              {/* More details: list / bottom price, fast-close, add-ons, deal total and
                  attachments, moved here from the main column. Hidden until asked for,
                  and left out once the offer (invoice) is showing. */}
              {variant && deal.stage === 'browse' && (
                <div className="pc-more">
                  <button type="button" className="pc-more-btn" aria-expanded={moreOpen} aria-controls="pc-more-body" onClick={() => setMoreOpen(o => !o)}>
                    <Mi>{moreOpen ? 'expand_less' : 'expand_more'}</Mi>{moreOpen ? 'Hide details' : 'More details'}
                  </button>
                  {moreOpen && (
                    <div id="pc-more-body" className="pc-more-body">
                    {/* price & offer */}
                    {variant && calc && (
                      <div className="pc-sec pc-offer">
                        <div className={`pco-prices${canSeeFloor ? '' : ' solo'}`}>
                          <div className="pco-box">
                            <div className="pco-box-l">Top price · list</div>
                            <div className="pco-box-v">{fmtBDT(pv.listRate)} <small>/ sqft</small></div>
                            <div className="pco-box-s">Total {crShort(pv.listRate * pv.size)}</div>
                          </div>
                          {canSeeFloor && (
                            <div className="pco-box floor">
                              <div className="pco-box-l">Bottom price · floor</div>
                              {pv.floorRate > 0 ? (
                                <>
                                  <div className="pco-box-v">{fmtBDT(pv.floorRate)} <small>/ sqft</small></div>
                                  <div className="pco-box-s">Total {crShort(pv.floorRate * pv.size)}</div>
                                </>
                              ) : (
                                <div className="pco-box-v" style={{ opacity: .55 }}>Not set</div>
                              )}
                            </div>
                          )}
                        </div>

                        <button className={`pc-fast${deal.fastClose ? ' on' : ''}`} disabled={locked} onClick={() => setDeal(d => ({ ...d, fastClose: !d.fastClose }))}>
                          <Mi>bolt</Mi>
                          <span>Fast-close incentive · −{p.fastClosePct || 0}%</span>
                          <span className="pc-cd">{deal.fastClose ? countdown : `${p.fastCloseDays || 0}d window`}</span>
                        </button>

                        {(p.addons || []).length > 0 && (
                          <div className="pca-sec">
                            <div className="pca-hd"><span className="pca-ttl">Add-ons</span><span className="pca-note">Not auto-applied · prices set for this project</span></div>
                            <div className="pca-grid">
                              {(p.addons || []).map(a => {
                                const on = !!deal.addons[a.id];
                                return (
                                  <button key={a.id} className={`pca${on ? ' on' : ''}`} disabled={locked} onClick={() => toggleAddon(a.id)}>
                                    <span className="pca-ic"><Mi>{a.icon || 'add'}</Mi></span>
                                    <span className="pca-nm">{a.name}</span>
                                    <span className="pca-amt">+ {amtShort(a.amount)}</span>
                                    <span className="pca-plus"><Mi>{on ? 'check' : 'add'}</Mi></span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        <div className="pc-total">
                          <div><span className="pc-total-l">Deal total</span>
                            <span className="pc-total-bd">{(calc.discountPct || calc.addOnsTotal)
                              ? `${calc.discountPct ? `−${calc.discountPct}%` : ''}${calc.discountPct && calc.addOnsTotal ? ' · ' : ''}${calc.addOnsTotal ? `+${amtShort(calc.addOnsTotal)} add-ons` : ''}`
                              : 'property only'}</span></div>
                          <div className="pc-total-v">{fmtBDT(calc.dealTotal)}</div>
                        </div>
                        {calc.belowFloor && <div className="pc-warn"><Mi>warning</Mi>Below floor — needs manager approval</div>}
                      </div>
                    )}

                    {/* attachments */}
                    <div className="pc-sec">
                      <div className="pc-sec-hd att-hd"><Mi>attach_file</Mi>Attachments</div>
                      {photos.length === 0 && docs.length === 0 && links.length === 0 ? (
                        <div className="pc-empty">No files yet. Add them in <b>Admin · Catalog → Media</b>.</div>
                      ) : (
                        <>
                          {photos.length > 0 && (
                            <div className="att-grp">
                              <div className="att-gh"><Mi>image</Mi>Photos · {photos.length}</div>
                              <div className="att-thumbs">{photos.map((m, i) => <img key={i} src={m.url} alt={m.label || ''} onClick={() => setLightbox(m.url)} />)}</div>
                            </div>
                          )}
                          {docs.length > 0 && (
                            <div className="att-grp">
                              <div className="att-gh"><Mi>description</Mi>Documents · {docs.length}</div>
                              {docs.map((d, i) => (
                                <a key={i} className="att-row" href={d.url} target="_blank" rel="noreferrer">
                                  <span className="att-ic"><Mi>picture_as_pdf</Mi></span>
                                  <span className="att-nm">{d.name || d.label || 'Document'}</span>
                                  {d.url && <span className="att-url">{d.url.replace(/^https?:\/\//, '')}</span>}
                                  <Mi className="att-ext">open_in_new</Mi>
                                </a>
                              ))}
                            </div>
                          )}
                          {links.length > 0 && (
                            <div className="att-grp">
                              <div className="att-gh"><Mi>link</Mi>Links · {links.length}</div>
                              {links.map((l, i) => (
                                <a key={i} className="att-row" href={l.url} target="_blank" rel="noreferrer">
                                  <span className="att-ic"><Mi>link</Mi></span>
                                  <span className="att-nm">{l.label || 'Link'}</span>
                                  {l.url && <span className="att-url">{l.url.replace(/^https?:\/\//, '')}</span>}
                                  <Mi className="att-ext">open_in_new</Mi>
                                </a>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    </div>
                  )}
                </div>
              )}

              <div className="pc-cart-wrap">
              {!variant ? <div className="pc-cart-empty">Select a project</div> : (
                <div className="pc-cart">
                  {deal.stage === 'browse' && (!deal.unitId ? (
                    <div className="pc-cart-empty">
                      <span className="pc-cart-empty-ic"><Mi>grid_view</Mi></span>
                      {dealOnly
                        ? <div>This unit is no longer available.<br />Go back and pick another one.</div>
                        : <div>Pick a unit from the grid to start.<br />Then add the <b>client's name</b> to send the offer.</div>}
                    </div>
                  ) : (
                    <>
                      <div className="pcl-rows">
                        <div className="pcl-row"><span>Offer rate</span><b>{fmtBDT(calc.offerRate)}/sqft</b></div>
                        <div className="pcl-row"><span>Offer value · {pv.size} sqft</span><b>{fmtBDT(calc.offerValue)}</b></div>
                        {calc.discountPct > 0 && <div className="pcl-row"><span>Fast-close −{calc.discountPct}%</span><b className="pcl-neg">−{fmtBDT(calc.offerValue - calc.discountedOffer)}</b></div>}
                        {(p.addons || []).filter(a => deal.addons[a.id]).map(a => <div key={a.id} className="pcl-row"><span>{a.name}</span><b>+{fmtBDT(a.amount)}</b></div>)}
                        <div className="pcl-total"><span>Deal total</span><div className="pcl-total-r"><b>{fmtBDT(calc.dealTotal)}</b><small>{fmtBDT(Math.round(calc.dealTotal / pv.size))}/sqft blended</small></div></div>
                      </div>
                      <div className="pcc-f">
                        <span>Client</span>
                        <div className="pcc-tabs" role="tablist" aria-label="Client">
                          <button type="button" role="tab" aria-selected={clientTab === 'search'} className={clientTab === 'search' ? 'on' : ''} onClick={() => setClientTab('search')}><Mi>search</Mi>Search customer</button>
                          <button type="button" role="tab" aria-selected={clientTab === 'create'} className={clientTab === 'create' ? 'on' : ''} onClick={() => setClientTab('create')}><Mi>person_add</Mi>Create lead</button>
                        </div>
                        {clientTab === 'search' ? (
                        <div className="pcc-search">
                          <Mi>search</Mi>
                          <input value={deal.client.id ? deal.client.name : cq} placeholder="Search customer by name / phone…"
                            onChange={e => { setDeal(d => ({ ...d, client: { name: '', phone: '' } })); setCq(e.target.value); }} />
                          {deal.client.id && <button className="pcc-clear" onClick={() => { setDeal(d => ({ ...d, client: { name: '', phone: '' } })); setCq(''); }}><Mi>close</Mi></button>}
                          {!deal.client.id && cq.trim() && (
                            <div className="pcc-drop">
                              {matches.length ? matches.map(l => (
                                <div key={l.id} className="pcc-opt" onClick={() => { setDeal(d => ({ ...d, client: { id: l.id, name: l.name, phone: l.phone } })); setCq(''); }}>
                                  <span className="pcc-opt-n">{l.name}</span><span className="pcc-opt-p">{l.phone}</span>
                                </div>
                              )) : <div className="pcc-noopt">No customer found. Use Create lead</div>}
                            </div>
                          )}
                        </div>
                        ) : (
                          <button type="button" className="btn btn-g btn-full" onClick={() => setLeadOpen(true)}><Mi>person_add</Mi>Add new lead for {deal.unitId}</button>
                        )}
                      </div>
                      {deal.client.id && <div className="pcc-chosen"><Mi>person</Mi>{deal.client.name}{deal.client.phone ? ` · ${deal.client.phone}` : ''}</div>}
                      <button className="btn btn-p btn-full" disabled={!deal.client.id} onClick={addToCart}><Mi>send</Mi>Reserve Now</button>
                      {!deal.client.id && <div className="pcc-hint">{clientTab === 'search' ? 'Select an existing customer to continue' : 'Add the lead, then send the offer'}</div>}
                    </>
                  ))}

                  {deal.stage === 'offer' && (
                    <>
                      <div className="pc-sheet-fit" ref={sheetRef} data-k={sheetK} style={{ '--k': sheetK }}>
                        <ProjectInvoice inline project={p} variant={pv} deal={deal} calc={calc} agent={user} />
                      </div>
                      {calc.belowFloor && <div className="pc-warn sm"><Mi>warning</Mi>below floor — needs manager approval</div>}
                      <div className="pc-offer-acts">
                        <button className="btn btn-g" onClick={() => downloadOfferPdf({ project: p, variant: pv, deal, calc, agent: user })}><Mi>download</Mi>Download</button>
                        <button className="btn btn-p" onClick={holdUnit}><Mi>lock</Mi>Hold unit</button>
                      </div>
                      <button className="btn btn-g btn-full" onClick={() => setDeal(d => ({ ...d, stage: 'browse' }))}>Remove from cart</button>
                    </>
                  )}

                  {deal.stage === 'hold' && (() => {
                    const hu = variant.units.find(u => u.id === deal.unitId);
                    const approved = !!hu?.holdUntil;
                    return (
                    <>
                      <div className="pc-cline">Unit <b>{deal.unitId}</b> for <b>{deal.client.name}</b></div>
                      <div className="pc-cline">{fmtBDT(calc.dealTotal)}</div>
                      {approved
                        ? <div className="pc-holdtimer ok"><Mi>verified</Mi>Booked by management until <b>{new Date(hu.holdUntil).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</b></div>
                        : <div className="pc-holdtimer wait"><Mi>hourglass_top</Mi>Awaiting management approval…</div>}
                      <button className="btn btn-p btn-full" disabled={!approved} onClick={() => setDeal(d => ({ ...d, stage: 'payment' }))}><Mi>payments</Mi>Discuss payment</button>
                      <button className="btn btn-g btn-full" onClick={releaseHold}>{approved ? 'Release hold' : 'Cancel request'}</button>
                    </>
                    );
                  })()}

                  {deal.stage === 'payment' && (
                    <>
                      <div className="pc-sec-sub">Choose a payment plan</div>
                      {plans.map(pl => (
                        <button key={pl.id} className={`pc-plan${deal.plan === pl.id ? ' on' : ''}`} onClick={() => setDeal(d => ({ ...d, plan: pl.id }))}>
                          <div className="pc-plan-hd"><b>{pl.name}</b><span>{pl.sub}</span></div>
                          {pl.lines.map((ln, i) => <div key={i} className="pc-plan-ln">{ln}</div>)}
                        </button>
                      ))}
                      <button className="btn btn-p btn-full" disabled={!deal.plan} onClick={confirmDeal}><Mi>check_circle</Mi>Confirm deal</button>
                    </>
                  )}

                  {deal.stage === 'closed' && (
                    <div className="pc-closed">
                      <Mi>emoji_events</Mi>
                      <div className="pc-closed-t">Deal closed!</div>
                      <div className="pc-cline">Unit <b>{deal.unitId}</b> sold to {deal.client.name}</div>
                      <div className="pc-cline">Final {fmtBDT(calc.dealTotal)} · {deal.plan}</div>
                      <div className="pc-cline">Est. commission <b>{fmtBDT(calc.commission)}</b></div>
                      <button className="btn btn-p btn-full" onClick={newDeal}><Mi>refresh</Mi>Start a new deal</button>
                    </div>
                  )}
                </div>
              )}
              </div>
            </aside>
          </div>
        )}
      </div>

      {lightbox && <div className="pc-lightbox" onClick={() => setLightbox(null)}><img src={lightbox} alt="" /><button className="pc-lb-x" onClick={() => setLightbox(null)}><Mi>close</Mi></button></div>}
      {/* Create lead: the Prospects Add New Lead form. Project Interest is not
          asked: it is saved as this project's name (the same form the rest of
          the app stores), and the unit rides on the deal the lead is picked for. */}
      <AddLeadModal open={leadOpen} onClose={() => setLeadOpen(false)}
        interest={p.name || ''}
        onCreated={l => { setDeal(d => ({ ...d, client: { id: l.id, name: l.name, phone: l.phone } })); setCq(''); setClientTab('search'); }} />
    </div>
  );
}
