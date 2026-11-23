import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { loadShopDocs, libOf, brochureLink } from '../lib/shopDocs.js';

// The company's document library and one shop's send log (migration 0071).
// `reload()` re-reads both after an upload or a send.
// The project's own floor plans count as the "Floor plans" document with no upload
// (an uploaded file, when there is one, wins).
export default function useShopDocs(propertyId, unitId, project) {
  const { user } = useApp();
  const cid = libOf(user?.companyId);
  const [st, setSt] = useState({ lib: {}, log: [], loaded: false, missing: false });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let dead = false;
    loadShopDocs(cid, propertyId, unitId).then((r) => { if (!dead) setSt(r); });
    return () => { dead = true; };
  }, [cid, propertyId, unitId, tick]);
  const plans = (project?.floorPlans || []).filter((p) => p.image?.url).map((p) => ({ name: p.name, url: p.image.url, mime: p.image.mime || 'image/jpeg', order: p.order ?? 0 }));
  const lib = !st.lib.floorplans?.url && plans.length
    ? { ...st.lib, floorplans: { ...st.lib.floorplans, key: 'floorplans', approved: true, auto: true, plans: plans.sort((a, b) => b.order - a.order) } }
    : st.lib;
  const link = brochureLink(project);
  const withBrochure = !lib.brochure?.url && link ? { ...lib, brochure: { ...lib.brochure, key: 'brochure', approved: true, auto: true, link } } : lib;
  return { ...st, lib: withBrochure, cid, reload: () => setTick((t) => t + 1) };
}
