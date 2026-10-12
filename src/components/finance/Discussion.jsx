import { useState } from 'react';
import Mi from '../Mi.jsx';
import Avatar from '../Avatar.jsx';
import { getDB } from '../../lib/db.js';
import { fmtAgo, fmtBDT } from '../../lib/helpers.js';
import { commentsOf, eventsOf, ACTION_LABELS } from '../../lib/finance.js';
import { FilePicker } from './forms.jsx';

// Opens an attachment: asks the function for a short-lived signed link.
export function FileLink({ file, call }) {
  const open = async () => {
    try { const { url } = await call('file.url', { path: file.path }); window.open(url, '_blank', 'noopener'); }
    catch (e) { alert(e.message); }
  };
  return <button type="button" className="fin-file" onClick={open} title={file.name}><Mi>attach_file</Mi><span>{file.name}</span></button>;
}

const highlight = (body) => body.split(/(@[\w.\- ]+?)(?=[\s,.:;!?]|$)/).map((part, i) => (part.startsWith('@') ? <mark key={i}>{part}</mark> : part));

// Comments on a budget, expense or statement, with @mentions and attachments.
export function Discussion({ api, user, type, id }) {
  const { fin, act, call } = api;
  const list = commentsOf(fin, type, id);
  const members = getDB().users.filter(u => u.isActive !== false && u.role !== 'MASTER' && u.id !== user.id);
  const [body, setBody] = useState('');
  const [mentions, setMentions] = useState([]);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const mention = (e) => {
    const u = members.find(m => m.id === e.target.value); e.target.value = '';
    if (!u || mentions.includes(u.id)) return;
    setMentions(m => [...m, u.id]); setBody(b => `${b}${b && !b.endsWith(' ') ? ' ' : ''}@${u.name} `);
  };
  const send = async () => {
    setErr(''); setBusy(true);
    try { await act('comment.add', { entityType: type, entityId: id, body, mentions, attachments: files }); setBody(''); setMentions([]); setFiles([]); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="fin-card-bd">
      {list.length === 0 ? <div className="fin-empty">No discussion yet.</div> : (
        <div className="fin-comments">{list.map(c => (
          <div key={c.id} className="fin-comment">
            <Avatar name={c.userName} className="ui-av ui-sm" />
            <div>
              <div className="hd"><b>{c.userName || 'Someone'}</b><span>{fmtAgo(c.createdAt)}</span></div>
              <div className="bd">{highlight(c.body)}</div>
              {c.attachments?.length > 0 && <div className="fin-files" style={{ marginTop: 6 }}>{c.attachments.map((f, i) => <FileLink key={i} file={f} call={call} />)}</div>}
            </div>
          </div>
        ))}</div>
      )}
      <div className="fin-compose">
        <textarea className="fi" value={body} onChange={e => setBody(e.target.value)} placeholder="Write a comment… use Mention to tag a colleague" />
        <div className="fin-compose-row">
          <select className="fsel" defaultValue="" onChange={mention} aria-label="Mention a colleague"><option value="" disabled>Mention…</option>{members.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
          <FilePicker files={files} setFiles={setFiles} upload={(p) => call('file.upload', p)} max={5} />
          <span className="sp" />
          <button type="button" className="btn btn-p btn-sm" onClick={send} disabled={busy || !body.trim()}><Mi>send</Mi>Post</button>
        </div>
        {err && <div className="fin-help" style={{ color: 'var(--red)' }}>{err}</div>}
      </div>
    </div>
  );
}

// Audit trail: every change and decision, newest first.
const TONE = { decided: (d) => (d.decision === 'APPROVED' ? 'good' : d.decision === 'REJECTED' ? 'bad' : 'warn'), overrun: () => 'bad', deleted: () => 'bad', finalized: () => 'good' };
const ICON = { created: 'add', updated: 'edit', submitted: 'send', decided: 'task_alt', deleted: 'delete', overrun: 'warning', finalized: 'check_circle', shared: 'link' };
const money = (k) => /amount|remaining|price/.test(k);
const fmtVal = (k, v) => (v == null || v === '' ? '—' : money(k) ? fmtBDT(Number(v)) : typeof v === 'object' ? JSON.stringify(v) : String(v));
const nice = (k) => k.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());

export function History({ api, type, id }) {
  const events = eventsOf(api.fin, type, id);
  if (!events.length) return <div className="fin-empty">No history yet.</div>;
  return (
    <div className="fin-card-bd"><div className="fin-timeline">{events.map(e => {
      const d = e.data || {};
      const tone = TONE[e.action]?.(d) || '';
      let line = ACTION_LABELS[e.action] || e.action;
      if (e.action === 'decided') line = `${d.decision === 'APPROVED' ? 'Approved' : d.decision === 'REJECTED' ? 'Rejected' : 'Revision requested'}${d.approvedAmount != null ? ` · ${fmtBDT(Number(d.approvedAmount))}` : ''} (v${d.version})`;
      if (e.action === 'submitted') line = `Submitted v${d.version} · requested ${fmtBDT(Number(d.requestedAmount))}`;
      if (e.action === 'overrun') line = `Budget overrun · remaining ${fmtBDT(Number(d.remaining))}`;
      const diffs = Object.entries(d).filter(([, v]) => v && typeof v === 'object' && 'from' in v && 'to' in v);
      return (
        <div key={e.id} className="fin-ev">
          <div className={`dot ${tone}`}><Mi>{ICON[e.action] || 'history'}</Mi></div>
          <div>
            <div className="t"><b>{line}</b>{d.note ? ` — “${d.note}”` : ''}</div>
            <div className="w">{e.userName || 'System'} · {fmtAgo(e.at)}</div>
            {diffs.length > 0 && <div className="d">{diffs.map(([k, v]) => <span key={k}>{nice(k)}: {fmtVal(k, v.from)} → {fmtVal(k, v.to)}</span>)}</div>}
          </div>
        </div>
      );
    })}</div></div>
  );
}
