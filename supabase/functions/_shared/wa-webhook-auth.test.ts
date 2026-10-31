import { test } from "node:test";
import assert from "node:assert/strict";

(globalThis as any).Deno = { env: { get: (k: string) => (k === "SUPABASE_URL" ? "https://sb.test" : "") } };
let secrets: any[] = [];
globalThis.fetch = (async () => new Response(JSON.stringify(secrets), { status: 200 })) as any;
const { verifyWebhook } = await import("./wa.ts");
const h = (o: Record<string, string>) => new Headers(o);

test("secret configured: matching header passes, wrong or missing fails", async () => {
  secrets = [{ id: "eyad", webhook_secret: "s3cret" }];
  assert.deepEqual(await verifyWebhook("eyad", h({ "x-webhook-signature": "s3cret" })), { ok: true, strong: true });
  assert.equal((await verifyWebhook("eyad", h({ "x-wasender-signature": "s3cret" }))).ok, true);
  assert.equal((await verifyWebhook("eyad", h({ "x-webhook-signature": "nope" }))).ok, false);
  assert.equal((await verifyWebhook("eyad", h({}))).ok, false);
});
test("no secret configured: accepted but not strong", async () => {
  secrets = [];
  assert.deepEqual(await verifyWebhook("dubai", h({})), { ok: true, strong: false });
});
