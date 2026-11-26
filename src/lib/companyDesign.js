import { sbGet, sbRpcCall } from './supabase.js';
import { setDesign, isDesign, setLayout, isLayout } from './theme.js';

// The company's look, shared by every account of the company: its design (colours and shapes,
// companies.ui_design, migration 0073) and its layout (how pages are built, companies.ui_layout,
// migration 0075). Management sets its own company's values through the crm_set_company_design /
// crm_set_company_layout functions; a plain update of companies is Master-only.
//
// Pre-migration fallback: without a column the read simply has no value for it and the saved device
// choice stays; without a function the save reports `shared: false` and the choice applies on this
// device only. A device-only choice is remembered (the *.device keys) so the company's stored value
// does not undo it on the next load; the next save that reaches the server clears that.
// Nothing here touches the cached DB, so mergeDB's rules are not involved.
const DEVICE = { design: 'design.device', layout: 'layout.device' };

// After sign-in / reload: take the company's design and layout where it has them.
export async function syncCompanyDesign(user) {
  const cid = user?.companyId;
  const want = { design: !localStorage.getItem(DEVICE.design), layout: !localStorage.getItem(DEVICE.layout) };
  if (!cid || (!want.design && !want.layout)) return;
  // select=* so a column that is not there yet is absent from the row instead of failing the read
  const rows = await sbGet(`companies?id=eq.${encodeURIComponent(cid)}&select=*`);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return;
  if (want.design && isDesign(row.ui_design)) setDesign(row.ui_design);
  if (want.layout && isLayout(row.ui_layout)) setLayout(row.ui_layout);
}

async function save(user, key, fn, arg) {
  localStorage.setItem(DEVICE[key], '1');
  if (!user?.companyId) return { ok: true, shared: false };
  const r = await sbRpcCall(fn, arg);
  if (r.missing) return { ok: true, shared: false };
  if (r.error) return { ok: true, shared: false, error: 'Kept on this device only: the server refused the change.' };
  localStorage.removeItem(DEVICE[key]);
  return { ok: true, shared: true };
}

// Admin picked a design / a layout: wear it now, then store it for the company.
// → { ok, shared }: shared is false when it could only be kept on this device.
export async function saveCompanyDesign(user, id) {
  if (!isDesign(id)) return { ok: false, shared: false };
  setDesign(id);
  return save(user, 'design', 'crm_set_company_design', { p_design: id });
}
export async function saveCompanyLayout(user, id) {
  if (!isLayout(id)) return { ok: false, shared: false };
  setLayout(id);
  return save(user, 'layout', 'crm_set_company_layout', { p_layout: id });
}
