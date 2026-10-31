// node --test — the scheduled sender (capi-sched.ts): selection, dry-run gating,
// and the real-send path, against an in-memory deps harness. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runSched } from "./capi-sched.ts";
import { type CapiDeps } from "./capi-core.ts";

const DAY = 864e5;
const NOW = Date.parse("2026-10-29T11:00:00Z");
const TOKEN = "EAAtest-SECRET-TOKEN-value";

type Lead = { id: string; ctwa_clid: string | null; qualified: boolean; status: string; created_at: string; qualified_at?: string | null; capi_status_column?: string | null; unsure?: boolean };
function world(leads: Lead[]) {
  const sent: any[] = []; const recorded: any[] = []; const locks = new Set<string>();
  const deps: CapiDeps = {
    now: () => NOW,
    token: () => TOKEN,
    async user() { return null; },
    async lead(id) {
      const l = leads.find((x) => x.id === id);
      return l ? { id: l.id, company_id: "c1", created_at: l.created_at, ctwa_clid: l.ctwa_clid, capi_status_column: l.capi_status_column ?? null, qualified: l.qualified, unsure: l.unsure ?? false } : null;
    },
    async page(q) {
      const rs = leads.filter((r) => r.status === (q.status === "all" ? r.status : q.status));
      return { rows: rs.slice(q.offset, q.offset + q.limit), total: rs.length };
    },
    async summary() { return { total: leads.length, by_status: {}, attempts: 0, accepted_attempts: 0, last_accepted_at: null, oldest_pending: null }; },
    async history() { return []; },
    async acquire(id) { if (locks.has(id)) return { result: "locked" }; locks.add(id); return { result: "ok" }; },
    async unlock(id) { locks.delete(id); },
    async throttle() { return new Date(NOW + 60000).toISOString(); },
    async bots() { return []; },
    async setBot() { return null; },
    async record(a) { recorded.push(a); return { attempt_no: recorded.filter((x) => x.lead_id === a.lead_id).length }; },
    async settings() { return { ui_recovery_paused: false }; },
    async saveSettings() {},
    async postMeta(body) { sent.push(body); return { status: 200, json: { events_received: 1, fbtrace_id: "fbt-1" } }; },
    allowUnverifiedActor: () => true,
  };
  return { deps, sent, recorded };
}
const L = (id: string, o: Partial<Lead> = {}): Lead => ({ id, ctwa_clid: "clid-" + id, qualified: true, status: "pending", created_at: new Date(NOW - DAY).toISOString(), qualified_at: new Date(NOW - DAY).toISOString(), capi_status_column: null, ...o });
const gates = (sendEnabled = false, maxBatch = 50) => ({ sendEnabled, maxBatch });

test("check is read-only: counts the qualified pending queue, sends and records nothing", async () => {
  const w = world([
    L("a"),                                  // eligible
    L("b", { qualified: false }),            // not agent-qualified
    L("c", { ctwa_clid: null }),             // no click id
    L("d", { status: "expired" }),           // past window
    L("e", { status: "success" }),           // already reported (not pending -> not listed)
    L("f", { capi_status_column: "LeadSubmitted" }), // reported
    L("g", { unsure: true }),                // earlier unclear answer
  ]);
  const out = await runSched("check", w.deps, gates(), NOW);
  assert.equal(out.action, "check");
  assert.equal(out.sent, 0);
  assert.equal(out.qualified, 1); // only a
  assert.ok(out.preview && out.preview.length === 1 && out.preview[0].id === "a");
  assert.equal(out.dry_run, true);
  assert.equal(w.sent.length, 0);
  assert.equal(w.recorded.length, 0);
});

test("send with sendEnabled=false dry-runs and never touches Meta", async () => {
  const w = world([L("a"), L("b")]);
  const out = await runSched("send", w.deps, gates(false), NOW);
  assert.equal(out.sent, 0);
  assert.equal(out.dry_run, true);
  assert.equal(out.disabled, true);
  assert.equal(out.queued, 2);
  assert.deepEqual(out.preview.map((p: any) => p.id), ["a", "b"]);
  assert.equal(w.sent.length, 0);
  assert.equal(w.recorded.length, 0);
});

test("send with sendEnabled=true sends eligible leads and records a 'scheduled' attempt", async () => {
  const w = world([L("a"), L("b"), L("c", { qualified: false })]);
  const out = await runSched("send", w.deps, gates(true), NOW);
  assert.equal(out.sent, 2);
  assert.equal(out.dry_run, false);
  assert.equal(w.sent.length, 2);
  assert.equal(w.recorded.length, 2);
  assert.ok(w.recorded.every((a: any) => a.source === "scheduled"));
  assert.ok(w.recorded.every((a: any) => a.outcome === "accepted"));
});
