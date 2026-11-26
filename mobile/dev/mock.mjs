// A stand-in for the Supabase project, for looking at the app in a browser
// without touching real data. Every request the app makes to the project's
// REST, auth and Edge Function endpoints is answered here from a small made-up
// company; nothing reaches the network (the realtime socket is closed too).
//
// Used by the browser-automation runner:
//   node <skill>/browser.mjs http://localhost:8099/ --script mobile/dev/<check>.mjs
// A check starts with:  const mock = await signInAs(page, 'AGENT' | 'TEAM_LEAD' | 'MANAGEMENT');
// and can read mock.writes (every POST/PATCH/DELETE the app sent) to assert on.

const iso = (minsFromNow) => new Date(Date.now() + minsFromNow * 60000).toISOString();
const STATUSES = ['NEW', 'CONTACTED', 'INTERESTED', 'MEETING_SET', 'SITE_VISIT_SCHEDULED', 'SITE_VISIT_DONE', 'NEGOTIATING', 'DEAL_CLOSED_WON', 'DEAL_CLOSED_LOST', 'NOT_INTERESTED'];
const NAMES = ['Rahim Ahmed', 'Karim Uddin', 'Nusrat Jahan', 'Tanvir Hasan', 'Sadia Islam', 'Imran Hossain', 'Farhana Akter', 'Shakil Khan', 'Mitu Rahman', 'Arif Chowdhury', 'Rumana Sultana', 'Jubayer Alam'];
const PROJECTS = ['Lake View Tower', 'Green Park Residence', 'City Centre Mall'];

export function makeData() {
  const company = { id: 'c1', name: 'Demo Realty', plan: 'Pro', is_active: true, created_at: iso(-90000) };
  const team = { id: 't1', name: 'Team Alpha', lead_id: 'u2', company_id: 'c1' };
  const user = (id, name, role, extra = {}) => ({
    id, name, email: `${id}@demo.test`, phone: '01700000000', role, team_id: role === 'MANAGEMENT' ? null : 't1',
    company_id: 'c1', is_active: true, avatar: null, projects: [], allowed_features: null, auth_user_id: 'auth-' + id, ...extra,
  });
  const users = [
    user('u1', 'Ayesha Agent', 'AGENT'),
    user('u2', 'Tariq Lead', 'TEAM_LEAD'),
    user('u3', 'Mina Manager', 'MANAGEMENT'),
    user('u4', 'Babul Agent', 'AGENT'),
  ];
  const leads = [];
  for (let i = 0; i < 46; i++) {
    const status = STATUSES[i % STATUSES.length];
    const owner = i % 3 === 0 ? users[3] : users[0];
    leads.push({
      id: 'L' + String(i + 1).padStart(3, '0'), name: `${NAMES[i % NAMES.length]} ${i + 1}`, phone: '88017' + String(10000000 + i * 7919).slice(0, 8),
      email: i % 4 === 0 ? `lead${i}@mail.test` : '', company: i % 5 === 0 ? 'Acme Trading' : '—', source: ['META_ADS', 'WEBSITE', 'PERSONAL', 'EVENT'][i % 4],
      status, assigned_to: owner.id, assigned_to_name: owner.name, assigned_role: 'AGENT', team_id: 't1', previous_assignees: [],
      property_interest: PROJECTS[i % PROJECTS.length], budget: 0, profession: i % 2 ? 'Business' : 'Service', city: i % 2 ? 'Dhaka' : 'Dubai',
      deal_value: status === 'DEAL_CLOSED_WON' ? 4500000 : 0, call_count: i % 4, sms_count: 0, whatsapp_count: i % 2, visit_count: status.startsWith('SITE') ? 1 : 0,
      no_answer_count: 0, next_followup: i % 6 === 1 ? iso(120) : i % 6 === 2 ? iso(-1500) : i % 6 === 3 ? iso(3000) : null,
      meeting_at: status === 'MEETING_SET' ? iso(600) : null, meeting_type: status === 'MEETING_SET' ? 'ONLINE' : null, meeting_link: status === 'MEETING_SET' ? 'https://meet.example/abc' : '',
      meeting_date: status === 'SITE_VISIT_SCHEDULED' ? iso(2000) : null, meeting_location: status === 'SITE_VISIT_SCHEDULED' ? 'Site office' : '',
      notes: '', company_id: 'c1', created_at: iso(-(i + 1) * 700), updated_at: iso(-(i + 1) * 90), talked: i % 2 === 0,
    });
  }
  const activities = (leadId) => [
    { id: leadId + 'a3', lead_id: leadId, type: 'NOTE', description: 'Wants a south-facing unit, will decide after Eid.', user_id: 'u1', user_name: 'Ayesha Agent', duration_seconds: 0, timestamp: iso(-60), company_id: 'c1' },
    { id: leadId + 'a2', lead_id: leadId, type: 'CALL', description: 'Call logged · 5 min (total: 1)', user_id: 'u1', user_name: 'Ayesha Agent', duration_seconds: 300, timestamp: iso(-600), company_id: 'c1' },
    { id: leadId + 'a1', lead_id: leadId, type: 'CREATED', description: 'Lead created', user_id: 'u1', user_name: 'Ayesha Agent', duration_seconds: 0, timestamp: iso(-3000), company_id: 'c1' },
  ];
  const notifications = (uid) => [
    { id: 'n1', user_id: uid, type: 'ASSIGNED', message: 'New lead assigned: Rahim Ahmed 1 (from Tariq Lead)', lead_id: 'L001', is_read: false, created_at: iso(-12), company_id: 'c1' },
    { id: 'n2', user_id: uid, type: 'FOLLOW_UP', message: 'Follow-up in 15 min: Karim Uddin 2 · Phone call', lead_id: 'L002', is_read: false, created_at: iso(-45), company_id: 'c1' },
    { id: 'n3', user_id: uid, type: 'DEAL_WON', message: 'Deal won: Shakil Khan 8', lead_id: 'L008', is_read: true, created_at: iso(-3000), company_id: 'c1' },
  ];
  const properties = PROJECTS.map((name, i) => ({
    id: 'p' + (i + 1), name, type: i === 2 ? 'Commercial' : 'Apartment', purpose: i === 2 ? 'Commercial' : 'Residential', location: ['Gulshan', 'Bashundhara', 'Motijheel'][i], area: ['Gulshan', 'Bashundhara', 'Motijheel'][i],
    status: 'AVAILABLE', price: 8500000 + i * 1500000, total_units: 24, units: [], company_id: 'c1', created_at: iso(-50000),
  }));
  return { company, team, users, leads, activities, notifications, properties };
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,HEAD,POST,PATCH,PUT,DELETE,OPTIONS',
  'access-control-expose-headers': 'content-range',
};

// The lead predicates the mock understands: an exact status, the id lookup and
// a name/phone search. Everything else in the query is ignored (scope included):
// it is a picture of the screens, not a test of leadQuery.js.
function filterLeads(leads, url) {
  const q = decodeURIComponent(url.search);
  let out = leads;
  const id = /[?&]id=eq\.([^&]+)/.exec(q);
  if (id) return leads.filter((l) => l.id === id[1].replace(/"/g, ''));
  const ids = /[?&(]id[=.]in\.\(([^)]*)\)/.exec(q);
  if (ids) { const set = new Set(ids[1].split(',').map((s) => s.replace(/"/g, ''))); return leads.filter((l) => set.has(l.id)); }
  const st = /status\.eq\.("?)([A-Z_]+)\1/.exec(q) || /[?&]status=eq\.([A-Z_]+)/.exec(q);
  if (st) out = out.filter((l) => l.status === (st[2] || st[1]));
  const like = /name\.ilike\.\*?"?%?\*?([^*%",)]+)/.exec(q);
  if (like) { const s = like[1].toLowerCase(); out = out.filter((l) => l.name.toLowerCase().includes(s) || l.phone.includes(s)); }
  if (/next_followup\.not\.is\.null/.test(q) || /next_followup\.(gte|lt|gt)\./.test(q)) out = out.filter((l) => l.next_followup);
  return out;
}

// `overrides` answers a table yourself: { table: rows | (url, data, me) => rows }.
// Use it for tables the base data leaves empty (hold_requests, wa_conversations, …)
// rather than editing this file.
export async function installMock(page, role = 'AGENT', overrides = {}) {
  const data = makeData();
  const me = data.users.find((u) => u.role === role) || data.users[0];
  const writes = [];
  const json = (route, body, extra = {}) => route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) });

  // The realtime socket is refused inside the page (not with routeWebSocket,
  // which also swallows the dev server's own socket and leaves the page blank).
  await page.addInitScript(() => {
    const Real = window.WebSocket;
    window.WebSocket = function (url, protocols) {
      if (String(url).includes('/realtime/')) {
        const fake = { readyState: 3, send() {}, close() {}, addEventListener() {}, removeEventListener() {} };
        setTimeout(() => { if (fake.onclose) fake.onclose({ code: 1006 }); }, 0);
        return fake;
      }
      return protocols === undefined ? new Real(url) : new Real(url, protocols);
    };
    window.WebSocket.prototype = Real.prototype;
    Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  });

  await page.route(/\.supabase\.co\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });

    if (url.pathname.startsWith('/auth/v1/token')) {
      return json(route, { access_token: 'mock-access', refresh_token: 'mock-refresh', expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: me.auth_user_id } });
    }
    if (url.pathname.startsWith('/auth/v1/')) return json(route, { id: me.auth_user_id });
    if (url.pathname.startsWith('/functions/v1/')) return json(route, { ok: true });
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      return route.fulfill({ status: 404, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ code: 'PGRST202', message: 'mock: no such function' }) });
    }

    const table = url.pathname.replace('/rest/v1/', '').split('/')[0];
    if (method !== 'GET' && method !== 'HEAD') {
      let body = null;
      try { body = req.postDataJSON(); } catch { body = req.postData(); }
      writes.push({ method, table, query: decodeURIComponent(url.search), body });
      const rep = /return=representation/.test(req.headers().prefer || '');
      return json(route, rep ? (Array.isArray(body) ? body : body ? [body] : []) : []);
    }

    let rows = [];
    const q = decodeURIComponent(url.search);
    if (overrides[table]) rows = typeof overrides[table] === 'function' ? overrides[table](url, data, me) : overrides[table];
    else if (table === 'users') rows = /auth_user_id=eq\./.test(q) ? [me] : /[?&]id=eq\./.test(q) ? data.users.filter((u) => q.includes(`id=eq.${u.id}`)) : data.users;
    else if (table === 'companies') rows = [data.company];
    else if (table === 'teams') rows = [data.team];
    else if (table === 'properties') rows = data.properties;
    else if (table === 'notifications') rows = data.notifications(me.id);
    else if (table === 'activities') { const m = /lead_id=eq\.([^&]+)/.exec(q); rows = m ? data.activities(m[1].replace(/"/g, '')) : []; }
    else if (table === 'leads') rows = filterLeads(data.leads, url);
    else rows = []; // targets, bookings, hold_requests, lead_followups, wa_*: empty

    const total = rows.length;
    const limit = Number(url.searchParams.get('limit'));
    const offset = Number(url.searchParams.get('offset')) || 0;
    if (table === 'leads' && limit) rows = rows.slice(offset, offset + limit);
    const range = `${offset}-${Math.max(offset, offset + rows.length - 1)}/${total}`;
    if (method === 'HEAD') return route.fulfill({ status: 200, headers: { ...CORS, 'content-range': range } });
    return json(route, rows, { 'content-range': range });
  });

  return { data, me, writes };
}

// Install the mock, hand the app a stored session for `role`, and reload so it
// boots through its real "session, cold cache" path.
export async function signInAs(page, role = 'AGENT', overrides = {}) {
  const mock = await installMock(page, role, overrides);
  await page.evaluate((s) => {
    localStorage.clear();
    localStorage.setItem('pcrm_auth', JSON.stringify(s));
  }, { access_token: 'mock-access', refresh_token: 'mock-refresh', expires_at: Math.floor(Date.now() / 1000) + 86400, sub: mock.me.auth_user_id, uid: mock.me.id });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText(/Good (morning|afternoon|evening)/).first().waitFor({ timeout: 60000 });
  return mock;
}

// Tap the first visible element with this exact text.
export const tap = async (page, text, opts = {}) => {
  // Screens under the current one stay mounted, so the same words can exist
  // several times: take the one that is actually showing.
  const loc = page.getByText(text, { exact: opts.exact !== false }).locator('visible=true').last();
  await loc.waitFor({ timeout: opts.timeout || 15000 });
  await loc.click();
  await page.waitForTimeout(opts.settle ?? 500);
};
export const shot = (page, name) => page.screenshot({ path: `${process.env.SHOT_DIR || '.'}/${name}.png` });
export const text = (page) => page.evaluate(() => document.body.innerText);
