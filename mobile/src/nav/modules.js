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
import BookingScreen from '../screens/booking/BookingScreen';
import BookingProjectScreen from '../screens/booking/BookingProjectScreen';

import { NAV_META } from '../../../src/lib/navMeta.js';

// Every page with a stack route, in the web sidebar's order (SECTIONS in
// src/components/Sidebar.jsx). `group` is the sidebar section label; null is
// its unlabelled top section. Titles and icons come from NAV_META, the labels
// the web sidebar uses, so both name a page the same way.
// The Menu tab leaves out pages in HIDDEN_NAV (src/lib/navMeta.js), as the web
// sidebar does; their routes stay registered so links and buttons still open them.
const page = (feature, route, group, screen, extra) => ({
  feature, route, group, screen, title: NAV_META[feature].lbl, icon: NAV_META[feature].ico, ...extra,
});

export const MODULES = [
  page('companies', 'Companies', null, CompaniesScreen),
  page('reports', 'Reports', null, ReportsScreen),
  page('agentperf', 'Performance', null, PerformanceScreen),
  page('requests', 'Requests', null, RequestsScreen),
  page('conversations', 'Conversations', 'Sales Team', ConversationsScreen, { chat: true }),
  page('calendar', 'Calendar', 'Sales Team', CalendarScreen),
  page('properties', 'Projects', 'Sales Team', ProjectsScreen),
  page('booking', 'Booking', 'Sales Team', BookingScreen),
  page('pipeline', 'Pipeline', 'Sales Team', PipelineScreen),
  page('team', 'Team', 'Admin', TeamScreen),
  page('accounts', 'Accounts', 'Admin', AccountsScreen),
];

// Reached from another screen, never from the menu.
export const DETAIL_ROUTES = [
  { route: 'ProjectDetail', title: 'Project', screen: ProjectDetailScreen },
  { route: 'BookingProject', title: 'Booking', screen: BookingProjectScreen },
  { route: 'AgentDetail', title: 'Agent', screen: AgentDetailScreen },
  { route: 'AccountForm', title: 'Account', screen: AccountFormScreen },
  { route: 'Chat', title: 'Chat', screen: ChatScreen },
  { route: 'ForwardLead', title: 'Forward lead', screen: ForwardLeadScreen },
  { route: 'TransferLead', title: 'Transfer lead', screen: TransferLeadScreen },
];
