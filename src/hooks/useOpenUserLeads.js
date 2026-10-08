import { useApp } from '../context/AppContext.jsx';

// Open one person's customers. Sets the app-wide agent drill-down, which
// LeadsView turns into `assigned_to = <them>` on the server — so this fetches
// that person's first 15 leads, not everybody's. Exported so the team-lead
// header in UsersView opens the same way its members do.
export default function useOpenUserLeads() {
  const { setView, setTab, setSearch, setAgentFilter, setTeamFilter, setStatusFilter } = useApp();
  return (id) => {
    setAgentFilter(id);
    setTeamFilter(null);
    setStatusFilter('ALL');
    setSearch('');
    setTab(0);
    setView('leads');
  };
}
