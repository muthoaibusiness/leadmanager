import { useState } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import {
  updateProject, addVariant, updateVariant, removeVariant, regenUnits,
  addAddon, updateAddon, removeAddon, addMedia, removeMedia,
} from '../../lib/projects.js';
import { fmtBDT } from '../../lib/helpers.js';

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

  const addLink = () => { addMedia(id, 'links', { label: '', url: '' }); refreshDB(); };
  const setLink = (i, patch) => { const links = p.media.links.map((l, j) => (j === i ? { ...l, ...patch } : l)); up({ media: { ...p.media, links } }); };

  const cycleUnit = (vid, uid) => {
    const v = p.variants.find(x => x.id === vid);
    updateVariant(id, vid, { units: v.units.map(u => (u.id === uid ? { ...u, status: nextStatus(u.status) } : u)) });
    refreshDB();
  };

  return (
    <div className="pcat">
      {/* Details */}
      <section className="pcat-sec">
        <div className="pcat-hd"><Mi>info</Mi>Details</div>
        <div className="pcat-grid">
          <label className="pcat-f pcat-f-full"><span>Project name</span><input value={p.name || ''} onChange={e => up({ name: e.target.value })} /></label>
          <label className="pcat-f pcat-f-full"><span>Location</span><input value={p.address || ''} onChange={e => up({ address: e.target.value })} /></label>
          <label className="pcat-f"><span>Listing #</span><input value={p.listing || ''} onChange={e => up({ listing: e.target.value })} /></label>
          <label className="pcat-f"><span>Handover</span><input value={p.handover || ''} onChange={e => up({ handover: e.target.value })} placeholder="March 2028" /></label>
          <label className="pcat-f pcat-f-full"><span>Approval</span><input value={p.approval || ''} onChange={e => up({ approval: e.target.value })} placeholder="RAJUK approved" /></label>
          <label className="pcat-f"><span>Fast-close %</span><input type="number" value={p.fastClosePct ?? 0} onChange={e => up({ fastClosePct: parseFloat(e.target.value) || 0 })} /></label>
          <label className="pcat-f"><span>Fast-close window (days)</span><input type="number" value={p.fastCloseDays ?? 0} onChange={e => up({ fastCloseDays: parseInt(e.target.value, 10) || 0 })} /></label>
        </div>
      </section>

      {/* Media */}
      <section className="pcat-sec">
        <div className="pcat-hd"><Mi>perm_media</Mi>Media &amp; attachments</div>
        <div className="pcat-media-btns">
          <label className="btn btn-g"><Mi>add_photo_alternate</Mi>Add photos<input type="file" accept="image/*" multiple hidden onChange={e => { onFiles(e.target.files, 'images', false); e.target.value = ''; }} /></label>
          <label className="btn btn-g"><Mi>picture_as_pdf</Mi>Add PDFs<input type="file" accept="application/pdf" multiple hidden onChange={e => { onFiles(e.target.files, 'docs', true); e.target.value = ''; }} /></label>
          <button className="btn btn-g" onClick={addLink}><Mi>add_link</Mi>Add link</button>
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
          <div key={i} className="pcat-row"><Mi>picture_as_pdf</Mi><span className="pcat-row-t">{d.label || d.name || 'Document'}</span><button onClick={() => { removeMedia(id, 'docs', i); refreshDB(); }}><Mi>close</Mi></button></div>
        ))}
        {p.media.links.map((l, i) => (
          <div key={i} className="pcat-linkrow">
            <input placeholder="https://…" value={l.url} onChange={e => setLink(i, { url: e.target.value })} />
            <input placeholder="Label" value={l.label} onChange={e => setLink(i, { label: e.target.value })} />
            <button onClick={() => { removeMedia(id, 'links', i); refreshDB(); }}><Mi>close</Mi></button>
          </div>
        ))}
        <div className="pcat-note">First photo becomes the hero cover. (TODO: uploads currently held in-memory — wire to real file storage.)</div>
      </section>

      {/* Unit types */}
      <section className="pcat-sec">
        <div className="pcat-hd"><Mi>apartment</Mi>Unit types<button className="pcat-add" onClick={() => { addVariant(id); refreshDB(); }}><Mi>add</Mi>Add type</button></div>
        {p.variants.map(v => (
          <div key={v.id} className="pcat-var">
            <div className="pcat-var-hd">
              <input className="pcat-var-name" value={v.name} onChange={e => { updateVariant(id, v.id, { name: e.target.value }); refreshDB(); }} />
              {p.variants.length > 1 && <button className="pcat-del" onClick={() => { removeVariant(id, v.id); refreshDB(); }}><Mi>delete</Mi></button>}
            </div>
            <div className="pcat-grid">
              <label className="pcat-f"><span>Beds</span><input type="number" value={v.beds} onChange={e => { updateVariant(id, v.id, { beds: parseInt(e.target.value, 10) || 0 }); refreshDB(); }} /></label>
              <label className="pcat-f"><span>Baths</span><input type="number" value={v.baths} onChange={e => { updateVariant(id, v.id, { baths: parseInt(e.target.value, 10) || 0 }); refreshDB(); }} /></label>
              <label className="pcat-f"><span>Size (sqft)</span><input type="number" value={v.size} onChange={e => { updateVariant(id, v.id, { size: parseInt(e.target.value, 10) || 0 }); refreshDB(); }} /></label>
              <label className="pcat-f"><span>List rate ৳/sqft</span><input type="number" value={v.listRate} onChange={e => { updateVariant(id, v.id, { listRate: parseFloat(e.target.value) || 0 }); refreshDB(); }} /></label>
              <label className="pcat-f"><span>Floor rate ৳/sqft</span><input type="number" value={v.floorRate} onChange={e => { updateVariant(id, v.id, { floorRate: parseFloat(e.target.value) || 0 }); refreshDB(); }} /></label>
              <label className="pcat-f"><span>Unit prefix</span><input value={v.unitPrefix} onChange={e => { updateVariant(id, v.id, { unitPrefix: e.target.value }); refreshDB(); }} placeholder="A" /></label>
              <label className="pcat-f"><span>Unit count</span>
                <input type="number" min="0" value={counts[v.id] ?? v.units.length}
                  onChange={e => setCounts(c => ({ ...c, [v.id]: e.target.value }))}
                  onBlur={e => { regenUnits(id, v.id, parseInt(e.target.value, 10) || 0); refreshDB(); setCounts(c => { const n = { ...c }; delete n[v.id]; return n; }); }} /></label>
            </div>
            <div className="pcat-vprice">List {fmtBDT(v.listRate * v.size)} · Floor {fmtBDT(v.floorRate * v.size)}</div>
            {v.units.length > 0 && (
              <div className="ub-grid pcat-units">
                {v.units.map(u => (
                  <button key={u.id} className={`ub-seat ${u.status === 'sold' ? 'ub-sold' : u.status === 'hold' ? 'ub-locked' : 'ub-available'}`} title={`${u.status} — click to cycle`} onClick={() => cycleUnit(v.id, u.id)}>
                    {u.id.replace(/^U-/, '')}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
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
        <button className="btn btn-p" onClick={() => { showToast('Project saved', 'ok'); onDone(); }}><Mi>save</Mi>Save</button>
      </div>
    </div>
  );
}
