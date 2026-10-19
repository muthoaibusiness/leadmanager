import { useCallback, useEffect, useState } from 'react';
import Mi from '../Mi.jsx';
import { sbGet } from '../../lib/supabase.js';
import { BOTS } from '../wa/relayBots.js';
import { Menu, MenuRadio, MenuRadioGroup } from '../ui/menu.jsx';
import { BOT_FILTER_ALL, botControlView, filterBots } from '../../lib/botControl.js';

// One card per bot: the customer-reply switch (wa_bot_settings.faq_agent_enabled,
// the same row WA Relay edits), what customers get today, the candidate version
// and its tests, and the production actions. Every write, the switch included,
// goes through the ai-trainer function, which re-checks the role and audits it.
const fmt = (t) => (t ? new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const TESTS = {
  not_run: ['warn', 'Not tested'], running: ['warn', 'Tests running'], incomplete: ['warn', 'Tests incomplete'],
  unknown: ['off', 'Test status unavailable'],
  failing: ['bad', 'Tests failing'], passing: ['ok', 'Tests passed'],
};

const LIVE = {
  version: (v) => [`v${v.live.version_no} · AI Trainer`, `Published ${fmt(v.live.published_at)}`],
  legacy: () => ['Legacy FAQ agent', "AI Trainer versions don't reach customers yet."],
  none: () => ['No automatic answers', 'AI replies are off. New customer questions get no automatic answer until an agent replies.'],
  global: () => ['Global WA settings', 'This bot has no setting of its own, so it follows the shared WA Relay settings.'],
};

function BotCard({ name, view, busy, onToggle, onRun, onPublish, onRollback }) {
  const v = view;
  const [testCls, testLabel] = v.tests ? TESTS[v.tests] : [];
  const [liveTitle, liveNote] = LIVE[v.live.kind](v);
  const why = [!v.canPublish && v.candidate && 'Publish unlocks when the latest tests all pass.', !v.canRollback && 'Nothing published to roll back.'].filter(Boolean);
  return (
    <article className="analytics-card bc-card" aria-labelledby={`bc-${v.bot}`}>
      <header className="bc-head">
        <div>
          <h3 id={`bc-${v.bot}`} className="bc-title">{name}</h3>
          <div className="bc-sub">WhatsApp</div>
        </div>
        <span className={`cot-badge ${v.replies === 'on' ? 'ok' : 'off'}`}>{v.replies === 'on' ? 'AI replies on' : v.replies === 'off' ? 'AI replies off' : 'AI replies: global'}</span>
      </header>

      <section className="bc-sec">
        <div className="bc-label">What customers get</div>
        <div className="bc-live">{liveTitle}</div>
        <p className="bc-note">{liveNote}</p>
      </section>

      <section className="bc-sec">
        <div className="bc-row">
          <div className="bc-grow">
            <div className="bc-strong" id={`bc-${v.bot}-replies`}>Customer AI replies</div>
            <p className="bc-note">Off stops new AI replies. Leads, history and agent commands keep working. Test numbers still get replies.</p>
          </div>
          <button type="button" role="switch" aria-checked={v.replies === 'on'} aria-labelledby={`bc-${v.bot}-replies`}
            className={`bc-switch ${v.replies === 'on' ? 'on' : ''}`} disabled={busy === 'toggle' || v.replies === 'unknown'} onClick={onToggle}>
            <span className="bc-knob" aria-hidden="true" />
            <span className="bc-switch-txt">{v.replies === 'on' ? 'On' : v.replies === 'off' ? 'Off' : 'Unknown'}</span>
          </button>
        </div>
      </section>

      <section className="bc-sec">
        <div className="bc-label">AI Trainer versions</div>
        {v.pointer && v.live.kind !== 'version' && (
          <div className="bc-row bc-inset">
            <div className="bc-grow">
              <div>v{v.pointer.version_no} · Published</div>
              <div className="bc-note">Published {fmt(v.pointer.published_at)}. Bots don't read published versions yet, so customers don't get it.</div>
            </div>
            <span className="cot-badge warn">Not live</span>
          </div>
        )}
        {v.candidate ? (
          <div className="bc-inset">
            <div className="bc-row">
              <div className="bc-grow">
                <div>v{v.candidate.version_no} · Candidate</div>
                <div className="bc-note">Drafts frozen {fmt(v.candidate.created_at)}. Testing it never changes what customers get.</div>
              </div>
              <span className={`cot-badge ${testCls}`}>{testLabel}</span>
            </div>
            <button type="button" className="btn btn-g bc-act bc-run" disabled={!!busy || !v.canRunTests} onClick={onRun}>
              <Mi>science</Mi>{busy === 'run' ? 'Running…' : 'Run tests'}
            </button>
          </div>
        ) : (
          <div className="bc-note bc-inset">No candidate. Freeze the drafts in Quality &amp; Publish to create one.</div>
        )}
        <div className="bc-actions">
          <button type="button" className="btn btn-g bc-act" disabled={!!busy || !v.canPublish} onClick={onPublish} aria-describedby={why.length ? `bc-${v.bot}-why` : undefined}>
            <Mi>rocket_launch</Mi>{v.candidate ? `Publish v${v.candidate.version_no}` : 'Publish'}
          </button>
          <button type="button" className="btn btn-g bc-act" disabled={!!busy || !v.canRollback} onClick={onRollback} aria-describedby={why.length ? `bc-${v.bot}-why` : undefined}>
            <Mi>history</Mi>Rollback
          </button>
        </div>
        {why.length > 0 && <p className="bc-note" id={`bc-${v.bot}-why`}>{why.join(' ')}</p>}
      </section>
    </article>
  );
}

export default function BotControl({ api, showToast }) {
  const [choice, setChoice] = useState(BOT_FILTER_ALL);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState({});
  const setBotBusy = (bot, v) => setBusy((b) => ({ ...b, [bot]: v }));

  const load = useCallback(() => Promise.all([
    // An ai-trainer deployed before runs.list rejects it; the cards still load.
    api('status'), api('snapshot.list'), api('runs.list').catch((e) => (e.code === 'unknown_action' ? null : Promise.reject(e))),
    sbGet('wa_bot_settings?select=bot,faq_agent_enabled,display_name'),
  ]).then(([status, snapshots, runs, settings]) => { setErr(null); setData({ status, snapshots, runs, settings: settings || [] }); })
    .catch((e) => setErr(e.message)), [api]);
  useEffect(() => { load(); }, [load]);

  if (err) return <div className="ait-err" role="alert">Could not load the bots: {err} <button className="btn btn-g btn-sm" onClick={load}><Mi>refresh</Mi>Retry</button></div>;
  if (!data) return <div className="ea-count">Loading…</div>;

  const viewOf = (bot) => botControlView({
    bot, settings: data.settings.find((s) => s.bot === bot) || null,
    pointer: data.status.pointers.find((p) => p.bot === bot), snapshots: data.snapshots, runs: data.runs,
  });

  const toggle = async (b, view) => {
    const next = view.replies !== 'on';
    const msg = next ? `Turn AI replies ON for ${b.name}? Customers will start getting automatic answers.` : `Turn AI replies OFF for ${b.name}? New customer questions get no automatic answer.`;
    if (!window.confirm(msg)) return;
    setBotBusy(b.bot, 'toggle');
    try { await api('bots.set_replies', { bot: b.bot, enabled: next }); showToast(`AI replies ${next ? 'on' : 'off'} for ${b.name}`, 'ok'); }
    catch (e) { showToast(`Could not change the switch: ${e.message}`, 'err'); }
    await load(); setBotBusy(b.bot, null);
  };

  const runTests = async (b, view) => {
    setBotBusy(b.bot, 'run');
    try {
      const r = await api('runs.start', { snapshot_id: view.candidate.id, bot: b.bot });
      let s = { status: 'running' };
      while (s.status === 'running') s = await api('runs.step', { run_id: r.id });
      showToast(s.status === 'complete' ? `Tests finished: ${Object.entries(s.counts || {}).map(([k, n]) => `${k} ${n}`).join(' · ')}` : `Tests ${s.status}`, 'ok');
    } catch (e) { showToast(e.message, 'err'); }
    await load(); setBotBusy(b.bot, null);
  };

  const publish = async (b, view) => {
    if (!window.confirm(`Publish v${view.candidate.version_no} to ${b.name}? The bots do not read published versions yet, so customers are not affected until that is switched on.`)) return;
    setBotBusy(b.bot, 'publish');
    try { await api('publish', { snapshot_id: view.candidate.id, bot: b.bot, expected_snapshot_id: data.status.pointers.find((p) => p.bot === b.bot)?.snapshot_id ?? null }); showToast(`Published v${view.candidate.version_no} to ${b.name}`, 'ok'); }
    catch (e) { showToast(e.code === 'gate' ? `Publish blocked: ${(e.details || [e.message]).join('; ')}` : e.message, 'err'); }
    await load(); setBotBusy(b.bot, null);
  };

  const rollback = async (b) => {
    const reason = window.prompt(`Why move ${b.name} back to legacy? (required)`);
    if (!reason?.trim()) return;
    setBotBusy(b.bot, 'rollback');
    try { await api('rollback', { bot: b.bot, legacy: true, reason, expected_snapshot_id: data.status.pointers.find((p) => p.bot === b.bot)?.snapshot_id ?? null }); showToast(`${b.name} moved back to legacy`, 'ok'); }
    catch (e) { showToast(e.details ? `${e.message} ${e.details.join('; ')}` : e.message, 'err'); }
    await load(); setBotBusy(b.bot, null);
  };

  const shown = filterBots(BOTS, choice);
  const choiceName = choice === BOT_FILTER_ALL ? 'All Bots' : BOTS.find((b) => b.bot === choice)?.name || 'All Bots';
  return (
    <div className="bc">
      <div className="bc-bar">
        <Menu align="start" label={`Bot: ${choiceName}`}
          trigger={<button type="button" className="btn btn-g bc-pick"><Mi>smart_toy</Mi>{choiceName}<Mi>expand_more</Mi></button>}>
          <MenuRadioGroup value={choice} onChange={setChoice}>
            <MenuRadio value={BOT_FILTER_ALL}>All Bots</MenuRadio>
            {BOTS.map((b) => <MenuRadio key={b.bot} value={b.bot}>{b.name}</MenuRadio>)}
          </MenuRadioGroup>
        </Menu>
        <button type="button" className="btn btn-g btn-sm" onClick={load}><Mi>refresh</Mi>Refresh</button>
      </div>
      <div className={`bc-grid ${shown.length > 1 ? 'two' : ''}`}>
        {shown.map((b) => {
          const view = viewOf(b.bot);
          return <BotCard key={b.bot} name={b.name} view={view} busy={busy[b.bot]}
            onToggle={() => toggle(b, view)} onRun={() => runTests(b, view)} onPublish={() => publish(b, view)} onRollback={() => rollback(b)} />;
        })}
      </div>
    </div>
  );
}
