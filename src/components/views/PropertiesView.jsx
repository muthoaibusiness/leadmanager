import { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { getProperties, deletePropertyFn } from '../../lib/db.js';
import { ROLES, PROPERTY_TYPES, PROPERTY_STATUS } from '../../lib/constants.js';
import Mi from '../Mi.jsx';

const PS_CLASS = { AVAILABLE: 'ps-available', FEW_LEFT: 'ps-few', SOLD_OUT: 'ps-sold', UPCOMING: 'ps-upcoming' };
const fmtSft = n => n >= 1000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1) + 'k' : String(n);

export default function PropertiesView() {
  const { user, setPropSel, openModal, setConsoleAdmin, refreshDB, showToast } = useApp();
  const isAdmin = user?.role === ROLES.MGMT;
  const [q, setQ] = useState('');
  const [city, setCity] = useState('ALL');
  const [type, setType] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [sel, setSel] = useState(new Set());

  // selecting is an admin-only control (only admins may delete projects)
  const canSelect = isAdmin;
  useEffect(() => { setSel(new Set()); }, [q, city, type, status]); // clear selection when the visible set changes

  const all = getProperties();
  const cities = [...new Set(all.map(p => p.district).filter(Boolean))];

  let props = all;
  if (city !== 'ALL') props = props.filter(p => p.district === city);
  if (type !== 'ALL') props = props.filter(p => p.type === type);
  if (status !== 'ALL') props = props.filter(p => p.status === status);
  if (q) { const s = q.toLowerCase(); props = props.filter(p => (p.name + ' ' + p.district + ' ' + (p.area || '') + ' ' + (p.address || '')).toLowerCase().includes(s)); }

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
    if (!window.confirm(`Delete ${ids.length} project${ids.length > 1 ? 's' : ''}? This cannot be undone.`)) return;
    ids.forEach(id => deletePropertyFn(id));   // tombstones + cloud-deletes each (no resurrect on reload)
    setSel(new Set());
    refreshDB();
    showToast(`${ids.length} project${ids.length > 1 ? 's' : ''} deleted`, 'ok');
  };

  const totalUnits = props.reduce((s, p) => s + (p.totalUnits || 0), 0);
  const availUnits = props.reduce((s, p) => s + (p.unitsAvailable || 0), 0);
  const totalSft = props.reduce((s, p) => s + (p.totalSft || 0), 0);
  const stats = [
    { l: 'Projects', v: props.length },
    { l: 'Total Units', v: totalUnits },
    { l: 'Available', v: availUnits, c: 'var(--volt)' },
    { l: 'Sold', v: Math.max(0, totalUnits - availUnits), c: 'var(--green)' },
    { l: 'Total Area', v: totalSft ? fmtSft(totalSft) + ' sft' : '—' },
  ];

  const open = (id) => { setConsoleAdmin(false); setPropSel(id); openModal('project-console'); };

  return (
    <>
      <div className="inv-strip">
        {stats.map((s, i) => (
          <div key={i} className="inv-tile">
            <div className="inv-v" style={s.c ? { color: s.c } : null}>{s.v}</div>
            <div className="inv-l">{s.l}</div>
          </div>
        ))}
      </div>

      <div className="prop-toolbar">
        <div className="pt-search">
          <Mi>search</Mi>
          <input placeholder="Search project, area, address..." value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <select className="fsel" value={city} onChange={e => setCity(e.target.value)}>
          <option value="ALL">All cities</option>
          {cities.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="fsel" value={type} onChange={e => setType(e.target.value)}>
          <option value="ALL">All types</option>
          {PROPERTY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="fsel" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="ALL">All status</option>
          {Object.entries(PROPERTY_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <span className="fcount">{props.length}</span>
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
              <div className="lt-cell"><div style={{ minWidth: 0 }}>
                <div className="lt-n">{p.name}</div>
                <div className="lt-sub">{[p.area, p.district].filter(Boolean).join(' · ')}</div>
              </div></div>
              <div className="lt-cell"><span className="lt-src">{p.pricePerSqft ? '৳' + p.pricePerSqft.toLocaleString() : '—'}</span></div>
              <div className="lt-cell"><span className="lt-src">{p.sizeText || '—'}</span></div>
              <div className="lt-cell">
                {(() => {
                  // Units live in the blocks (variants): Block A 8 + Block B 8 = 16.
                  const blocks = p.variants || [];
                  const fromBlocks = blocks.reduce((s, v) => s + ((v.units || []).length || 0), 0);
                  const fromCodes = (p.saleableUnits || '').split(',').map(s => s.trim()).filter(Boolean).length;
                  const n = fromBlocks || fromCodes || p.unitsAvailable || p.totalUnits || 0;
                  const tip = blocks.length
                    ? blocks.map(v => `${v.name || 'Block'}: ${(v.units || []).length}`).join(' · ')
                    : (p.saleableUnits || '');
                  return <span className="lt-src" title={tip}>{n ? `${n} unit${n > 1 ? 's' : ''}` : '—'}</span>;
                })()}
              </div>
              <div className="lt-cell"><span className={`bdg ${PS_CLASS[p.status] || ''}`}>{PROPERTY_STATUS[p.status] || p.status}</span></div>
              <div className="lt-cell"><span className="lt-date">{p.handover || '—'}</span></div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
