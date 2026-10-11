import { useState, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';
import Mi from '../Mi.jsx';
import { ColorEmotionSelect } from '../ui/color-emotion-select.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { saveNewProject, saveProject, projectTypeOf, placedUnitIds } from '../../lib/projects.js';
import { PROJECT_TYPES } from '../../lib/constants.js';
import { useProjectToast } from './projectToast.js';
import './ProjectCatalog.css';

const nextStatus = (s) => (s === 'available' ? 'hold' : s === 'hold' ? 'sold' : 'available');
// The number in a code of the form prefix + number ("A12" → 12 for prefix
// "A"), or null when the code is named some other way.
const seqNo = (id, prefix) => {
  if (!id.startsWith(prefix)) return null;
  const rest = id.slice(prefix.length);
  return /^[1-9]\d*$/.test(rest) ? Number(rest) : null;
};
// The project with type `vid` brought to `want` units — see regenUnits.
// `kept`: units the count asked to remove that had to stay.
function withCount(prev, vid, want) {
  const placed = placedUnitIds(prev);
  let kept = 0;
  const variants = prev.variants.map(v => {
    if (v.id !== vid || want === v.units.length) return v;
    const prefix = v.unitPrefix || '';
    if (want > v.units.length) {
      const taken = new Set(prev.variants.flatMap(x => x.units.map(u => u.id)));
      const add = [];
      for (let n = 1; add.length < want - v.units.length; n++) {
        const code = prefix + n;
        if (!taken.has(code)) { add.push({ id: code, status: 'available' }); taken.add(code); }
      }
      return { ...v, units: [...v.units, ...add] };
    }
    const num = (id) => seqNo(id, prefix);
    const removable = v.units.filter(u => u.status === 'available' && !placed.has(u.id) && num(u.id) != null)
      .sort((a, b) => num(b.id) - num(a.id));
    const drop = new Set(removable.slice(0, v.units.length - want).map(u => u.id));
    kept = v.units.length - drop.size - want;
    return { ...v, units: v.units.filter(u => !drop.has(u.id)) };
  });
  return { next: { ...prev, variants }, kept };
}
const TYPE_REQUIRED = 'Project type is required.';
const TYPE_LOOK = { Residential: { color: '#54B848', emoji: '🏠' }, Commercial: { color: '#3B82F6', emoji: '🏢' } };
const TYPE_OPTIONS = PROJECT_TYPES.map(t => ({ value: t, label: t, ...TYPE_LOOK[t] }));

// Admin · Catalog — e-commerce-style product editor for a project. Writes to
// local state, only persisted globally when "Save product" is clicked.
// `isNew`: the project is an unsaved Add Property draft, so saving creates it.
// `actionsEl`: the console header's slot; Discard and Save render there.
// `ref` exposes isDirty() / isSaving() for the console's close guard.
export default function ProjectCatalog({ project, isNew = false, actionsEl, onDone, onSaved, ref }) {
  const { refreshDB } = useApp();
  const toast = useProjectToast();

  // Create a deep copy of the project for local editing so we don't mutate global state or jump around.
  // The same string is the baseline isDirty() compares against.
  const [baseline] = useState(() => JSON.stringify(project));
  const [p, setP] = useState(() => JSON.parse(baseline));
  const id = p.id;
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const leaveLabel = isNew ? 'Discard' : 'Preview / Discard';
  const ptype = projectTypeOf(p); // null = "Default", not chosen yet

  useImperativeHandle(ref, () => ({
    isDirty: () => JSON.stringify(p) !== baseline,
    isSaving: () => saving,
  }), [p, baseline, saving]);

  const up = (patch) => { setErr(''); setP(prev => ({ ...prev, ...patch })); };
  const [counts, setCounts] = useState({}); // unit-count edit buffers, committed on blur
  const [lk, setLk] = useState({ url: '', label: '' }); // add-link form

  const addMedia = (kind, item) => setP(prev => ({ ...prev, media: { ...prev.media, [kind]: [...(prev.media[kind] || []), item] } }));
  const removeMedia = (kind, index) => setP(prev => ({ ...prev, media: { ...prev.media, [kind]: (prev.media[kind] || []).filter((_, i) => i !== index) } }));

  const submitLink = () => {
    if (!lk.url.trim()) { toast.warning('Add a link first', 'Paste a URL, then press Add link.'); return; }
    addMedia('links', { url: lk.url.trim(), label: lk.label.trim() || lk.url.trim() });
    toast.success('Link added', `${lk.label.trim() || 'Attachment link'} added. Save the product to keep it.`);
    setLk({ url: '', label: '' });
  };

  // Same checks and the same media items as before; the notifications only
  // report the outcome, once per batch rather than once per file.
  const onFiles = (files, kind, asLabel) => {
    const noun = kind === 'images' ? 'photo' : 'PDF';
    const list = [...files];
    const tooBig = list.filter(f => f.size > 3 * 1024 * 1024);
    const ok = list.filter(f => f.size <= 3 * 1024 * 1024);
    if (tooBig.length) {
      toast.error(tooBig.length > 1 ? `${tooBig.length} files too large` : 'File too large',
        `${tooBig.map(f => f.name).join(', ')} ${tooBig.length > 1 ? 'are' : 'is'} over 3 MB. Use a link instead.`,
        'File too large (max 3MB) — use a link instead');
    }
    let left = ok.length;
    const added = [], failed = [];
    const settle = () => {
      if (--left > 0) return;
      const many = added.length > 1;
      if (added.length) {
        toast.success(`${noun === 'photo' ? 'Photo' : 'PDF'}${many ? 's' : ''} added`,
          `${many ? `${added.length} ${noun}s` : added[0]} added. Save the product to keep ${many ? 'them' : 'it'}.`);
      }
      if (failed.length) toast.error(`Couldn't read ${failed.length > 1 ? 'files' : 'file'}`, `${failed.join(', ')} could not be read. Try again.`);
    };
    ok.forEach(f => {
      const r = new FileReader();
      r.onload = () => { addMedia(kind, asLabel ? { label: f.name, url: r.result } : { name: f.name, url: r.result }); added.push(f.name); settle(); };
      r.onerror = () => { failed.push(f.name); settle(); };
      r.readAsDataURL(f);
    });
  };

  const addVariant = () => setP(prev => ({ ...prev, variants: [...prev.variants, { id: 'v' + Date.now(), name: 'New type', beds: 0, baths: 0, size: 0, listRate: 0, floorRate: 0, unitPrefix: '', units: [] }] }));
  const updateVariant = (vid, patch) => setP(prev => ({ ...prev, variants: prev.variants.map(v => v.id === vid ? { ...v, ...patch } : v) }));
  const dropVariant = (vid) => setP(prev => { const left = prev.variants.filter(v => v.id !== vid); return { ...prev, variants: left.length ? left : prev.variants }; });
  // A type whose units have boxes on a floor plan asks first: those boxes
  // would be left pointing at nothing.
  const removeVariant = (vid) => {
    const v = p.variants.find(x => x.id === vid);
    const placed = placedUnitIds(p);
    const n = (v?.units || []).filter(u => placed.has(u.id)).length;
    if (!n) { dropVariant(vid); return; }
    toast.confirm({
      title: `Remove ${v.name || 'this type'}?`,
      description: `${n} of its units ${n > 1 ? 'are' : 'is'} on a floor plan. Their boxes will no longer point at a unit.`,
      confirmLabel: 'Remove',
      onConfirm: () => { dropVariant(vid); },
    });
  };

  // "# of units" only adds or removes units named prefix + number. Units named
  // any other way (SHOP-07, a legacy U-01), units on hold or sold, and units
  // with a box on a floor plan are never removed by it, and leaving the field
  // with the number unchanged changes nothing.
  const regenUnits = (vid, count) => {
    const want = Math.max(0, count | 0);
    const kept = withCount(p, vid, want).kept;
    setP(prev => withCount(prev, vid, want).next);
    if (kept > 0) toast.info(`${kept} unit${kept > 1 ? 's' : ''} kept`, 'Units on hold, sold, on a floor plan or named differently are not removed by the count.');
  };

  // A new prefix renames the units that follow the old prefix + number, as long
  // as they are still available and not on a floor plan; the rest keep their codes.
  const setPrefix = (vid, prefix) => setP(prev => {
    const placed = placedUnitIds(prev);
    const taken = new Set(prev.variants.flatMap(x => x.units.map(u => u.id)));
    return {
      ...prev,
      variants: prev.variants.map(v => {
        if (v.id !== vid) return v;
        const units = v.units.map(u => {
          const n = seqNo(u.id, v.unitPrefix || '');
          if (n == null || u.status !== 'available' || placed.has(u.id)) return u;
          const code = prefix + n;
          if (code === u.id || taken.has(code)) return u;
          taken.delete(u.id); taken.add(code);
          return { ...u, id: code };
        });
        return { ...v, unitPrefix: prefix, units };
      }),
    };
  });

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

  const handleSave = async () => {
    if (saving) return;
    const name = (p.name || '').trim();
    if (!name) { setErr('Property name is required.'); toast.warning('Name required', 'Add a property name before saving.'); return; }
    if (!ptype) { setErr(TYPE_REQUIRED); toast.warning(TYPE_REQUIRED, 'Choose Residential or Commercial, then save.', TYPE_REQUIRED); return; }
    setErr('');
    setSaving(true);
    const draft = { ...p, name };
    const res = isNew ? await saveNewProject(draft) : await saveProject(id, draft);
    setSaving(false);
    // A failed save keeps the editor open with every field as typed.
    if (!res.ok) {
      setErr(`Not saved: ${res.error}.`);
      toast.error(isNew ? 'Property not saved' : 'Changes not saved', `${res.error.charAt(0).toUpperCase()}${res.error.slice(1)}. Your edits are still here.`, 'Project not saved');
      return;
    }
    refreshDB();
    toast.success(isNew ? 'Property saved' : 'Changes saved', isNew ? 'New property saved successfully.' : `${name} updated.`, 'Project saved');
    onSaved(res.id);
  };

  return (
    <div className="pcat">
      {/* Details */}
      <section className="pcat-sec">
        <div className="pcat-hd pcat-hd-type">
          <Mi>info</Mi>Property details
          {/* Required project type, saved in `purpose`. Until one is picked
              the select reads "Default", which is a placeholder, not an option. */}
          <ColorEmotionSelect className="pcat-ptype" options={TYPE_OPTIONS} label="PROJECT TYPE" placeholder="Default"
            value={ptype ?? ''} onChange={(t) => up({ purpose: t })} invalid={err === TYPE_REQUIRED} />
        </div>
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
              <label className="pcat-f"><span>Unit prefix</span><input value={v.unitPrefix} onChange={e => setPrefix(v.id, e.target.value)} placeholder="A" /></label>
              <label className="pcat-f"><span># of units</span>
                <input type="number" min="0" value={counts[v.id] ?? v.units.length}
                  onChange={e => setCounts(c => ({ ...c, [v.id]: e.target.value }))}
                  onBlur={e => { if (e.target.value.trim() !== '') regenUnits(v.id, parseInt(e.target.value, 10) || 0); setCounts(c => { const n = { ...c }; delete n[v.id]; return n; }); }} /></label>
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

      {/* Discard and Save live in the console header, not in a footer bar. On
          phones the .pc-act-tx words hide: Discard shows only its icon. */}
      {actionsEl && createPortal(
        <>
          {err && <div className="pc-warn"><Mi>error</Mi>{err}</div>}
          <button className="btn btn-g" disabled={saving} onClick={() => onDone()} aria-label={leaveLabel}><Mi>{isNew ? 'close' : 'visibility'}</Mi><span className="pc-act-tx">{leaveLabel}</span></button>
          <button className="btn btn-p" disabled={saving} onClick={handleSave}><Mi>save</Mi>{saving ? 'Saving…' : <>Save<span className="pc-act-tx"> project</span></>}</button>
        </>,
        actionsEl,
      )}
    </div>
  );
}
