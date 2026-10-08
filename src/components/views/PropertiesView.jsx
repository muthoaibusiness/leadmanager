import { useState, useRef } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { getProperties, deletePropertyFn } from '../../lib/db.js';
import { ROLES, PROPERTY_TYPES, PROPERTY_STATUS } from '../../lib/constants.js';
import { projectInventory } from '../../lib/projects.js';
import Mi from '../Mi.jsx';
import ProjectsToaster from '../project/ProjectsToaster.jsx';
import { useProjectToast } from '../project/projectToast.js';

const PS_CLASS = { AVAILABLE: 'ps-available', FEW_LEFT: 'ps-few', SOLD_OUT: 'ps-sold', UPCOMING: 'ps-upcoming' };
const fmtSft = n => n >= 1000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1) + 'k' : String(n);
// "৳9,500" or "৳9,500 – 12,500"; same shape for sizes.
const span = (min, max, pre = '', post = '') =>
  min == null ? '—' : min === max ? `${pre}${min.toLocaleString()}${post}` : `${pre}${min.toLocaleString()} – ${max.toLocaleString()}${post}`;

export default function PropertiesView() {
  const { user, setPropSel, openModal, setConsoleAdmin, refreshDB } = useApp();
  const toast = useProjectToast();
  const deleteAskRef = useRef(null); // the open delete confirmation, if any
  const isAdmin = user?.role === ROLES.MGMT;
  const [q, setQ] = useState('');
  const [city, setCity] = useState('ALL');
  const [type, setType] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [sel, setSel] = useState(new Set());

  // selecting is an admin-only control (only admins may delete projects)
  const canSelect = isAdmin;
  // Changing what is listed clears the selection — in the filter handlers, so it
  // happens with the change itself rather than in an effect a render later.
  const filterBy = (set) => (e) => { set(e.target.value); setSel(new Set()); };

  const all = getProperties();
  const cities = [...new Set(all.map(p => p.district).filter(Boolean))];
  // Units, rates, sizes and status come from each project's blocks — see
  // projectInventory() for why the flat legacy fields are not used.
  const inv = new Map(all.map(p => [p.id, projectInventory(p)]));

  let props = all;
  if (city !== 'ALL') props = props.filter(p => p.district === city);
  if (type !== 'ALL') props = props.filter(p => p.type === type);
  if (status !== 'ALL') props = props.filter(p => inv.get(p.id).status === status);
  if (q) { const s = q.toLowerCase(); props = props.filter(p => ((p.name || '') + ' ' + (p.district || '') + ' ' + (p.area || '') + ' ' + (p.address || '')).toLowerCase().includes(s)); }

  const allSelected = props.length > 0 && props.every(p => sel.has(p.id));
  const toggleAll = () => setSel(s => {
    const n = new Set(s);
    if (allSelected) props.forEach(p => n.delete(p.id)); else props.forEach(p => n.add(p.id));
    return n;
  });
  const toggleOne = (id, e) => { e.stopPropagation(); setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); };

  const bulkDelete = () => {
    const ids = [...sel];
    if (!ids.length) return;
    const label = `${ids.length} project${ids.length > 1 ? 's' : ''}`;
    // One question at a time: a second click replaces it with the current count.
    if (deleteAskRef.current != null) toast.dismiss(deleteAskRef.current);
    deleteAskRef.current = toast.confirm({
      title: `Delete ${label}?`,
      description: 'This cannot be undone.',
      confirmLabel: 'Delete',
      onConfirm: () => {
        ids.forEach(id => deletePropertyFn(id));   // tombstones + cloud-deletes each (no resurrect on reload)
        setSel(new Set());
        refreshDB();
        toast.success(ids.length > 1 ? 'Projects deleted' : 'Project deleted', `${label} removed.`);
      },
      onDismiss: (id) => { if (deleteAskRef.current === id) deleteAskRef.current = null; },
    });
  };

  // KPIs over the projects listed below (filters apply). Available + On hold +
  // Sold = Total Units; Total Area is the sellable area of those units.
  const sum = (k) => props.reduce((s, p) => s + inv.get(p.id)[k], 0);
  const totalSft = sum('area');
  const stats = [
    { l: 'Projects', v: props.length },
    { l: 'Total Units', v: sum('total') },
    { l: 'Available', v: sum('available'), c: 'var(--volt)' },
    { l: 'On Hold', v: sum('hold'), c: 'var(--gold)' },
    { l: 'Sold', v: sum('sold'), c: 'var(--green)' },
    { l: 'Total Area', v: totalSft ? fmtSft(totalSft) + ' sft' : '—' },
  ];

  const open = (id) => { setConsoleAdmin(false); setPropSel(id); openModal('project-console'); };

  return (
    <>
      <ProjectsToaster />
      <div className="inv-strip">
        {stats.map((s, i) => (
          <div key={i} className="inv-tile">
            <div className="inv-v" style={s.c ? { color: s.c } : null}>{s.v}</div>
            <div className="inv-l">{s.l}</div>
          </div>
        ))}
      </div>

      <div className="prop-toolbar" style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', marginBottom: '16px', background: 'var(--surf)', padding: '12px', borderRadius: '12px', border: '1px solid var(--bd2)' }}>
        <div className="pt-search" style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: '1 1 200px', minWidth: '200px', background: 'var(--inset)', padding: '0 12px', borderRadius: '8px', border: '1px solid var(--bd2)' }}>
          <Mi>search</Mi>
          <input placeholder="Search project, area, address..." value={q} onChange={filterBy(setQ)} style={{ border: 'none', background: 'transparent', outline: 'none', width: '100%', height: '36px', color: 'var(--t1)' }} />
        </div>
        <select className="fsel" value={city} onChange={filterBy(setCity)} style={{ flex: '1 1 auto', height: '38px', minWidth: '120px', padding: '0 12px', borderRadius: '8px', border: '1px solid var(--bd2)', background: 'var(--surf)', color: 'var(--t1)' }}>
          <option value="ALL">All cities</option>
          {cities.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="fsel" value={type} onChange={filterBy(setType)} style={{ flex: '1 1 auto', height: '38px', minWidth: '120px', padding: '0 12px', borderRadius: '8px', border: '1px solid var(--bd2)', background: 'var(--surf)', color: 'var(--t1)' }}>
          <option value="ALL">All types</option>
          {PROPERTY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="fsel" value={status} onChange={filterBy(setStatus)} style={{ flex: '1 1 auto', height: '38px', minWidth: '120px', padding: '0 12px', borderRadius: '8px', border: '1px solid var(--bd2)', background: 'var(--surf)', color: 'var(--t1)' }}>
          <option value="ALL">All status</option>
          {Object.entries(PROPERTY_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <span className="fcount" style={{ fontWeight: '600', color: 'var(--t2)', marginLeft: '4px' }}>{props.length}</span>
      </div>

      {canSelect && sel.size > 0 && (
        <div className="bulk-bar">
          <span className="bulk-ct">{sel.size} selected</span>
          <button className="btn btn-sm" style={{ background: 'var(--red-l)', color: 'var(--red)' }} onClick={bulkDelete}>
            <Mi>delete</Mi>Delete Selected
          </button>
          <button className="btn btn-g btn-sm" onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}

      {props.length === 0 ? (
        <div className="empty"><Mi>apartment</Mi><p>No properties{isAdmin ? ' — add your first listing.' : ' available'}</p></div>
      ) : (
        <div className="lt">
          <div className={`lt-hdr prop-row${canSelect ? ' with-cb' : ''}`}>
            {canSelect && (
              <div className="lt-cb-col" onClick={toggleAll} title={allSelected ? 'Clear all' : 'Select all'}>
                <input type="checkbox" checked={allSelected} onChange={() => {}} onClick={e => { e.stopPropagation(); toggleAll(); }} />
              </div>
            )}
            <div>Project</div><div>৳/sqft</div><div>Size</div><div>Saleable Units</div><div>Status</div><div>Handover</div>
          </div>
          {props.map(p => (
            <div key={p.id} className={`lt-row prop-row${canSelect ? ' with-cb' : ''}${sel.has(p.id) ? ' lt-sel' : ''}`}
              onClick={() => (canSelect && sel.size > 0) ? toggleOne(p.id, { stopPropagation: () => {} }) : open(p.id)}>
              {canSelect && (
                <div className="lt-cb-col" onClick={e => toggleOne(p.id, e)}>
                  <input type="checkbox" checked={sel.has(p.id)} onChange={() => {}} onClick={e => toggleOne(p.id, e)} />
                </div>
              )}
              <div className="lt-cell lt-cell-main"><div style={{ minWidth: 0 }}>
                <div className="lt-n">{p.name}</div>
                <div className="lt-sub">{[p.area, p.district].filter(Boolean).join(' · ')}</div>
              </div></div>
              {(() => {
                const iv = inv.get(p.id);
                const blocks = p.variants || [];
                const tip = blocks.length ? blocks.map(v => `${v.name || 'Block'}: ${(v.units || []).length}`).join(' · ') : '';
                return (
                  <>
                    <div className="lt-cell lt-cell-src"><span className="lt-src">{span(iv.rateMin, iv.rateMax, '৳')}</span></div>
                    <div className="lt-cell lt-cell-prop">
                      <span className="lt-src">{iv.sizeMin != null ? span(iv.sizeMin, iv.sizeMax, '', ' sqft') : (p.sizeText || '—')}</span>
                    </div>
                    <div className="lt-cell lt-cell-units">
                      {iv.total ? (
                        <div style={{ minWidth: 0 }} title={tip}>
                          <div className="lt-src">{iv.total} unit{iv.total > 1 ? 's' : ''}</div>
                          <div className="lt-sub">{iv.available} available{iv.hold ? ` · ${iv.hold} on hold` : ''}{iv.sold ? ` · ${iv.sold} sold` : ''}</div>
                        </div>
                      ) : <span className="lt-src">—</span>}
                    </div>
                    <div className="lt-cell lt-cell-status">
                      {iv.status
                        ? <span className={`bdg ${PS_CLASS[iv.status] || ''}`}>{PROPERTY_STATUS[iv.status]}</span>
                        : <span className="bdg ps-none" title="No units in the catalog yet">No units</span>}
                    </div>
                  </>
                );
              })()}
              <div className="lt-cell lt-cell-date"><span className="lt-date">{p.handover || '—'}</span></div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
