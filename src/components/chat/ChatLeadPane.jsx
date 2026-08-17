import { useState } from 'react';
import Mi from '../Mi.jsx';
import AdSourceCard from './AdSourceCard.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { addLeadFn, getActs } from '../../lib/db.js';
import { waLinkLead } from '../../lib/wa.js';
import { avc, ini, fmtBDT, fmtAgo, leadDisplayStatus, scoreLead, scoreLabel, srclabel } from '../../lib/helpers.js';

// Right rail: who this conversation actually is in the CRM. Links the thread to
// an existing lead when the phone matches, offers to create one when it doesn't,
// and shows the ad referral that started the chat.
export default function ChatLeadPane({ conv, lead, onLinked }) {
  const { user, setPanLead, showToast } = useApp();
  const [creating, setCreating] = useState(false);

  if (!conv) return null;

  const createLead = async () => {
    setCreating(true);
    try {
      // Ads are the only automatic non-manual source we can attribute here.
      const source = conv.source === 'AD' ? 'WHATSAPP_ADS' : 'PERSONAL';
      const id = addLeadFn(
        conv.name || conv.phone, conv.phone, null, '', null, '—',
        source, conv.adMeta?.title || '', 0, '', '', user
      );
      if (!id) { showToast('Could not create a lead — invalid phone number.', 'err'); return; }
      await waLinkLead(conv.id, id);
      onLinked?.(id);
      showToast('Lead created and linked.', 'ok');
    } finally {
      setCreating(false);
    }
  };

  const score = lead ? scoreLead(lead, getActs(lead.id)) : 0;
  const sl = lead ? scoreLabel(score) : null;
  const ds = lead ? leadDisplayStatus(lead) : null;

  return (
    <aside className="wa-pane">
      <div className="wa-pane-id">
        {conv.avatarUrl
          ? <img className="wa-pane-av wa-ci-img" src={conv.avatarUrl} alt="" />
          : <div className="wa-pane-av" style={{ background: avc(conv.name || conv.phone) }}>{ini(conv.name || conv.phone)}</div>}
        <div className="wa-pane-name">{conv.name || conv.phone}</div>
        <a className="wa-pane-phone" href={`tel:${conv.phone}`}>{conv.phone}</a>
      </div>

      <AdSourceCard conv={conv} />

      <div className="wa-src">
        <div className="wa-src-head"><Mi>account_circle</Mi><span>CRM record</span></div>

        {!lead && (
          <div className="wa-nolead">
            <p>No lead matches this number.</p>
            <button className="btn btn-p wa-fullbtn" disabled={creating} onClick={createLead}>
              <Mi>person_add</Mi>{creating ? 'Creating…' : 'Create lead'}
            </button>
          </div>
        )}

        {lead && (
          <div className="wa-lead">
            <div className="wa-lead-top">
              <span className={`bdg ${ds.cls}`}>{ds.label}</span>
              {sl && <span className="wa-score" style={{ color: sl.color, background: sl.bg }}>{sl.label} · {score}</span>}
            </div>

            <div className="wa-ad-kv"><span className="wa-ad-k">Name</span><span className="wa-ad-v">{lead.name}</span></div>
            {lead.email && <div className="wa-ad-kv"><span className="wa-ad-k">Email</span><span className="wa-ad-v">{lead.email}</span></div>}
            <div className="wa-ad-kv"><span className="wa-ad-k">Source</span><span className="wa-ad-v">{srclabel(lead.source)}</span></div>
            <div className="wa-ad-kv"><span className="wa-ad-k">Owner</span><span className="wa-ad-v">{lead.assignedToName || '—'}</span></div>
            {lead.propertyInterest && <div className="wa-ad-kv"><span className="wa-ad-k">Interest</span><span className="wa-ad-v">{lead.propertyInterest}</span></div>}
            {lead.budget > 0 && <div className="wa-ad-kv"><span className="wa-ad-k">Budget</span><span className="wa-ad-v">{fmtBDT(lead.budget)}</span></div>}
            {lead.city && <div className="wa-ad-kv"><span className="wa-ad-k">City</span><span className="wa-ad-v">{lead.city}</span></div>}
            <div className="wa-ad-kv"><span className="wa-ad-k">Updated</span><span className="wa-ad-v">{fmtAgo(lead.updatedAt)}</span></div>

            <button className="btn btn-g wa-fullbtn" onClick={() => setPanLead(lead.id)}>
              <Mi>open_in_new</Mi>Open full record
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
