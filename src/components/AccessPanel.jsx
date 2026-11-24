import { useState } from 'react';
import Mi from './Mi.jsx';
import { useApp } from '../context/AppContext.jsx';
import { rlabel } from '../lib/helpers.js';
import { canManageUser, assignableRoles, initialFeatures } from '../lib/constants.js';
import { setFeatures, setRole, setActive } from '../lib/accessAdmin.js';
import FeatureEditor from './FeatureEditor.jsx';
import './AccessPanel.css';
import BkSelect from './booking/BkSelect.jsx';
import './booking/ShopBooking.css';
import './project/AddPropertyWizard.css';

// Users & Accounts › Access: one account at a time, its role, status and
// feature access. Every save goes to the access-admin function, which checks
// the same rules (access-rules.js), and the form shows what the server stored.
export default function AccessPanel({ users }) {
  const { user, refreshDB, showToast } = useApp();
  const editable = users.filter(u => u.id !== user.id && canManageUser(user, u));
  const [pickId, setPickId] = useState(editable[0]?.id || '');
  const target = editable.find(u => u.id === pickId) || null;
  const [feat, setFeat] = useState(() => initialFeatures(target));
  const [shownFor, setShownFor] = useState(target?.id || null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // The form follows the picked account. Also re-seeds after a save, because
  // storeUserRow replaces the cached object with the server's row.
  if (target && shownFor !== target.id) { setShownFor(target.id); setFeat(initialFeatures(target)); setErr(''); }

  if (!editable.length) return <div className="bk-empty bk-empty-lg"><Mi>shield</Mi><b>No accounts you can manage</b><span>Accounts you may change appear here.</span></div>;

  const before = initialFeatures(target);
  const dirty = before.size !== feat.size || [...feat].some(k => !before.has(k));
  const toggle = (k) => setFeat(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const apply = async (fn, okMsg) => {
    setBusy(true); setErr('');
    const r = await fn();
    setBusy(false);
    refreshDB();
    if (!r.ok) { setErr(r.error); showToast(r.error, 'err'); return; }
    setShownFor(null);   // re-seed the checklist from the saved row
    showToast(okMsg, 'ok');
  };

  const active = target.isActive !== false;
  const roleOpts = [...new Set([target.role, ...assignableRoles(user)])].map(r => ({ value: r, label: rlabel(r) }));
  return (
    <section className="rqi-card acp" aria-label="Access">
      <header>
        <div><h3>Access</h3><span className="bk-cap">Changes apply on the account's next request. Deactivating also signs it out everywhere.</span></div>
      </header>

      <div className="acp-row">
        <div className="pw-f"><span className="bk-cap">Account</span>
          <BkSelect label="Account" value={pickId} onChange={v => { if (!busy) setPickId(v); }}
            options={editable.map(u => ({ value: u.id, label: `${u.name} · ${rlabel(u.role)}${u.isActive === false ? ' (inactive)' : ''}` }))} /></div>
        <div className="pw-f"><span className="bk-cap">Role</span>
          <BkSelect label="Role" value={target.role} options={roleOpts}
            onChange={r => { if (!busy && assignableRoles(user).includes(target.role) && r !== target.role) apply(() => setRole(target.id, r), 'Role saved'); }} /></div>
        <div className="pw-f"><span className="bk-cap">Status</span>
          <button type="button" className="bk-btn" disabled={busy}
            onClick={() => apply(() => setActive(target.id, !active), active ? 'Account deactivated' : 'Account reactivated')}>
            <Mi>{active ? 'block' : 'check_circle'}</Mi>{active ? 'Deactivate' : 'Reactivate'}
          </button>
        </div>
      </div>

      <div className="acp-feat">
        <div className="acp-feat-h">
          <span className="bk-cap">Feature access</span>
          <span className="bk-cap">{feat.size} enabled{Array.isArray(target.allowedFeatures) ? '' : ' · role defaults'}</span>
        </div>
        <FeatureEditor value={feat} onToggle={toggle} role={target.role} disabled={busy} />
      </div>
      {err && <div className="pw-warn" role="alert"><Mi>error</Mi>{err}</div>}
      <div className="acp-ft">
        <button type="button" className="bk-btn" disabled={busy || !Array.isArray(target.allowedFeatures)}
          onClick={() => apply(() => setFeatures(target.id, null), 'Back to role defaults')}>
          <Mi>restart_alt</Mi>Use role defaults
        </button>
        <button type="button" className="bk-btn primary" disabled={busy || !dirty}
          onClick={() => apply(() => setFeatures(target.id, [...feat]), 'Access saved')}>
          <Mi>save</Mi>{busy ? 'Saving…' : 'Save access'}
        </button>
      </div>
    </section>
  );
}
