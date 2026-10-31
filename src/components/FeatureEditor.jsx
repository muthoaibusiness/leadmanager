import Mi from './Mi.jsx';
import { FEATURE_KEYS, FEATURE_LABELS, FEATURE_HINTS, ROLES } from '../lib/constants.js';

// The one feature-access checklist, used by EditAgentModal and the Access
// Management tab. `value` is the set being edited (initialFeatures in
// constants.js seeds it); the caller saves it through accessAdmin.setFeatures,
// so the server applies the same rules (access-rules.js) the labels describe.

export default function FeatureEditor({ value, onToggle, role, disabled = false }) {
  return (
    <>
      <div className="feat-grid" role="group" aria-label="Feature access">
        {FEATURE_KEYS.map(k => (
          <button key={k} type="button" className={`feat-chip${value.has(k) ? ' on' : ''}`} aria-pressed={value.has(k)}
            disabled={disabled} onClick={() => onToggle(k)} title={FEATURE_HINTS[k]}>
            <Mi aria-hidden="true">{value.has(k) ? 'check_box' : 'check_box_outline_blank'}</Mi>{FEATURE_LABELS[k] || k}
          </button>
        ))}
      </div>
      <div className="ea-count">{role === ROLES.EXEC ? 'Executive: no defaults. Grant features explicitly.' :'Pre-filled with role defaults. Check to grant, uncheck to restrict.'}</div>
      <div className="ea-count">{FEATURE_HINTS.finance_approve}</div>
    </>
  );
}
