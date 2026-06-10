import { useState, useEffect } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { getProperty, deletePropertyFn } from '../../lib/db.js';
import { fmtBDT } from '../../lib/helpers.js';
import { ROLES, PROPERTY_STATUS } from '../../lib/constants.js';

const PS_CLASS = { AVAILABLE: 'ps-available', FEW_LEFT: 'ps-few', SOLD_OUT: 'ps-sold', UPCOMING: 'ps-upcoming' };
const DOC_ICON = { brochure: 'menu_book', layout: 'grid_view', image: 'image', video: 'movie', other: 'description' };

export default function PropertyViewModal() {
  const { modal, closeModal, propSel, user, setPropEdit, openModal, refreshDB, showToast } = useApp();
  const isOpen = modal === 'property-view';
  const p = isOpen && propSel ? getProperty(propSel) : null;
  const [active, setActive] = useState(0);

  useEffect(() => { setActive(0); }, [propSel, isOpen]);

  if (!isOpen || !p) return <div className={`mov${isOpen ? ' on' : ''}`} onClick={closeModal} />;

  const isAdmin = user?.role === ROLES.MGMT;
  const imgs = p.images?.filter(Boolean) || [];
  const docs = p.documents?.filter(d => d && d.url) || [];
  const amenities = (p.amenities || []).filter(Boolean);
  const sizeStr = p.sizeMin && p.sizeMax ? `${p.sizeMin}–${p.sizeMax} sqft` : (p.sizeMin ? `${p.sizeMin}+ sqft` : '—');
  const availPct = p.totalUnits ? Math.round((p.unitsAvailable / p.totalUnits) * 100) : 0;
  const priceTotal = p.askingPrice ? fmtBDT(p.askingPrice) : 'On request';
  const overview = p.details
    || `${p.type} development${p.developer ? ' by ' + p.developer : ''} located in ${[p.area, p.district].filter(Boolean).join(', ')}. `
       + `${p.totalUnits ? p.totalUnits + ' units' : 'Multiple units'}${p.facing ? ', ' + p.facing + ' facing' : ''}`
       + `${p.handover ? ', handover ' + p.handover : ''}.`;

  const specs = [
    { ico: 'aspect_ratio', l: 'Unit size', v: p.sizeText || sizeStr },
    { ico: 'sell', l: 'Price / sqft', v: p.pricePerSqft ? '৳' + p.pricePerSqft.toLocaleString() : 'On request' },
    { ico: 'straighten', l: 'Total area', v: p.totalSft ? p.totalSft.toLocaleString() + ' sft' : null },
    { ico: 'landscape', l: 'Land area', v: p.landArea },
    { ico: 'layers', l: 'Storeys', v: p.storeys },
    { ico: 'explore', l: 'Facing', v: p.facing },
    { ico: 'task_alt', l: 'Purpose', v: p.purpose },
  ].filter(s => s.v);

  const quick = [
    { ico: 'apartment', l: 'Type', v: p.type },
    { ico: 'business', l: 'Developer', v: p.developer },
    { ico: 'event_available', l: 'Handover', v: p.handover },
    { ico: 'meeting_room', l: 'Total units', v: p.totalUnits || null },
  ].filter(q => q.v);

  const handleEdit = () => { setPropEdit(p); openModal('property-form'); };
  const handleDelete = () => {
    if (!window.confirm(`Delete "${p.name}"?`)) return;
    deletePropertyFn(p.id);
    refreshDB();
    showToast('Property deleted', 'ok');
    closeModal();
  };

  return (
    <div className="mov on" onClick={closeModal}>
      <div className="modal pv-modal" onClick={e => e.stopPropagation()}>
        <div className="m-body pv-body">
          {/* Immersive hero */}
          <div className="pv-hero">
            {imgs.length
              ? <img className="pv-hero-img" src={imgs[active]} alt={p.name} />
              : <div className="pv-hero-fallback"><Mi>apartment</Mi></div>}
            <div className="pv-scrim" />
            <div className="pv-hero-top">
              <span className={`bdg ${PS_CLASS[p.status] || ''}`}>{PROPERTY_STATUS[p.status] || p.status}</span>
              <button className="pv-hero-x" onClick={closeModal}><Mi>close</Mi></button>
            </div>
            <div className="pv-hero-body">
              <div className="pv-hero-headline">
                <div className="pv-eyebrow">{[p.developer, p.type].filter(Boolean).join('  ·  ')}</div>
                <h2 className="pv-title">{p.name}</h2>
                <div className="pv-loc"><Mi>location_on</Mi>{p.address || p.district}</div>
              </div>
              <div className="pv-hero-price">
                <div className="l">{p.askingPrice ? 'Starting from' : 'Price'}</div>
                <div className="v">{priceTotal}</div>
                {p.pricePerSqft ? <div className="s">৳{p.pricePerSqft.toLocaleString()} / sqft</div> : null}
              </div>
            </div>
          </div>

          {imgs.length > 1 && (
            <div className="pv-thumbs">
              {imgs.map((im, i) => (
                <button key={i} className={`pv-thumb${i === active ? ' on' : ''}`} onClick={() => setActive(i)}>
                  <img src={im} alt={`${p.name} ${i + 1}`} />
                </button>
              ))}
            </div>
          )}

          {/* Two-column content */}
          <div className="pv-grid">
            <div className="pv-left">
              <section className="pv-block">
                <h3 className="pv-h"><Mi>info</Mi>Overview</h3>
                <p className="pv-details">{overview}</p>
              </section>

              <section className="pv-block">
                <h3 className="pv-h"><Mi>list_alt</Mi>Specifications</h3>
                <div className="pv-specs">
                  {specs.map((s, i) => (
                    <div className="pv-spec" key={i}>
                      <span className="pv-spec-l"><Mi>{s.ico}</Mi>{s.l}</span>
                      <span className="pv-spec-v">{s.v}</span>
                    </div>
                  ))}
                </div>
              </section>

              {amenities.length > 0 && (
                <section className="pv-block">
                  <h3 className="pv-h"><Mi>verified</Mi>Amenities</h3>
                  <div className="pv-amen">
                    {amenities.map((a, i) => (
                      <div className="pv-amen-item" key={i}><Mi>check_circle</Mi>{a}</div>
                    ))}
                  </div>
                </section>
              )}

              <section className="pv-block">
                <h3 className="pv-h"><Mi>construction</Mi>Construction progress</h3>
                <div className="pv-prog-track"><div className="pv-prog-fill" style={{ width: (p.construction || 0) + '%' }} /></div>
                <div className="pv-prog-lbl">{p.construction || 0}% complete</div>
              </section>

              {p.saleableUnits && (
                <section className="pv-block">
                  <h3 className="pv-h"><Mi>grid_view</Mi>Unsold / saleable units</h3>
                  <div className="pv-chips">
                    {p.saleableUnits.split(',').map((u, i) => u.trim() && <span key={i} className="pv-chip">{u.trim()}</span>)}
                  </div>
                </section>
              )}

              {docs.length > 0 && (
                <section className="pv-block">
                  <h3 className="pv-h"><Mi>folder</Mi>Documents &amp; media</h3>
                  <div className="pv-docs">
                    {docs.map((d, i) => (
                      <a key={i} className="pv-doc" href={d.url} target="_blank" rel="noreferrer">
                        <Mi>{DOC_ICON[d.type] || 'description'}</Mi>
                        <div className="pv-doc-bd">
                          <div className="pv-doc-name">{d.name || d.type}</div>
                          <div className="pv-doc-type">{d.type}</div>
                        </div>
                        <Mi>open_in_new</Mi>
                      </a>
                    ))}
                  </div>
                </section>
              )}
            </div>

            {/* Sticky reserve sidebar */}
            <aside className="pv-side">
              <div className="pv-reserve">
                <div className="pv-res-hd">Availability</div>
                <div className="pv-avail">
                  <div className="pv-avail-top">
                    <span className="pv-avail-n">{p.unitsAvailable}<small> / {p.totalUnits} units</small></span>
                    <span className="pv-avail-pct">{availPct}% open</span>
                  </div>
                  <div className="pv-avail-bar"><div className="pv-avail-fill" style={{ width: availPct + '%' }} /></div>
                </div>
                <button className="btn btn-p pv-cta" onClick={() => openModal('units')}>
                  <Mi>event_seat</Mi>Book / Lock a Unit
                </button>
                <div className="pv-res-note"><Mi>bolt</Mi>Hold a unit instantly · no payment now</div>
              </div>

              {quick.length > 0 && (
                <div className="pv-quick">
                  {quick.map((q, i) => (
                    <div className="pv-quick-row" key={i}>
                      <span className="pv-quick-l"><Mi>{q.ico}</Mi>{q.l}</span>
                      <span className="pv-quick-v">{q.v}</span>
                    </div>
                  ))}
                </div>
              )}
            </aside>
          </div>
        </div>

        {isAdmin && (
          <div className="m-ft">
            <button className="btn btn-danger" onClick={handleDelete}><Mi>delete</Mi>Delete</button>
            <button className="btn btn-p" onClick={handleEdit}><Mi>edit</Mi>Edit Property</button>
          </div>
        )}
      </div>
    </div>
  );
}
