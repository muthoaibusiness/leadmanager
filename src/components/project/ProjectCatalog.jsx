import { useState } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { updateProject } from '../../lib/projects.js';

const nextStatus = (s) => (s === 'available' ? 'hold' : s === 'hold' ? 'sold' : 'available');

// Admin · Catalog — e-commerce-style product editor for a project. Writes to
// local state, only persisted globally when "Save product" is clicked.
export default function ProjectCatalog({ project, onDone }) {
  const { refreshDB, showToast } = useApp();
  
  // Create a deep copy of the project for local editing so we don't mutate global state or jump around
  const [p, setP] = useState(() => JSON.parse(JSON.stringify(project)));
  const id = p.id;
  
  const up = (patch) => setP(prev => ({ ...prev, ...patch }));
  const [counts, setCounts] = useState({}); // unit-count edit buffers, committed on blur
  const [lk, setLk] = useState({ url: '', label: '' }); // add-link form

  const addMedia = (kind, item) => setP(prev => ({ ...prev, media: { ...prev.media, [kind]: [...(prev.media[kind] || []), item] } }));
  const removeMedia = (kind, index) => setP(prev => ({ ...prev, media: { ...prev.media, [kind]: (prev.media[kind] || []).filter((_, i) => i !== index) } }));

  const submitLink = () => { if (!lk.url.trim()) return; addMedia('links', { url: lk.url.trim(), label: lk.label.trim() || lk.url.trim() }); setLk({ url: '', label: '' }); };

  const onFiles = (files, kind, asLabel) => {
    [...files].forEach(f => {
      if (f.size > 3 * 1024 * 1024) { showToast('File too large (max 3MB) — use a link instead', 'err'); return; }
      const r = new FileReader();
      r.onload = () => addMedia(kind, asLabel ? { label: f.name, url: r.result } : { name: f.name, url: r.result });
      r.readAsDataURL(f);
    });
  };

  const addVariant = () => setP(prev => ({ ...prev, variants: [...prev.variants, { id: 'v' + Date.now(), name: 'New type', beds: 0, baths: 0, size: 0, listRate: 0, floorRate: 0, unitPrefix: '', units: [] }] }));
  const updateVariant = (vid, patch) => setP(prev => ({ ...prev, variants: prev.variants.map(v => v.id === vid ? { ...v, ...patch } : v) }));
  const removeVariant = (vid) => setP(prev => { const left = prev.variants.filter(v => v.id !== vid); return { ...prev, variants: left.length ? left : prev.variants }; });
  
  const regenUnits = (vid, count) => {
    setP(prev => ({
      ...prev,
      variants: prev.variants.map(v => {
        if (v.id !== vid) return v;
        const cur = new Map(v.units.map(u => [u.id, u]));
        const units = Array.from({ length: Math.max(0, count | 0) }, (_, i) => {
          const code = (v.unitPrefix || '') + (i + 1);
          return cur.get(code) || { id: code, status: 'available' };
        });
        return { ...v, units };
      })
    }));
  };

  const cycleUnit = (vid, uid) => {
    setP(prev => ({
      ...prev,
      variants: prev.variants.map(v => v.id === vid ? {
        ...v,
        units: v.units.map(u => (u.id === uid ? { ...u, status: nextStatus(u.status) } : u))
      } : v)
    }));
  };

  const addAddon = () => setP(prev => ({ ...prev, addons: [...(prev.addons || []), { id: 'ao' + Date.now(), name: 'Add-on', amount: 0, icon: 'add' }] }));
  const updateAddon = (aid, patch) => setP(prev => ({ ...prev, addons: (prev.addons || []).map(a => a.id === aid ? { ...a, ...patch } : a) }));
  const removeAddon = (aid) => setP(prev => ({ ...prev, addons: (prev.addons || []).filter(a => a.id !== aid) }));

  const handleSave = () => {
    updateProject(id, p);
    refreshDB();
    showToast('Project saved', 'ok');
    onDone();
  };

  return (
    <div className="pcat">
      {/* Details */}
      <section className="pcat-sec">
        <div className="pcat-hd"><Mi>info</Mi>Property details</div>
        <div className="pcat-grid">
          <label className="pcat-f pcat-f-full"><span>Property name</span><input value={p.name || ''} onChange={e => up({ name: e.target.value })} placeholder="e.g. Meadowcrest Residences" /></label>
          <label className="pcat-f"><span>Location</span><input value={p.address || ''} onChange={e => up({ address: e.target.value })} placeholder="Area · Block · City" /></label>
          <label className="pcat-f"><span>Listing #</span><input value={p.listing || ''} onChange={e => up({ listing: e.target.value })} placeholder="#MCR-0042" /></label>
          <label className="pcat-f"><span>Handover</span><input value={p.handover || ''} onChange={e => up({ handover: e.target.value })} placeholder="Dec 2027" /></label>
          <label className="pcat-f"><span>Approval</span><input value={p.approval || ''} onChange={e => up({ approval: e.target.value })} placeholder="RAJUK" /></label>
          <label className="pcat-f"><span>Fast-close discount %</span><input type="number" value={p.fastClosePct ?? 0} onChange={e => up({ fastClosePct: parseFloat(e.target.value) || 0 })} /></label>
          <label className="pcat-f"><span>Fast-close window (days)</span><input type="number" value={p.fastCloseDays ?? 0} onChange={e => up({ fastCloseDays: parseInt(e.target.value, 10) || 0 })} /></label>
        </div>
      </section>

      {/* Media */}
      <section className="pcat-sec">
        <div className="pcat-hd"><Mi>perm_media</Mi>Media &amp; attachments</div>
        <div className="pcat-drops">
          <label className="pcat-drop"><Mi>image</Mi><span>Add photos</span><input type="file" accept="image/*" multiple hidden onChange={e => { onFiles(e.target.files, 'images', false); e.target.value = ''; }} /></label>
          <label className="pcat-drop"><Mi>description</Mi><span>Add PDFs (brochure, floor plan)</span><input type="file" accept="application/pdf" multiple hidden onChange={e => { onFiles(e.target.files, 'docs', true); e.target.value = ''; }} /></label>
        </div>

        {p.media.images.length > 0 && (
          <div className="pcat-thumbs">
            {p.media.images.map((m, i) => (
              <div key={i} className="pcat-thumb">
                <img src={m.url} alt="" />{i === 0 && <span className="pcat-cover">Cover</span>}
                <button onClick={() => removeMedia('images', i)}><Mi>close</Mi></button>
              </div>
            ))}
          </div>
        )}

        {p.media.docs.map((d, i) => (
          <div key={'d' + i} className="pcat-item">
            <span className="pcat-item-ic"><Mi>picture_as_pdf</Mi></span>
            <div className="pcat-item-tx"><div className="pcat-item-n">{d.label || d.name || 'Document'}</div><div className="pcat-item-u">{(d.url || '').replace(/^data:.*/, 'uploaded file')}</div></div>
            <button className="pcat-item-x" onClick={() => removeMedia('docs', i)}><Mi>close</Mi></button>
          </div>
        ))}
        {p.media.links.map((l, i) => (
          <div key={'l' + i} className="pcat-item">
            <span className="pcat-item-ic"><Mi>link</Mi></span>
            <div className="pcat-item-tx"><div className="pcat-item-n">{l.label || 'Link'}</div><div className="pcat-item-u">{l.url}</div></div>
            <button className="pcat-item-x" onClick={() => removeMedia('links', i)}><Mi>close</Mi></button>
          </div>
        ))}

        <div className="pcat-addlink">
          <input placeholder="https://drive.google.com/…" value={lk.url} onChange={e => setLk(s => ({ ...s, url: e.target.value }))} />
          <input placeholder="Label (e.g. Drive folder)" value={lk.label} onChange={e => setLk(s => ({ ...s, label: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') submitLink(); }} />
          <button className="btn btn-p" onClick={submitLink}>Add link</button>
        </div>
        <div className="pcat-note">First photo becomes the hero cover. (TODO: uploads held in-memory — wire to real file storage.)</div>
      </section>

      {/* Unit types */}
      <section className="pcat-sec">
        <div className="pcat-hd"><Mi>apartment</Mi>Unit types <span className="pcat-note-inline">— variants. Leave a single type for a no-variant project.</span><button className="pcat-add" onClick={addVariant}><Mi>add</Mi>Add type</button></div>
        {p.variants.map(v => {
          const open = v.units.filter(u => u.status === 'available').length;
          const held = v.units.filter(u => u.status === 'hold').length;
          const sold = v.units.filter(u => u.status === 'sold').length;
          return (
          <div key={v.id} className="pcat-var">
            <div className="pcat-var-hd">
              <input className="pcat-var-name" value={v.name} onChange={e => updateVariant(v.id, { name: e.target.value })} />
              {p.variants.length > 1 && <button className="pcat-del" onClick={() => removeVariant(v.id)}><Mi>close</Mi></button>}
            </div>
            <div className="pcat-vgrid">
              <label className="pcat-f"><span>Beds</span><input type="number" value={v.beds} onChange={e => updateVariant(v.id, { beds: parseInt(e.target.value, 10) || 0 })} /></label>
              <label className="pcat-f"><span>Baths</span><input type="number" value={v.baths} onChange={e => updateVariant(v.id, { baths: parseInt(e.target.value, 10) || 0 })} /></label>
              <label className="pcat-f"><span>Size (sqft)</span><input type="number" value={v.size} onChange={e => updateVariant(v.id, { size: parseInt(e.target.value, 10) || 0 })} /></label>
              <label className="pcat-f"><span>List ৳/sqft</span><input type="number" value={v.listRate} onChange={e => updateVariant(v.id, { listRate: parseFloat(e.target.value) || 0 })} /></label>
              <label className="pcat-f"><span>Floor ৳/sqft</span><input type="number" value={v.floorRate} onChange={e => updateVariant(v.id, { floorRate: parseFloat(e.target.value) || 0 })} /></label>
            </div>
            <div className="pcat-vdiv" />
            <div className="pcat-vrow2">
              <label className="pcat-f"><span>Unit prefix</span><input value={v.unitPrefix} onChange={e => updateVariant(v.id, { unitPrefix: e.target.value })} placeholder="A" /></label>
              <label className="pcat-f"><span># of units</span>
                <input type="number" min="0" value={counts[v.id] ?? v.units.length}
                  onChange={e => setCounts(c => ({ ...c, [v.id]: e.target.value }))}
                  onBlur={e => { regenUnits(v.id, parseInt(e.target.value, 10) || 0); setCounts(c => { const n = { ...c }; delete n[v.id]; return n; }); }} /></label>
              <div className="pcat-vstat">{open} open · {held} held · {sold} sold</div>
            </div>
            {v.units.length > 0 && (
              <div className="pcat-ugrid">
                {v.units.map(u => (
                  <button key={u.id} className={`pcat-u pcat-u-${u.status}`} title={`${u.status} — tap to cycle`} onClick={() => cycleUnit(v.id, u.id)}>
                    {u.id.replace(/^U-/, '')}
                  </button>
                ))}
              </div>
            )}
            <div className="pcat-uhint">Tap a unit to cycle open → held → sold</div>
          </div>
          );
        })}
      </section>

      {/* Add-ons */}
      <section className="pcat-sec">
        <div className="pcat-hd"><Mi>add_circle</Mi>Add-ons<button className="pcat-add" onClick={addAddon}><Mi>add</Mi>Add row</button></div>
        {(p.addons || []).length === 0 && <div className="pcat-note">No add-ons. They're opt-in per deal; prices set here per project.</div>}
        {(p.addons || []).map(a => (
          <div key={a.id} className="pcat-addon">
            <span className="pcat-addon-ic"><Mi>{a.icon || 'add'}</Mi></span>
            <input className="pcat-addon-icin" value={a.icon} onChange={e => updateAddon(a.id, { icon: e.target.value })} placeholder="icon" />
            <input className="pcat-addon-nm" value={a.name} onChange={e => updateAddon(a.id, { name: e.target.value })} placeholder="Car parking" />
            <input className="pcat-addon-amt" type="number" value={a.amount} onChange={e => updateAddon(a.id, { amount: parseFloat(e.target.value) || 0 })} placeholder="0" />
            <button className="pcat-del" onClick={() => removeAddon(a.id)}><Mi>delete</Mi></button>
          </div>
        ))}
      </section>

      <div className="pcat-foot">
        <button className="btn btn-g" onClick={() => onDone()}><Mi>visibility</Mi>Preview / Discard</button>
        <button className="btn btn-p" onClick={handleSave}><Mi>save</Mi>Save product</button>
      </div>
    </div>
  );
}
