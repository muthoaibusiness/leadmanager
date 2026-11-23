import { useState } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import useChanged from '../../hooks/useChanged.js';
import useDiscardGuard from '../../hooks/useDiscardGuard.js';
import useProjectNav from '../../hooks/useProjectNav.js';
import { newProjectDraft, saveNewProject } from '../../lib/projects.js';
import { uploadProjectMedia } from '../../lib/supabase.js';
import { PROJECT_TYPES } from '../../lib/constants.js';
import { taka } from '../../lib/floorPlan.js';
import '../booking/ShopBooking.css';
import './AddPropertyWizard.css';

// Add Property, as four short steps in the Booking page's look: Basics → Unit
// types → Photos & files → Review. Nothing is stored until the last step
// saves (same rule as the old catalog draft). Photos and PDFs are kept in the
// browser until then and uploaded to the project-media bucket on save. After
// saving, the next step offered is the floor plan (where shops get their place).

const STEPS = [
  ['basics', 'Basics', 'Name, type and place'],
  ['types', 'Unit types', 'Sizes, rates and codes'],
  ['media', 'Photos & files', 'Optional'],
  ['review', 'Review', 'Check and save'],
];
const KIND_ICON = { Residential: 'home', Commercial: 'storefront' };
const KIND_HINT = { Residential: 'Apartments, duplexes, villas', Commercial: 'Shops, offices, showrooms' };
const IMG_OK = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_MB = 25;

const blankType = (n, kind) => ({
  key: 'k' + Date.now().toString(36) + n,
  name: kind === 'Commercial' ? (n ? `Shop type ${n + 1}` : 'Shop') : `Type ${String.fromCharCode(65 + n)}`,
  prefix: kind === 'Commercial' ? 'S' : String.fromCharCode(65 + n),
  count: '', size: '', listRate: '', floorRate: '', beds: '', baths: '',
});
const BLANK = { name: '', kind: '', address: '', handover: '', approval: '', listing: '', types: [], fastClosePct: '2', fastCloseDays: '5' };
const num = (v) => parseFloat(v) || 0;
const codesOf = (t) => Array.from({ length: Math.max(0, parseInt(t.count, 10) || 0) }, (_, i) => `${t.prefix.trim()}${i + 1}`);

// What stops a save, step by step. Each item is a short sentence.
function problems(f) {
  const basics = [];
  if (!f.name.trim()) basics.push('Add the property name.');
  if (!f.kind) basics.push('Choose Residential or Commercial.');
  const types = [];
  if (!f.types.length) types.push('Add at least one unit type.');
  const seen = new Map();
  f.types.forEach(t => {
    if (!t.name.trim()) types.push('Every unit type needs a name.');
    codesOf(t).forEach(c => { if (seen.has(c) && seen.get(c) !== t.key && !types.some(x => x.includes(`"${c}"`))) types.push(`Code "${c}" is used by two types. Give each type its own prefix.`); seen.set(c, t.key); });
  });
  return { basics, types };
}

export default function AddPropertyWizard() {
  const { modal, closeModal, user, refreshDB, showToast } = useApp();
  const pnav = useProjectNav();
  const isOpen = modal === 'property-wizard';
  const [step, setStep] = useState(0);
  const [f, setF] = useState(BLANK);
  const [photos, setPhotos] = useState([]); // { file, url }
  const [pdfs, setPdfs] = useState([]);
  const [links, setLinks] = useState([]);
  const [lk, setLk] = useState({ url: '', label: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null); // { id, name } after a save

  if (useChanged(isOpen) && isOpen) {
    setStep(0); setF(BLANK); setPhotos([]); setPdfs([]); setLinks([]); setLk({ url: '', label: '' }); setErr(''); setDone(null); setSaving(false);
  }

  const dirty = () => !done && (JSON.stringify(f) !== JSON.stringify(BLANK) || photos.length + pdfs.length + links.length > 0);
  const g = useDiscardGuard({ isOpen, isDirty: dirty, onClose: closeModal, busy: saving, ask: { title: 'Discard this property?', description: 'What you entered has not been saved.' } });
  if (!isOpen) return null;

  const up = (patch) => { setErr(''); setF(s => ({ ...s, ...patch })); };
  const upType = (key, patch) => up({ types: f.types.map(t => (t.key === key ? { ...t, ...patch } : t)) });
  const addType = () => up({ types: [...f.types, blankType(f.types.length, f.kind)] });
  const dropType = (key) => up({ types: f.types.filter(t => t.key !== key) });
  const pickKind = (kind) => up({ kind, types: f.types.length ? f.types : [blankType(0, kind)] });

  const bad = problems(f);
  const stepBad = [bad.basics, bad.types, [], [...bad.basics, ...bad.types]];
  const totalUnits = f.types.reduce((s, t) => s + codesOf(t).length, 0);
  const totalArea = f.types.reduce((s, t) => s + codesOf(t).length * num(t.size), 0);

  const go = (n) => { if (n > step && stepBad.slice(step, n).some(a => a.length)) return; setStep(n); };

  const addFiles = (list, kind) => {
    const bads = [];
    [...list].forEach(file => {
      const okType = kind === 'photo' ? IMG_OK.includes(file.type) : file.type === 'application/pdf';
      if (!okType) { bads.push(`${file.name}: ${kind === 'photo' ? 'use PNG, JPG or WebP' : 'use a PDF'}`); return; }
      if (file.size > MAX_MB * 1024 * 1024) { bads.push(`${file.name}: over ${MAX_MB} MB`); return; }
      if (kind === 'photo') setPhotos(p => [...p, { file, url: URL.createObjectURL(file) }]);
      else setPdfs(p => [...p, { file }]);
    });
    if (bads.length) showToast(bads.join(' · '), 'err');
  };
  const addLink = () => {
    if (!lk.url.trim()) return;
    setLinks(l => [...l, { url: lk.url.trim(), label: lk.label.trim() || lk.url.trim() }]);
    setLk({ url: '', label: '' });
  };

  const save = async () => {
    if (saving || stepBad[3].length) return;
    setSaving(true); setErr('');
    const draft = newProjectDraft(user?.companyId);
    const cid = user?.companyId || 'company';
    const media = { images: [], docs: [], links: links.map(l => ({ ...l })) };
    for (const [i, p] of photos.entries()) {
      const ext = p.file.type === 'image/png' ? 'png' : p.file.type === 'image/webp' ? 'webp' : 'jpg';
      const r = await uploadProjectMedia(p.file, `${cid}/${draft.id}/media/photo-${Date.now()}-${i}.${ext}`);
      if (!r.ok) { setSaving(false); setErr(`Not saved: ${p.file.name} could not be uploaded (${r.error}).`); return; }
      media.images.push({ name: p.file.name, url: r.url });
    }
    for (const [i, d] of pdfs.entries()) {
      const r = await uploadProjectMedia(d.file, `${cid}/${draft.id}/media/doc-${Date.now()}-${i}.pdf`);
      if (!r.ok) { setSaving(false); setErr(`Not saved: ${d.file.name} could not be uploaded (${r.error}).`); return; }
      media.docs.push({ label: d.file.name, url: r.url });
    }
    const variants = f.types.map((t, i) => ({
      id: 'v' + Date.now().toString(36) + i, name: t.name.trim(), beds: parseInt(t.beds, 10) || 0, baths: parseInt(t.baths, 10) || 0,
      size: num(t.size), listRate: num(t.listRate), floorRate: num(t.floorRate), unitPrefix: t.prefix.trim(),
      units: codesOf(t).map(id => ({ id, status: 'available' })),
    }));
    const res = await saveNewProject({
      ...draft, name: f.name.trim(), purpose: f.kind, address: f.address.trim(), handover: f.handover.trim(), approval: f.approval.trim(),
      listing: f.listing.trim(), fastClosePct: num(f.fastClosePct), fastCloseDays: parseInt(f.fastCloseDays, 10) || 0, variants, media,
    });
    setSaving(false);
    if (!res.ok) { setErr(`Not saved: ${res.error}. Your entries are still here.`); return; }
    refreshDB();
    showToast('Property saved', 'ok');
    setDone({ id: res.id, name: f.name.trim() });
  };

  const field = (label, key, props = {}) => (
    <label className="pw-f"><span className="bk-cap">{label}</span>
      <input value={f[key]} onChange={e => up({ [key]: e.target.value })} {...props} /></label>
  );
  const tfield = (t, label, key, props = {}) => (
    <label className="pw-f"><span className="bk-cap">{label}</span>
      <input value={t[key]} onChange={e => upType(t.key, { [key]: e.target.value })} {...props} /></label>
  );

  return (
    <div className="pw-scrim" {...g.backdropProps}>
      <div className="bk pw" role="dialog" aria-label="Add property" {...g.modalProps}>
        <aside className="pw-rail">
          <div className="pw-rail-h"><span className="bk-eyebrow">New property</span><b>{f.name.trim() || 'Untitled'}</b></div>
          <ol>
            {STEPS.map(([k, l, s], i) => (
              <li key={k}>
                <button type="button" className="bk-floor" aria-pressed={!done && step === i} disabled={!!done} onClick={() => go(i)}>
                  <span className="bk-fl">{done || i < step ? <Mi>check</Mi> : i + 1}</span>
                  <span className="pw-st"><b>{l}</b><i>{s}</i></span>
                </button>
              </li>
            ))}
          </ol>
        </aside>

        <section className="pw-main">
          <header className="pw-head">
            <h3>{done ? 'Property saved' : STEPS[step][1]}</h3>
            <button type="button" className="bk-close" aria-label="Close" onClick={g.requestClose}><Mi>close</Mi></button>
          </header>

          <div className="pw-body">
            {done ? (
              <div className="pw-done">
                <span className="pw-ok"><Mi>check</Mi></span>
                <h4>{done.name} is added</h4>
                <p>{totalUnits ? `${totalUnits} unit${totalUnits > 1 ? 's' : ''} are ready. ` : ''}Next, draw the floor plan so each shop gets its place on the Booking page.</p>
                <div className="pw-acts">
                  <button type="button" className="bk-btn primary" onClick={() => { closeModal(); pnav.addFloorPlan(done.id); }}>Add a floor plan</button>
                  <button type="button" className="bk-btn" onClick={closeModal}>Done</button>
                </div>
              </div>
            ) : step === 0 ? (
              <>
                {field('Property name', 'name', { placeholder: 'e.g. Citizen Avenue Mall', autoFocus: true, className: 'pw-big' })}
                <div className="pw-f">
                  <span className="bk-cap">Project type</span>
                  <div className="pw-kinds" role="group" aria-label="Project type">
                    {PROJECT_TYPES.map(k => (
                      <button key={k} type="button" className="pw-kind" aria-pressed={f.kind === k} onClick={() => pickKind(k)}>
                        <Mi>{KIND_ICON[k]}</Mi><b>{k}</b><span>{KIND_HINT[k]}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="pw-grid">
                  {field('Location', 'address', { placeholder: 'Area · Block · City' })}
                  {field('Handover', 'handover', { placeholder: 'Dec 2027' })}
                  {field('Approval', 'approval', { placeholder: 'e.g. RAJUK / CDA' })}
                  {field('Listing no.', 'listing', { placeholder: '#MCR-0042' })}
                </div>
              </>
            ) : step === 1 ? (
              <>
                <p className="bk-hint">Each type gets its own size and rate. Codes are made from the prefix and a number (S1, S2, S3…). You can rename or move shops later on the floor plan.</p>
                {f.types.map(t => {
                  const codes = codesOf(t);
                  const perUnit = num(t.size) * num(t.listRate);
                  return (
                    <div className="pw-type" key={t.key}>
                      <div className="pw-type-h">
                        <input className="pw-type-n" value={t.name} onChange={e => upType(t.key, { name: e.target.value })} aria-label="Type name" />
                        {f.types.length > 1 && <button type="button" className="bk-close" aria-label={`Remove ${t.name}`} onClick={() => dropType(t.key)}><Mi>delete</Mi></button>}
                      </div>
                      <div className="pw-grid pw-grid4">
                        {tfield(t, 'Code prefix', 'prefix', { placeholder: 'S' })}
                        {tfield(t, 'Number of units', 'count', { type: 'number', min: 0, inputMode: 'numeric', placeholder: '0' })}
                        {tfield(t, 'Size (sq ft)', 'size', { type: 'number', min: 0, inputMode: 'numeric', placeholder: '0' })}
                        {tfield(t, 'List rate (৳ / sq ft)', 'listRate', { type: 'number', min: 0, inputMode: 'numeric', placeholder: '0' })}
                        {tfield(t, 'Floor rate (৳ / sq ft)', 'floorRate', { type: 'number', min: 0, inputMode: 'numeric', placeholder: '0' })}
                        {f.kind === 'Residential' && tfield(t, 'Beds', 'beds', { type: 'number', min: 0, inputMode: 'numeric' })}
                        {f.kind === 'Residential' && tfield(t, 'Baths', 'baths', { type: 'number', min: 0, inputMode: 'numeric' })}
                      </div>
                      <div className="pw-sum">
                        {codes.length ? <span><b>{codes.length}</b> unit{codes.length > 1 ? 's' : ''} · {codes[0]}{codes.length > 1 ? ` to ${codes[codes.length - 1]}` : ''}</span> : <span>No units yet</span>}
                        {perUnit > 0 && <span>{taka(perUnit)} per unit</span>}
                      </div>
                    </div>
                  );
                })}
                <button type="button" className="bk-btn" onClick={addType}><Mi>add</Mi>Add another type</button>
              </>
            ) : step === 2 ? (
              <>
                <p className="bk-hint">All optional. Add them now or later from the project page.</p>
                <div className="pw-drops">
                  <label className="pw-drop"><Mi>image</Mi><b>Add photos</b><span>PNG, JPG, WebP · first is the cover</span>
                    <input type="file" hidden multiple accept="image/png,image/jpeg,image/webp" onChange={e => { addFiles(e.target.files, 'photo'); e.target.value = ''; }} /></label>
                  <label className="pw-drop"><Mi>picture_as_pdf</Mi><b>Add PDFs</b><span>Brochure, price list, plans</span>
                    <input type="file" hidden multiple accept="application/pdf" onChange={e => { addFiles(e.target.files, 'pdf'); e.target.value = ''; }} /></label>
                </div>
                {photos.length > 0 && (
                  <div className="pw-thumbs">
                    {photos.map((p, i) => (
                      <div key={p.url} className="pw-thumb"><img src={p.url} alt="" />{i === 0 && <span className="pw-cover">Cover</span>}
                        <button type="button" aria-label="Remove photo" onClick={() => setPhotos(x => x.filter((_, j) => j !== i))}><Mi>close</Mi></button></div>
                    ))}
                  </div>
                )}
                {pdfs.map((d, i) => (
                  <div key={d.file.name + i} className="pw-item"><Mi>picture_as_pdf</Mi><span>{d.file.name}</span>
                    <button type="button" className="bk-close" aria-label="Remove file" onClick={() => setPdfs(x => x.filter((_, j) => j !== i))}><Mi>close</Mi></button></div>
                ))}
                {links.map((l, i) => (
                  <div key={l.url + i} className="pw-item"><Mi>link</Mi><span>{l.label}</span>
                    <button type="button" className="bk-close" aria-label="Remove link" onClick={() => setLinks(x => x.filter((_, j) => j !== i))}><Mi>close</Mi></button></div>
                ))}
                <div className="pw-grid">
                  <label className="pw-f"><span className="bk-cap">Link (Drive, video…)</span>
                    <input value={lk.url} onChange={e => setLk(s => ({ ...s, url: e.target.value }))} placeholder="https://…" /></label>
                  <label className="pw-f"><span className="bk-cap">Label</span>
                    <input value={lk.label} onChange={e => setLk(s => ({ ...s, label: e.target.value }))} placeholder="Drive folder" onKeyDown={e => { if (e.key === 'Enter') addLink(); }} /></label>
                </div>
                <button type="button" className="bk-btn" onClick={addLink} disabled={!lk.url.trim()}><Mi>add</Mi>Add link</button>
              </>
            ) : (
              <>
                <div className="pw-review">
                  <div><span className="bk-cap">Property</span><b>{f.name.trim() || '—'}</b></div>
                  <div><span className="bk-cap">Type</span><b>{f.kind || '—'}</b></div>
                  <div><span className="bk-cap">Location</span><b>{f.address.trim() || '—'}</b></div>
                  <div><span className="bk-cap">Handover</span><b>{f.handover.trim() || '—'}</b></div>
                  <div><span className="bk-cap">Units</span><b>{totalUnits} in {f.types.length} type{f.types.length > 1 ? 's' : ''}</b></div>
                  <div><span className="bk-cap">Total area</span><b>{totalArea ? `${Math.round(totalArea).toLocaleString('en-IN')} sq ft` : '—'}</b></div>
                  <div><span className="bk-cap">Photos and files</span><b>{photos.length} photo{photos.length === 1 ? '' : 's'} · {pdfs.length} PDF{pdfs.length === 1 ? '' : 's'} · {links.length} link{links.length === 1 ? '' : 's'}</b></div>
                </div>
                <div className="pw-grid">
                  {field('Fast-close discount (%)', 'fastClosePct', { type: 'number', min: 0, inputMode: 'decimal' })}
                  {field('Fast-close window (days)', 'fastCloseDays', { type: 'number', min: 0, inputMode: 'numeric' })}
                </div>
                {[...bad.basics, ...bad.types].map(m => <div key={m} className="pw-warn"><Mi>error</Mi>{m}</div>)}
              </>
            )}
            {err && <div className="pw-warn"><Mi>error</Mi>{err}</div>}
          </div>

          {!done && (
            <footer className="pw-foot">
              <span className="bk-cap">{stepBad[step].length ? stepBad[step][0] : `Step ${step + 1} of ${STEPS.length}`}</span>
              <div className="pw-acts">
                {step > 0 && <button type="button" className="bk-btn" disabled={saving} onClick={() => setStep(step - 1)}>Back</button>}
                {step < STEPS.length - 1
                  ? <button type="button" className="bk-btn primary" disabled={stepBad[step].length > 0} onClick={() => go(step + 1)}>{step === 2 && !photos.length && !pdfs.length && !links.length ? 'Skip' : 'Next'}</button>
                  : <button type="button" className="bk-btn primary" disabled={saving || stepBad[3].length > 0} onClick={save}>{saving ? 'Saving…' : 'Save property'}</button>}
              </div>
            </footer>
          )}
        </section>
      </div>
    </div>
  );
}
