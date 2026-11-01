import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { sbGetAll, isUnscoped } from '../lib/supabase.js';
import { CAMPAIGN_START } from '../lib/campaignStats.js';

// The Avenue Mela dashboard's rows: Citizen Avenue leads since the ad went live and
// what happened on them (contact attempts, hand-offs, and the invitation markers).
// Reloads itself every minute while the tab is on screen.
const CONTACT = ['CALL', 'WHATSAPP', 'SMS', 'EMAIL', 'STATUS_CHANGE', 'FORWARDED'];
const COLS = 'id,lead_id,type,description,user_id,timestamp';

export default function useMelaData() {
  const { user } = useApp();
  const [state, setState] = useState({ leads: [], acts: [], loading: true, error: '', at: null });
  const alive = useRef(true);

  const load = useCallback(async () => {
    const since = encodeURIComponent(new Date(CAMPAIGN_START).toISOString());
    const co = !isUnscoped(user) ? `&or=(company_id.eq.${user.companyId},company_id.is.null)` : '';
    try {
      const leads = await sbGetAll(`leads?select=*&property_interest=ilike.${encodeURIComponent('*citizen*')}&created_at=gte.${since}&order=created_at.asc${co}`);
      const ids = leads.map((l) => l.id);
      const chunks = [];
      for (let i = 0; i < ids.length; i += 80) chunks.push(ids.slice(i, i + 80));
      const parts = await Promise.all(chunks.map((c) => sbGetAll(`activities?select=${COLS}&lead_id=in.(${c.join(',')})&type=in.(${CONTACT.join(',')})&order=timestamp.asc`)));
      // The invitation markers are NOTE rows with a fixed id prefix.
      const marks = await sbGetAll(`activities?select=${COLS}&id=like.${encodeURIComponent('mela-invite-*')}`);
      const have = new Set(ids);
      if (alive.current) setState({ leads, acts: [...parts.flat(), ...marks.filter((m) => have.has(m.lead_id))], loading: false, error: '', at: new Date() });
    } catch (e) {
      if (alive.current) setState((s) => ({ ...s, loading: false, error: e?.message || 'Could not load the Mela data.' }));
    }
  }, [user]);

  useEffect(() => {
    alive.current = true;
    load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 60_000);
    return () => { alive.current = false; clearInterval(t); };
  }, [load]);

  return { ...state, reload: load };
}
