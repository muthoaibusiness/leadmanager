import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { sbGetAll, isUnscoped } from '../lib/supabase.js';
import { CAMPAIGN_PROJECT } from '../lib/campaignStats.js';

// The Campaign dashboard's rows: every lead and every WhatsApp inquiry whose
// project is the running campaign. The set is small (one project), so both come
// down whole and the dashboard does its counting in the browser — nothing here
// goes through the shared lead cache, which holds what has been looked at, not
// the campaign. Refreshes itself while the tab is on screen.
const EVERY_MS = 60_000;

export default function useCampaignData() {
  const { user } = useApp();
  const [state, setState] = useState({ leads: [], preleads: [], loading: true, error: '', at: null });
  const alive = useRef(true);

  const load = useCallback(async () => {
    const like = `property_interest=ilike.${encodeURIComponent(`*${CAMPAIGN_PROJECT}*`)}`;
    const co = !isUnscoped(user) ? `&or=(company_id.eq.${user.companyId},company_id.is.null)` : '';
    try {
      const [leads, preleads] = await Promise.all([
        sbGetAll(`leads?select=*&${like}&order=created_at.asc${co}`),
        sbGetAll(`preleads?select=id,phone,WA,created_at,flow_stage,takeover,forwarded,property_interest&${like}&order=created_at.asc${co}`),
      ]);
      if (alive.current) setState({ leads, preleads, loading: false, error: '', at: new Date() });
    } catch (e) {
      if (alive.current) setState(s => ({ ...s, loading: false, error: e?.message || 'Could not load the campaign.' }));
    }
  }, [user]);

  useEffect(() => {
    alive.current = true;
    load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, EVERY_MS);
    return () => { alive.current = false; clearInterval(t); };
  }, [load]);

  return { ...state, reload: load };
}
