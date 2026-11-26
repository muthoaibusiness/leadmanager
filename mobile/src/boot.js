// Loading the signed-in account's data. The same steps, in the same order, as
// hydrateFromCloud in the web app's src/App.jsx, calling the same shared
// functions, so the two apps reconcile cloud and cache by one set of rules
// (see mergeDB in src/lib/db.js before changing anything here).
//
// Left out on purpose: the web's demo/seed project catalog. A phone must never
// invent projects for a company that has none.
import {
  getDB, getSession, saveDBDeferred, mergeDB, reconcileDeletions, purgeDemoSeed, dedupeLeads,
  migrateTenancy, expireHolds, checkFollowUpReminders, clearLocalDB, cacheBelongsTo,
} from '../../src/lib/db.js';
import { sbLoad } from '../../src/lib/supabase.js';
import { migrateProjects } from '../../src/lib/projects.js';
import { hasFollowupTable } from '../../src/lib/followups.js';

export async function hydrateFromCloud(who) {
  const forUser = who || getSession();
  if (!forUser) return false;
  // A cache built for another account is a leak, not a head start.
  if (!cacheBelongsTo(forUser.id)) clearLocalDB();
  const sbData = await sbLoad(forUser);
  const local = getDB();
  let fresh;
  if (sbData && sbData.users && sbData.users.length) {
    fresh = (local && local.users && local.users.length) ? mergeDB(sbData, local) : sbData;
  } else {
    fresh = local; // offline or an empty answer: keep what the phone has
  }
  // sbLoad leaves leads out (lists page through the server), so a cold merge
  // has none: everything downstream iterates these.
  if (!fresh.leads) fresh.leads = local.leads || [];
  if (!fresh.notifications) fresh.notifications = {};
  if (!fresh.properties) fresh.properties = [];
  reconcileDeletions(fresh, sbData && sbData.leads);
  purgeDemoSeed(fresh);
  dedupeLeads(fresh);
  migrateTenancy(fresh, forUser);
  migrateProjects(fresh);
  hasFollowupTable().then((ok) => { if (!ok) checkFollowUpReminders(fresh, forUser); });
  saveDBDeferred(fresh);
  expireHolds();
  return !!(sbData && sbData.users && sbData.users.length);
}
