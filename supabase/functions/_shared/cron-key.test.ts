// node --test — the shared-secret gate for pg_cron targets (cron-key.ts).
// Fail closed: with no key configured every call is refused (503), so a
// deploy that forgets FOLLOWUP_CRON_KEY sends nothing instead of letting
// anyone with the URL trigger WhatsApp sends. With the key set, a missing,
// empty or wrong header is 401.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cronKeyGate } from "./cron-key.ts";

const req = (h?: string) => new Request("http://fn.test", { method: "POST", headers: h === undefined ? {} : { "x-followup-key": h } });
const KEY = "k-" + "x".repeat(40);

test("no key configured: refused (503), even with a header", () => {
  for (const configured of [undefined, ""]) {
    for (const h of [undefined, "", KEY]) {
      const g = cronKeyGate(req(h), configured, "x-followup-key");
      assert.equal(g.ok, false, `${configured} / ${h}`); assert.equal((g as any).status, 503);
    }
  }
});

test("key configured: the exact header passes", () => {
  assert.deepEqual(cronKeyGate(req(KEY), KEY, "x-followup-key"), { ok: true });
});

test("key configured: missing, empty, wrong, prefix or longer header is 401", () => {
  for (const h of [undefined, "", "wrong", KEY.slice(0, -1), KEY + "x", KEY.toUpperCase()]) {
    const g = cronKeyGate(req(h), KEY, "x-followup-key");
    assert.equal(g.ok, false, String(h)); assert.equal(g.status, 401, String(h));
  }
});

test("a key shorter than 32 characters is a misconfiguration: refuse everything (503)", () => {
  const g = cronKeyGate(req("short"), "short", "x-followup-key");
  assert.equal(g.ok, false); assert.equal(g.status, 503);
});
