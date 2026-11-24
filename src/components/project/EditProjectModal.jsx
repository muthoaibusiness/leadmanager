import { useState } from 'react';
import Mi from '../Mi.jsx';
import BkSelect from '../booking/BkSelect.jsx';
import { useApp } from '../../context/AppContext.jsx';
import useChanged from '../../hooks/useChanged.js';
import useDiscardGuard from '../../hooks/useDiscardGuard.js';
import { toProject, saveProject } from '../../lib/projects.js';
import { uploadProjectMedia } from '../../lib/supabase.js';
import { PROJECT_TYPES, PROPERTY_STATUS } from '../../lib/constants.js';
import { taka } from '../../lib/floorPlan.js';
import '../booking/ShopBooking.css';
import './AddPropertyWizard.css';

// Edit project, in the Booking page's look and laid out like the Add Property wizard (same
// rail, same fields), but every section is open at once: Basics, Building, Unit types, Photos &
// files. It changes the project's details, type rates and media. It never touches the floor
// plans or a unit's status. Units are added with a new type and removed only while all of
// them are still available.

const STEPS = [
  ['basics', 'Basics', 'Name, type, place'],
  ['building', 'Building', 'Land, storeys, handover'],
  ['types', 'Unit types', 'Sizes and rates'],
  ['media', 'Photos & files', 'Cover, PDFs, links'],
];
const KIND_ICON = { Residential: 'home', Commercial: 'storefront' };
const KIND_HINT = { Residential: 'Apartments, duplexes, villas', Commercial: 'Shops, offices, showrooms' };
const IMG_OK = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_MB = 25;
const num = (v) => parseFloat(v) || 0;
const str = (v) => (v == null ? '' : String(v));

function fromProject(p) {
  const pr = toProject(p);
  return {
    name: str(pr.name), developer: str(pr.developer), kind: PROJECT_TYPES.includes(pr.purpose) ? pr.purpose : '', status: pr.status || 'AVAILABLE',
    address: str(pr.address), district: str(pr.district), area: str(pr.area), handover: str(pr.handover), approval: str(pr.approval), listing: str(pr.listing),
    landArea: str(pr.landArea), storeys: str(pr.storeys), facing: str(pr.facing), construction: str(pr.construction || ''),
    sizeText: str(pr.sizeText), amenities: (pr.amenities || []).join(', '),
    fastClosePct: str(pr.fastClosePct), fastCloseDays: str(pr.fastCloseDays),
    types: pr.variants.map(v => ({
      id: v.id, name: str(v.name), size: str(v.size || ''), listRate: str(v.listRate || ''), floorRate: str(v.floorRate || ''),
      beds: str(v.beds || ''), baths: str(v.baths || ''), prefix: str(v.unitPrefix), units: v.units || [], count: '', fresh: false,
    })),
    images: pr.media.images.map(i => ({ ...i })), docs: pr.media.docs.map(d => ({ ...d })), links: pr.media.links.map(l => ({ ...l })),
  };
}

export default function EditProjectModal() {
  const { modal, closeModal, propEdit, user, refreshDB, showToast } = useApp();
  const isOpen = modal === 'property-edit';
  const [step, setStep] = useState(0);
  const [f, setF] = useState(null);
  const [base, setBase] = useState('');
  const [photos, setPhotos] = useState([]); // { file, url } waiting to upload
  const [pdfs, setPdfs] = useState([]);
  const [lk, setLk] = useState({ url: '', label: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  if (useChanged(isOpen ? propEdit : null) && isOpen && propEdit?.id) {
    const init = fromProject(propEdit);
    setF(init); setBase(JSON.stringify(init)); setStep(0); setPhotos([]); setPdfs([]); setLk({ url: '', label: '' }); setErr(''); setSaving(false);
  }

  const dirty = () => !!f && (JSON.stringify(f) !== base || photos.length + pdfs.length > 0);
  const g = useDiscardGuard({ isOpen: isOpen && !!f, isDirty: dirty, onClose: closeModal, busy: saving, ask: { title: 'Discard your changes?', description: 'The edits have not been saved.' } });
  if (!isOpen || !f || !propEdit?.id) return null;

  const up = (patch) => { setErr(''); setF(s => ({ ...s, ...patch })); };
  const upType = (id, patch) => up({ types: f.types.map(t => (t.id === id ? { ...t, ...patch } : t)) });
  const addType = () => up({ types: [...f.types, { id: 'v' + Date.now().toString(36), name: 'New type', size: '', listRate: '', floorRate: '', beds: '', baths: '', prefix: '', units: [], count: '', fresh: true }] });
  const locked = (t) => t.units.some(u => u.status !== 'available');
  const dropType = (id) => up({ types: f.types.filter(t => t.id !== id) });

  const problems = [];
  if (!f.name.trim()) problems.push('The project needs a name.');
  if (!f.types.length) problems.push('Keep at least one unit type.');
  f.types.forEach(t => {
    if (!t.name.trim()) problems.push('Every unit type needs a name.');
    if (t.fresh && num(t.count) > 0 && !t.prefix.trim()) problems.push(`Give "${t.name || 'the new type'}" a code prefix for its units.`);
  });

  const addFiles = (list, kind) => {
    const bads = [];
    [...list].forEach(file => {
      const okType = kind === 'photo' ? IMG_OK.includes(file.type) : file.type === 'application/pdf';
      if (!okType) { bads.push(`${file.name}: ${kind === 'photo' ? 'use PNG, JPG or WebP' : 'use a PDF'}`); return; }
      if (file.size > MAX_MB * 1024 * 1024) { bads.push(`${file.name}: over ${MAX_MB} MB`); return; }
      if (kind === 'photo') setPhotos(p => [...p, { file, url: URL.createObjectURL(file) }]); else setPdfs(p => [...p, { file }]);
    });
    if (bads.length) showToast(bads.join(' · '), 'err');
  };
  const addLink = () => {
    if (!lk.url.trim()) return;
    up({ links: [...f.links, { url: lk.url.trim(), label: lk.label.trim() || lk.url.trim() }] });
    setLk({ url: '', label: '' });
  };
  const makeCover = (i) => up({ images: [f.images[i], ...f.images.filter((_, j) => j !== i)] });

  const save = async () => {
    if (saving || problems.length) return;
    setSaving(true); setErr('');
    const cid = user?.companyId || 'company';
    const images = f.images.map(i => ({ ...i }));
    const docs = f.docs.map(d => ({ ...d }));
    for (const [i, p] of photos.entries()) {
      const ext = p.file.type === 'image/png' ? 'png' : p.file.type === 'image/webp' ? 'webp' : 'jpg';
      const r = await uploadProjectMedia(p.file, `${cid}/${propEdit.id}/media/photo-${Date.now()}-${i}.${ext}`);
      if (!r.ok) { setSaving(false); setErr(`Not saved: ${p.file.name} could not be uploaded (${r.error}).`); return; }
      images.push({ name: p.file.name, url: r.url });
    }
    for (const [i, d] of pdfs.entries()) {
      const r = await uploadProjectMedia(d.file, `${cid}/${propEdit.id}/media/doc-${Date.now()}-${i}.pdf`);
      if (!r.ok) { setSaving(false); setErr(`Not saved: ${d.file.name} could not be uploaded (${r.error}).`); return; }
      docs.push({ label: d.file.name, url: r.url });
    }
    const variants = f.types.map(t => {
      const made = t.fresh ? Array.from({ length: Math.max(0, parseInt(t.count, 10) || 0) }, (_, i) => ({ id: `${t.prefix.trim()}${i + 1}`, status: 'available' })) : t.units;
      return {
        ...(propEdit.variants || []).find(v => v.id === t.id), id: t.id, name: t.name.trim(), size: num(t.size), listRate: num(t.listRate), floorRate: num(t.floorRate),
        beds: parseInt(t.beds, 10) || 0, baths: parseInt(t.baths, 10) || 0, unitPrefix: t.prefix.trim(), units: made,
      };
    });
    const res = await saveProject(propEdit.id, {
      name: f.name.trim(), developer: f.developer.trim(), purpose: f.kind || propEdit.purpose, status: f.status,
      address: f.address.trim(), district: f.district.trim(), area: f.area.trim(), handover: f.handover.trim(), approval: f.approval.trim(), listing: f.listing.trim(),
      landArea: f.landArea.trim(), storeys: f.storeys.trim(), facing: f.facing.trim(), construction: Math.max(0, Math.min(100, num(f.construction))),
      sizeText: f.sizeText.trim(), amenities: f.amenities.split(',').map(s => s.trim()).filter(Boolean),
      fastClosePct: num(f.fastClosePct), fastCloseDays: parseInt(f.fastCloseDays, 10) || 0,
      variants, media: { images, docs, links: f.links }, images: images.map(i => i.url).filter(Boolean).slice(0, 3),
    });
    setSaving(false);
    if (!res.ok) { setErr(`Not saved: ${res.error}. Your changes are still here.`); return; }
    refreshDB();
    showToast('Project updated', 'ok');
    closeModal();
  };

  const field = (label, key, props = {}) => (
    <label className="pw-f"><span className="bk-cap">{label}</span><input value={f[key]} onChange={e => up({ [key]: e.target.value })} {...props} /></label>
  );
  const tfield = (t, label, key, props = {}) => (
    <label className="pw-f"><span className="bk-cap">{label}</span><input value={t[key]} onChange={e => upType(t.id, { [key]: e.target.value })} {...props} /></label>
  );
  const nUnits = f.types.reduce((s, t) => s + (t.fresh ? parseInt(t.count, 10) || 0 : t.units.length), 0);
  const head = STEPS[step];

  return (
    <div className="pw-scrim" {...g.backdropProps}>
      <div className="bk pw" role="dialog" aria-label="Edit project" {...g.modalProps}>
        <aside className="pw-rail">
          <div className="pw-rail-h"><span className="bk-eyebrow">Edit project</span><b>{f.name.trim() || 'Untitled'}</b></div>
          <ol>
            {STEPS.map(([k, l, s], i) => (
              <li key={k}>
                <button type="button" className="bk-floor" aria-pressed={step === i} onClick={() => setStep(i)}>
                  <span className="bk-fl">{i + 1}</span>
                  <span className="pw-st"><b>{l}</b><i>{s}</i></span>
                </button>
              </li>
            ))}
          </ol>
        </aside>

        <section className="pw-main">
          <header className="pw-head">
            <h3>{head[1]}</h3>
            <button type="button" className="bk-close" aria-label="Close" onClick={g.requestClose}><Mi>close</Mi></button>
          </header>

          <div className="pw-body">
            {step === 0 && (
              <>
                {field('Project name', 'name', { autoFocus: true, className: 'pw-big' })}
                <div className="pw-f">
                  <span className="bk-cap">Project type</span>
                  <div className="pw-kinds" role="group" aria-label="Project type">
                    {PROJECT_TYPES.map(k => (
                      <button key={k} type="button" className="pw-kind" aria-pressed={f.kind === k} onClick={() => up({ kind: k })}>
                        <Mi>{KIND_ICON[k]}</Mi><b>{k}</b><span>{KIND_HINT[k]}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="pw-grid">
                  <div className="pw-f"><span className="bk-cap">Sales status</span>
                    <BkSelect label="Sales status" value={f.status} onChange={v => up({ status: v })} options={Object.entries(PROPERTY_STATUS).map(([value, label]) => ({ value, label }))} /></div>
                  {field('Developer', 'developer')}
                  {field('Address', 'address', { placeholder: 'Area · Block · City' })}
                  {field('Area', 'area', { placeholder: 'e.g. Laldighi East' })}
                  {field('District', 'district', { placeholder: 'e.g. Chattogram' })}
                  {field('Listing no.', 'listing')}
                </div>
              </>
            )}

            {step === 1 && (
              <>
                <div className="pw-grid">
                  {field('Handover', 'handover', { placeholder: 'Dec 2027' })}
                  {field('Approval', 'approval', { placeholder: 'e.g. CDA 25.47…' })}
                  {field('Land area', 'landArea', { placeholder: '17 Katha' })}
                  {field('Storeys', 'storeys', { placeholder: 'B + SB + G + 9 + Roof' })}
                  {field('Facing', 'facing', { placeholder: 'North-West' })}
                  {field('Unit sizes', 'sizeText', { placeholder: '85 - 1690 sft' })}
                  {field('Construction done (%)', 'construction', { type: 'number', min: 0, max: 100, inputMode: 'numeric' })}
                </div>
                <label className="pw-f"><span className="bk-cap">Amenities (separate with commas)</span>
                  <input value={f.amenities} onChange={e => up({ amenities: e.target.value })} placeholder="Lift, Car parking, Generator backup" /></label>
                <div className="pw-grid">
                  {field('Fast-close discount (%)', 'fastClosePct', { type: 'number', min: 0, inputMode: 'decimal' })}
                  {field('Fast-close window (days)', 'fastCloseDays', { type: 'number', min: 0, inputMode: 'numeric' })}
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <p className="bk-hint">Sizes and rates apply to every unit of the type that has no price of its own. Units already sold, held or placed on a floor plan keep their status.</p>
                {f.types.map(t => {
                  const n = t.fresh ? parseInt(t.count, 10) || 0 : t.units.length;
                  const open = t.units.filter(u => u.status === 'available').length;
                  const perUnit = num(t.size) * num(t.listRate);
                  return (
                    <div className="pw-type" key={t.id}>
                      <div className="pw-type-h">
                        <input className="pw-type-n" value={t.name} onChange={e => upType(t.id, { name: e.target.value })} aria-label="Type name" />
                        {f.types.length > 1 && (
                          <button type="button" className="bk-close" aria-label={`Remove ${t.name}`} disabled={locked(t)}
                            title={locked(t) ? 'Some units are held or sold, so this type cannot be removed' : 'Remove type'} onClick={() => dropType(t.id)}><Mi>delete</Mi></button>
                        )}
                      </div>
                      <div className="pw-grid pw-grid4">
                        {tfield(t, 'Size (sq ft)', 'size', { type: 'number', min: 0, inputMode: 'numeric', placeholder: '0' })}
                        {tfield(t, 'List rate (৳ / sq ft)', 'listRate', { type: 'number', min: 0, inputMode: 'numeric', placeholder: '0' })}
                        {tfield(t, 'Floor rate (৳ / sq ft)', 'floorRate', { type: 'number', min: 0, inputMode: 'numeric', placeholder: '0' })}
                        {f.kind === 'Residential' && tfield(t, 'Beds', 'beds', { type: 'number', min: 0, inputMode: 'numeric' })}
                        {f.kind === 'Residential' && tfield(t, 'Baths', 'baths', { type: 'number', min: 0, inputMode: 'numeric' })}
                        {t.fresh && tfield(t, 'Code prefix', 'prefix', { placeholder: 'S' })}
                        {t.fresh && tfield(t, 'Number of units', 'count', { type: 'number', min: 0, inputMode: 'numeric', placeholder: '0' })}
                      </div>
                      <div className="pw-sum">
                        <span><b>{n}</b> unit{n === 1 ? '' : 's'}{!t.fresh && n ? ` · ${open} available` : ''}</span>
                        {perUnit > 0 && <span>{taka(perUnit)} per unit</span>}
                      </div>
                    </div>
                  );
                })}
                <button type="button" className="bk-btn" onClick={addType}><Mi>add</Mi>Add a unit type</button>
              </>
            )}

            {step === 3 && (
              <>
                <p className="bk-hint">The first photo is the cover on the Booking page and the project list.</p>
                {(f.images.length > 0 || photos.length > 0) && (
                  <div className="pw-thumbs">
                    {f.images.map((im, i) => (
                      <div key={im.url + i} className="pw-thumb"><img src={im.url} alt="" onError={e => { e.currentTarget.style.opacity = '.25'; }} />
                        {i === 0 ? <span className="pw-cover">Cover</span> : <button type="button" className="pw-mk" onClick={() => makeCover(i)}>Make cover</button>}
                        <button type="button" aria-label="Remove photo" onClick={() => up({ images: f.images.filter((_, j) => j !== i) })}><Mi>close</Mi></button></div>
                    ))}
                    {photos.map((p, i) => (
                      <div key={p.url} className="pw-thumb"><img src={p.url} alt="" /><span className="pw-cover">New</span>
                        <button type="button" aria-label="Remove photo" onClick={() => setPhotos(x => x.filter((_, j) => j !== i))}><Mi>close</Mi></button></div>
                    ))}
                  </div>
                )}
                <div className="pw-drops">
                  <label className="pw-drop"><Mi>image</Mi><b>Add photos</b><span>PNG, JPG, WebP</span>
                    <input type="file" hidden multiple accept="image/png,image/jpeg,image/webp" onChange={e => { addFiles(e.target.files, 'photo'); e.target.value = ''; }} /></label>
                  <label className="pw-drop"><Mi>picture_as_pdf</Mi><b>Add PDFs</b><span>Brochure, price list, plans</span>
                    <input type="file" hidden multiple accept="application/pdf" onChange={e => { addFiles(e.target.files, 'pdf'); e.target.value = ''; }} /></label>
                </div>
                {f.docs.map((d, i) => (
                  <div key={d.url + i} className="pw-item"><Mi>picture_as_pdf</Mi><span>{d.label || d.name || d.url}</span>
                    <button type="button" className="bk-close" aria-label="Remove file" onClick={() => up({ docs: f.docs.filter((_, j) => j !== i) })}><Mi>close</Mi></button></div>
                ))}
                {pdfs.map((d, i) => (
                  <div key={d.file.name + i} className="pw-item"><Mi>picture_as_pdf</Mi><span>{d.file.name}</span><em className="bk-cap">new</em>
                    <button type="button" className="bk-close" aria-label="Remove file" onClick={() => setPdfs(x => x.filter((_, j) => j !== i))}><Mi>close</Mi></button></div>
                ))}
                {f.links.map((l, i) => (
                  <div key={l.url + i} className="pw-item"><Mi>link</Mi><span>{l.label}</span>
                    <button type="button" className="bk-close" aria-label="Remove link" onClick={() => up({ links: f.links.filter((_, j) => j !== i) })}><Mi>close</Mi></button></div>
                ))}
                <div className="pw-grid">
                  <label className="pw-f"><span className="bk-cap">Link (Drive, video…)</span>
                    <input value={lk.url} onChange={e => setLk(s => ({ ...s, url: e.target.value }))} placeholder="https://…" /></label>
                  <label className="pw-f"><span className="bk-cap">Label (use “Brochure” for the brochure)</span>
                    <input value={lk.label} onChange={e => setLk(s => ({ ...s, label: e.target.value }))} placeholder="Brochure" onKeyDown={e => { if (e.key === 'Enter') addLink(); }} /></label>
                </div>
                <button type="button" className="bk-btn" onClick={addLink} disabled={!lk.url.trim()}><Mi>add</Mi>Add link</button>
              </>
            )}

            {problems.map(m => <div key={m} className="pw-warn"><Mi>error</Mi>{m}</div>)}
            {err && <div className="pw-warn"><Mi>error</Mi>{err}</div>}
          </div>

          <footer className="pw-foot">
            <span className="bk-cap">{problems[0] || `${nUnits} unit${nUnits === 1 ? '' : 's'} in ${f.types.length} type${f.types.length === 1 ? '' : 's'}`}</span>
            <div className="pw-acts">
              {step > 0 && <button type="button" className="bk-btn" disabled={saving} onClick={() => setStep(step - 1)}>Back</button>}
              {step < STEPS.length - 1 && <button type="button" className="bk-btn" disabled={saving} onClick={() => setStep(step + 1)}>Next</button>}
              <button type="button" className="bk-btn primary" disabled={saving || problems.length > 0 || !dirty()} onClick={save}>{saving ? 'Saving…' : 'Save changes'}</button>
            </div>
          </footer>
        </section>
      </div>
    </div>
  );
}
