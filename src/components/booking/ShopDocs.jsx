import { useEffect, useRef, useState } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { saveProject } from '../../lib/projects.js';
import {
  DOCS, DSTAGE, docReady, docState, stageOf, genText, fileKind,
  uploadKitFile, approveKit, addShopLog, buildFloorPlanFile,
} from '../../lib/shopDocs.js';
import { waAccountFor, waConversationForLead, waSendMessage, WA_ACCOUNT_LABEL } from '../../lib/wa.js';
import { fmtAgo } from '../../lib/helpers.js';
import DocViewer from './DocViewer.jsx';

// The shop panel's Documents and History tabs. Documents: the kit by stage, a
// dot per item (ready / draft / missing), view, upload (management) and a send
// box. "Send" goes out through Wasender (the same relay as Conversations) from
// the number the customer already chats with, Eyad's or Dubai's, and is logged
// in History. State comes from useShopDocs (the parent keeps the
// "4/16" count in the tab itself).

const canManage = (u) => u?.role === 'MANAGEMENT' || u?.role === 'MASTER';
const when = (iso) => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const mask = (c) => (/@/.test(c) ? c.replace(/^(.).*(@.*)$/, '$1•••$2') : c.length > 6 ? c.slice(0, 3) + '•••' + c.slice(-3) : c);

export function DocsTab({ project, shop, floorName, store, client: picked }) {
  const { user, showToast, waSettings, refreshDB } = useApp();
  const { lib, missing, loaded, cid, reload } = store;
  const stage = stageOf(shop);
  const first = (d) => docReady(d, lib) && (d.stage === stage || (stage !== 'pre' && d.stage === 'pre' && d.t === 'gen'));
  // The ticked set follows the shop; a pick made by hand is kept until the shop changes.
  const [pick, setPick] = useState({ code: null, set: new Set() });
  const sel = pick.code === shop.code ? pick.set : new Set(DOCS.filter(first).map(d => d.k));
  const setSel = (s) => setPick({ code: shop.code, set: s });
  const [view, setView] = useState(null);
  // Who it is for comes from the customer picked above the tabs.
  const client = picked?.name || shop.clientName || '';
  const [from, setFrom] = useState(''); // which WhatsApp number this customer is answered from
  useEffect(() => {
    let dead = false;
    if (picked?.phone) waAccountFor(picked, user).then(a => { if (!dead) setFrom(a); });
    return () => { dead = true; };
  }, [picked, user]);
  const fromLabel = picked?.phone && from ? WA_ACCOUNT_LABEL[from] : '';
  const [busy, setBusy] = useState(false);
  const file = useRef(null);
  const upKey = useRef(null);
  const manage = canManage(user);

  const ready = DOCS.filter(d => docReady(d, lib)).length;
  const toggle = (k) => { const s = new Set(sel); if (s.has(k)) s.delete(k); else s.add(k); setSel(s); };
  const chosen = DOCS.filter(d => sel.has(d.k) && docReady(d, lib));

  const upload = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || !upKey.current) return;
    setBusy(true);
    const r = await uploadKitFile(cid, upKey.current, f, user);
    setBusy(false);
    if (r.ok) { showToast('File added to the document kit', 'ok'); reload(); } else showToast(r.error, 'err');
  };
  const approve = async (k, on = true) => { setBusy(true); const ok = await approveKit(cid, k, user, on); setBusy(false); if (ok) { reload(); showToast(on ? 'Approved. It can now be sent to clients.' : 'Approval withdrawn.', 'ok'); } else showToast('Could not change the approval', 'err'); };

  const [sending, setSending] = useState(false);
  // The brochure is a link on the project (label "Brochure"); management sets it from the viewer.
  const saveBrochure = async (url) => {
    const keep = (project.media?.links || []).filter(l => !/brochure/i.test(l.label || ''));
    const r = await saveProject(project.id, { media: { ...project.media, links: url ? [...keep, { label: 'Brochure', url }] : keep } });
    if (r.ok) { refreshDB(); reload(); showToast(url ? 'Brochure link saved for this project' : 'Brochure link removed', 'ok'); } else showToast(`Not saved: ${r.error}`, 'err');
    return r.ok;
  };
  // Management: cut the floor-plan pages out of the uploaded brochure into their own document.
  const [building, setBuilding] = useState('');
  const buildPlans = async () => {
    const url = lib.brochure?.url;
    if (!url || building) return;
    try {
      setBuilding('Reading the brochure…');
      const { file: pdf, pages } = await buildFloorPlanFile(url, project.name.replace(/[^\w]+/g, '-').replace(/-+$/, ''), (i, n) => setBuilding(`Drawing floor plan ${Math.min(i + 1, n)} of ${n}…`));
      setBuilding('Saving…');
      const r = await uploadKitFile(cid, 'floorplans', pdf, user);
      if (!r.ok) throw new Error(r.error);
      reload();
      showToast(`Floor plans document updated from the brochure (${pages.length} pages)`, 'ok');
    } catch (e) {
      showToast(`Not updated: ${e.message || e}`, 'err');
    } finally {
      setBuilding('');
    }
  };
  const send = async () => {
    if (!picked?.phone || !chosen.length || sending) return;
    if (waSettings && waSettings.enabled === false) { showToast('WhatsApp chat is switched off in Chat Settings.', 'err'); return; }
    setSending(true);
    const res = await waConversationForLead(picked, user);
    if (!res.ok) { setSending(false); showToast(res.error, 'err'); return; }
    const conv = res.conversation;
    const sent = [];
    const gen = chosen.filter(d => d.t === 'gen');
    const files = chosen.filter(d => lib[d.k]?.url || lib[d.k]?.plans || lib[d.k]?.link);
    let failed = '';
    const go = async (payload) => { const r = await waSendMessage(waSettings, { conversation: conv, user, ...payload }); if (!r.ok && !failed) failed = r.error || 'A message failed.'; return r.ok; };
    if (gen.length) {
      const text = [`Hello ${client},`, '', project.name, ...gen.map(d => '\n' + genText(d.k, project, shop, floorName))].join('\n');
      if (await go({ type: 'text', body: text })) gen.forEach(d => sent.push(d.k));
    }
    for (const d of files) {
      const L = lib[d.k];
      if (L.link && !L.url) {
        if (await go({ type: 'text', body: `${d.n}: ${L.link}` })) sent.push(d.k);
        continue;
      }
      if (L.plans) {
        let all = true;
        for (const p of L.plans) if (!(await go({ type: 'image', body: `${project.name} · ${p.name}`, mediaUrl: p.url, mediaMime: p.mime, mediaName: `${p.name}.${p.mime.split('/')[1] || 'jpg'}` }))) all = false;
        if (all) sent.push(d.k);
        continue;
      }
      if (await go({ type: fileKind(L.mime), body: d.n, mediaUrl: L.url, mediaMime: L.mime, mediaName: L.name || d.n, mediaSize: L.size })) sent.push(d.k);
    }
    const skipped = chosen.length - gen.length - files.length; // approved templates with no file yet
    if (sent.length) await addShopLog(cid, { propertyId: project.id, unitId: shop.code, kind: 'docs_sent', client, contact: mask(picked.phone), channel: `WhatsApp · ${WA_ACCOUNT_LABEL[conv.account] || conv.account}`, docs: sent }, user);
    setSending(false);
    if (sent.length) reload();
    showToast(failed || `${sent.length} document${sent.length > 1 ? 's' : ''} sent to ${client} from ${WA_ACCOUNT_LABEL[conv.account]}${skipped ? ` (${skipped} have no file yet)` : ''}`, failed ? 'err' : 'ok');
  };

  if (!loaded) return <div className="bk-hint">Loading documents…</div>;
  if (missing) return <div className="bk-taken"><Mi>info</Mi><div><b>Document kit is not set up</b><span>Apply supabase/migrations/0071_shop_docs.sql to turn it on.</span></div></div>;

  const previewDoc = view && DOCS.find(d => d.k === view);

  return (
    <div className="bkd">
      <div className="bkd-head">
        <div className="bkd-top"><b>{ready} of {DOCS.length} ready</b>
          <span className="bk-legend"><span><i className="bkd-dot ok" />Ready</span><span><i className="bkd-dot warn" />Draft</span><span><i className="bkd-dot miss" />Missing</span></span>
        </div>
        <div className="bkd-bar"><i style={{ width: `${ready / DOCS.length * 100}%` }} /></div>
      </div>

      {Object.keys(DSTAGE).map(g => (
        <div className="bkd-group" key={g}>
          <h4 className={g === stage ? 'now' : undefined}>{DSTAGE[g]}</h4>
          {DOCS.filter(d => d.stage === g).map(d => {
            const ok = docReady(d, lib);
            const [c, t] = docState(d, lib);
            const L = lib[d.k];
            return (
              <div key={d.k} className={`bkd-row${ok ? '' : ' off'}`}>
                <input type="checkbox" id={`bkd-${d.k}`} checked={sel.has(d.k) && ok} disabled={!ok} onChange={() => toggle(d.k)} />
                <label htmlFor={`bkd-${d.k}`} title={d.d}>{d.n}</label>
                <span className={`bkd-dot ${c}`} title={t} aria-label={t} />
                <span className="bkd-acts">
                  <button type="button" className="bkd-ib" title="View" aria-label={`View ${d.n}`} onClick={() => setView(d.k)}><Mi>visibility</Mi></button>
                  {manage && d.t !== 'gen' && (
                    <button type="button" className="bkd-ib" disabled={busy} title={L?.url ? 'Replace file' : 'Upload file'} aria-label={`Upload ${d.n}`}
                      onClick={() => { upKey.current = d.k; file.current?.click(); }}><Mi>upload_file</Mi></button>
                  )}
                  {manage && d.t === 'tpl' && !ok && (
                    <button type="button" className="bkd-ib" disabled={busy} title="Approve the standard text" aria-label={`Approve ${d.n}`} onClick={() => approve(d.k)}><Mi>task_alt</Mi></button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      ))}

      {previewDoc && <DocViewer doc={previewDoc} project={project} shop={shop} floorName={floorName} entry={lib[previewDoc.k]} manage={manage} busy={busy} onApprove={(on) => approve(previewDoc.k, on)} onSaveLink={saveBrochure} brochureUrl={lib.brochure?.url || ''} onBuildPlans={buildPlans} building={building} onClose={() => setView(null)} />}

      <div className="bkd-send">
        {picked ? (
          <div className="bkd-to">
            <span className="bk-cap">Send to</span>
            <b>{client}</b>
            <span className="bkd-from">{picked.phone ? `${picked.phone}${fromLabel ? ` · from ${fromLabel}` : ''}` : 'No phone number'}</span>
          </div>
        ) : <div className="bk-hint">Choose a customer above to send documents.</div>}
        <button type="button" className="bk-btn primary" disabled={!chosen.length || !picked?.phone || sending} onClick={send}>
          {sending ? 'Sending…' : chosen.length ? `Send ${chosen.length} document${chosen.length > 1 ? 's' : ''} on WhatsApp` : 'Select documents'}
        </button>
        {!manage && <div className="bk-hint">Management adds and approves the files.</div>}
      </div>
      <input ref={file} type="file" hidden accept=".pdf,image/png,image/jpeg,image/webp" onChange={upload} />
    </div>
  );
}

export function HistoryTab({ project, shop, store }) {
  const { user, showToast } = useApp();
  const { log, missing, loaded, cid, reload } = store;
  const [note, setNote] = useState('');
  const save = async () => {
    const t = note.trim();
    if (!t) return;
    const ok = await addShopLog(cid, { propertyId: project.id, unitId: shop.code, kind: 'note', note: t }, user);
    if (ok) { setNote(''); reload(); } else showToast('Could not save the note', 'err');
  };
  if (!loaded) return <div className="bk-hint">Loading history…</div>;
  if (missing) return <div className="bk-taken"><Mi>info</Mi><div><b>History is not set up</b><span>Apply supabase/migrations/0071_shop_docs.sql to turn it on.</span></div></div>;
  return (
    <div className="bkd">
      {shop.status === 'hold' && (
        <div className="bkd-banner">On hold{shop.clientName ? ` for ${shop.clientName}` : ''}{shop.holdUntil ? ` · until ${new Date(shop.holdUntil).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}` : ''}</div>
      )}
      {log.length ? (
        <ol className="bkd-tl">
          {log.map(a => (
            <li key={a.id}>
              <span className={`bkd-ki ${a.kind}`}>{a.kind === 'docs_sent' ? 'D' : 'N'}</span>
              <div>
                <div className="bkd-tl-top"><b>{a.kind === 'docs_sent' ? 'Documents sent' : 'Note'}</b><span>{fmtAgo(a.at) || when(a.at)}</span></div>
                <div className="bkd-meta">{a.client ? `${a.client} · ` : ''}{a.by}</div>
                {a.kind === 'docs_sent' && <div className="bkd-meta">{a.docs.length} documents · {a.channel}{a.contact ? ` · ${a.contact}` : ''}</div>}
                {a.note && <div className="bkd-meta">{a.note}</div>}
              </div>
            </li>
          ))}
        </ol>
      ) : <div className="bk-empty">No activity yet</div>}
      <div className="bkd-note">
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Add a note" aria-label="Add a note" onKeyDown={e => { if (e.key === 'Enter') save(); }} />
        <button type="button" className="bk-btn" onClick={save} disabled={!note.trim()}>Save</button>
      </div>
    </div>
  );
}
