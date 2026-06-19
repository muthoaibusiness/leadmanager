import { useState, useMemo } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { getDB, getCompanies, companyStats, createCompany, setCompanyActive } from '../../lib/db.js';
import { fmtBDT } from '../../lib/helpers.js';
import { ROLES } from '../../lib/constants.js';
import DashGreeting from './DashGreeting.jsx';

const PLANS = ['Starter', 'Growth', 'Enterprise'];
const blankForm = () => ({ name: '', plan: 'Starter', adminName: '', adminEmail: '', password: '', phone: '' });

// Master-admin overview — data company-wise, not people-wise.
export default function MasterDash() {
  const { user, dbVersion, refreshDB, showToast } = useApp();
  const db = getDB();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [created, setCreated] = useState(null);
  const [err, setErr] = useState('');

  if (user.role !== ROLES.MASTER) return null;

  const companies = getCompanies();
  const rows = useMemo(() => companies.map(c => ({ c, s: companyStats(c.id) })), [dbVersion, companies.length]);

  // global rollup across all tenants
  const totals = useMemo(() => rows.reduce((a, { s }) => ({
    accounts: a.accounts + s.accounts, leads: a.leads + s.leads, won: a.won + s.won, collected: a.collected + s.collected,
  }), { accounts: 0, leads: 0, won: 0, collected: 0 }), [rows]);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  const save = () => {
    if (!form.name.trim()) { setErr('Company name required.'); return; }
    if (!form.adminName.trim() || !form.adminEmail.trim()) { setErr('Admin name and email required.'); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.adminEmail)) { setErr('Valid admin email required.'); return; }
    const res = createCompany(form);
    if (res.error) { setErr(res.error); return; }
    setErr('');
    setCreated({ company: form.name, email: res.adminEmail, pass: res.password });
    setForm(blankForm());
    setAdding(false);
    refreshDB();
    showToast('Company created', 'ok');
  };

  const toggle = (cid, active) => { setCompanyActive(cid, !active); refreshDB(); showToast(active ? 'Company suspended' : 'Company activated', 'ok'); };

  return (
    <div className="ms">
      <DashGreeting user={user} sub={`${companies.length} ${companies.length === 1 ? 'company' : 'companies'} · ${totals.accounts} accounts · ${totals.leads} leads`} />

      {/* global KPIs */}
      <div className="ms-kpis">
        <div className="ms-kpi"><Mi>apartment</Mi><div><div className="ms-kpi-v">{companies.length}</div><div className="ms-kpi-l">Companies</div></div></div>
        <div className="ms-kpi"><Mi>group</Mi><div><div className="ms-kpi-v">{totals.accounts}</div><div className="ms-kpi-l">Total accounts</div></div></div>
        <div className="ms-kpi"><Mi>person_search</Mi><div><div className="ms-kpi-v">{totals.leads}</div><div className="ms-kpi-l">Total leads</div></div></div>
        <div className="ms-kpi"><Mi>payments</Mi><div><div className="ms-kpi-v">{fmtBDT(totals.collected)}</div><div className="ms-kpi-l">Collections</div></div></div>
      </div>

      {/* add company */}
      <div className="ms-bar">
        <div className="ms-bar-t">Companies <span className="acc-count">{companies.length}</span></div>
        <button className="btn btn-p" onClick={() => { setAdding(a => !a); setErr(''); }}>
          <Mi>{adding ? 'close' : 'add_business'}</Mi>{adding ? 'Cancel' : 'Add company'}
        </button>
      </div>

      {created && (
        <div className="ms-created">
          <Mi>check_circle</Mi>
          <div><b>{created.company}</b> created. Admin login: <b>{created.email}</b> · password <b>{created.pass}</b></div>
          <button className="ms-x" onClick={() => setCreated(null)}><Mi>close</Mi></button>
        </div>
      )}

      {adding && (
        <div className="ms-form">
          <div className="ms-form-row">
            <div className="fg"><label>Company name *</label><input className="fi" value={form.name} onChange={set('name')} placeholder="e.g. Navana Realty" /></div>
            <div className="fg"><label>Plan</label><select className="fi" value={form.plan} onChange={set('plan')}>{PLANS.map(p => <option key={p}>{p}</option>)}</select></div>
          </div>
          <div className="ms-form-sub">First admin account (Management) for this company</div>
          <div className="ms-form-row">
            <div className="fg"><label>Admin name *</label><input className="fi" value={form.adminName} onChange={set('adminName')} placeholder="e.g. Sadia Noor" /></div>
            <div className="fg"><label>Admin email *</label><input className="fi" value={form.adminEmail} onChange={set('adminEmail')} placeholder="admin@company.com" /></div>
          </div>
          <div className="ms-form-row">
            <div className="fg"><label>Password</label><input className="fi" value={form.password} onChange={set('password')} placeholder="1234" /></div>
            <div className="fg"><label>Phone</label><input className="fi" value={form.phone} onChange={set('phone')} placeholder="+880…" /></div>
          </div>
          {err && <div className="ms-err">{err}</div>}
          <div className="ms-form-ft"><button className="btn btn-p" onClick={save}><Mi>add_business</Mi>Create company</button></div>
        </div>
      )}

      {/* company cards */}
      <div className="ms-grid">
        {rows.map(({ c, s }) => {
          const admin = db.users.find(u => u.companyId === c.id && u.role === ROLES.MGMT);
          return (
            <div className={`ms-card${c.isActive === false ? ' off' : ''}`} key={c.id}>
              <div className="ms-card-hd">
                <div className="ms-logo">{c.name[0]}</div>
                <div className="ms-card-id">
                  <div className="ms-card-n">{c.name}</div>
                  <div className="ms-card-m">{admin ? admin.email : 'No admin'} · since {(c.createdAt || '').slice(0, 10)}</div>
                </div>
                <span className={`ms-plan ${c.plan?.toLowerCase()}`}>{c.plan || 'Starter'}</span>
              </div>
              <div className="ms-stats">
                <div className="ms-stat"><div className="ms-sv">{s.accounts}</div><div className="ms-sl">Accounts</div></div>
                <div className="ms-stat"><div className="ms-sv">{s.teams}</div><div className="ms-sl">Teams</div></div>
                <div className="ms-stat"><div className="ms-sv">{s.leads}</div><div className="ms-sl">Leads</div></div>
                <div className="ms-stat"><div className="ms-sv">{s.active}</div><div className="ms-sl">Active</div></div>
                <div className="ms-stat"><div className="ms-sv" style={{ color: 'var(--green)' }}>{s.won}</div><div className="ms-sl">Won</div></div>
                <div className="ms-stat"><div className="ms-sv">{s.projects}</div><div className="ms-sl">Projects</div></div>
              </div>
              <div className="ms-card-ft">
                <span className="ms-coll">Collections <b>{fmtBDT(s.collected)}</b></span>
                <button className={`ms-toggle${c.isActive === false ? ' off' : ''}`} onClick={() => toggle(c.id, c.isActive !== false)}>
                  <Mi>{c.isActive === false ? 'play_circle' : 'pause_circle'}</Mi>{c.isActive === false ? 'Activate' : 'Suspend'}
                </button>
              </div>
            </div>
          );
        })}
        {!rows.length && <div className="ui-empty">No companies yet. Add one to get started.</div>}
      </div>
    </div>
  );
}
