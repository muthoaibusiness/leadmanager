// node --test — askAgent reliability (Phase 1): provider failures, empty /
// unparsed replies, and network errors must return a safe empty reply, never
// throw, and be recorded through the injected io.record sink. The real fetch
// and DB write are injected away; only the decision logic is exercised.
import { test } from "node:test";
import assert from "node:assert/strict";
import { askAgent, type AskAgentIo } from "./ai.ts";

const env: Record<string, string> = { OPENROUTER_API_KEY: "test-key" };
(globalThis as any).Deno = { env: { get: (k: string) => env[k] ?? null } };

const JSON_OK = JSON.stringify({ confident: true, reply: "Wecon Osman Bellevue", send: null });

function fakeFetch(status: number, jsonBody: unknown, textBody?: string): { fetch: typeof fetch; captured: any[] } {
  const captured: any[] = [];
  const fetch = (async (url: any, init: any) => {
    captured.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (textBody ?? JSON.stringify(jsonBody)) as string,
      json: async () => jsonBody,
    } as any;
  }) as typeof fetch;
  return { fetch, captured };
}

const emptyIo = (over: Partial<AskAgentIo> = {}): { io: AskAgentIo; recorded: any[] } => {
  const recorded: any[] = [];
  return { io: { record: (f: any) => void recorded.push(f), ...over }, recorded };
};

test("askAgent: missing key returns a safe empty reply and records an auth failure", async () => {
  env.OPENROUTER_API_KEY = "";
  const { io, recorded } = emptyIo();
  const r = await askAgent([], "hi", [], undefined, [], [], io);
  assert.deepEqual(r, { reply: "", send: null, confident: false });
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].kind, "auth");
  env.OPENROUTER_API_KEY = "test-key";
});

test("askAgent: provider 500 returns a safe empty reply, records it, and sends max_tokens 400", async () => {
  const { fetch, captured } = fakeFetch(500, { error: "boom" });
  const { io, recorded } = emptyIo({ fetch });
  const r = await askAgent([], "hello", [], undefined, [], [], io);
  assert.deepEqual(r, { reply: "", send: null, confident: false });
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].kind, "provider");
  assert.equal(recorded[0].status, 500);
  const body = JSON.parse(captured[0].init.body as string);
  assert.equal(body.max_tokens, 400);
});

test("askAgent: unparsed model output returns a safe empty reply and records a parse failure", async () => {
  const { fetch } = fakeFetch(200, { choices: [{ message: { content: "not json at all" } }] });
  const { io, recorded } = emptyIo({ fetch });
  const r = await askAgent([], "hello", [], undefined, [], [], io);
  assert.deepEqual(r, { reply: "", send: null, confident: false });
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].kind, "parse");
});

test("askAgent: a network failure is swallowed and recorded", async () => {
  const failing = (async () => { throw new Error("socket hang up"); }) as typeof fetch;
  const { io, recorded } = emptyIo({ fetch: failing });
  const r = await askAgent([], "hello", [], undefined, [], [], io);
  assert.deepEqual(r, { reply: "", send: null, confident: false });
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].kind, "network");
});

test("askAgent: a well-formed reply is returned, and max_tokens is present", async () => {
  const { fetch, captured } = fakeFetch(200, { choices: [{ message: { content: JSON_OK } }] });
  const { io } = emptyIo({ fetch });
  const r = await askAgent([], "hello", [], undefined, [], [], io);
  assert.equal(r.confident, true);
  assert.equal(r.reply, "Wecon Osman Bellevue");
  const body = JSON.parse(captured[0].init.body as string);
  assert.equal(body.max_tokens, 400);
});
