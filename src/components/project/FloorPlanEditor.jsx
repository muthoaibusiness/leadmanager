import { useState, useEffect, useRef } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { uid } from '../../lib/helpers.js';
import { hasColumn } from '../../lib/supabase.js';
import { getProjectById, findUnit, unitSize, isUnitLocked, projectTypeOf, saveFloorPlan } from '../../lib/projects.js';
import {
  toPx, toFrac, clampMove, saveCode, nextCode, byCode, STATUS, taka,
  historyOf, record, undo, redo, planProblems,
  IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_PDF_BYTES, prepareImage, openPdf, renderPdfPage, pdfPageImage,
} from '../../lib/floorPlan.js';
import useDiscardGuard from '../../hooks/useDiscardGuard.js';
import FloorPlanCanvas from './FloorPlanCanvas.jsx';
import { useProjectToast } from './projectToast.js';
import './FloorPlan.css';
import './FloorPlanEditor.css';

// Projects → Available Units → Add / Edit floor plan (Management).
// Upload a plan (image, or one page of a PDF), draw a box around each shop or
// showroom, and give each box its unit: name, type, size, price. Everything
// is local until Save, which uploads the image and merges the plan and the
// unit changes onto a fresh copy of the project (saveFloorPlan).
//
// Editor state ("draft"), one undo step per change:
//   plan    { id, name, order, boxes: [{ id, unitKey, x, y, w, h, lost }] }  box coords are 0–1 fractions
//   image   the stored image ({ url, width, height, … }) or null
//   pending a new image not uploaded yet: { blob, previewUrl, width, height, fileName, source, pdfPage }
//   units   { [unitKey]: { key, code, variantId, size, price, orig: { code } | null } }
//           unitKey is 'u:<code>' for a unit that exists, 'n:<id>' for a new one
//   types   [{ id, name, isNew }]

export default function FloorPlanEditor() {
  const { modal, planEdit } = useApp();
  if (modal !== 'floorplan-editor' || !planEdit) return null;
  return <Editor projectId={planEdit.projectId} planId={planEdit.planId} />;
}

const inField = (el) => el instanceof Element && !!el.closest('input, textarea, select, [contenteditable="true"]');
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const num = (v) => { const n = parseFloat(String(v).replace(/,/g, '')); return n > 0 ? n : 0; };
// Typing a name: upper case, spaces become dashes; ends are trimmed on save.
const liveCode = (s) => String(s || '').toUpperCase().replace(/\s+/g, '-');

function unitEntry(loc) {
  const { unit: u, variant: v } = loc;
  return { key: 'u:' + u.id, code: u.id, variantId: v.id, size: u.size > 0 ? u.size : '', price: u.price > 0 ? u.price : '', orig: { code: u.id } };
}

function initDraft(proj, planId) {
  const fp = proj.floorPlans.find(x => x.id === planId) || null;
  const units = {};
  const boxes = (fp?.boxes || []).map(b => {
    const loc = findUnit(proj, b.unitId);
    if (!loc) return { id: b.id, unitKey: null, lost: b.unitId || '', x: b.x, y: b.y, w: b.w, h: b.h };
    const e = unitEntry(loc);
    units[e.key] = e;
    return { id: b.id, unitKey: e.key, x: b.x, y: b.y, w: b.w, h: b.h };
  });
  const n = proj.floorPlans.length;
  return {
    plan: { id: fp?.id || 'fp' + uid(), name: fp?.name || `Floor ${n + 1}`, order: fp?.order ?? n + 1, boxes },
    image: fp?.image || null,
    pending: null,
    units,
    types: proj.variants.map(v => ({ id: v.id, name: v.name || 'Type', isNew: false })),
  };
}
const snapshot = (d) => JSON.stringify({ ...d, pending: d.pending ? d.pending.previewUrl : null });

function Editor({ projectId, planId }) {
  const { user, dbVersion, refreshDB, closeModal, setPlanEdit, setPlanSel } = useApp();
  void dbVersion; // statuses come from the live store
  const toast = useProjectToast();
  const proj = getProjectById(projectId);
  const [hist, setHist] = useState(() => historyOf(proj ? initDraft(proj, planId) : null));
  const [baseline] = useState(() => (hist.present ? snapshot(hist.present) : ''));
  const draft = hist.present;
  const [selId, setSelId] = useState(null);
  const [tool, setTool] = useState('draw');
  const [linkKey, setLinkKey] = useState(null);   // the next box drawn goes to this existing unit
  const [busy, setBusy] = useState('');           // 'Preparing image…' etc.
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [showProblems, setShowProblems] = useState(false);
  const [canSave, setCanSave] = useState(null);
  const [pdf, setPdf] = useState(null);           // { file, numPages, thumbs: [] } while picking a page
  const [newType, setNewType] = useState(null);   // the "New type…" name being typed
  const pdfRef = useRef(null);
  const fileRef = useRef(null);
  const nameRef = useRef(null);
  const urlsRef = useRef([]);
  const lastRef = useRef({ code: null, variantId: null });
  const [focusName, setFocusName] = useState(0);

  const close = () => { closeModal(); setPlanEdit(null); };

  useEffect(() => {
    let live = true;
    hasColumn('properties', 'floor_plans', 'Floor plans cannot be saved. Apply supabase/migrations/0020_floor_plans.sql.')
      .then(ok => { if (live) setCanSave(ok); });
    return () => { live = false; };
  }, []);
  // Object URLs for previews (kept for undo) and an open PDF go when the editor does.
  useEffect(() => () => {
    urlsRef.current.forEach(u => URL.revokeObjectURL(u));
    pdfRef.current?.destroy();
  }, []);
  useEffect(() => { if (focusName) { nameRef.current?.focus(); nameRef.current?.select(); } }, [focusName]);

  // ── changes (each one undo step) ──
  const commit = (next, tag) => { setErr(''); setHist(h => record(h, next, tag)); };
  // Typing in one field is one undo step until something else changes.
  const commitField = (next, tag) => { setErr(''); setHist(h => record(h, next, tag, Infinity)); };
  const setBoxes = (boxes, tag, extra = {}) => commit({ ...draft, ...extra, plan: { ...draft.plan, boxes } }, tag);
  const setUnit = (key, patch, extra = {}) => commit({ ...draft, ...extra, units: { ...draft.units, [key]: { ...draft.units[key], ...patch } } });

  const img = draft?.pending || draft?.image || null;
  const W = img?.width || 1, H = img?.height || 1;
  const sel = draft?.plan.boxes.find(b => b.id === selId) || null;
  const entry = sel?.unitKey ? draft.units[sel.unitKey] : null;
  const liveOf = (e) => (e?.orig ? findUnit(proj, e.orig.code) : null);
  const statusOf = (e) => (!e ? 'unlinked' : e.orig ? (liveOf(e)?.unit.status || 'available') : 'available');

  const allCodes = () => {
    const s = new Set();
    proj.variants.forEach(v => v.units.forEach(u => s.add(u.id)));
    Object.values(draft.units).forEach(u => u.code && s.add(u.code));
    return s;
  };
  const suggestCode = () => {
    const taken = allCodes();
    const seed = lastRef.current.code
      || [...draft.plan.boxes].map(b => draft.units[b.unitKey]?.code).filter(Boolean).sort(byCode).pop()
      || null;
    let c = seed ? nextCode(seed) : (projectTypeOf(proj) === 'Residential' ? 'UNIT-01' : 'SHOP-01');
    for (let i = 0; taken.has(c) && i < 500; i++) c = nextCode(c);
    return c;
  };

  // A new box: linked to the unit picked in "Not on this plan", else a new
  // unit with the next free name and the last type used.
  const createBox = (rect) => {
    const f = toFrac(rect, W, H);
    const box = { id: 'bx' + uid(), unitKey: null, ...f };
    let units = draft.units, types = draft.types;
    if (linkKey) {
      box.unitKey = linkKey;
      if (!units[linkKey]) {
        const loc = findUnit(proj, linkKey.slice(2));
        if (loc) units = { ...units, [linkKey]: unitEntry(loc) };
      }
      setLinkKey(null);
    } else {
      let variantId = lastRef.current.variantId && types.some(t => t.id === lastRef.current.variantId) ? lastRef.current.variantId : types[0]?.id;
      if (!variantId) {
        const t = { id: 'v' + uid(), name: projectTypeOf(proj) === 'Residential' ? 'Apartment' : 'Shop', isNew: true };
        types = [...types, t];
        variantId = t.id;
      }
      const code = suggestCode();
      const key = 'n:' + uid();
      units = { ...units, [key]: { key, code, variantId, size: '', price: '', orig: null } };
      box.unitKey = key;
      lastRef.current = { code, variantId };
      setFocusName(n => n + 1);
    }
    commit({ ...draft, units, types, plan: { ...draft.plan, boxes: [...draft.plan.boxes, box] } });
    setSelId(box.id);
  };
  const moveBox = (id, rect) => setBoxes(draft.plan.boxes.map(b => (b.id === id ? { ...b, ...toFrac(rect, W, H) } : b)));
  const deleteBox = (id) => { setBoxes(draft.plan.boxes.filter(b => b.id !== id)); setSelId(null); };
  const nudge = (dx, dy) => {
    if (!sel) return;
    const r = clampMove({ ...toPx(sel, W, H), x: sel.x * W + dx, y: sel.y * H + dy }, W, H);
    setBoxes(draft.plan.boxes.map(b => (b.id === sel.id ? { ...b, ...toFrac(r, W, H) } : b)), 'nudge:' + sel.id);
  };

  // ── unit details ──
  const relink = (key, extraUnits) => {
    const units = extraUnits ? { ...draft.units, ...extraUnits } : draft.units;
    commit({ ...draft, units, plan: { ...draft.plan, boxes: draft.plan.boxes.map(b => (b.id === sel.id ? { ...b, unitKey: key, lost: undefined } : b)) } });
  };
  const toNewUnit = (code) => {
    const key = 'n:' + uid();
    const variantId = entry?.variantId || lastRef.current.variantId || draft.types[0]?.id || null;
    relink(key, { [key]: { key, code: code || suggestCode(), variantId, size: '', price: '', orig: null } });
    setFocusName(n => n + 1);
  };
  const toExisting = (code) => {
    const key = 'u:' + code;
    if (draft.units[key]) { relink(key); return; }
    const loc = findUnit(proj, code);
    if (loc) relink(key, { [key]: unitEntry(loc) });
  };
  const setField = (field, value) => commitField({ ...draft, units: { ...draft.units, [entry.key]: { ...entry, [field]: value } } }, `u:${entry.key}:${field}`);
  const setCode = (raw) => { const code = liveCode(raw); if (code) lastRef.current.code = code; setField('code', code); };
  const setType = (vid) => {
    if (vid === '__new') { setNewType(''); return; }
    lastRef.current.variantId = vid;
    setUnit(entry.key, { variantId: vid });
  };
  const addType = () => {
    const name = (newType || '').trim();
    if (!name) { setNewType(null); return; }
    const t = { id: 'v' + uid(), name, isNew: true };
    lastRef.current.variantId = t.id;
    setUnit(entry.key, { variantId: t.id }, { types: [...draft.types, t] });
    setNewType(null);
  };

  // ── image upload ──
  const takeImage = (p) => {
    const previewUrl = URL.createObjectURL(p.blob);
    urlsRef.current.push(previewUrl);
    const prev = draft.pending || draft.image;
    if (prev && Math.abs(p.width / p.height - prev.width / prev.height) / (prev.width / prev.height) > 0.02) {
      toast.warning('Different shape', 'The new image is shaped differently, so check that every box still sits on its shop.');
    }
    // Onto the state as it is now: boxes can change while the image is prepared.
    setErr('');
    setHist(h => record(h, { ...h.present, pending: { ...p, previewUrl } }));
  };
  const onFile = async (file) => {
    if (!file) return;
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (!isPdf && !IMAGE_TYPES.includes(file.type)) {
      toast.error('Unsupported file', 'Use a PNG, JPG or WebP image, or a PDF.'); return;
    }
    if (file.size > (isPdf ? MAX_PDF_BYTES : MAX_IMAGE_BYTES)) {
      toast.error('File too large', `${isPdf ? 'PDFs' : 'Images'} can be up to ${isPdf ? 25 : 15} MB.`); return;
    }
    try {
      if (!isPdf) {
        setBusy('Preparing image…');
        const p = await prepareImage(file);
        takeImage({ ...p, fileName: file.name, source: 'image', pdfPage: null });
        return;
      }
      setBusy('Opening PDF…');
      pdfRef.current?.destroy();
      const doc = await openPdf(file);
      pdfRef.current = doc;
      if (doc.numPages === 1) { await applyPdfPage(file, doc, 1); return; }
      setPdf({ file, numPages: doc.numPages, thumbs: [] });
      setBusy('');
      // Thumbnails one after another, so the first pages show at once.
      for (let i = 1; i <= doc.numPages; i++) {
        if (pdfRef.current !== doc) return;
        let url = null;
        try {
          const c = await renderPdfPage(doc.doc, i, 220);
          url = c.toDataURL('image/jpeg', 0.7);
        } catch { /* a page that will not render shows as blank */ }
        setPdf(s => (s && s.file === file ? { ...s, thumbs: { ...s.thumbs, [i]: url || '' } } : s));
      }
    } catch (e) {
      console.error('[floor plan] could not read file', e);
      toast.error('Could not read file', `${file.name} could not be opened. Try exporting the page as an image.`);
    } finally { setBusy(b => (b === 'Opening PDF…' || b === 'Preparing image…' ? '' : b)); }
  };
  async function applyPdfPage(file, doc, pageNo) {
    setBusy(`Rendering page ${pageNo}…`);
    try {
      const p = await pdfPageImage(doc.doc, pageNo);
      takeImage({ ...p, fileName: file.name, source: 'pdf', pdfPage: pageNo });
      cancelPdf();
    } catch (e) {
      console.error('[floor plan] page render failed', e);
      toast.error('Page not rendered', `Page ${pageNo} could not be drawn. Try another page, or export it as an image.`);
    } finally { setBusy(''); }
  }
  const cancelPdf = () => { setPdf(null); pdfRef.current?.destroy(); pdfRef.current = null; };

  // ── save ──
  const problems = draft && proj ? planProblems(draft, proj) : [];
  const save = async () => {
    if (saving) return;
    if (problems.length) {
      setShowProblems(true);
      toast.warning('Not saved yet', problems[0]);
      return;
    }
    if (canSave === false) { toast.error('Cannot save', 'Floor plans need database update 0020 first.'); return; }
    setSaving(true);
    setErr('');
    const res = await saveFloorPlan({
      projectId, companyId: proj.companyId || user?.companyId, user,
      plan: { ...draft.plan, name: draft.plan.name.trim(), order: parseInt(draft.plan.order, 10) || 0 },
      pending: draft.pending, types: draft.types,
      units: Object.fromEntries(Object.entries(draft.units).map(([k, u]) => [k, { ...u, code: saveCode(u), size: num(u.size), price: num(u.price) }])),
    });
    setSaving(false);
    if (!res.ok) {
      setErr(`Not saved: ${res.error}.`);
      toast.error('Floor plan not saved', `${cap(res.error)}. Your drawing is still here.`);
      return;
    }
    refreshDB();
    setPlanSel({ projectId, planId: res.plan.id });
    const notes = [];
    if (res.skipped.length) notes.push(`${res.skipped.join(', ')} kept ${res.skipped.length > 1 ? 'their names and types' : 'its name and type'}: on hold or sold meanwhile.`);
    if (res.recreated.length) notes.push(`${res.recreated.join(', ')} had been removed and ${res.recreated.length > 1 ? 'were' : 'was'} added back as available.`);
    toast.success('Floor plan saved', notes.join(' ') || `${res.plan.name} · ${res.plan.boxes.length} unit${res.plan.boxes.length === 1 ? '' : 's'}.`);
    close();
  };

  // ── keyboard ──
  // Registered before useDiscardGuard's Esc listener (both window, capture
  // phase; the guard is called below), so Esc first leaves a field, cancels a
  // pending placement or clears the selection, and only then closes.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (pdf) { e.stopImmediatePropagation(); cancelPdf(); return; }
        if (inField(e.target)) { e.stopImmediatePropagation(); e.target.blur(); return; }
        if (linkKey) { e.stopImmediatePropagation(); setLinkKey(null); return; }
        if (selId) { e.stopImmediatePropagation(); setSelId(null); return; }
        return; // the discard guard closes (or asks)
      }
      if (inField(e.target) || saving || pdf) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); setHist(undo); return; }
      if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); setHist(redo); return; }
      if (mod || e.altKey) return;
      if (k === 'b') { setTool('draw'); return; }
      if (k === 'v') { setTool('select'); return; }
      if (!sel) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteBox(sel.id); return; }
      const step = e.shiftKey ? 10 : 1;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (d) { e.preventDefault(); nudge(d[0], d[1]); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // After the keyboard listener above, so that one sees Esc first.
  const guard = useDiscardGuard({
    isOpen: true,
    isDirty: () => !!draft && snapshot(draft) !== baseline,
    onClose: close,
    busy: saving,
    ask: { title: 'Exit without saving?', description: planId ? 'Your changes to this floor plan will be lost.' : 'This new floor plan will be lost.' },
  });

  if (!proj || !draft) {
    return (
      <div className="mov on" onClick={close}>
        <div className="modal fpe-gone" onClick={e => e.stopPropagation()}>
          <p>This project is no longer available.</p>
          <button type="button" className="btn btn-p" onClick={close}>Close</button>
        </div>
      </div>
    );
  }

  // ── what the canvas shows ──
  const boxes = draft.plan.boxes.map(b => {
    const e = b.unitKey ? draft.units[b.unitKey] : null;
    const st = statusOf(e);
    return { id: b.id, ...toPx(b, W, H), status: st, label: e ? e.code || '?' : (b.lost ? `${b.lost}?` : '?'),
      aria: e ? `${e.code || 'Unnamed unit'}, ${STATUS[st].label}` : 'Box not linked to a unit' };
  });

  // Units of this project with no box on any plan (this plan as it now stands).
  const otherPlaced = new Set(proj.floorPlans.filter(fp => fp.id !== draft.plan.id).flatMap(fp => (fp.boxes || []).map(b => b.unitId)));
  const inDraft = new Set(draft.plan.boxes.map(b => draft.units[b.unitKey]?.orig?.code).filter(Boolean));
  const free = proj.variants.flatMap(v => v.units.map(u => ({ code: u.id, type: v.name, status: u.status, size: unitSize(u, v) })))
    .filter(u => !otherPlaced.has(u.code) && !inDraft.has(u.code)).sort((a, b) => byCode(a.code, b.code));
  const pickable = entry?.orig ? [{ code: entry.orig.code, type: draft.types.find(t => t.id === entry.variantId)?.name || '', status: statusOf(entry) }, ...free] : free;

  const typeObj = entry ? proj.variants.find(v => v.id === entry.variantId) : null;
  const st = statusOf(entry);
  const locked = !!entry?.orig && isUnitLocked(liveOf(entry)?.unit);
  // Judged on the code as it will be saved, like planProblems.
  const myCode = entry ? saveCode(entry) : '';
  const codeClash = !!myCode && (Object.values(draft.units).some(u => u !== entry && saveCode(u) === myCode && draft.plan.boxes.some(b => b.unitKey === u.key))
    || (myCode !== entry.orig?.code && !!findUnit(proj, myCode) && !inDraft.has(myCode)));
  const sizeHint = typeObj?.size > 0 ? `${typeObj.size} (type)` : 'sqft';
  const effSize = num(entry?.size) || typeObj?.size || 0;
  const priceHint = typeObj?.listRate > 0 && effSize ? `${Math.round(typeObj.listRate * effSize)} (type rate)` : '৳ total';
  const rate = num(entry?.price) && effSize ? num(entry.price) / effSize : 0;

  return (
    <div className="mov on" {...guard.backdropProps}>
      <div className="modal fpe" role="dialog" aria-modal="true" aria-label="Floor plan editor" onClick={e => e.stopPropagation()} {...guard.modalProps}>
        <header className="fpe-top">
          <div className="fpe-ttl"><Mi>map</Mi><b>{draft.plan.name || 'Floor plan'}</b><span className="fpe-proj">{proj.name}</span></div>
          <div className="fpe-acts">
            <button type="button" className="btn btn-g fpe-ic" onClick={() => setHist(undo)} disabled={!hist.past.length || saving} aria-label="Undo" title="Undo (Ctrl+Z)" aria-keyshortcuts="Control+Z"><Mi>undo</Mi></button>
            <button type="button" className="btn btn-g fpe-ic" onClick={() => setHist(redo)} disabled={!hist.future.length || saving} aria-label="Redo" title="Redo (Ctrl+Shift+Z)" aria-keyshortcuts="Control+Shift+Z"><Mi>redo</Mi></button>
            {err && <div className="pc-warn fpe-err"><Mi>error</Mi>{err}</div>}
            <button type="button" className="btn btn-g" onClick={guard.requestClose} disabled={saving}><Mi>close</Mi><span className="fpe-tx">Discard</span></button>
            <button type="button" className="btn btn-p" onClick={save} disabled={saving || !!busy || canSave === false}
              title={canSave === false ? 'Needs database update 0020' : undefined}>
              <Mi>save</Mi>{saving ? (draft.pending ? 'Uploading…' : 'Saving…') : <>Save<span className="fpe-tx"> plan</span></>}
            </button>
          </div>
        </header>

        {canSave === false && (
          <div className="fp-banner fpe-banner" role="status"><Mi>database</Mi><div><b>Saving is off.</b> Floor plans need database update 0020 (<code>supabase/migrations/0020_floor_plans.sql</code>).</div></div>
        )}

        <div className="fpe-body">
          <div className="fpe-canvas">
            {img ? (
              <>
                <div className="fpe-tools" role="toolbar" aria-label="Tools">
                  <button type="button" className={tool === 'select' ? 'on' : ''} aria-pressed={tool === 'select'} onClick={() => setTool('select')} title="Select, move and resize (V)"><Mi>arrow_selector_tool</Mi><span className="fpe-tool-tx">Select</span></button>
                  <button type="button" className={tool === 'draw' ? 'on' : ''} aria-pressed={tool === 'draw'} onClick={() => setTool('draw')} title="Draw a box (B)"><Mi>crop_square</Mi><span className="fpe-tool-tx">Draw box</span></button>
                  <span className="fpe-tip">{linkKey ? <>Draw the box for <b>{linkKey.slice(2)}</b> · Esc cancels</> : tool === 'draw' ? 'Drag around a shop to box it; click a box to edit it. Select (V) moves and resizes.' : 'Drag a box to move it; drag a handle to resize. Draw box (B) adds more.'}</span>
                </div>
                <FloorPlanCanvas className="fpe-stage" image={{ url: img.previewUrl || img.url, width: W, height: H }} boxes={boxes}
                  editable tool={tool} selectedId={selId} onSelect={setSelId} onCreate={createBox} onCommit={moveBox}
                  label={`Editing ${draft.plan.name || 'floor plan'}`} />
              </>
            ) : (
              <label className={`fpe-drop${busy ? ' busy' : ''}`}
                onDragOver={e => { e.preventDefault(); }} onDrop={e => { e.preventDefault(); onFile(e.dataTransfer.files?.[0]); }}>
                <Mi>upload_file</Mi>
                <b>{busy || 'Upload the floor plan'}</b>
                <span>Drop an image or a PDF here, or click to choose. PNG, JPG, WebP up to 15 MB · PDF up to 25 MB.</span>
                <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" hidden disabled={!!busy}
                  onChange={e => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
            )}
            {busy && img && <div className="fpe-busy"><span className="fpe-spin" />{busy}</div>}
          </div>

          <aside className="fpe-side">
            {sel ? (
              <section className="fpe-card">
                <div className="fpe-card-hd">
                  <span className="fpv-eyebrow">Selected box</span>
                  <button type="button" className="btn btn-g btn-sm fpe-del" onClick={() => deleteBox(sel.id)}><Mi>delete</Mi>Delete box</button>
                </div>
                {!entry && sel.lost && (
                  <div className="fpe-note warn"><Mi>link_off</Mi><span><b>{sel.lost}</b> is no longer in this project. Add it again, or link the box to another unit.</span></div>
                )}
                <div className="fpe-seg" role="radiogroup" aria-label="Unit">
                  <button type="button" role="radio" aria-checked={!!entry && !entry.orig} className={entry && !entry.orig ? 'on' : ''}
                    onClick={() => { if (!entry || entry.orig) toNewUnit(sel.lost || ''); }}>New unit</button>
                  <button type="button" role="radio" aria-checked={!!entry?.orig} className={entry?.orig ? 'on' : ''}
                    onClick={() => { if (!entry?.orig && free[0]) toExisting(free[0].code); }} disabled={!entry?.orig && !free.length}
                    title={!free.length ? 'Every unit of this project is already on a plan' : undefined}>Existing unit</button>
                </div>

                {entry?.orig && (
                  <label className="fpe-f"><span>Unit</span>
                    <select className="fsel" value={entry.orig.code} onChange={e => toExisting(e.target.value)}>
                      {pickable.map(u => <option key={u.code} value={u.code}>{u.code} · {u.type} · {STATUS[u.status]?.label || u.status}</option>)}
                    </select>
                  </label>
                )}

                {entry && (
                  <>
                    <label className="fpe-f"><span>Name</span>
                      <input ref={nameRef} value={entry.code} onChange={e => setCode(e.target.value)} disabled={locked} placeholder="SHOP-07"
                        aria-invalid={!myCode || codeClash ? 'true' : undefined} spellCheck={false} autoCapitalize="characters" />
                    </label>
                    {!myCode && <div className="fpe-fe">A name is required.</div>}
                    {codeClash && <div className="fpe-fe">{myCode} is already used by another unit.</div>}

                    <label className="fpe-f"><span>Type</span>
                      {newType != null ? (
                        <span className="fpe-newtype">
                          <input autoFocus value={newType} onChange={e => setNewType(e.target.value)} placeholder="e.g. Showroom"
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addType(); } }} />
                          <button type="button" className="btn btn-p btn-sm" onClick={addType}>Add</button>
                          <button type="button" className="btn btn-g btn-sm" onClick={() => setNewType(null)}>Cancel</button>
                        </span>
                      ) : (
                        <select className="fsel" value={entry.variantId || ''} onChange={e => setType(e.target.value)} disabled={locked}>
                          {!entry.variantId && <option value="">Choose a type</option>}
                          {draft.types.map(t => <option key={t.id} value={t.id}>{t.name}{t.isNew ? ' (new)' : ''}</option>)}
                          <option value="__new">+ New type…</option>
                        </select>
                      )}
                    </label>
                    {locked && <div className="fpe-note"><Mi>lock</Mi><span>{STATUS[st].label} — release it first to rename it or change its type. Size and price can still change.</span></div>}

                    <div className="fpe-two">
                      <label className="fpe-f"><span>Size (sqft)</span>
                        <input type="number" min="0" inputMode="decimal" value={entry.size} placeholder={sizeHint} onChange={e => setField('size', e.target.value)} />
                      </label>
                      <label className="fpe-f"><span>Price (৳ total)</span>
                        <input type="number" min="0" inputMode="decimal" value={entry.price} placeholder={priceHint} onChange={e => setField('price', e.target.value)} />
                      </label>
                    </div>
                    <div className="fpe-calc">{rate ? `${taka(rate)} / sqft` : effSize ? `${effSize} sqft${typeObj?.listRate ? ` · ${taka(typeObj.listRate * effSize)} at the type's rate` : ''}` : 'Leave blank to use the type\'s size and rate.'}</div>

                    <div className="fpe-status"><span>Status</span><span className={`fp-pill st-${st}`}>{STATUS[st].label}</span>
                      {!entry.orig && <em>new units start available</em>}</div>
                  </>
                )}
              </section>
            ) : (
              <section className="fpe-card">
                <span className="fpv-eyebrow">Plan</span>
                <div className="fpe-two">
                  <label className="fpe-f fpe-grow"><span>Name</span>
                    <input value={draft.plan.name} placeholder="5th Floor" onChange={e => commitField({ ...draft, plan: { ...draft.plan, name: e.target.value } }, 'plan:name')} />
                  </label>
                  <label className="fpe-f fpe-ord"><span>Order</span>
                    <input type="number" value={draft.plan.order} onChange={e => commitField({ ...draft, plan: { ...draft.plan, order: e.target.value } }, 'plan:order')} title="Floor tabs are sorted by this number" />
                  </label>
                </div>
                {img && (
                  <div className="fpe-imginfo">
                    <Mi>{img.source === 'pdf' ? 'picture_as_pdf' : 'image'}</Mi>
                    <span>{img.fileName || 'Plan image'}{img.pdfPage ? ` · page ${img.pdfPage}` : ''}<br /><small>{W} × {H}px{draft.pending ? ' · not uploaded yet' : ''}</small></span>
                    <button type="button" className="btn btn-g btn-sm" onClick={() => fileRef.current?.click()} disabled={!!busy}><Mi>swap_horiz</Mi>Replace</button>
                    <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" hidden onChange={e => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
                  </div>
                )}
                <div className="fpe-stats">{boxes.length} box{boxes.length === 1 ? '' : 'es'}{boxes.some(b => b.status === 'unlinked') ? ` · ${boxes.filter(b => b.status === 'unlinked').length} not linked` : ''}</div>
                {(showProblems && problems.length > 0) && (
                  <ul className="fpe-problems" aria-label="Before saving">{problems.map(p => <li key={p}><Mi>error</Mi>{p}</li>)}</ul>
                )}
                <div className="fpe-help">
                  <b>How it works</b>
                  <span>Draw a box around each shop (B); its details open here. Click a box to edit it. With Select (V), drag a box to move it or a handle to resize it. Delete removes the selected box; Ctrl+Z undoes.</span>
                </div>
              </section>
            )}

            {!sel && img && (
              <section className="fpe-card fpe-free">
                <div className="fpe-card-hd"><span className="fpv-eyebrow">Not on any plan</span><span className="fpe-count">{free.length}</span></div>
                {free.length === 0
                  ? <div className="fpe-none">Every unit of this project has a box.</div>
                  : free.map(u => (
                    <button key={u.code} type="button" className={`fpe-freerow${linkKey === 'u:' + u.code ? ' on' : ''}`}
                      onClick={() => { setLinkKey(k => (k === 'u:' + u.code ? null : 'u:' + u.code)); setTool('draw'); }}>
                      <i className={`fp-dot st-${u.status}`} /><b>{u.code}</b><span>{u.type}</span><span className="fpe-place">{linkKey === 'u:' + u.code ? 'Draw it' : 'Place'}</span>
                    </button>
                  ))}
              </section>
            )}
          </aside>
        </div>

        {pdf && (
          <div className="fpe-pdf" role="dialog" aria-label="Choose a PDF page">
            <div className="fpe-pdf-in">
              <div className="fpe-pdf-hd"><b>Which page is the floor plan?</b><span>{pdf.file.name} · {pdf.numPages} pages</span>
                <button type="button" className="m-x" onClick={cancelPdf} aria-label="Cancel"><Mi>close</Mi></button></div>
              <div className="fpe-pdf-grid">
                {Array.from({ length: pdf.numPages }, (_, i) => i + 1).map(n => (
                  <button key={n} type="button" className="fpe-pg" disabled={!!busy} onClick={() => applyPdfPage(pdf.file, pdfRef.current, n)}>
                    {pdf.thumbs[n] ? <img src={pdf.thumbs[n]} alt="" /> : <span className="fpe-pg-ph">{pdf.thumbs[n] === '' ? 'No preview' : '…'}</span>}
                    <span className="fpe-pg-n">Page {n}</span>
                  </button>
                ))}
              </div>
              {busy && <div className="fpe-busy static"><span className="fpe-spin" />{busy}</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
