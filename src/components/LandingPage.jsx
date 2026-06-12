import { useState, useEffect } from 'react';
import Mi from './Mi.jsx';
import DashMock from './landing/DashMock.jsx';
import DemoForm from './landing/DemoForm.jsx';

// Public marketing homepage for WEPRO CRM — enterprise dark-green aesthetic
// inspired by slosint.io, adapted to a real-estate sales engine.
// `onEnter` switches to the login screen.

const NAV = [
  { label: 'Product', href: '#product' },
  { label: 'Capabilities', href: '#capabilities' },
  { label: 'Solutions', href: '#solutions' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'Resources', href: '#resources' },
];

const TRUST = ['WECON Properties', 'Jolshiri Abason', 'Dakshinayan', 'Navana Real Estate', 'Building Tech'];

const STATS = [
  { v: '500+', l: 'units managed' },
  { v: '6', l: 'live projects' },
  { v: '0–99', l: 'AI lead score' },
  { v: '4', l: 'role dashboards' },
];

const PRODUCTS = [
  { tag: 'Pipeline', t: 'WEPRO Pipeline', d: 'A configurable Kanban that moves deals from lead → offer → booking → won, with lead score, deal value and project demand on every card.', ico: 'view_kanban' },
  { tag: 'Inventory', t: 'WEPRO Inventory', d: 'Manage projects, units, construction progress and documents. Hold, lock and sell units with a live availability grid.', ico: 'real_estate_agent' },
  { tag: 'Insights', t: 'WEPRO Insights', d: 'Live sales analytics, funnels and KPI dashboards for management and team leads — collections, conversion and forecasts.', ico: 'monitoring' },
];

const CAPS = [
  { ico: 'insights', t: 'AI lead scoring & prioritisation', d: 'Every lead is scored 0–99 in real time so your agents always work the hottest opportunities first — not whoever called last.' },
  { ico: 'bolt', t: 'Automated follow-ups that never slip', d: 'Reminders, call logging and meeting scheduling keep every customer engaged across the full funnel, automatically.' },
  { ico: 'apartment', t: 'Live inventory & unit booking', d: 'A bus-seat unit grid locks, holds and sells units in real time — no double-bookings, no spreadsheets.' },
  { ico: 'account_balance_wallet', t: 'Bookings, instalments & collections', d: 'Track deal value, instalment schedules, dues and receipts from first payment to handover in one place.' },
];

const HOWTO = [
  { n: '01', t: 'Capture every lead', d: 'Import or add leads from any channel. WEPRO scores and routes each to the right agent automatically.' },
  { n: '02', t: 'Work the pipeline', d: 'Agents log calls, set meetings and send offers while team leads supervise every deal in flight.' },
  { n: '03', t: 'Book & collect', d: 'Lock a unit, create the booking and track instalments and dues all the way to handover.' },
];

const QUALITY = [
  { ico: 'hub', t: 'One source of truth', d: 'Leads, projects, units, payments and team activity unified — no fragmented tools.' },
  { ico: 'groups', t: 'Built for every role', d: 'Tailored dashboards for initial agents, meeting agents, team leads and management.' },
  { ico: 'shield', t: 'Project-scoped access', d: 'Assign agents to specific projects and control exactly what each role can see and do.' },
  { ico: 'speed', t: 'Real-time everything', d: 'Drag a deal, lock a unit, log a call — changes sync instantly across the whole team.' },
];

const SOLUTIONS = {
  Developers: ['Sell out projects faster with demand visibility', 'Inventory & booking control across towers', 'Collections, dues & instalment tracking'],
  Brokerages: ['Distribute and route leads to the right agents', 'Team leads supervise every deal in flight', 'Performance reporting per agent & team'],
  Agents: ['Work the highest-scoring leads first', 'Never miss a follow-up or meeting', 'Close, book units and log payments in seconds'],
};

const PRICING = [
  { name: 'Starter', price: 'Free', per: 'up to 3 agents', feats: ['Lead pipeline & scoring', 'Call logging & follow-ups', '1 project, basic reports'], cta: 'Start free', hot: false },
  { name: 'Growth', price: '৳12,000', per: 'per month', feats: ['Everything in Starter', 'Inventory & unit booking', 'Bookings, instalments & dues', 'All role dashboards', 'Up to 50 agents'], cta: 'Book a demo', hot: true },
  { name: 'Enterprise', price: 'Custom', per: 'unlimited agents', feats: ['Everything in Growth', 'Unlimited projects & agents', 'Project-scoped access control', 'Priority support & onboarding'], cta: 'Contact sales', hot: false },
];

const TESTIMONIALS = [
  { q: 'We replaced three tools with WEPRO. Our agents finally work one pipeline, and nothing falls through the cracks.', n: 'Head of Sales', r: 'Residential Developer' },
  { q: 'The unit booking grid alone paid for itself — zero double-bookings since we switched.', n: 'Sales Director', r: 'Mixed-use Project' },
  { q: 'Management dashboards give me collections and conversion at a glance. I run the whole company from it.', n: 'Managing Director', r: 'Brokerage Group' },
];

const RESOURCES = [
  { tag: 'Guide', t: 'How AI lead scoring closes more deals', d: 'Why working leads by score beats working them by recency — and how to set it up.' },
  { tag: 'Playbook', t: 'Selling out a project, tower by tower', d: 'Use live inventory demand to time releases and pricing for maximum absorption.' },
  { tag: 'Case study', t: 'Zero double-bookings with a live unit grid', d: 'How one developer eliminated booking conflicts across 500+ units.' },
];

const FAQ = [
  { q: 'How long does it take to get started?', a: 'Most teams are live the same day. Import your leads, add your projects and invite agents — WEPRO seeds demo data so you can explore immediately.' },
  { q: 'Can I control what each agent sees?', a: 'Yes. Assign agents to specific projects and roles (initial agent, meeting agent, team lead, management) — each sees a tailored dashboard and only the data they should.' },
  { q: 'Does it handle payments and instalments?', a: 'WEPRO auto-creates a booking when a deal is won, generates an instalment schedule, and tracks collected amounts, dues and receipts to handover.' },
  { q: 'Is my data secure?', a: 'Data is stored in your own backend with role-based access control. You decide who can see and act on what.' },
  { q: 'Can I migrate from spreadsheets?', a: 'Yes — import leads and inventory directly, and WEPRO becomes your single source of truth from day one.' },
];

export default function LandingPage({ onEnter }) {
  const [scrolled, setScrolled] = useState(false);
  const [menu, setMenu] = useState(false);
  const [faq, setFaq] = useState(0);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const goDemo = (e) => { e?.preventDefault?.(); document.getElementById('demo')?.scrollIntoView({ behavior: 'smooth' }); setMenu(false); };

  return (
    <div id="lp">
      {/* NAV */}
      <header className={`lp-nav${scrolled ? ' on' : ''}`}>
        <div className="lp-nav-in">
          <div className="lp-brand"><span>WEPRO</span><span className="lp-brand-2">CRM</span></div>
          <nav className="lp-links">
            {NAV.map(n => <a key={n.label} href={n.href}>{n.label}</a>)}
          </nav>
          <div className="lp-nav-cta">
            <button className="lp-ghost" onClick={onEnter}>Sign in</button>
            <button className="lp-btn" onClick={goDemo}>Book a demo<Mi>arrow_forward</Mi></button>
          </div>
          <button className="lp-burger" onClick={() => setMenu(m => !m)}><Mi>{menu ? 'close' : 'menu'}</Mi></button>
        </div>
        {menu && (
          <div className="lp-mobile">
            {NAV.map(n => <a key={n.label} href={n.href} onClick={() => setMenu(false)}>{n.label}</a>)}
            <button className="lp-ghost" onClick={() => { setMenu(false); onEnter(); }}>Sign in</button>
            <button className="lp-btn" onClick={goDemo}>Book a demo</button>
          </div>
        )}
      </header>

      {/* HERO */}
      <section className="lp-hero">
        <div className="lp-hero-glow" />
        <div className="lp-hero-in">
          <div className="lp-eyebrow"><span className="lp-dot" />The real-estate sales engine</div>
          <h1 className="lp-h1">Close more deals with <span>data-driven</span> sales operations.</h1>
          <p className="lp-sub">WEPRO CRM unifies leads, inventory, bookings and collections into one platform — so developers and brokerages sell out projects faster, with full visibility from first call to handover.</p>
          <div className="lp-hero-cta">
            <button className="lp-btn lp-btn-lg" onClick={goDemo}>Book a demo<Mi>arrow_forward</Mi></button>
            <button className="lp-ghost lp-ghost-lg" onClick={onEnter}><Mi>login</Mi>Sign in</button>
          </div>
        </div>
        <div className="lp-hero-mock"><DashMock /></div>
        <div className="lp-stats">
          {STATS.map(s => <div key={s.l} className="lp-stat"><div className="lp-stat-v">{s.v}</div><div className="lp-stat-l">{s.l}</div></div>)}
        </div>
      </section>

      {/* TRUST */}
      <section className="lp-trust">
        <p>Trusted by developers &amp; brokerages selling premium real estate</p>
        <div className="lp-logos">{TRUST.map(t => <span key={t}>{t}</span>)}</div>
      </section>

      {/* PRODUCT */}
      <section className="lp-section" id="product">
        <div className="lp-head">
          <div className="lp-kicker">One platform</div>
          <h2>Your entire sales operation, in one place</h2>
          <p>Stop stitching together spreadsheets, chat threads and disconnected tools. WEPRO runs the full cycle.</p>
        </div>
        <div className="lp-prod-grid">
          {PRODUCTS.map(p => (
            <div className="lp-card lp-prod" key={p.t}>
              <span className="lp-prod-ico"><Mi>{p.ico}</Mi></span>
              <div className="lp-prod-tag">{p.tag}</div>
              <h3>{p.t}</h3>
              <p>{p.d}</p>
              <button className="lp-link" onClick={onEnter}>Learn more<Mi>arrow_forward</Mi></button>
            </div>
          ))}
        </div>
      </section>

      {/* CAPABILITIES */}
      <section className="lp-section lp-alt" id="capabilities">
        <div className="lp-head">
          <div className="lp-kicker">Capabilities</div>
          <h2>Built to accelerate every deal</h2>
          <p>From the first inbound lead to the final instalment — automation and intelligence at every step.</p>
        </div>
        <div className="lp-cap-grid">
          {CAPS.map(c => (
            <div className="lp-cap" key={c.t}>
              <span className="lp-cap-ico"><Mi>{c.ico}</Mi></span>
              <div><h3>{c.t}</h3><p>{c.d}</p></div>
            </div>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="lp-section" id="how">
        <div className="lp-head">
          <div className="lp-kicker">How it works</div>
          <h2>From lead to handover in three steps</h2>
        </div>
        <div className="lp-steps">
          {HOWTO.map(s => (
            <div className="lp-step" key={s.n}>
              <span className="lp-step-n">{s.n}</span>
              <h3>{s.t}</h3>
              <p>{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* WHY */}
      <section className="lp-section lp-alt" id="why">
        <div className="lp-head">
          <div className="lp-kicker">Why WEPRO</div>
          <h2>The most complete real-estate CRM</h2>
        </div>
        <div className="lp-quality">
          {QUALITY.map(q => (
            <div className="lp-q" key={q.t}>
              <span className="lp-q-ico"><Mi>{q.ico}</Mi></span>
              <h4>{q.t}</h4>
              <p>{q.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* SOLUTIONS */}
      <section className="lp-section" id="solutions">
        <div className="lp-head">
          <div className="lp-kicker">Solutions</div>
          <h2>Made for the way you sell</h2>
        </div>
        <div className="lp-sol-grid">
          {Object.entries(SOLUTIONS).map(([k, items]) => (
            <div className="lp-card lp-sol" key={k}>
              <h3>{k}</h3>
              <ul>{items.map(i => <li key={i}><Mi>check_circle</Mi>{i}</li>)}</ul>
            </div>
          ))}
        </div>
      </section>

      {/* PRICING */}
      <section className="lp-section lp-alt" id="pricing">
        <div className="lp-head">
          <div className="lp-kicker">Pricing</div>
          <h2>Simple plans that scale with you</h2>
          <p>Start free. Upgrade when your team grows. No hidden fees.</p>
        </div>
        <div className="lp-price-grid">
          {PRICING.map(p => (
            <div className={`lp-card lp-price${p.hot ? ' hot' : ''}`} key={p.name}>
              {p.hot && <span className="lp-price-badge">Most popular</span>}
              <div className="lp-price-name">{p.name}</div>
              <div className="lp-price-v">{p.price}<span>/ {p.per}</span></div>
              <ul>{p.feats.map(f => <li key={f}><Mi>check</Mi>{f}</li>)}</ul>
              <button className={p.hot ? 'lp-btn' : 'lp-ghost'} onClick={goDemo}>{p.cta}</button>
            </div>
          ))}
        </div>
      </section>

      {/* TESTIMONIALS */}
      <section className="lp-section" id="customers">
        <div className="lp-head">
          <div className="lp-kicker">Customers</div>
          <h2>Sales teams run on WEPRO</h2>
        </div>
        <div className="lp-test-grid">
          {TESTIMONIALS.map(t => (
            <figure className="lp-card lp-test" key={t.q}>
              <Mi className="lp-quote">format_quote</Mi>
              <blockquote>{t.q}</blockquote>
              <figcaption><strong>{t.n}</strong><span>{t.r}</span></figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* RESOURCES */}
      <section className="lp-section lp-alt" id="resources">
        <div className="lp-head">
          <div className="lp-kicker">Resources</div>
          <h2>Guides to help you sell more</h2>
        </div>
        <div className="lp-res-grid">
          {RESOURCES.map(r => (
            <article className="lp-card lp-res" key={r.t}>
              <div className="lp-res-thumb"><Mi>article</Mi></div>
              <div className="lp-res-body">
                <div className="lp-res-tag">{r.tag}</div>
                <h3>{r.t}</h3>
                <p>{r.d}</p>
                <button className="lp-link" onClick={onEnter}>Read more<Mi>arrow_forward</Mi></button>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="lp-section" id="faq">
        <div className="lp-head">
          <div className="lp-kicker">FAQ</div>
          <h2>Questions, answered</h2>
        </div>
        <div className="lp-faq">
          {FAQ.map((item, i) => (
            <div className={`lp-faq-item${faq === i ? ' open' : ''}`} key={item.q}>
              <button className="lp-faq-q" onClick={() => setFaq(faq === i ? -1 : i)}>
                {item.q}<Mi>{faq === i ? 'remove' : 'add'}</Mi>
              </button>
              {faq === i && <div className="lp-faq-a">{item.a}</div>}
            </div>
          ))}
        </div>
      </section>

      {/* DEMO FORM */}
      <section className="lp-demo" id="demo">
        <div className="lp-demo-in">
          <div className="lp-demo-left">
            <div className="lp-kicker">Book a demo</div>
            <h2>See WEPRO CRM in action</h2>
            <p>Get a personalised walkthrough of your pipeline, inventory and collections — tailored to how your team sells.</p>
            <ul className="lp-demo-list">
              <li><Mi>check_circle</Mi>30-minute personalised demo</li>
              <li><Mi>check_circle</Mi>See it with your own workflow</li>
              <li><Mi>check_circle</Mi>No commitment, no pressure</li>
            </ul>
          </div>
          <div className="lp-demo-right"><DemoForm /></div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="lp-foot" id="company">
        <div className="lp-foot-in">
          <div className="lp-foot-brand">
            <div className="lp-brand"><span>WEPRO</span><span className="lp-brand-2">CRM</span></div>
            <p>The real-estate sales engine for developers and brokerages.</p>
            <div className="lp-foot-social">
              <a aria-label="LinkedIn"><Mi>public</Mi></a>
              <a aria-label="Email"><Mi>mail</Mi></a>
              <a aria-label="Phone"><Mi>call</Mi></a>
            </div>
          </div>
          <div className="lp-foot-cols">
            <div><h5>Product</h5><a onClick={onEnter}>Pipeline</a><a onClick={onEnter}>Inventory</a><a onClick={onEnter}>Insights</a><a onClick={onEnter}>Bookings</a></div>
            <div><h5>Solutions</h5><a href="#solutions">Developers</a><a href="#solutions">Brokerages</a><a href="#solutions">Agents</a><a href="#pricing">Pricing</a></div>
            <div><h5>Company</h5><a href="#customers">Customers</a><a href="#resources">Resources</a><a href="#faq">FAQ</a><a onClick={goDemo}>Book a demo</a></div>
          </div>
        </div>
        <div className="lp-foot-bot">
          <span>© 2026 WEPRO CRM. All rights reserved.</span>
          <span>Real Estate · Sales Engine</span>
        </div>
      </footer>
    </div>
  );
}
