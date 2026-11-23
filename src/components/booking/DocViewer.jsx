import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Mi from '../Mi.jsx';
import { docFile, kitDoc, genDoc, previewUrl, brochureLink } from '../../lib/shopDocs.js';

// The popup a document's view button opens (as on the Citizen Avenue page):
// the document on a white sheet, with Close, Download and, for a template that
// has no uploaded file, Approve for clients / Withdraw approval (management).
// An uploaded PDF or image is shown as it is, with Open in a new tab.
export default function DocViewer({ doc, project, shop, floorName, entry, manage, busy, onApprove, onSaveLink, brochureUrl, onBuildPlans, building, onClose }) {
  const [link, setLink] = useState(brochureLink(project));
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [onClose]);

  const plans = entry?.plans || null; // the project's own floor plans
  const ext = !entry?.url && entry?.link ? entry.link : ''; // a link, e.g. the Drive brochure
  const isBrochure = doc.k === 'brochure';
  const file = entry?.url ? entry : null;
  const title = `${doc.n}, shop ${shop.code}`;
  const html = file ? '' : doc.t === 'gen' ? genDoc(doc.k, project, shop, floorName) : kitDoc(doc, project, shop, floorName, !!entry?.approved);
  const canApprove = manage && doc.t === 'tpl' && !file && !plans && !ext;

  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([docFile(title, html)], { type: 'text/html' }));
    a.download = `${title.replace(/[^\w]+/g, '-').replace(/-+$/, '')}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return createPortal(
    <div className="bk bkd-scrim" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bkd-modal" role="dialog" aria-label={title}>
        <div className="bkd-modal-h">
          <h3>{title}</h3>
          <button type="button" className="bk-close" aria-label="Close" onClick={onClose}><Mi>close</Mi></button>
        </div>
        <div className="bkd-modal-b">
          {plans ? (
            <div className="bkd-plans">
              {plans.map(p => <figure key={p.name}><img src={p.url} alt={p.name} /><figcaption>{p.name} <a href={p.url} target="_blank" rel="noopener noreferrer">open</a></figcaption></figure>)}
            </div>
          ) : ext ? (
            <iframe className="bkd-frame" src={previewUrl(ext)} title={title} allow="autoplay" />
          ) : file ? (
            file.mime === 'application/pdf'
              ? <iframe className="bkd-frame" src={file.url} title={title} />
              : <img className="bkd-img" src={file.url} alt={title} />
          ) : <div className="bkd-sheet full" dangerouslySetInnerHTML={{ __html: html }} />}
        </div>
        {doc.k === 'floorplans' && manage && brochureUrl && (
          <div className="bkd-linkbar">
            <span className="bk-cap">{entry?.url ? 'This document is an uploaded file.' : 'This document shows the plan images saved on the project.'} Rebuild it from the floor-plan pages of the uploaded brochure.</span>
            <div className="bkd-linkrow">
              <button type="button" className="bk-btn" disabled={!!building} onClick={onBuildPlans}>{building || (entry?.url ? 'Update from the brochure' : 'Create from the brochure')}</button>
            </div>
          </div>
        )}
        {isBrochure && manage && (
          <div className="bkd-linkbar">
            <label className="bk-cap" htmlFor="bkd-blink">Brochure link for {project.name} (Google Drive or any web link)</label>
            <div className="bkd-linkrow">
              <input id="bkd-blink" value={link} onChange={e => setLink(e.target.value)} placeholder="https://drive.google.com/file/d/…" />
              <button type="button" className="bk-btn" disabled={saving || link.trim() === brochureLink(project)}
                onClick={async () => { setSaving(true); await onSaveLink(link.trim()); setSaving(false); }}>{saving ? 'Saving…' : 'Save link'}</button>
            </div>
          </div>
        )}
        <div className="bkd-modal-f">
          <button type="button" className="bk-btn" onClick={onClose}>Close</button>
          {canApprove && (entry?.approved
            ? <button type="button" className="bk-btn" disabled={busy} onClick={() => onApprove(false)}>Withdraw approval</button>
            : <button type="button" className="bk-btn" disabled={busy} onClick={() => onApprove(true)}>Approve for clients</button>)}
          {ext && <a className="bk-btn primary" href={ext} target="_blank" rel="noopener noreferrer">Open in new tab</a>}
          {plans || ext ? null : file
            ? <a className="bk-btn primary" href={file.url} target="_blank" rel="noopener noreferrer">Open in new tab</a>
            : <button type="button" className="bk-btn primary" onClick={download}>Download</button>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
