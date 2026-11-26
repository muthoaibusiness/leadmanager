// Every page of the app beyond the tab bar, in menu order.
//
//   feature  the access key checked with canSee(user, feature), the same keys
//            the web sidebar uses (NAV_SCOPES in supabase/functions/_shared/access-rules.js).
//            A saved allowedFeatures list on the account overrides role defaults.
//   route    the stack route name; `screen` is its component.
//   group    the heading it sits under in the menu.
//
// A web page that has no entry here is not built for the phone yet: the menu
// only lists what exists.
import PipelineScreen from '../screens/PipelineScreen';
import CalendarScreen from '../screens/CalendarScreen';
import ProjectsScreen from '../screens/projects/ProjectsScreen';
import ProjectDetailScreen from '../screens/projects/ProjectDetailScreen';
import TeamScreen from '../screens/people/TeamScreen';
import PerformanceScreen from '../screens/people/PerformanceScreen';
import AgentDetailScreen from '../screens/people/AgentDetailScreen';
import ReportsScreen from '../screens/people/ReportsScreen';
import AccountsScreen from '../screens/admin/AccountsScreen';
import AccountFormScreen from '../screens/admin/AccountFormScreen';
import RequestsScreen from '../screens/admin/RequestsScreen';
import CompaniesScreen from '../screens/admin/CompaniesScreen';
import ConversationsScreen from '../screens/chat/ConversationsScreen';
import ChatScreen from '../screens/chat/ChatScreen';
import ForwardLeadScreen from '../screens/lead/ForwardLeadScreen';
import TransferLeadScreen from '../screens/lead/TransferLeadScreen';

// Shown in the menu (Menu tab).
export const MODULES = [
  { feature: 'pipeline', route: 'Pipeline', title: 'Pipeline', icon: 'view-kanban', group: 'Sales', screen: PipelineScreen },
  { feature: 'calendar', route: 'Calendar', title: 'Calendar', icon: 'calendar-month', group: 'Sales', screen: CalendarScreen },
  { feature: 'conversations', route: 'Conversations', title: 'Conversations', icon: 'forum', group: 'Sales', screen: ConversationsScreen, chat: true },
  { feature: 'properties', route: 'Projects', title: 'Projects', icon: 'apartment', group: 'Sales', screen: ProjectsScreen },
  { feature: 'team', route: 'Team', title: 'Team', icon: 'groups', group: 'People', screen: TeamScreen },
  { feature: 'agentperf', route: 'Performance', title: 'Performance', icon: 'leaderboard', group: 'People', screen: PerformanceScreen },
  { feature: 'reports', route: 'Reports', title: 'Reports', icon: 'bar-chart', group: 'People', screen: ReportsScreen },
  { feature: 'requests', route: 'Requests', title: 'Hold requests', icon: 'pan-tool', group: 'Admin', screen: RequestsScreen },
  { feature: 'accounts', route: 'Accounts', title: 'Users & accounts', icon: 'manage-accounts', group: 'Admin', screen: AccountsScreen },
  { feature: 'companies', route: 'Companies', title: 'Companies', icon: 'corporate-fare', group: 'Admin', screen: CompaniesScreen },
];

// Reached from another screen, never from the menu.
export const DETAIL_ROUTES = [
  { route: 'ProjectDetail', title: 'Project', screen: ProjectDetailScreen },
  { route: 'AgentDetail', title: 'Agent', screen: AgentDetailScreen },
  { route: 'AccountForm', title: 'Account', screen: AccountFormScreen },
  { route: 'Chat', title: 'Chat', screen: ChatScreen },
  { route: 'ForwardLead', title: 'Forward lead', screen: ForwardLeadScreen },
  { route: 'TransferLead', title: 'Transfer lead', screen: TransferLeadScreen },
];
