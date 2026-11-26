import Mi from '../Mi.jsx';
import useNavState from '../../hooks/useNavState.js';
import { useApp } from '../../context/AppContext.jsx';
import { canSee } from '../../lib/constants.js';
import AnalyticsPerf from './AnalyticsPerf.jsx';
import ProjectLeaderboard from './ProjectLeaderboard.jsx';
import FbLeadsView from './FbLeadsView.jsx';
import MetaCapiView from './MetaCapiView.jsx';
import '../booking/ShopBooking.css';
import './Analytics.css';

// Analytics: how the sales team is doing (agents, project leaderboard) and where leads come from
// (Facebook Leads and Meta CAPI, which used to be two pages of their own). One page, three tabs, in
// the Booking page's look.

const TABS = [
  ['perf', 'Performance', 'leaderboard'],
  ['board', 'Leaderboard', 'emoji_events'],
  ['social', 'Facebook & Meta', 'campaign'],
];

export default function AnalyticsView() {
  const { user } = useApp();
  const [tab, setTab] = useNavState('analytics.tab', 'perf');
  const [sub, setSub] = useNavState('analytics.sub', 'fb');
  // Facebook Leads and Meta CAPI are management tools; the agent scorecards are open to whoever opened the page.
  const social = canSee(user, 'fbleads') || canSee(user, 'metacapi');
  const tabs = TABS.filter(([k]) => k !== 'social' || social);
  const cur = tabs.some(([k]) => k === tab) ? tab : 'perf';

  return (
    <div className="bk anx">
      <div className="rqx-wrap anx-wrap">
        <div className="rqx-tabs" role="tablist" aria-label="Analytics">
          {tabs.map(([k, l, ic]) => (
            <button key={k} type="button" role="tab" className="bk-chip" aria-selected={cur === k} aria-pressed={cur === k} onClick={() => setTab(k)}><Mi>{ic}</Mi>{l}</button>
          ))}
        </div>

        {cur === 'perf' && <AnalyticsPerf />}
        {cur === 'board' && <ProjectLeaderboard />}
        {cur === 'social' && (
          <>
            <div className="rqx-chips anx-sub" role="group" aria-label="Facebook and Meta">
              {canSee(user, 'fbleads') && <button type="button" className="bk-chip" aria-pressed={sub === 'fb'} onClick={() => setSub('fb')}><Mi>dynamic_form</Mi>Facebook Leads</button>}
              {canSee(user, 'metacapi') && <button type="button" className="bk-chip" aria-pressed={sub === 'capi'} onClick={() => setSub('capi')}><Mi>campaign</Mi>Meta CAPI</button>}
            </div>
            {(sub === 'capi' && canSee(user, 'metacapi')) ? <MetaCapiView /> : <FbLeadsView />}
          </>
        )}
      </div>
    </div>
  );
}
