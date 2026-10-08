import Mi from './Mi.jsx';
import { useApp } from '../context/AppContext.jsx';

// Customers hero: re-fetch the list from the server. refreshDB bumps dbVersion,
// which LeadsView already refetches on -- the page, its counts and the Last
// Follow-up column. LeadsView publishes leadCounts as null while a page is
// loading, so the icon spins exactly while the list is being fetched.
export default function RefreshButton() {
  const { refreshDB, leadCounts } = useApp();
  const busy = leadCounts == null;
  return (
    <div className="rf-ring">
      <button type="button" className={`rf-btn${busy ? ' busy' : ''}`} onClick={() => refreshDB()}
        title="Refresh customers" aria-busy={busy}>
        <Mi>sync</Mi>Refresh
      </button>
    </div>
  );
}
