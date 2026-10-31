import { useApp } from '../../context/AppContext.jsx';
import useNavState from '../../hooks/useNavState.js';
import Mi from '../Mi.jsx';
import Loader from '../ui/loader.jsx';
import { useFinance } from '../../lib/finance.js';
import Overview from '../finance/Overview.jsx';
import Budgets from '../finance/Budgets.jsx';
import Statements from '../finance/Statements.jsx';
import '../finance/finance.css';

// Admin → Inventory: internal budget & expense management. Management only
// (NAV_SCOPES.inventory). Budget approval is turned off, so there is no
// request queue: a budget is usable once created. All data comes from the
// finance Edge Function — see src/lib/finance.js.
export default function InventoryView() {
  const { user, dateRange } = useApp();
  const api = useFinance(user);
  const { fin, error, loading } = api;
  const [tab, setTab] = useNavState('inventory.tab', 'overview');
  const [budgetId, setBudgetId] = useNavState('inventory.budget', null);
  const [invoiceId, setInvoiceId] = useNavState('inventory.statement', null);

  const TABS = [
    ['overview', 'Overview', 'bar_chart'],
    ['budgets', 'Budgets', 'account_balance_wallet'],
    ['statements', 'Statements', 'receipt_long'],
  ];
  // A tab saved before the Requests tab went away opens Overview.
  const shown = TABS.some(([k]) => k === tab) ? tab : 'overview';
  const openBudget = (id) => { setBudgetId(id); setTab('budgets'); };
  const openStatement = (id) => { setInvoiceId(id); setTab('statements'); };

  if (error && !fin) {
    return (
      <div className="empty fin-err">
        <Mi>warning</Mi>
        <p>{error}</p>
        <button className="btn btn-g btn-sm" onClick={api.reload} disabled={loading}><Mi>sync</Mi>Try again</button>
      </div>
    );
  }
  if (!fin) return <Loader className="fin-loader" title="Loading Inventory…" subtitle="Fetching budgets, expenses and statements" />;

  return (
    <div className="fin">
      <div className="fin-bar">
        <div className="fin-tabs" role="tablist" aria-label="Inventory sections">
          {TABS.map(([k, l, ic]) => (
            <button key={k} type="button" role="tab" aria-selected={shown === k} className={shown === k ? 'on' : ''} onClick={() => setTab(k)}>
              <Mi>{ic}</Mi>{l}
            </button>
          ))}
        </div>
        {error && <span className="fin-bar-err"><Mi>warning</Mi>{error}</span>}
        <button type="button" className="fin-refresh" onClick={api.reload} disabled={loading} title="Refresh" aria-label="Refresh"><Mi className={loading ? 'spin' : ''}>sync</Mi></button>
      </div>
      {shown === 'overview' && <Overview fin={fin} range={dateRange?.range || null} />}
      {shown === 'budgets' && <Budgets api={api} user={user} budgetId={budgetId} setBudgetId={setBudgetId} onOpenStatement={openStatement} />}
      {shown === 'statements' && <Statements api={api} user={user} invoiceId={invoiceId} setInvoiceId={setInvoiceId} onOpenBudget={openBudget} />}
    </div>
  );
}
