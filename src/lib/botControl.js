// What the Bots control card shows for one bot, derived only from real rows:
// wa_bot_settings (the customer-reply switch), ai_bot_pointers (which version
// the pointer names) and ai_snapshots / ai_test_runs (candidate and its tests).
// A bot whose production WhatsApp path reads the pointer (BOT_READS_POINTER)
// serves the published snapshot; others answer from the legacy FAQ code.

export const BOT_FILTER_ALL = 'all';

// Bots whose production path routes through the AI Trainer and reads the
// published snapshot. Keep in step with the bot's deploy state.
export const BOT_READS_POINTER = new Set(['eyad']);
export const botReadsPointer = (bot) => BOT_READS_POINTER.has(bot);

export function filterBots(bots, choice) {
  return choice === BOT_FILTER_ALL ? bots : bots.filter((b) => b.bot === choice);
}

const newestFirst = (a, b) => (b.version_no || 0) - (a.version_no || 0);

export function botControlView({ bot, settings, pointer, snapshots, runs, pointersAreLive = botReadsPointer(bot) }) {
  const snaps = [...(snapshots || [])].sort(newestFirst);
  const active = pointer?.mode === 'snapshot' ? snaps.find((s) => s.id === pointer.snapshot_id) || null : null;
  const candidate = snaps.find((s) => s.status === 'candidate' && (!active || s.version_no > active.version_no)) || null;
  const latestRun = candidate
    ? [...(runs || [])].filter((r) => r.snapshot_id === candidate.id && r.bot === bot)
      .sort((a, b) => String(b.started_at || '').localeCompare(String(a.started_at || '')))[0] || null
    : null;

  const replies = settings ? (settings.faq_agent_enabled ? 'on' : 'off') : 'unknown';
  // runs === null: the server could not list runs (an ai-trainer without
  // runs.list), so the test state is unknown rather than "not tested".
  const tests = !candidate ? null
    : runs === null ? 'unknown'
    : !latestRun ? 'not_run'
      : latestRun.status === 'running' ? 'running'
        : latestRun.status !== 'complete' ? 'incomplete'
          : (latestRun.counts?.FAIL || 0) + (latestRun.counts?.INCONCLUSIVE || 0) > 0 ? 'failing'
            // A complete run over zero tests passed nothing; the server refuses to publish it.
            : (latestRun.counts?.PASS || 0) === 0 ? 'no_tests' : 'passing';

  return {
    bot,
    replies,
    // What the WhatsApp customer actually gets today. Replies off means no
    // automatic answer at all; no row means the bot follows wa_settings.
    live: replies === 'off' ? { kind: 'none' } : replies === 'unknown' ? { kind: 'global' }
      : pointersAreLive && active ? { kind: 'version', version_no: active.version_no, published_at: active.published_at } : { kind: 'legacy' },
    // What the pointer names, shown separately while it is not wired to the bots.
    pointer: active ? { version_no: active.version_no, published_at: active.published_at } : null,
    candidate: candidate ? { id: candidate.id, version_no: candidate.version_no, created_at: candidate.created_at } : null,
    tests,
    canRunTests: !!candidate,
    canPublish: tests === 'passing',
    canRollback: pointer?.mode === 'snapshot',
  };
}
