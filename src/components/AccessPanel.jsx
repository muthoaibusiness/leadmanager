import { useState } from 'react';
import Mi from './Mi.jsx';
import { useApp } from '../context/AppContext.jsx';
import { rlabel } from '../lib/helpers.js';
import { canManageUser, assignableRoles, initialFeatures } from '../lib/constants.js';
import { setFeatures, setRole, setActive } from '../lib/accessAdmin.js';
import FeatureEditor from './FeatureEditor.jsx';
import './AccessPanel.css';
import { Select, SelectLabel, SelectTrigger, SelectValue, SelectPopover, SelectListBox, SelectItem } from './ui/select.jsx';

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

  if (!editable.length) return <div className="acc-card"><div className="acc-card-s">No accounts you can manage.</div></div>;

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
  return (
    <div className="acc-card acp">
      <div className="acc-card-hd">
        <div>
          <div className="acc-card-t"><Mi>shield</Mi>Access</div>
          <div className="acc-card-s">Changes apply on the account's next request. Deactivating also signs it out everywhere.</div>
        </div>
      </div>

      <div className="acp-row">
        {/* ds-allow-native-select: ui/select.jsx (radix), not a native <select>; the lint is case-insensitive. */}
        <Select className="acp-f" value={pickId} onChange={setPickId} disabled={busy} name="access-account">
          <SelectLabel>Account</SelectLabel>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectPopover><SelectListBox>
            {editable.map(u => <SelectItem key={u.id} value={u.id}>{u.name} · {rlabel(u.role)}{u.isActive === false ? ' (inactive)' : ''}</SelectItem>)}
          </SelectListBox></SelectPopover>
        </Select>
        {/* ds-allow-native-select: same radix Select. */}
        <Select className="acp-f" value={target.role} name="access-role"
          disabled={busy || !assignableRoles(user).includes(target.role)}
          onChange={r => { if (r !== target.role) apply(() => setRole(target.id, r), 'Role saved'); }}>
          <SelectLabel>Role</SelectLabel>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectPopover><SelectListBox>
            {[...new Set([target.role, ...assignableRoles(user)])].map(r => <SelectItem key={r} value={r}>{rlabel(r)}</SelectItem>)}
          </SelectListBox></SelectPopover>
        </Select>
        <div className="acp-f"><span className="sel-label">Status</span>
          <button type="button" className={`btn btn-g${active ? '' : ' on'}`} disabled={busy}
            onClick={() => apply(() => setActive(target.id, !active), active ? 'Account deactivated' : 'Account reactivated')}>
            <Mi>{active ? 'block' : 'check_circle'}</Mi>{active ? 'Deactivate' : 'Reactivate'}
          </button>
        </div>
      </div>

      <div className="fl">
        <div className="ea-row">
          <label style={{ margin: 0 }}>Feature access</label>
          <span className="ea-count" style={{ margin: 0 }}>{feat.size} enabled{Array.isArray(target.allowedFeatures) ? '' : ' · role defaults'}</span>
        </div>
        <FeatureEditor value={feat} onToggle={toggle} role={target.role} disabled={busy} />
      </div>
      {err && <div className="acp-err" role="alert"><Mi>error</Mi>{err}</div>}
      <div className="acp-ft">
        <button type="button" className="btn btn-g" disabled={busy || !Array.isArray(target.allowedFeatures)}
          onClick={() => apply(() => setFeatures(target.id, null), 'Back to role defaults')}>
          <Mi>restart_alt</Mi>Use role defaults
        </button>
        <button type="button" className="btn btn-p" disabled={busy || !dirty}
          onClick={() => apply(() => setFeatures(target.id, [...feat]), 'Access saved')}>
          <Mi>save</Mi>{busy ? 'Saving…' : 'Save access'}
        </button>
      </div>
    </div>
  );
}
