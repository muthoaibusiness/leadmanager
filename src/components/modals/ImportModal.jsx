import { useState, useRef } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { processImportCSV, submitImport as doSubmitImport } from '../../lib/db.js';
import { SRC_LABELS, STATUS_LABELS } from '../../lib/constants.js';

function sclass(s) { return 's-' + (s || '').toLowerCase(); }
function srcclass(s) { return 'src-' + (s || '').toLowerCase(); }

export default function ImportModal() {
  const { modal, closeModal, user, importData, setImportData, refreshDB, showToast } = useApp();
  const isOpen = modal === 'import';
  const fileRef = useRef();

  const handleFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const result = processImportCSV(ev.target.result, user);
      setImportData(result);
    };
    reader.readAsText(file, 'UTF-8');
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const submitImport = () => {
    if (!importData || !importData.leads.length) return;
    const count = doSubmitImport(importData, user);
    setImportData(null);
    closeModal();
    refreshDB();
    showToast(count + ' leads imported', 'ok');
  };

  const handleClose = () => {
    setImportData(null);
    closeModal();
  };

  return (
    <div className={`mov${isOpen ? ' on' : ''}`} onClick={e => { if (e.target === e.currentTarget) handleClose(); }}>
      <div className="modal" style={{ maxWidth: '560px' }}>
        <div className="m-hd">
          <div className="m-ttl">Import Leads from CSV</div>
          <button className="m-x" onClick={handleClose}><Mi>close</Mi></button>
        </div>
        <div className="m-body">
          {!importData ? (
            <div
              className="import-drop"
              onClick={() => fileRef.current.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={handleDrop}
            >
              <Mi>upload_file</Mi>
              <div style={{ fontSize: '14px', fontWeight: 600 }}>Drop your CSV file here or click to browse</div>
              <div style={{ fontSize: '12px', color: 'var(--t3)', marginTop: '5px' }}>Supports Google Sheets CSV export · Duplicates auto-skipped by phone number</div>
              <input type="file" ref={fileRef} accept=".csv,.txt" style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
            </div>
          ) : (
            <>
              <div className="imp-stats">
                <div className="imp-stat"><div className="imp-sv">{importData.total}</div><div className="imp-sl">Total rows</div></div>
                <div className="imp-stat"><div className="imp-sv" style={{ color: 'var(--green)' }}>{importData.leads.length}</div><div className="imp-sl">Will import</div></div>
                <div className="imp-stat"><div className="imp-sv" style={{ color: 'var(--orange)' }}>{importData.skipped}</div><div className="imp-sl">Duplicates skipped</div></div>
                {importData.blank > 0 && <div className="imp-stat"><div className="imp-sv" style={{ color: 'var(--red)' }}>{importData.blank}</div><div className="imp-sl">No name/phone</div></div>}
              </div>
              {importData.leads.filter(l => !l.phone).length > 0 && (
                <div style={{ fontSize: '12px', color: 'var(--orange)', margin: '4px 0 10px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <Mi style={{ fontSize: '16px' }}>warning</Mi>
                  {importData.leads.filter(l => !l.phone).length} row(s) have no phone — check your CSV's phone column header.
                </div>
              )}
              <div className="imp-prev-hd">Preview — first {Math.min(8, importData.leads.length)} of {importData.leads.length}</div>
              <div className="imp-table">
                <div className="imp-hdr"><div>Name</div><div>Phone</div><div>Source</div><div>Status</div></div>
                {importData.leads.slice(0, 8).map((l, i) => (
                  <div key={i} className="imp-row">
                    <div className="imp-cell">
                      <div style={{ fontSize: '12px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</div>
                      {l.city && <div style={{ fontSize: '11px', color: 'var(--t3)' }}>{l.city}</div>}
                    </div>
                    <div className="imp-cell" style={{ fontSize: '11px', color: 'var(--t2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.phone}</div>
                    <div className="imp-cell"><span className={`bdg ${srcclass(l.source)}`}>{SRC_LABELS[l.source] || l.source}</span></div>
                    <div className="imp-cell"><span className={`bdg ${sclass(l.status)}`}>{STATUS_LABELS[l.status] || l.status}</span></div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="m-ft">
          <button className="btn btn-g" onClick={handleClose}>Cancel</button>
          {importData && importData.leads.length > 0 && (
            <button className="btn btn-p" onClick={submitImport}><Mi>upload</Mi>Import {importData.leads.length} Customers</button>
          )}
        </div>
      </div>
    </div>
  );
}
