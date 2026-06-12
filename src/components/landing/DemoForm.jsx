import { useState } from 'react';
import Mi from '../Mi.jsx';

// "Book a demo" lead-capture form — slosint's signature CTA, adapted.
// No backend: a valid submit shows an inline success state.
const ROLES = ['Managing Director / Owner', 'Head of Sales', 'Sales / Team Lead', 'Agent', 'IT / Operations', 'Other'];
const SIZES = ['1–10 agents', '11–50 agents', '51–200 agents', '200+ agents'];

export default function DemoForm() {
  const [f, setF] = useState({ name: '', email: '', company: '', phone: '', role: '', size: '', use: '' });
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');

  const set = (k) => (e) => setF(s => ({ ...s, [k]: e.target.value }));
  const submit = (e) => {
    e.preventDefault();
    if (!f.name.trim() || !f.email.trim() || !f.company.trim()) { setErr('Please fill in your name, work email and company.'); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) { setErr('Please enter a valid work email.'); return; }
    setErr('');
    setSent(true);
  };

  if (sent) {
    return (
      <div className="lp-form lp-form-done">
        <span className="lp-form-check"><Mi>check_circle</Mi></span>
        <h3>Request received</h3>
        <p>Thanks, {f.name.split(' ')[0]}. Our team will reach out to {f.email} within one business day to schedule your personalised WEPRO CRM demo.</p>
      </div>
    );
  }

  return (
    <form className="lp-form" onSubmit={submit} noValidate>
      <div className="lp-form-row">
        <div className="lp-field"><label>Full name *</label><input value={f.name} onChange={set('name')} placeholder="Your name" /></div>
        <div className="lp-field"><label>Work email *</label><input type="email" value={f.email} onChange={set('email')} placeholder="you@company.com" /></div>
      </div>
      <div className="lp-form-row">
        <div className="lp-field"><label>Company *</label><input value={f.company} onChange={set('company')} placeholder="Company name" /></div>
        <div className="lp-field"><label>Phone</label><input value={f.phone} onChange={set('phone')} placeholder="+880 1XXX-XXXXXX" /></div>
      </div>
      <div className="lp-form-row">
        <div className="lp-field"><label>Your role</label>
          <select value={f.role} onChange={set('role')}>
            <option value="">Select…</option>
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div className="lp-field"><label>Team size</label>
          <select value={f.size} onChange={set('size')}>
            <option value="">Select…</option>
            {SIZES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
      <div className="lp-field"><label>What would you like to see?</label>
        <textarea rows={3} value={f.use} onChange={set('use')} placeholder="Pipeline, inventory, collections, reporting…" />
      </div>
      {err && <div className="lp-form-err"><Mi>error</Mi>{err}</div>}
      <button className="lp-btn lp-btn-lg lp-form-submit" type="submit">Book my demo<Mi>arrow_forward</Mi></button>
      <p className="lp-form-note">By submitting you agree to be contacted about WEPRO CRM. We never share your data.</p>
    </form>
  );
}
