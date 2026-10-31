// meta-capi-sched core — the pg_cron target for scheduled Meta CAPI work
// (migration 0052). Server-to-server, no browser user: authorization is the
// operator's deploy switch, not an actor check. Real sending stays OFF until
// the deployer sets CAPI_SCHED_SEND=true AND the CR-001 D1 verified-sign-in
// blocker is resolved (see capi-core.ts decision D1). Until then `send` only
// dry-runs — it counts the eligible queue and sends nothing.
import { eventBody, classifyMeta, MAX_BATCH, WINDOW_MS, type CapiDeps } from "./capi-core.ts";

export type SchedAction = "check" | "send";
export interface SchedGates { sendEnabled: boolean; maxBatch: number }
type Row = Record<string, any>;

// Selection rule shared by both actions: a lead is queued only when the lead
// view (0051) says it is agent-qualified (a person logged
// CONTACTED/INTERESTED), it carries a valid click id, and it is not yet
// reported. This is the same server-side check the `retry` action applies per
// lead. It reads each lead through deps.lead() (which carries ctwa_clid),
// because the list projection (deps.page) intentionally omits click ids.
// Returns the eligible leads up to the batch cap.
async function queue(deps: CapiDeps, gates: SchedGates): Promise<Row[]> {
  const limit = Math.min(Math.max(1, gates.maxBatch || MAX_BATCH), MAX_BATCH);
  const page = await deps.page({ company: null, status: "pending", search: "", from: null, to: null, sort: "created_desc", limit, offset: 0 });
  const now = deps.now();
  const eligible: Row[] = [];
  for (const row of page.rows) {
    const lead = await deps.lead(row.id);
    if (!lead) continue;
    if (lead.capi_status_column === "LeadSubmitted") continue;          // already reported
    if (!lead.ctwa_clid || lead.qualified !== true) continue;           // not agent-qualified / no click id
    if (!(now - Date.parse(lead.created_at) < WINDOW_MS)) continue;     // past Meta's window
    if (lead.unsure === true) continue;                                 // earlier unclear answer
    eligible.push(lead);
  }
  return eligible;
}

export async function runSched(action: SchedAction, deps: CapiDeps, gates: SchedGates, nowMs: number) {
  const summary = await deps.summary(null); // null = Master scope: every company.
  const eligible = await queue(deps, gates);
  if (action === "check") {
    // Read-only: report who is eligible right now, send nothing.
    return { action, sent: 0, dry_run: true, qualified: eligible.length, preview: eligible.map((l) => ({ id: l.id, qualified_at: l.qualified_at ?? null })), summary };
  }
  if (!gates.sendEnabled) {
    return { action, sent: 0, dry_run: true, disabled: true, queued: eligible.length, preview: eligible.map((l) => ({ id: l.id, qualified_at: l.qualified_at ?? null })), summary };
  }
  const results: Row[] = [];
  for (const lead of eligible) {
    const permit = await deps.acquire(lead.id, "scheduled");
    if (permit.result !== "ok") { results.push({ id: lead.id, result: permit.result, retry_at: permit.retry_at ?? null }); continue; }
    try {
      const r = await deps.postMeta(eventBody(lead, deps.token(), nowMs));
      const m = classifyMeta(r.status, r.json, deps.token());
      const saved = await deps.record({ lead_id: lead.id, event_id: lead.id, source: "scheduled", initiated_by: null, lock_id: null, http_status: r.status, ...m });
      results.push({ id: lead.id, result: m.outcome, attempt_no: saved.attempt_no });
    } finally { await deps.unlock(lead.id); }
  }
  return { action, sent: results.length, dry_run: false, results, summary };
}
