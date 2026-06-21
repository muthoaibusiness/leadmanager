import { useState, useEffect } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { addPropertyFn, updatePropertyFn, unitsFromCodes } from '../../lib/db.js';
import { PROPERTY_TYPES, PROPERTY_STATUS } from '../../lib/constants.js';

const BLANK = {
  name: '', developer: 'WECON Properties', type: 'Apartment', district: '', area: '', address: '', status: 'AVAILABLE',
  unitsAvailable: '', totalUnits: '', pricePerSqft: '', sizeText: '',
  landArea: '', storeys: '', facing: '', totalSft: '', saleableUnits: '', driveLink: '',
  construction: '', handover: '', img0: '', img1: '', img2: '',
};
const DOC_TYPES = ['brochure', 'layout', 'image', 'video', 'other'];

export default function PropertyFormModal() {
  const { modal, closeModal, propEdit, refreshDB, showToast } = useApp();
  const isOpen = modal === 'property-form';
  const isEdit = isOpen && propEdit && propEdit.id;
  const [f, setF] = useState(BLANK);
  const [docs, setDocs] = useState([]);

  useEffect(() => {
    if (!isOpen) return;
    if (isEdit) {
      const p = propEdit;
      setF({
        name: p.name || '', developer: p.developer || '', type: p.type || 'Apartment',
        district: p.district || '', area: p.area || '', address: p.address || '', status: p.status || 'AVAILABLE',
        unitsAvailable: p.unitsAvailable || '', totalUnits: p.totalUnits || '',
        pricePerSqft: p.pricePerSqft || '', sizeText: p.sizeText || '',
        landArea: p.landArea || '', storeys: p.storeys || '', facing: p.facing || '',
        totalSft: p.totalSft || '', saleableUnits: p.saleableUnits || '',
        driveLink: p.driveLink || '', construction: p.construction || '',
        handover: p.handover || '', img0: p.images?.[0] || '', img1: p.images?.[1] || '', img2: p.images?.[2] || '',
      });
      setDocs((p.documents || []).map(d => ({ ...d })));
    } else {
      setF(BLANK);
      setDocs([]);
    }
  }, [isOpen, isEdit, propEdit]);

  if (!isOpen) return <div className="mov" onClick={closeModal} />;

  const set = (k, v) => setF(s => ({ ...s, [k]: v }));
  const addDoc = () => setDocs(d => [...d, { type: 'brochure', name: '', url: '' }]);
  const setDoc = (i, k, v) => setDocs(d => d.map((x, j) => j === i ? { ...x, [k]: v } : x));
  const rmDoc = (i) => setDocs(d => d.filter((_, j) => j !== i));
  const pickFile = (i, file) => {
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { showToast('File too large (max 3MB). Use a URL instead.', 'err'); return; }
    const reader = new FileReader();
    reader.onload = () => setDocs(d => d.map((x, j) => j === i ? { ...x, url: reader.result, name: x.name || file.name } : x));
    reader.readAsDataURL(file);
  };
  const num = (v) => parseFloat(v) || 0;

  const submit = () => {
    if (!f.name.trim()) { showToast('Property name required', 'err'); return; }
    const firstSize = parseInt(String(f.sizeText).replace(/[, ]/g, '')) || 0;
    const data = {
      name: f.name.trim(), developer: f.developer.trim(), type: f.type, district: f.district.trim(), area: f.area.trim(),
      address: f.address.trim() || [f.area.trim(), f.district.trim()].filter(Boolean).join(', '), status: f.status,
      unitsAvailable: num(f.unitsAvailable), totalUnits: num(f.totalUnits),
      pricePerSqft: num(f.pricePerSqft), sizeText: f.sizeText.trim(), sizeMin: firstSize, sizeMax: 0,
      askingPrice: num(f.pricePerSqft) && firstSize ? num(f.pricePerSqft) * firstSize : 0,
      landArea: f.landArea.trim(), storeys: f.storeys.trim(), facing: f.facing.trim(),
      totalSft: num(f.totalSft), saleableUnits: f.saleableUnits.trim(), driveLink: f.driveLink.trim(), purpose: 'Sale',
      construction: Math.max(0, Math.min(100, num(f.construction))),
      handover: f.handover.trim(),
      images: [f.img0, f.img1, f.img2].map(s => s.trim()).filter(Boolean),
      documents: docs.filter(d => d.url && d.url.trim()).map(d => ({ type: d.type, name: (d.name || '').trim(), url: d.url.trim() })),
    };
    // Rebuild the bookable unit grid from the saleable codes (preserving statuses of
    // matching codes). Skip if nothing to build so existing units aren't wiped.
    const codeUnits = unitsFromCodes(data.saleableUnits, data.totalUnits, isEdit ? (propEdit.units || []) : []);
    if (codeUnits.length) data.units = codeUnits;
    if (isEdit) { updatePropertyFn(propEdit.id, data); showToast('Property updated', 'ok'); }
    else { addPropertyFn(data); showToast('Property added', 'ok'); }
    refreshDB();
    closeModal();
  };

  return (
    <div className="mov on" onClick={closeModal}>
      <div className="modal pf-modal" onClick={e => e.stopPropagation()}>
        <div className="m-hd">
          <div className="m-ttl">{isEdit ? 'Edit Property' : 'Add Property'}</div>
          <button className="m-x" onClick={closeModal}><Mi>close</Mi></button>
        </div>
        <div className="m-body">
          <div className="fg"><label>Property name *</label>
            <input className="fi" value={f.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Bashundhara Skyline Residences" /></div>
          <div className="fg-row">
            <div className="fg"><label>Developer</label>
              <input className="fi" value={f.developer} onChange={e => set('developer', e.target.value)} /></div>
            <div className="fg"><label>Type</label>
              <select className="fi" value={f.type} onChange={e => set('type', e.target.value)}>
                {PROPERTY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select></div>
          </div>
          <div className="fg-row">
            <div className="fg"><label>District</label>
              <input className="fi" value={f.district} onChange={e => set('district', e.target.value)} placeholder="Chattogram" /></div>
            <div className="fg"><label>Area / location</label>
              <input className="fi" value={f.area} onChange={e => set('area', e.target.value)} placeholder="O R Nizam" /></div>
          </div>
          <div className="fg-row">
            <div className="fg"><label>Status</label>
              <select className="fi" value={f.status} onChange={e => set('status', e.target.value)}>
                {Object.entries(PROPERTY_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select></div>
            <div className="fg"><label>Handover</label>
              <input className="fi" value={f.handover} onChange={e => set('handover', e.target.value)} placeholder="December 2029" /></div>
          </div>
          <div className="fg"><label>Full address</label>
            <input className="fi" value={f.address} onChange={e => set('address', e.target.value)} placeholder="House-105, Road 9, O R Nizam Road R/A" /></div>

          <div className="fg-row">
            <div className="fg"><label>Price / sqft (৳)</label>
              <input className="fi" type="number" value={f.pricePerSqft} onChange={e => set('pricePerSqft', e.target.value)} placeholder="12500" /></div>
            <div className="fg"><label>Unit size</label>
              <input className="fi" value={f.sizeText} onChange={e => set('sizeText', e.target.value)} placeholder="3879 sft / 2400–2700" /></div>
          </div>
          <div className="fg-row">
            <div className="fg"><label>Land area</label>
              <input className="fi" value={f.landArea} onChange={e => set('landArea', e.target.value)} placeholder="7.55 Katha" /></div>
            <div className="fg"><label>Storeys</label>
              <input className="fi" value={f.storeys} onChange={e => set('storeys', e.target.value)} placeholder="SB+G+12F+R" /></div>
          </div>
          <div className="fg-row">
            <div className="fg"><label>Facing</label>
              <input className="fi" value={f.facing} onChange={e => set('facing', e.target.value)} placeholder="South" /></div>
            <div className="fg"><label>Total SFT</label>
              <input className="fi" type="number" value={f.totalSft} onChange={e => set('totalSft', e.target.value)} placeholder="37200" /></div>
          </div>
          <div className="fg-row">
            <div className="fg"><label>Total units</label>
              <input className="fi" type="number" value={f.totalUnits} onChange={e => set('totalUnits', e.target.value)} /></div>
            <div className="fg"><label>Unsold / available</label>
              <input className="fi" type="number" value={f.unitsAvailable} onChange={e => set('unitsAvailable', e.target.value)} /></div>
          </div>
          <div className="fg"><label>Saleable unit codes</label>
            <input className="fi" value={f.saleableUnits} onChange={e => set('saleableUnits', e.target.value)} placeholder="A-2, A-4, A-7, A-8" /></div>
          <div className="fg"><label>Drive link (floor plans & docs)</label>
            <input className="fi" value={f.driveLink} onChange={e => set('driveLink', e.target.value)} placeholder="https://..." /></div>
          <div className="fg"><label>Construction %</label>
            <input className="fi" type="number" min="0" max="100" value={f.construction} onChange={e => set('construction', e.target.value)} /></div>

          <div className="fg"><label>Images (up to 3 URLs)</label>
            <input className="fi" value={f.img0} onChange={e => set('img0', e.target.value)} placeholder="https://...jpg" style={{ marginBottom: '8px' }} />
            <input className="fi" value={f.img1} onChange={e => set('img1', e.target.value)} placeholder="https://...jpg" style={{ marginBottom: '8px' }} />
            <input className="fi" value={f.img2} onChange={e => set('img2', e.target.value)} placeholder="https://...jpg" />
          </div>

          <div className="fg" style={{ borderTop: '1px solid var(--bd)', paddingTop: '14px' }}>
            <label>Documents & media (brochure, layout, image, video)</label>
            {docs.map((d, i) => (
              <div key={i} className="doc-row">
                <select className="fi doc-type" value={d.type} onChange={e => setDoc(i, 'type', e.target.value)}>
                  {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <input className="fi doc-name" value={d.name} onChange={e => setDoc(i, 'name', e.target.value)} placeholder="Label" />
                <input className="fi doc-url" value={d.url?.startsWith('data:') ? '(uploaded file)' : d.url} onChange={e => setDoc(i, 'url', e.target.value)} placeholder="Paste URL" />
                <label className="doc-file" title="Upload file">
                  <Mi>upload</Mi>
                  <input type="file" hidden onChange={e => pickFile(i, e.target.files?.[0])} />
                </label>
                <button className="doc-rm" onClick={() => rmDoc(i)} title="Remove"><Mi>close</Mi></button>
              </div>
            ))}
            <button className="btn btn-g btn-sm" style={{ marginTop: '8px' }} onClick={addDoc}><Mi>add</Mi>Add document</button>
          </div>
        </div>
        <div className="m-ft">
          <button className="btn btn-g" onClick={closeModal}>Cancel</button>
          <button className="btn btn-p" onClick={submit}>{isEdit ? 'Save Changes' : 'Add Property'}</button>
        </div>
      </div>
    </div>
  );
}
