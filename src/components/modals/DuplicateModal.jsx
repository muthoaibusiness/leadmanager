import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { findDuplicateLeads, bulkDeleteLeads } from '../../lib/db.js';
import { fmtD } from '../../lib/helpers.js';

// Duplicate checker — scans the user's leads, lists duplicate groups, and lets
// the user remove the extras (keeps the most-recent lead in each group).
export default function DuplicateModal() {
  const { modal, closeModal, user, refreshDB, showToast, setPanLead } = useApp();
  const isOpen = modal === 'duplicates';
  if (!isOpen) return <div className="mov" onClick={closeModal} />;

  const groups = findDuplicateLeads(user);
  const extraCount = groups.reduce((s, g) => s + (g.leads.length - 1), 0);

  const removeAll = () => {
    const ids = groups.flatMap(g => g.leads.slice(1).map(l => l.id)); // keep newest, drop rest
    if (!ids.length) return;
    if (!window.confirm(`Remove ${ids.length} duplicate lead(s)? The most recent in each group is kept. This cannot be undone.`)) return;
    bulkDeleteLeads(ids, user);
    refreshDB();
    closeModal();
    showToast(`${ids.length} duplicate(s) removed`, 'ok');
  };

  const removeGroup = (g) => {
    const ids = g.leads.slice(1).map(l => l.id);
    if (!ids.length) return;
    bulkDeleteLeads(ids, user);
    refreshDB();
    showToast(`${ids.length} duplicate(s) removed`, 'ok');
  };

  return (
    <div className="mov on" onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
      <div className="modal" style={{ maxWidth: '560px' }}>
        <div className="m-hd">
          <div className="m-ttl">Duplicate Checker</div>
          <button className="m-x" onClick={closeModal}><Mi>close</Mi></button>
        </div>
        <div className="m-body">
          {!groups.length ? (
            <div className="dup-clean">
              <Mi>verified</Mi>
              <div className="dup-clean-t">No duplicates found</div>
              <div className="dup-clean-s">Every lead has a unique phone (or name + email).</div>
            </div>
          ) : (
            <>
              <div className="dup-alert">
                <Mi>warning</Mi>
                <span><b>{groups.length}</b> duplicate group(s) · <b>{extraCount}</b> extra lead(s) found. Newest in each group is kept.</span>
              </div>
              <div className="dup-list">
                {groups.map((g, i) => (
                  <div key={g.key} className="dup-group">
                    <div className="dup-group-hd">
                      <span className="dup-key"><Mi>content_copy</Mi>{g.leads.length}× · {g.key.startsWith('p:') ? g.key.slice(2) : g.leads[0].name}</span>
                      <button className="btn btn-g btn-sm" onClick={() => removeGroup(g)}><Mi>delete</Mi>Remove {g.leads.length - 1}</button>
                    </div>
                    {g.leads.map((l, idx) => (
                      <div key={l.id} className={`dup-row${idx === 0 ? ' keep' : ''}`} onClick={() => { closeModal(); setTimeout(() => setPanLead(l.id), 100); }}>
                        <span className="dup-badge">{idx === 0 ? 'KEEP' : 'DUP'}</span>
                        <div className="dup-info">
                          <div className="dup-name">{l.name}</div>
                          <div className="dup-sub">{l.phone || l.email || '—'} · {fmtD(l.createdAt)} · {l.assignedToName || '—'}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="m-ft">
          <button className="btn btn-g" onClick={closeModal}>Close</button>
          {groups.length > 0 && (
            <button className="btn btn-p" onClick={removeAll} style={{ background: 'var(--red)', color: '#fff' }}>
              <Mi>delete_sweep</Mi>Remove all {extraCount} duplicates
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
