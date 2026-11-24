import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { loadShopDocs, libOf, brochureLink, PER_PROJECT } from '../lib/shopDocs.js';

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
  // The brochure and the floor plans are per project: take this project's rows, never another's.
  const base = { ...st.lib };
  PER_PROJECT.forEach((k) => { base[k] = st.lib[`${k}@${propertyId}`]; });
  // Sources, best first: a file uploaded in the library; a floor-plan PDF kept on the project
  // (media.docs, labelled "Floor plans"); the project's own plan images.
  const plansDoc = (project?.media?.docs || []).find((d) => /floor\s*plans?/i.test(d.label || d.name || '') && d.url);
  const plans = (project?.floorPlans || []).filter((p) => p.image?.url).map((p) => ({ name: p.name, url: p.image.url, mime: p.image.mime || 'image/jpeg', order: p.order ?? 0 }));
  const lib = base.floorplans?.url ? base
    : plansDoc ? { ...base, floorplans: { ...base.floorplans, key: 'floorplans', approved: true, url: plansDoc.url, mime: 'application/pdf', name: plansDoc.label || plansDoc.name || 'Floor plans' } }
      : plans.length ? { ...base, floorplans: { ...base.floorplans, key: 'floorplans', approved: true, auto: true, plans: plans.sort((x, y) => y.order - x.order) } } : base;
  const link = brochureLink(project);
  const withBrochure = !lib.brochure?.url && link ? { ...lib, brochure: { ...lib.brochure, key: 'brochure', approved: true, auto: true, link } } : lib;
  return { ...st, lib: withBrochure, cid, reload: () => setTick((t) => t + 1) };
}
