import { useCallback, useEffect, useState } from 'react';
import Mi from '../Mi.jsx';

// Per-bot state (legacy or published snapshot), freeze, stepped test runs,
// results, gated publish and rollback. Publish is refused by the server while
// any test fails or is inconclusive; this screen only shows why.
const cls = (v) => (v === 'PASS' ? 'pass' : v === 'FAIL' ? 'fail' : 'inc');

export default function QualityTab({ api, showToast }) {
  const [status, setStatus] = useState(null);
  const [snaps, setSnaps] = useState([]);
  const [tests, setTests] = useState([]);
  const [bot, setBot] = useState('eyad');
  const [snapId, setSnapId] = useState('');
  const [run, setRun] = useState(null);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(null);

  // State is set in the promise callback, not synchronously in the effect,
  // which the react-hooks lint rule forbids.
  const reload = useCallback(() => Promise.all([api('status'), api('snapshot.list'), api('tests.list')])
    .then(([s, l, t]) => { setStatus(s); setSnaps(l); setTests(t); })
    .catch(e => showToast(e.message, 'err')), [api, showToast]);
  useEffect(() => { reload(); }, [reload]);

  const freeze = async () => {
    setBusy(true);
    try { const d = await api('snapshot.freeze'); setSnapId(d.id); showToast(d.reused ? `Drafts unchanged: v${d.version_no}` : `Candidate v${d.version_no} created`, 'ok'); reload(); }
    catch (e) { showToast(e.code === 'freeze' ? `Fix drafts first: ${(e.details || []).join('; ')}` : e.message, 'err'); }
    finally { setBusy(false); }
  };

  const runTests = async () => {
    if (!snapId) return;
    setBusy(true); setBlocked(null);
    try {
      const r = await api('runs.start', { snapshot_id: snapId, bot });
      let s = { status: 'running' };
      while (s.status === 'running') {
        s = await api('runs.step', { run_id: r.id });
        setRun({ id: r.id, progress: s });
      }
      setRun(await api('runs.get', { run_id: r.id }));
    } catch (e) { showToast(e.message, 'err'); }
    finally { setBusy(false); }
  };

  const publish = async () => {
    setBusy(true); setBlocked(null);
    try { await api('publish', { snapshot_id: snapId, bot }); showToast(`Published to ${bot}`, 'ok'); reload(); }
    catch (e) { if (e.code === 'gate') setBlocked(e.details || [e.message]); else showToast(e.message, 'err'); }
    finally { setBusy(false); }
  };

  const rollback = async (b, legacy, toId) => {
    const reason = window.prompt(legacy ? `Why move ${b} back to legacy? (required)` : `Why roll ${b} back? (required)`);
    if (!reason?.trim()) return;
    try { await api('rollback', { bot: b, legacy, snapshot_id: toId, reason }); showToast('Done', 'ok'); reload(); }
    catch (e) { showToast(e.details ? `${e.message} ${e.details.join('; ')}` : e.message, 'err'); }
  };

  const retireTest = async (t) => {
    const reason = window.prompt('Why retire this test? (required)');
    if (!reason?.trim()) return;
    try { await api('tests.retire', { id: t.id, revision: t.revision, reason }); reload(); }
    catch (e) { showToast(e.message, 'err'); }
  };

  if (!status) return <div className="ea-count">Loading…</div>;
  const snapById = Object.fromEntries(snaps.map(s => [s.id, s]));
  const budget = status.budget?.[0];

  return (
    <div className="ait">
      <section className="ea-row" style={{ gap: 12, flexWrap: 'wrap' }}>
        {status.pointers.map(p => (
          <div key={p.bot} className="analytics-card" style={{ minWidth: 240 }}>
            <b>{p.bot}</b>
            <div>{p.mode === 'legacy' ? 'Legacy: unversioned live reads, not a published version' : `Snapshot v${snapById[p.snapshot_id]?.version_no ?? '?'} · ${snapById[p.snapshot_id]?.checksum?.slice(0, 12) ?? ''}`}</div>
            <div className="meta">changed {new Date(p.changed_at).toLocaleString()}{p.changed_by_claimed ? ` · claimed by ${p.changed_by_claimed}` : ''}</div>
            {p.mode === 'snapshot' && <button className="btn btn-g btn-sm" onClick={() => rollback(p.bot, true)}><Mi>undo</Mi>Back to legacy</button>}
          </div>
        ))}
        <div className="analytics-card">
          <b>Core</b><div>{status.core_version}</div>
          <b>Budget today</b><div>{budget ? `$${(Number(budget.spent_usd) + Number(budget.reserved_usd)).toFixed(3)} of $${Number(budget.limit_usd).toFixed(2)}` : 'unused'}</div>
        </div>
      </section>

      <section className="analytics-card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="ea-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-g" disabled={busy} onClick={freeze}><Mi>science</Mi>Freeze drafts as candidate</button>
          <select className="fi" value={snapId} onChange={e => { setSnapId(e.target.value); setRun(null); setBlocked(null); }} aria-label="Snapshot">
            <option value="">Choose a version</option>
            {snaps.map(s => <option key={s.id} value={s.id}>v{s.version_no} ({s.status})</option>)}
          </select>
          <select className="fi" value={bot} onChange={e => setBot(e.target.value)} aria-label="Bot"><option value="eyad">eyad</option><option value="dubai">dubai</option></select>
          <button className="btn btn-g" disabled={busy || !snapId} onClick={runTests}><Mi>play_arrow</Mi>Run tests ({tests.filter(t => t.status === 'active' && t.bots.includes(bot)).length})</button>
          <button className="btn btn-p" disabled={busy || !snapId} onClick={publish}>Publish to {bot}</button>
          {snapId && snapById[snapId]?.status === 'published' && <button className="btn btn-g" onClick={() => rollback(bot, false, snapId)}>Roll {bot} back to this version</button>}
        </div>
        {run?.progress && run.progress.status === 'running' && <div>Running… {run.progress.done}/{run.progress.total}</div>}
        {blocked && <div className="ait-err" role="alert"><b>Publish blocked:</b><ul>{blocked.map(r => <li key={r}>{r}</li>)}</ul></div>}
        {run?.results && (
          <div className="ait-list">
            <div>Run {run.status}: {Object.entries(run.counts || {}).map(([k, v]) => `${k} ${v}`).join(' · ')}</div>
            {run.results.map(r => {
              const t = tests.find(x => x.id === r.test_id);
              return (
                <div className="ait-row" key={r.id}>
                  <div>
                    <span className={`ait-badge ${cls(r.verdict)}`}>{r.verdict}</span> <b>{t?.spec?.title || r.test_id}</b>
                    <div>Reply: {r.reply.reply || `(none: ${r.reply.outcome})`}</div>
                    <div className="meta">{r.checks.filter(c => !c.pass).map(c => `failed ${c.type}${c.detail ? ` (${c.detail})` : ''}`).join(' · ') || 'all checks passed'}</div>
                    <div className="meta">Judge: {r.judge.verdict}{r.judge.attempts?.map((a, i) => ` · #${i + 1} ${a.verdict}${a.rationale ? `: ${a.rationale}` : ''}${a.error ? ` (${a.error})` : ''}`).join('')}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h3>Regression tests</h3>
        <div className="ait-list">
          {tests.filter(t => t.status === 'active').map(t => (
            <div className="ait-row" key={t.id}>
              <div><b>{t.spec.title}</b><div>{t.spec.target}</div><div className="meta">rev {t.revision} · {t.bots.join(', ')} · {t.origin}</div></div>
              <button className="btn btn-g btn-sm" onClick={() => retireTest(t)} aria-label="Retire test"><Mi>delete</Mi></button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
