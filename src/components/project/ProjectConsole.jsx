import { useState, useEffect, useMemo } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { getProjectById, setUnitStatus, removeProject } from '../../lib/projects.js';
import { createHoldRequest, getLeads } from '../../lib/db.js';
import { computeDeal, emptyDeal } from '../../lib/deal.js';
import ProjectCatalog from './ProjectCatalog.jsx';
import ProjectInvoice from './ProjectInvoice.jsx';
import { fmtBDT } from '../../lib/helpers.js';
import { ROLES } from '../../lib/constants.js';

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
function useCountdown(targetMs) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 1000); return () => clearInterval(t); }, []);
  const diff = targetMs - Date.now();
  if (diff <= 0) return 'expired';
  const d = Math.floor(diff / 86400000), h = Math.floor(diff / 3600000) % 24, m = Math.floor(diff / 60000) % 60, s = Math.floor(diff / 1000) % 60;
  return `${d}d ${h}h ${m}m ${s}s`;
}

export default function ProjectConsole() {
  const { modal, closeModal, propSel, user, refreshDB, showToast, dbVersion, consoleAdmin } = useApp();
  const isOpen = modal === 'project-console';
  const isAdmin = user?.role === ROLES.MGMT;

  const [admin, setAdmin] = useState(false); // admin "back view" toggle
  const [vid, setVid] = useState(null);
  const [deal, setDeal] = useState(emptyDeal);
  const [lightbox, setLightbox] = useState(null);
  const [cq, setCq] = useState(''); // client search query
  const [invoice, setInvoice] = useState(false); // invoice preview overlay
  const [startedAt] = useState(() => Date.now()); // fast-close window anchor

  void dbVersion;
  const p = isOpen && propSel ? getProjectById(propSel) : null;
  const variants = useMemo(() => (p ? p.variants : []), [p, dbVersion]);
  const variant = variants.find(v => v.id === vid) || variants[0] || null;

  // reset when opening a different project
  useEffect(() => { if (isOpen) { setVid(null); setDeal(emptyDeal()); setCq(''); setAdmin(!!consoleAdmin); } }, [propSel, isOpen]);
  // keep deal.variantId in sync; reset unit when variant changes
  useEffect(() => { if (variant) setDeal(d => (d.variantId === variant.id ? d : { ...emptyDeal(), variantId: variant.id })); }, [variant?.id]);

  // returning to the console after admin edits — sanitize the deal so it can't
  // reference a variant/unit that was deleted or is no longer available.
  useEffect(() => {
    if (admin) return;
    const proj = propSel ? getProjectById(propSel) : null;
    if (!proj) return;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin]);

  const locked = deal.stage !== 'browse'; // editing locked once in the cart
  const fastTarget = startedAt + (p?.fastCloseDays || 0) * 86400000;
  const countdown = useCountdown(fastTarget);

  const calc = variant ? computeDeal(deal, variant, p) : null;

  if (!isOpen) return <div className="mov" onClick={closeModal} />;
  if (!p) return <div className="mov on" onClick={closeModal} />;

  const img0 = p.media?.images?.[0]?.url || p.images?.[0] || '';
  const docs = p.media?.docs || (p.documents || []).filter(d => /pdf|doc/i.test(d.type || d.url || ''));
  const links = p.media?.links || (p.driveLink ? [{ label: 'Drive', url: p.driveLink }] : []);
  const photos = p.media?.images || (p.images || []).map(u => ({ url: u }));

  const totalUnits = variants.reduce((s, v) => s + v.units.length, 0);
  const availUnits = variants.reduce((s, v) => s + v.units.filter(u => u.status === 'available').length, 0);
  const vAvail = variant ? variant.units.filter(u => u.status === 'available').length : 0;
  // Floor (bottom) price + total project value are commercially sensitive — only
  // Team Leads and Management see them; initial/meeting agents do not.
  const canSeeFloor = [ROLES.TL, ROLES.MGMT, ROLES.MASTER].includes(user?.role);
  // Total project value at list rate = Σ blocks (rate × size × units).
  const projectValue = variants.reduce((s, v) => s + (v.listRate || 0) * (v.size || 0) * (v.units.length || 0), 0);

  // Offers can only go to an existing customer — search this user's leads.
  const myLeads = getLeads(user);
  const matches = cq.trim()
    ? myLeads.filter(l => (l.name + ' ' + (l.phone || '')).toLowerCase().includes(cq.toLowerCase())).slice(0, 6)
    : [];

  const setUnit = (u) => { if (!locked && u.status === 'available') setDeal(d => ({ ...d, unitId: u.id })); };
  const setRate = (k, v) => setDeal(d => ({ ...d, [k]: v === '' ? null : parseFloat(v) }));
  const toggleAddon = (id) => { if (!locked) setDeal(d => ({ ...d, addons: { ...d.addons, [id]: !d.addons[id] } })); };

  // ── funnel actions ──
  const addToCart = () => { if (deal.unitId && deal.client.id) setDeal(d => ({ ...d, stage: 'offer' })); };
  const holdUnit = () => {
    // TODO(role-gate): if calc.belowFloor, require manager-approval permission before allowing checkout.
    setUnitStatus(p.id, variant.id, deal.unitId, 'hold', { user, client: { id: deal.client.id, name: deal.client.name }, note: 'Hold requested' });
    createHoldRequest({
      propertyId: p.id, propertyName: p.name, variantId: variant.id, variantName: variant.name, unitId: deal.unitId,
      clientName: deal.client.name, clientPhone: deal.client.phone, dealTotal: calc.dealTotal, offerRate: calc.offerRate,
    }, user);
    refreshDB();
    setDeal(d => ({ ...d, stage: 'hold', holdAt: Date.now() }));
    showToast('Hold request sent to management', 'ok');
  };
  const releaseHold = () => {
    setUnitStatus(p.id, variant.id, deal.unitId, 'available', { user });
    refreshDB();
    setDeal(d => ({ ...d, stage: 'offer' }));
    showToast(`Unit ${deal.unitId} released`, 'ok');
  };
  const confirmDeal = () => {
    setUnitStatus(p.id, variant.id, deal.unitId, 'sold', { user, client: { id: deal.client.id, name: deal.client.name } });
    refreshDB();
    setDeal(d => ({ ...d, stage: 'closed' }));
    showToast(`Deal closed · Unit ${deal.unitId} sold`, 'ok');
  };
  const newDeal = () => setDeal({ ...emptyDeal(), variantId: variant?.id });
  // closing an untitled (abandoned) new project cleans it up
  const handleClose = () => { if (p && !(p.name || '').trim()) removeProject(p.id); closeModal(); };

  const plans = calc ? [
    { id: 'full', name: 'Full payment', sub: '−1% extra', total: calc.dealTotal * 0.99, lines: [`One-time ${fmtBDT(calc.dealTotal * 0.99)}`] },
    { id: 'install', name: 'Installments', sub: '30% down + 12', total: calc.dealTotal, lines: [`Down ${fmtBDT(calc.dealTotal * 0.3)}`, `12 × ${fmtBDT(calc.dealTotal * 0.7 / 12)}`] },
    { id: 'loan', name: 'Bank loan', sub: '20% down, 80% financed', total: calc.dealTotal, lines: [`Down ${fmtBDT(calc.dealTotal * 0.2)}`, `Financed ${fmtBDT(calc.dealTotal * 0.8)}`] },
  ] : [];

  return (
    <div className="mov on" onClick={handleClose}>
      <div className="modal pc-modal" onClick={e => e.stopPropagation()}>
        <div className="pc-top">
          <div className="pc-top-l"><Mi>storefront</Mi><b>{p.name}</b></div>
          <div className="pc-top-r">
            {isAdmin && (
              <div className="pc-toggle">
                <button className={!admin ? 'on' : ''} onClick={() => setAdmin(false)}>Agent console</button>
                <button className={admin ? 'on' : ''} onClick={() => setAdmin(true)}>Admin catalog</button>
              </div>
            )}
            <button className="m-x" onClick={handleClose}><Mi>close</Mi></button>
          </div>
        </div>

        {admin ? (
          <div className="pc-adminview">
            <ProjectCatalog project={p} onDone={() => setAdmin(false)} />
          </div>
        ) : (
          <div className="pc-body">
            {/* ── main column ── */}
            <div className="pc-main">
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

              {/* unit type (variant) picker */}
              {variants.length > 0 && (
                <div className="pc-sec">
                  <div className="pc-sec-hd">Unit type <span className="pc-sec-note">— like a product variant</span></div>
                  <div className="pcv-row">
                    {variants.map(v => {
                      const av = v.units.filter(u => u.status === 'available').length;
                      return (
                        <button key={v.id} className={`pcv${variant?.id === v.id ? ' on' : ''}`} disabled={locked} onClick={() => setVid(v.id)}>
                          <div className="pcv-top"><span className="pcv-name">{v.name}</span><span className="pcv-avail">{av} avail</span></div>
                          <div className="pcv-meta">{v.beds} bed · {v.baths} bath · {v.size} sqft</div>
                          <div className="pcv-price">{crShort(v.listRate * v.size)} · {fmtBDT(v.listRate)}/sqft</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* unit grid */}
              {variant && (
                <div className="pc-sec">
                  <div className="pc-sec-hd">Pick a unit <span className="pc-sec-sub">{vAvail} available</span></div>
                  <div className="pcu-legend">
                    <span><i className="pcu-sw pcu-sw-open" />Available</span>
                    <span><i className="pcu-sw pcu-sw-hold" />On hold</span>
                    <span><i className="pcu-sw pcu-sw-sold" />Sold</span>
                    <span><i className="pcu-sw pcu-sw-sel" />Selected</span>
                  </div>
                  <div className="pcu-grid">
                    {variant.units.map(u => {
                      const lbl = u.status === 'sold' ? 'SOLD' : u.status === 'hold' ? 'HELD' : 'OPEN';
                      const blocked = u.status !== 'available';
                      const t = [u.status === 'sold' ? 'Sold' : u.status === 'hold' ? 'On hold' : 'Available'];
                      if (u.clientName) t.push('Client: ' + u.clientName);
                      if (u.holdUntil) t.push('Booked by management until ' + new Date(u.holdUntil).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }));
                      else if (u.heldByName) t.push('By: ' + u.heldByName);
                      return (
                        <button key={u.id} className={`pcu pcu-${u.status}${deal.unitId === u.id ? ' sel' : ''}${blocked ? ' blocked' : ''}`}
                          title={t.join('\n')} aria-disabled={blocked || locked} onClick={() => setUnit(u)}>
                          <div className="pcu-no">{u.id.replace(/^U-/, '')}</div>
                          <div className="pcu-st">{lbl}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* price & offer */}
              {variant && calc && (
                <div className="pc-sec pc-offer">
                  <div className={`pco-prices${canSeeFloor ? '' : ' solo'}`}>
                    <div className="pco-box">
                      <div className="pco-box-l">Top price · list</div>
                      <div className="pco-box-v">{fmtBDT(variant.listRate)} <small>/ sqft</small></div>
                      <div className="pco-box-s">Total {crShort(variant.listRate * variant.size)}</div>
                    </div>
                    {canSeeFloor && (
                      <div className="pco-box floor">
                        <div className="pco-box-l">Bottom price · floor</div>
                        {variant.floorRate > 0 ? (
                          <>
                            <div className="pco-box-v">{fmtBDT(variant.floorRate)} <small>/ sqft</small></div>
                            <div className="pco-box-s">Total {crShort(variant.floorRate * variant.size)}</div>
                          </>
                        ) : (
                          <div className="pco-box-v" style={{ opacity: .55 }}>Not set</div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="pco-panel">
                    <div className="pco-row">
                      <div className="pco-cell">
                        <div className="pco-lbl">Your offer · rate</div>
                        <div className="pco-input">
                          <span className="pco-cur">৳</span>
                          <input type="number" disabled={locked} value={deal.offerRate ?? ''} placeholder={variant.listRate} onChange={e => setRate('offerRate', e.target.value)} />
                          <span className="pco-suf">/ sqft</span>
                        </div>
                      </div>
                      <div className="pco-cell pco-right">
                        <div className="pco-lbl">Total offer value</div>
                        <div className="pco-total">{fmtBDT(calc.offerValue)}</div>
                        <div className="pco-total-s">{fmtBDT(calc.offerRate)} × {variant.size} sqft</div>
                      </div>
                    </div>

                    <div className="pco-div" />

                    <div className="pco-row">
                      <div className="pco-cell">
                        <div className="pco-lbl">Customer's last offer · rate</div>
                        <div className="pco-input">
                          <span className="pco-cur">৳</span>
                          <input type="number" disabled={locked} value={deal.custRate ?? ''} placeholder="—" onChange={e => setRate('custRate', e.target.value)} />
                          <span className="pco-suf">/ sqft</span>
                        </div>
                      </div>
                      <div className="pco-cell pco-right">
                        {calc.customerTotal != null ? (
                          <>
                            <div className="pco-lbl">Customer total</div>
                            <div className="pco-total alt">{fmtBDT(calc.customerTotal)}</div>
                            <div className="pco-total-s">{calc.gap === 0 ? 'matched' : <span className={calc.gap > 0 ? 'pc-gap-hi' : 'pc-gap-lo'}>{calc.gap > 0 ? 'you +' : 'client +'}{fmtBDT(Math.abs(calc.gap))}</span>}</div>
                          </>
                        ) : (
                          <><div className="pco-total alt">—</div><div className="pco-total-s">no customer offer yet</div></>
                        )}
                      </div>
                    </div>
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

            {/* ── deal cart rail ── */}
            <aside className="pc-rail">
              <div className="pc-rail-hd">
                <div className="pc-rail-ttl"><Mi>shopping_bag</Mi>Deal cart</div>
                <div className="pc-rail-sub">Build an offer, then move it down the pipeline</div>
              </div>
              <div className="pc-funnel">
                {STAGES.map((s, i) => (
                  <div key={s.key} className={`pc-step${stageIdx(deal.stage) >= i + (deal.stage === 'browse' ? 0 : 1) ? ' done' : ''}${stageIdx(deal.stage) === i ? ' cur' : ''}`}>
                    <span className="pc-step-n">{i + 1}</span>{s.label}
                  </div>
                ))}
              </div>

              <div className="pc-cart-wrap">
              {!variant ? <div className="pc-cart-empty">Select a project</div> : (
                <div className="pc-cart">
                  {deal.stage === 'browse' && (!deal.unitId ? (
                    <div className="pc-cart-empty">
                      <span className="pc-cart-empty-ic"><Mi>grid_view</Mi></span>
                      <div>Pick a unit from the grid to start.<br />Then add the <b>client's name</b> to send the offer.</div>
                    </div>
                  ) : (
                    <>
                      <div className="pcl-card">
                        <div className="pcl-hd">{variant.name} · Unit</div>
                        <div className="pcl-no">{deal.unitId}</div>
                      </div>
                      <div className="pcl-rows">
                        <div className="pcl-row"><span>Offer rate</span><b>{fmtBDT(calc.offerRate)}/sqft</b></div>
                        <div className="pcl-row"><span>Offer value · {variant.size} sqft</span><b>{fmtBDT(calc.offerValue)}</b></div>
                        {calc.discountPct > 0 && <div className="pcl-row"><span>Fast-close −{calc.discountPct}%</span><b className="pcl-neg">−{fmtBDT(calc.offerValue - calc.discountedOffer)}</b></div>}
                        {(p.addons || []).filter(a => deal.addons[a.id]).map(a => <div key={a.id} className="pcl-row"><span>{a.name}</span><b>+{fmtBDT(a.amount)}</b></div>)}
                        <div className="pcl-total"><span>Deal total</span><div className="pcl-total-r"><b>{fmtBDT(calc.dealTotal)}</b><small>{fmtBDT(Math.round(calc.dealTotal / variant.size))}/sqft blended</small></div></div>
                      </div>
                      <div className="pcc-f">
                        <span>Client (existing customer)</span>
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
                              )) : <div className="pcc-noopt">No customer found — add them in Leads first</div>}
                            </div>
                          )}
                        </div>
                      </div>
                      {deal.client.id && <div className="pcc-chosen"><Mi>person</Mi>{deal.client.name}{deal.client.phone ? ` · ${deal.client.phone}` : ''}</div>}
                      <button className="btn btn-p btn-full" disabled={!deal.client.id} onClick={addToCart}><Mi>send</Mi>Send offer</button>
                      {!deal.client.id && <div className="pcc-hint">Select an existing customer to continue</div>}
                    </>
                  ))}

                  {deal.stage === 'offer' && (
                    <>
                      <ProjectInvoice inline project={p} variant={variant} deal={deal} calc={calc} agent={user} />
                      {calc.belowFloor && <div className="pc-warn sm"><Mi>warning</Mi>below floor — needs manager approval</div>}
                      <button className="btn btn-g btn-full" onClick={() => setInvoice(true)}><Mi>open_in_full</Mi>Open / print invoice</button>
                      <button className="btn btn-p btn-full" onClick={holdUnit}><Mi>lock</Mi>Hold unit (checkout)</button>
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
      {invoice && variant && calc && <ProjectInvoice project={p} variant={variant} deal={deal} calc={calc} agent={user} onClose={() => setInvoice(false)} />}
    </div>
  );
}
