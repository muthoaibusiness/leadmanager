// node --test — the hybrid FAQ fallback contract: the caller falls back to the
// legacy FAQ agent ONLY when the AI Trainer's published snapshot is missing or
// core-incompatible (blocked_no_published_snapshot). Every other outcome — an
// answered turn, a paused conversation, a blocked test number, a fallback
// error — is final and must NOT produce a second, legacy reply. Falling back
// on those was a fail-open (e.g. sending into a conversation the operator
// paused). See the security review on wa-bot-*/index.ts.
// The predicate lives in trainer-deno.ts, whose import chain reads Deno.env at
// module top (wa.ts); stub Deno before a dynamic import (ESM imports hoist,
// so a static import would run before the stub).
(globalThis as any).Deno = {
  env: {
    get: (_k: string) => "",
    has: () => false,
    toObject: () => ({}),
  },
};

import { test } from "node:test";
import assert from "node:assert/strict";

test("fallback fires ONLY on blocked_no_published_snapshot (fail-open fix)", async () => {
  const { shouldFallbackToFaq } = await import("./trainer-deno.ts");
  const cases: { r: { outcome: string; sent: number }; want: boolean }[] = [
    { r: { outcome: "blocked_no_published_snapshot", sent: 0 }, want: true },
    { r: { outcome: "skipped_paused", sent: 0 }, want: false },
    { r: { outcome: "blocked_not_test_number", sent: 0 }, want: false },
    { r: { outcome: "blocked_draft_errors", sent: 0 }, want: false },
    { r: { outcome: "ok", sent: 1 }, want: false },
    { r: { outcome: "handoff_requested", sent: 0 }, want: false },
    { r: { outcome: "brochure_sent", sent: 1 }, want: false },
    { r: { outcome: "fallback_model_error", sent: 0 }, want: false },
    { r: { outcome: "fallback_invalid_output", sent: 0 }, want: false },
  ];
  for (const { r, want } of cases) {
    assert.equal(shouldFallbackToFaq(r as any), want, `${r.outcome} -> ${want}`);
  }
});
