import { useState, useRef } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { getDB, mutate, getTarget } from '../../lib/db.js';
import { avc, ini, fmtBDT, rlabel, startOfMonth, curMonth } from '../../lib/helpers.js';
import { ROLES } from '../../lib/constants.js';
import Mi from '../Mi.jsx';

function readAsDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

function KpiBox({ ico, val, label, color, sub }) {
  return (
    <div className="pf-kpi">
      <div className="pf-kpi-ico" style={{ background: color + '15', color }}><Mi>{ico}</Mi></div>
      <div className="pf-kpi-body">
        <div className="pf-kpi-val">{val}</div>
        <div className="pf-kpi-lbl">{label}</div>
        {sub && <div className="pf-kpi-sub">{sub}</div>}
      </div>
    </div>
  );
}

export default function ProfileView() {
  const { user, setUser, refreshDB, showToast } = useApp();
  const fileRef = useRef(null);

  const db = getDB();
  const fresh = db.users.find(u => u.id === user.id) || user;

  const [name, setName] = useState(fresh.name || '');
  const [email, setEmail] = useState(fresh.email || '');
  const [phone, setPhone] = useState(fresh.phone || '');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [avatar, setAvatar] = useState(fresh.avatar || '');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  const team = db.teams?.find(t => t.id === fresh.teamId);

  // ─── KPI calculations ──────────────────────────────────────────
  const sm = startOfMonth();
  const myLeads = db.leads.filter(l => l.assignedTo === fresh.id || l.previousAssignees?.includes(fresh.id));
  const allActs = Object.values(db.activities || {}).flat();
  const myActs = allActs.filter(a => a.userId === fresh.id);
  const monthActs = myActs.filter(a => new Date(a.timestamp) >= sm);

  const calls = monthActs.filter(a => a.type === 'CALL').length;
  const talkSecs = monthActs.filter(a => a.type === 'CALL').reduce((s, a) => s + (a.durationSeconds || 0), 0);
  const talkMins = Math.round(talkSecs / 60);
  const meetingsSet = db.leads.filter(l => l.meetingSetBy === fresh.id && l.meetingSetDate && new Date(l.meetingSetDate) >= sm).length;
  const visitsDone = db.leads.filter(l => l.siteVisitDoneBy === fresh.id && l.siteVisitDoneDate && new Date(l.siteVisitDoneDate) >= sm).length;
  const won = myLeads.filter(l => l.status === 'DEAL_CLOSED_WON' && l.updatedAt && new Date(l.updatedAt) >= sm);
  const lost = myLeads.filter(l => l.status === 'DEAL_CLOSED_LOST' && l.updatedAt && new Date(l.updatedAt) >= sm);
  const rev = won.reduce((s, l) => s + (l.dealValue || 0), 0);
  const wr = won.length + lost.length > 0 ? Math.round((won.length / (won.length + lost.length)) * 100) : 0;
  const active = myLeads.filter(l => !['DEAL_CLOSED_WON', 'DEAL_CLOSED_LOST', 'NOT_INTERESTED'].includes(l.status)).length;

  // For TL: team-wide stats
  const teamUsers = db.users.filter(u => u.teamId === fresh.teamId && u.id !== fresh.id);
  const teamLeads = db.leads.filter(l => l.teamId === fresh.teamId);
  const teamWon = teamLeads.filter(l => l.status === 'DEAL_CLOSED_WON' && l.updatedAt && new Date(l.updatedAt) >= sm);
  const teamRev = teamWon.reduce((s, l) => s + (l.dealValue || 0), 0);

  // Target
  const tgt = db.targets?.find(t => t.userId === fresh.id && t.month === curMonth());

  let kpis = [];
  if (fresh.role === ROLES.IA) {
    kpis = [
      { ico: 'call', val: calls, label: 'Calls This Month', color: '#2DD4BF' },
      { ico: 'schedule', val: talkMins + ' min', label: 'Talk Time', color: '#DDB948' },
      { ico: 'check_circle', val: meetingsSet, label: 'Meetings Set', color: '#34D399', sub: tgt ? `Target: ${tgt.value}` : '' },
      { ico: 'person', val: active, label: 'Active Customers', color: '#FFFFFF' },
    ];
  } else if (fresh.role === ROLES.MA) {
    kpis = [
      { ico: 'location_on', val: visitsDone, label: 'Site Visits Done', color: '#34D399', sub: tgt ? `Target: ${tgt.value}` : '' },
      { ico: 'handshake', val: won.length, label: 'Deals Won', color: '#F0A92B' },
      { ico: 'payments', val: fmtBDT(rev), label: 'Revenue', color: '#34D399' },
      { ico: 'percent', val: wr + '%', label: 'Win Rate', color: '#DDB948' },
    ];
  } else if (fresh.role === ROLES.TL) {
    kpis = [
      { ico: 'groups', val: teamUsers.length, label: 'Team Members', color: '#FFFFFF' },
      { ico: 'group', val: teamLeads.length, label: 'Team Leads', color: '#2DD4BF' },
      { ico: 'payments', val: fmtBDT(teamRev), label: 'Team Revenue', color: '#34D399' },
      { ico: 'emoji_events', val: teamWon.length, label: 'Team Deals Won', color: '#F0A92B' },
    ];
  } else {
    const allLeads = db.leads;
    const allWon = allLeads.filter(l => l.status === 'DEAL_CLOSED_WON' && l.updatedAt && new Date(l.updatedAt) >= sm);
    const allRev = allWon.reduce((s, l) => s + (l.dealValue || 0), 0);
    kpis = [
      { ico: 'group', val: db.users.length, label: 'Total Users', color: '#FFFFFF' },
      { ico: 'groups', val: db.teams?.length || 0, label: 'Teams', color: '#2DD4BF' },
      { ico: 'payments', val: fmtBDT(allRev), label: 'Monthly Revenue', color: '#34D399' },
      { ico: 'emoji_events', val: allWon.length, label: 'Deals Won', color: '#F0A92B' },
    ];
  }

  const markDirty = (fn) => (e) => { fn(e.target.value); setDirty(true); };

  const onPick = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { showToast('Image too big (max 2MB)', 'err'); return; }
    const url = await readAsDataURL(f);
    setAvatar(url);
    setDirty(true);
  };

  const removeAvatar = () => { setAvatar(''); setDirty(true); };

  const save = () => {
    if (!name.trim() || !email.trim()) { showToast('Name and email required', 'err'); return; }
    if (pw && pw !== pw2) { showToast('Passwords do not match', 'err'); return; }
    setBusy(true);
    mutate(d => {
      const u = d.users.find(x => x.id === fresh.id);
      if (!u) return;
      u.name = name.trim();
      u.email = email.trim();
      u.phone = phone.trim();
      u.avatar = avatar;
      if (pw) u.password = pw;
    });
    setUser({ ...fresh, name: name.trim(), email: email.trim(), phone: phone.trim(), avatar, ...(pw ? { password: pw } : {}) });
    refreshDB();
    setBusy(false);
    setDirty(false);
    setPw(''); setPw2('');
    showToast('Profile saved', 'ok');
  };

  return (
    <div className="pf-wrap">
      <div className="pf-hero">
        <div className="pf-av-col">
          {avatar
            ? <img src={avatar} alt={name} className="pf-av-img" />
            : <div className="pf-av-fb" style={{ background: avc(name) }}>{ini(name)}</div>}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPick} />
          <div className="pf-av-acts">
            <button className="btn btn-p btn-sm" onClick={() => fileRef.current?.click()}>
              <Mi>upload</Mi>{avatar ? 'Change' : 'Upload'}
            </button>
            {avatar && <button className="btn btn-g btn-sm" onClick={removeAvatar}><Mi>delete</Mi></button>}
          </div>
        </div>
        <div className="pf-hero-info">
          <div className="pf-name">{name}</div>
          <div className="pf-meta">
            <span className="pf-pill"><Mi>badge</Mi>{rlabel(fresh.role)}</span>
            {team && <span className="pf-pill"><Mi>groups</Mi>{team.name}</span>}
            <span className="pf-pill"><Mi>mail</Mi>{email}</span>
            {phone && <span className="pf-pill"><Mi>call</Mi>{phone}</span>}
          </div>
        </div>
      </div>

      <div className="sec-hd"><div className="sec-t"><Mi>insights</Mi>This Month</div></div>
      <div className="pf-kpi-grid">
        {kpis.map((k, i) => <KpiBox key={i} {...k} />)}
      </div>

      <div className="sec-hd"><div className="sec-t"><Mi>edit</Mi>Edit Information</div></div>
      <div className="pf-form">
        <div className="pf-row">
          <div className="fl">
            <label>Full Name</label>
            <input className="finp" value={name} onChange={markDirty(setName)} />
          </div>
          <div className="fl">
            <label>Phone</label>
            <input className="finp" value={phone} onChange={markDirty(setPhone)} placeholder="+880…" />
          </div>
        </div>
        <div className="pf-row">
          <div className="fl">
            <label>Email</label>
            <input className="finp" type="email" value={email} onChange={markDirty(setEmail)} />
          </div>
          <div className="fl">
            <label>Role</label>
            <input className="finp" value={rlabel(fresh.role)} disabled />
          </div>
        </div>
        <div className="pf-row">
          <div className="fl">
            <label>New Password <span className="pf-hint">(leave empty to keep current)</span></label>
            <input className="finp" type="password" value={pw} onChange={markDirty(setPw)} placeholder="••••••••" />
          </div>
          <div className="fl">
            <label>Confirm New Password</label>
            <input className="finp" type="password" value={pw2} onChange={markDirty(setPw2)} placeholder="••••••••" />
          </div>
        </div>
        <div className="pf-actions">
          <button className="btn btn-p" disabled={!dirty || busy} onClick={save}>
            <Mi>save</Mi>{busy ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
