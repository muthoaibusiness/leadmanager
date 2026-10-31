import Mi from './Mi.jsx';
import { useApp } from '../context/AppContext.jsx';

// Customers hero: re-fetch the list from the server. refreshDB bumps dbVersion,
// which LeadsView already refetches on -- the page, its counts and the Last
// Follow-up column. LeadsView publishes leadCounts as null while a page is
// loading, so the icon spins exactly while the list is being fetched.
//
// Another page can use the same button by passing its own `onClick` and `busy`
// (Meta CAPI does); `label` names what is refreshed for screen readers.
export default function RefreshButton({ onClick, busy: busyProp, label = 'Refresh customers' }) {
  const { refreshDB, leadCounts } = useApp();
  const busy = busyProp ?? leadCounts == null;
  return (
    <div className="rf-ring">
      <button type="button" className={`rf-btn${busy ? ' busy' : ''}`} onClick={() => (onClick ? onClick() : refreshDB())}
        title={label} aria-label={label} aria-busy={busy}>
        {/* Phones (CSS) hide the word and keep a round icon button. */}
        <Mi aria-hidden="true">sync</Mi><span className="rf-lbl">Refresh</span>
      </button>
    </div>
  );
}
