import { useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import {
  getCampaigns, getCampaign, getAds, getLeads, campaignStats, campaignLeads,
  adLeads, deleteCampaign, deleteAd, attributeLead,
} from '../../lib/db.js';
import { fmtBDT, fmtD } from '../../lib/helpers.js';
import { CAMPAIGN_STATUS } from '../../lib/constants.js';
import Mi from '../Mi.jsx';

const stClass = s => ({ DRAFT: 'bs-hold', ACTIVE: 'bs-active', PAUSED: 'bs-hold', COMPLETED: 'bs-done' }[s] || '');

// Cost per lead only means something once a lead has actually landed.
const fmtCPL = (cpl) => (cpl == null ? '—' : fmtBDT(Math.round(cpl)));

export default function CampaignsView() {
  const { campSel } = useApp();
  // Drilling into a campaign swaps the whole view over to its ads.
  return campSel ? <CampaignDetail id={campSel} /> : <CampaignList />;
}

// ── Campaign list ────────────────────────────────────────────────────────────
function CampaignList() {
  const { openModal, setCampEdit, setCampSel } = useApp();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('ALL');

  let camps = getCampaigns();
  if (status !== 'ALL') camps = camps.filter(c => (c.status || 'ACTIVE') === status);
  if (q) {
    const s = q.toLowerCase();
    camps = camps.filter(c => (c.name + ' ' + (c.platform || '')).toLowerCase().includes(s));
  }

  const rows = camps.map(c => ({ c, st: campaignStats(c.id) }));
  const totalCost = rows.reduce((s, r) => s + r.st.cost, 0);
  const totalLeads = rows.reduce((s, r) => s + r.st.leads, 0);
  const blendedCPL = totalLeads ? totalCost / totalLeads : null;
  const activeCt = rows.filter(r => (r.c.status || 'ACTIVE') === 'ACTIVE').length;

  return (
    <>
      <div className="grid-4" style={{ marginBottom: '18px' }}>
        <div className="mc"><div className="mc-top"><div className="mc-ico" style={{ background: '#F0A92B' }}><Mi>payments</Mi></div></div><div className="mc-v">{fmtBDT(totalCost)}</div><div className="mc-l">Total Spend</div></div>
        <div className="mc"><div className="mc-top"><div className="mc-ico" style={{ background: '#2DD4BF' }}><Mi>person_add</Mi></div></div><div className="mc-v">{totalLeads}</div><div className="mc-l">Leads Generated</div></div>
        <div className="mc"><div className="mc-top"><div className="mc-ico" style={{ background: '#34D399' }}><Mi>sell</Mi></div></div><div className="mc-v">{fmtCPL(blendedCPL)}</div><div className="mc-l">Blended Cost / Lead</div></div>
        <div className="mc"><div className="mc-top"><div className="mc-ico" style={{ background: '#FFFFFF' }}><Mi>campaign</Mi></div></div><div className="mc-v">{activeCt}</div><div className="mc-l">Active Campaigns</div></div>
      </div>

      <div className="prop-toolbar">
        <div className="pt-search">
          <Mi>search</Mi>
          <input placeholder="Search campaign or platform..." value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <select className="fsel" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="ALL">All status</option>
          {Object.entries(CAMPAIGN_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <span className="fcount">{camps.length} campaign{camps.length === 1 ? '' : 's'}</span>
      </div>

      {!rows.length ? (
        <div className="empty"><Mi>campaign</Mi><p>No campaigns yet. Use <strong>Add Campaign</strong> to track your first ad spend.</p></div>
      ) : (
        <div className="lt">
          <div className="lt-hdr cm-row"><div>Campaign</div><div>Platform</div><div>Cost</div><div>Status</div><div>Leads</div><div>Cost / Lead</div><div /></div>
          {rows.map(({ c, st }) => (
            <div key={c.id} className="lt-row cm-row" onClick={() => setCampSel(c.id)}>
              <div className="lt-cell">
                <div style={{ minWidth: 0 }}>
                  <div className="lt-n">{c.name || 'Untitled campaign'}</div>
                  <div className="lt-sub">{getAds(c.id).length} ad{getAds(c.id).length === 1 ? '' : 's'}{c.startDate ? ' · from ' + fmtD(c.startDate) : ''}</div>
                </div>
              </div>
              <div className="lt-cell"><span className="lt-sub">{c.platform || '—'}</span></div>
              <div className="lt-cell"><span className="bk-amt">{fmtBDT(c.cost)}</span></div>
              <div className="lt-cell"><span className={`bdg ${stClass(c.status)}`}>{CAMPAIGN_STATUS[c.status] || c.status}</span></div>
              <div className="lt-cell"><span className="bk-amt" style={{ color: st.leads ? 'var(--green)' : 'var(--t3)' }}>{st.leads}</span></div>
              <div className="lt-cell"><span className="bk-amt">{fmtCPL(st.cpl)}</span></div>
              <div className="lt-cell cm-acts">
                <button
                  className="cm-ico-btn" title="Edit campaign"
                  onClick={e => { e.stopPropagation(); setCampEdit(c); openModal('campaign'); }}
                ><Mi>edit</Mi></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ── One campaign: its ads + the leads attributed to them ─────────────────────
function CampaignDetail({ id }) {
  const { user, openModal, setCampSel, setCampEdit, setAdEdit, setPanLead, refreshDB, showToast } = useApp();
  const c = getCampaign(id);

  // The campaign can vanish under us (deleted here, or by another device via
  // realtime) — fall back to the list rather than rendering a broken detail.
  if (!c) {
    return (
      <div className="empty">
        <Mi>campaign</Mi>
        <p>This campaign no longer exists.</p>
        <button className="btn btn-g" onClick={() => setCampSel(null)}><Mi>arrow_back</Mi>All Campaigns</button>
      </div>
    );
  }

  const ads = getAds(id);
  const st = campaignStats(id);
  const attributed = campaignLeads(id);

  const removeCampaign = () => {
    if (!confirm(`Delete "${c.name}"?\n\nIts ${ads.length} ad(s) will be deleted and ${attributed.length} lead(s) will lose their campaign attribution. The leads themselves are kept.`)) return;
    deleteCampaign(id);
    setCampSel(null); refreshDB();
    showToast('Campaign deleted', 'ok');
  };

  const removeAd = (ad) => {
    const n = adLeads(ad.id).length;
    if (!confirm(`Delete ad "${ad.title || ad.adId}"?` + (n ? `\n\n${n} lead(s) will keep the campaign but lose the ad link.` : ''))) return;
    deleteAd(ad.id);
    refreshDB();
    showToast('Ad deleted', 'ok');
  };

  return (
    <>
      <div className="cm-detail-hd">
        <button className="hero-back" onClick={() => setCampSel(null)}><Mi>arrow_back</Mi>All Campaigns</button>
        <div className="cm-detail-acts">
          <button className="btn btn-g" onClick={() => { setCampEdit(c); openModal('campaign'); }}><Mi>edit</Mi>Edit</button>
          <button className="btn btn-g cm-danger" onClick={removeCampaign}><Mi>delete</Mi>Delete</button>
          <button className="btn btn-p" onClick={() => { setAdEdit({ campaignId: id }); openModal('ad'); }}><Mi>add</Mi>Add Ad</button>
        </div>
      </div>

      <div className="cm-title-row">
        <h2 className="cm-title">{c.name || 'Untitled campaign'}</h2>
        <span className={`bdg ${stClass(c.status)}`}>{CAMPAIGN_STATUS[c.status] || c.status}</span>
        {c.platform && <span className="lt-sub">{c.platform}</span>}
        {(c.startDate || c.endDate) && (
          <span className="lt-sub">{[c.startDate && fmtD(c.startDate), c.endDate && fmtD(c.endDate)].filter(Boolean).join(' → ')}</span>
        )}
      </div>

      <div className="grid-4" style={{ marginBottom: '18px' }}>
        <div className="mc"><div className="mc-top"><div className="mc-ico" style={{ background: '#F0A92B' }}><Mi>payments</Mi></div></div><div className="mc-v">{fmtBDT(st.cost)}</div><div className="mc-l">Campaign Cost</div></div>
        <div className="mc"><div className="mc-top"><div className="mc-ico" style={{ background: '#2DD4BF' }}><Mi>person_add</Mi></div></div><div className="mc-v">{st.leads}</div><div className="mc-l">Leads Generated</div></div>
        <div className="mc"><div className="mc-top"><div className="mc-ico" style={{ background: '#34D399' }}><Mi>sell</Mi></div></div><div className="mc-v">{fmtCPL(st.cpl)}</div><div className="mc-l">Cost / Lead</div></div>
        <div className="mc"><div className="mc-top"><div className="mc-ico" style={{ background: '#FFFFFF' }}><Mi>emoji_events</Mi></div></div><div className="mc-v">{st.won}</div><div className="mc-l">Deals Won · {fmtBDT(st.revenue)}</div></div>
      </div>

      <div className="cm-sec-lbl">Ads</div>
      {!ads.length ? (
        <div className="empty"><Mi>ads_click</Mi><p>No ads on this campaign yet. Use <strong>Add Ad</strong> to create one.</p></div>
      ) : (
        <div className="lt" style={{ marginBottom: '22px' }}>
          <div className="lt-hdr ad-row"><div>Ad</div><div>Source App</div><div>Ad ID</div><div>Leads</div><div /></div>
          {ads.map(ad => (
            <div key={ad.id} className="lt-row ad-row" onClick={() => { setAdEdit(ad); openModal('ad'); }}>
              <div className="lt-cell">
                <div style={{ minWidth: 0 }}>
                  <div className="lt-n">{ad.title || 'Untitled ad'}</div>
                  {ad.body && <div className="lt-sub cm-clip">{ad.body}</div>}
                </div>
              </div>
              <div className="lt-cell"><span className="lt-sub">{ad.sourceApp || '—'}</span></div>
              <div className="lt-cell"><span className="lt-sub cm-clip">{ad.adId || '—'}</span></div>
              <div className="lt-cell"><span className="bk-amt" style={{ color: adLeads(ad.id).length ? 'var(--green)' : 'var(--t3)' }}>{adLeads(ad.id).length}</span></div>
              <div className="lt-cell cm-acts">
                <button className="cm-ico-btn cm-danger" title="Delete ad" onClick={e => { e.stopPropagation(); removeAd(ad); }}><Mi>delete</Mi></button>
              </div>
            </div>
          ))}
        </div>
      )}

      <AttachLead campaignId={id} ads={ads} />

      <div className="cm-sec-lbl">Attributed Leads · {attributed.length}</div>
      {!attributed.length ? (
        <div className="empty"><Mi>person_search</Mi><p>No leads attributed to this campaign yet.</p></div>
      ) : (
        <div className="lt">
          <div className="lt-hdr al-row"><div>Lead</div><div>Ad</div><div>Source</div><div /></div>
          {attributed.map(l => {
            const ad = ads.find(a => a.id === l.adId);
            return (
              <div key={l.id} className="lt-row al-row" onClick={() => setPanLead(l.id)}>
                <div className="lt-cell">
                  <div style={{ minWidth: 0 }}>
                    <div className="lt-n">{l.name}</div>
                    <div className="lt-sub">{l.phone}</div>
                  </div>
                </div>
                <div className="lt-cell">
                  {/* Re-attributing a lead to a different ad in this campaign. */}
                  <select
                    className="fsel cm-sel"
                    value={l.adId || ''}
                    onClick={e => e.stopPropagation()}
                    onChange={e => {
                      attributeLead(l.id, e.target.value || null, user);
                      refreshDB();
                      showToast('Lead attribution updated', 'ok');
                    }}
                  >
                    <option value="">— campaign only —</option>
                    {ads.map(a => <option key={a.id} value={a.id}>{a.title || a.adId || 'Untitled ad'}</option>)}
                  </select>
                </div>
                <div className="lt-cell"><span className="lt-sub">{ad ? (ad.sourceApp || '—') : '—'}</span></div>
                <div className="lt-cell cm-acts">
                  <button
                    className="cm-ico-btn cm-danger" title="Remove from campaign"
                    onClick={e => {
                      e.stopPropagation();
                      attributeLead(l.id, null, user);
                      refreshDB();
                      showToast('Lead removed from campaign', 'ok');
                    }}
                  ><Mi>link_off</Mi></button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ── Attach an existing lead to one of this campaign's ads ────────────────────
function AttachLead({ campaignId, ads }) {
  const { user, refreshDB, showToast } = useApp();
  const [q, setQ] = useState('');
  const [adId, setAdId] = useState('');

  if (!ads.length) return null;

  const s = q.trim().toLowerCase();
  // Only search once there's a query — the full lead list would be useless noise.
  // Leads already on this campaign are excluded; the list above manages those.
  const matches = s
    ? getLeads(user)
        .filter(l => l.campaignId !== campaignId)
        .filter(l => (l.name + ' ' + (l.phone || '') + ' ' + (l.email || '')).toLowerCase().includes(s))
        .slice(0, 6)
    : [];

  const attach = (lead) => {
    const target = adId || ads[0].id;
    attributeLead(lead.id, target, user);
    setQ('');
    refreshDB();
    showToast(`${lead.name} attributed to this campaign`, 'ok');
  };

  return (
    <div className="cm-attach">
      <div className="cm-sec-lbl">Attribute an existing lead</div>
      <div className="prop-toolbar" style={{ marginBottom: matches.length ? '8px' : 0 }}>
        <div className="pt-search">
          <Mi>search</Mi>
          <input placeholder="Search a lead by name, phone or email..." value={q} onChange={e => setQ(e.target.value)} />
        </div>
        {/* Falls back to the first ad so the box never renders blank before a pick. */}
        <select className="fsel" value={adId || ads[0].id} onChange={e => setAdId(e.target.value)}>
          {ads.map(a => <option key={a.id} value={a.id}>{a.title || a.adId || 'Untitled ad'}</option>)}
        </select>
      </div>
      {s && !matches.length && <div className="cm-attach-empty">No unattributed lead matches “{q}”.</div>}
      {matches.map(l => (
        <div key={l.id} className="cm-attach-row">
          <div style={{ minWidth: 0 }}>
            <div className="lt-n">{l.name}</div>
            <div className="lt-sub">{l.phone}{l.assignedToName ? ' · ' + l.assignedToName : ''}{l.campaignId ? ' · already on another campaign' : ''}</div>
          </div>
          <button className="btn btn-p" onClick={() => attach(l)}><Mi>link</Mi>Attach</button>
        </div>
      ))}
    </div>
  );
}
