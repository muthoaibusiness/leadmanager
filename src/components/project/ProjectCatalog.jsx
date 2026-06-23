import { useState } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import {
  updateProject, addVariant, updateVariant, removeVariant, regenUnits,
  addAddon, updateAddon, removeAddon, addMedia, removeMedia,
} from '../../lib/projects.js';

const nextStatus = (s) => (s === 'available' ? 'hold' : s === 'hold' ? 'sold' : 'available');

// Admin · Catalog — e-commerce-style product editor for a project. Writes live to
// the property via the projects data module; lists only rebuild on add/remove so
// typing never loses focus (inputs are keyed by stable id).
export default function ProjectCatalog({ project, onDone }) {
  const { refreshDB, showToast } = useApp();
  const p = project;
  const id = p.id;
  const up = (patch) => { updateProject(id, patch); refreshDB(); };
  const [counts, setCounts] = useState({}); // unit-count edit buffers, committed on blur
  const [lk, setLk] = useState({ url: '', label: '' }); // add-link form
  const submitLink = () => { if (!lk.url.trim()) return; addMedia(id, 'links', { url: lk.url.trim(), label: lk.label.trim() || lk.url.trim() }); refreshDB(); setLk({ url: '', label: '' }); };

  const onFiles = (files, kind, asLabel) => {
    [...files].forEach(f => {
      if (f.size > 3 * 1024 * 1024) { showToast('File too large (max 3MB) — use a link instead', 'err'); return; }
      const r = new FileReader();
      // TODO(storage): upload to real file storage and persist the returned URL
      // instead of holding a base64 data URL in the property object.
      r.onload = () => { addMedia(id, kind, asLabel ? { label: f.name, url: r.result } : { name: f.name, url: r.result }); refreshDB(); };
      r.readAsDataURL(f);
    });
  };


  const cycleUnit = (vid, uid) => {
    const v = p.variants.find(x => x.id === vid);
    updateVariant(id, vid, { units: v.units.map(u => (u.id === uid ? { ...u, status: nextStatus(u.status) } : u)) });
    refreshDB();
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
                <button onClick={() => { removeMedia(id, 'images', i); refreshDB(); }}><Mi>close</Mi></button>
              </div>
            ))}
          </div>
        )}

        {p.media.docs.map((d, i) => (
          <div key={'d' + i} className="pcat-item">
            <span className="pcat-item-ic"><Mi>picture_as_pdf</Mi></span>
            <div className="pcat-item-tx"><div className="pcat-item-n">{d.label || d.name || 'Document'}</div><div className="pcat-item-u">{(d.url || '').replace(/^data:.*/, 'uploaded file')}</div></div>
            <button className="pcat-item-x" onClick={() => { removeMedia(id, 'docs', i); refreshDB(); }}><Mi>close</Mi></button>
          </div>
        ))}
        {p.media.links.map((l, i) => (
          <div key={'l' + i} className="pcat-item">
            <span className="pcat-item-ic"><Mi>link</Mi></span>
            <div className="pcat-item-tx"><div className="pcat-item-n">{l.label || 'Link'}</div><div className="pcat-item-u">{l.url}</div></div>
            <button className="pcat-item-x" onClick={() => { removeMedia(id, 'links', i); refreshDB(); }}><Mi>close</Mi></button>
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
        <div className="pcat-hd"><Mi>apartment</Mi>Unit types <span className="pcat-note-inline">— variants. Leave a single type for a no-variant project.</span><button className="pcat-add" onClick={() => { addVariant(id); refreshDB(); }}><Mi>add</Mi>Add type</button></div>
        {p.variants.map(v => {
          const open = v.units.filter(u => u.status === 'available').length;
          const held = v.units.filter(u => u.status === 'hold').length;
          const sold = v.units.filter(u => u.status === 'sold').length;
          return (
          <div key={v.id} className="pcat-var">
            <div className="pcat-var-hd">
              <input className="pcat-var-name" value={v.name} onChange={e => { updateVariant(id, v.id, { name: e.target.value }); refreshDB(); }} />
              {p.variants.length > 1 && <button className="pcat-del" onClick={() => { removeVariant(id, v.id); refreshDB(); }}><Mi>close</Mi></button>}
            </div>
            <div className="pcat-vgrid">
              <label className="pcat-f"><span>Beds</span><input type="number" value={v.beds} onChange={e => { updateVariant(id, v.id, { beds: parseInt(e.target.value, 10) || 0 }); refreshDB(); }} /></label>
              <label className="pcat-f"><span>Baths</span><input type="number" value={v.baths} onChange={e => { updateVariant(id, v.id, { baths: parseInt(e.target.value, 10) || 0 }); refreshDB(); }} /></label>
              <label className="pcat-f"><span>Size (sqft)</span><input type="number" value={v.size} onChange={e => { updateVariant(id, v.id, { size: parseInt(e.target.value, 10) || 0 }); refreshDB(); }} /></label>
              <label className="pcat-f"><span>List ৳/sqft</span><input type="number" value={v.listRate} onChange={e => { updateVariant(id, v.id, { listRate: parseFloat(e.target.value) || 0 }); refreshDB(); }} /></label>
              <label className="pcat-f"><span>Floor ৳/sqft</span><input type="number" value={v.floorRate} onChange={e => { updateVariant(id, v.id, { floorRate: parseFloat(e.target.value) || 0 }); refreshDB(); }} /></label>
            </div>
            <div className="pcat-vdiv" />
            <div className="pcat-vrow2">
              <label className="pcat-f"><span>Unit prefix</span><input value={v.unitPrefix} onChange={e => { updateVariant(id, v.id, { unitPrefix: e.target.value }); refreshDB(); }} placeholder="A" /></label>
              <label className="pcat-f"><span># of units</span>
                <input type="number" min="0" value={counts[v.id] ?? v.units.length}
                  onChange={e => setCounts(c => ({ ...c, [v.id]: e.target.value }))}
                  onBlur={e => { regenUnits(id, v.id, parseInt(e.target.value, 10) || 0); refreshDB(); setCounts(c => { const n = { ...c }; delete n[v.id]; return n; }); }} /></label>
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
        <div className="pcat-hd"><Mi>add_circle</Mi>Add-ons<button className="pcat-add" onClick={() => { addAddon(id); refreshDB(); }}><Mi>add</Mi>Add row</button></div>
        {(p.addons || []).length === 0 && <div className="pcat-note">No add-ons. They're opt-in per deal; prices set here per project.</div>}
        {(p.addons || []).map(a => (
          <div key={a.id} className="pcat-addon">
            <span className="pcat-addon-ic"><Mi>{a.icon || 'add'}</Mi></span>
            <input className="pcat-addon-icin" value={a.icon} onChange={e => { updateAddon(id, a.id, { icon: e.target.value }); refreshDB(); }} placeholder="icon" />
            <input className="pcat-addon-nm" value={a.name} onChange={e => { updateAddon(id, a.id, { name: e.target.value }); refreshDB(); }} placeholder="Car parking" />
            <input className="pcat-addon-amt" type="number" value={a.amount} onChange={e => { updateAddon(id, a.id, { amount: parseFloat(e.target.value) || 0 }); refreshDB(); }} placeholder="0" />
            <button className="pcat-del" onClick={() => { removeAddon(id, a.id); refreshDB(); }}><Mi>delete</Mi></button>
          </div>
        ))}
      </section>

      <div className="pcat-foot">
        <button className="btn btn-g" onClick={() => onDone()}><Mi>visibility</Mi>Preview</button>
        <button className="btn btn-p" onClick={() => { showToast('Project saved', 'ok'); onDone(); }}><Mi>save</Mi>Save product</button>
      </div>
    </div>
  );
}
