import { test } from "node:test";
import assert from "node:assert/strict";
import { validateConfig, isBlockedAddress, chatCompletion, maskKey, validKey, type Fetch } from "./trainer-model.ts";

const REQ = { model: "m/x", max_tokens: 5, system: "s", messages: [{ role: "user", content: "ping" }] };
const KEY = "sk-test-SECRET-1234";
const res = (status: number, body: unknown = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body });
const io = (f: Fetch, addrs = ["93.184.216.34"], timeoutMs?: number) => ({ fetch: f, resolve: async () => addrs, timeoutMs });

test("validateConfig: defaults, https only, fixed hosts, model id", () => {
  const a = validateConfig({ provider: "openrouter", model: "anthropic/claude-haiku-5.5" });
  assert.ok(a.ok && a.value.base_url === "https://openrouter.ai/api/v1");
  assert.equal(validateConfig({ provider: "openai", base_url: "https://api.openai.com/v1/", model: "gpt-x" }).ok, true);
  for (const [c, why] of [
    [{ provider: "nope", model: "m" }, "provider"],
    [{ provider: "custom", base_url: "http://api.example.com/v1", model: "m" }, "https"],
    [{ provider: "custom", base_url: "ftp://api.example.com", model: "m" }, "https"],
    [{ provider: "custom", base_url: "", model: "m" }, "valid URL"],
    [{ provider: "openai", base_url: "https://evil.example.com/v1", model: "m" }, "api.openai.com"],
    [{ provider: "custom", base_url: "https://u:p@api.example.com/v1", model: "m" }, "credentials"],
    [{ provider: "custom", base_url: "https://api.example.com/v1?x=1", model: "m" }, "query"],
    [{ provider: "custom", base_url: "https://api.example.com:8443/v1", model: "m" }, "port"],
    [{ provider: "custom", base_url: "https://api.example.com/v1", model: "" }, "model"],
    [{ provider: "custom", base_url: "https://api.example.com/v1", model: "a b" }, "model"],
    [{ provider: "custom", base_url: "https://api.example.com/v1", model: "x".repeat(129) }, "model"],
  ] as const) {
    const r = validateConfig(c);
    assert.equal(r.ok, false, JSON.stringify(c));
    assert.match((r as any).errors.join(" "), new RegExp(why), JSON.stringify(c));
  }
});

test("validateConfig: refuses localhost, private ranges and metadata endpoints", () => {
  for (const host of ["localhost", "api.localhost", "127.0.0.1", "10.1.2.3", "172.16.0.9", "192.168.1.1", "169.254.169.254", "100.64.0.1",
    "0.0.0.0", "[::1]", "[fd00::1]", "[fe80::1]", "[::ffff:127.0.0.1]", "metadata.google.internal", "db.internal", "printer.local",
    "localhost.", "api.localhost.", "metadata.google.internal.", "2130706433", "0x7f.1", "[64:ff9b::a00:1]", "[2002:a00:1::]", "[::a00:1]",
    "[2001::1]", "[2001:db8::1]", "[100::1]", "[ff02::1]"]) {
    const r = validateConfig({ provider: "custom", base_url: `https://${host}/v1`, model: "m" });
    assert.equal(r.ok, false, host);
  }
  assert.equal(isBlockedAddress("8.8.8.8"), false);
  assert.equal(isBlockedAddress("2606:4700::1111"), false);
  assert.equal(validateConfig({ provider: "custom", base_url: "https://[2606:4700::1111]/v1", model: "m" }).ok, true);
});

test("chatCompletion: success parses content and usage, sends the key only as a bearer header", async () => {
  let seen: any;
  const r = await chatCompletion({ provider: "custom", base_url: "https://api.example.com/v1", model: "m/x" }, KEY, REQ,
    io(async (url, init) => { seen = { url, init }; return res(200, { choices: [{ message: { content: "OK" } }], usage: { prompt_tokens: 3, completion_tokens: 1 } }); }));
  assert.deepEqual(r, { ok: true, text: "OK", prompt_tokens: 3, completion_tokens: 1 });
  assert.equal(seen.url, "https://api.example.com/v1/chat/completions");
  assert.equal(seen.init.headers.Authorization, `Bearer ${KEY}`);
  assert.equal(seen.init.redirect, "manual");
  assert.ok(!seen.init.body.includes(KEY));
});

test("chatCompletion: provider failures map to safe codes and never echo the key or body", async () => {
  const cfg = { provider: "custom" as const, base_url: "https://api.example.com/v1", model: "m" };
  for (const [status, code] of [[401, "auth"], [403, "auth"], [404, "model"], [400, "request"], [402, "billing"], [429, "rate_limited"], [302, "redirect"], [503, "provider"]] as const) {
    const r: any = await chatCompletion(cfg, KEY, REQ, io(async () => res(status, { error: { message: `bad key ${KEY}` } })));
    assert.equal(r.ok, false); assert.equal(r.code, code, String(status));
    assert.ok(!JSON.stringify(r).includes(KEY), "key leaked");
    assert.ok(!JSON.stringify(r).includes("bad key"), "provider body leaked");
  }
  const bad: any = await chatCompletion(cfg, KEY, REQ, io(async () => res(200, { nothing: true })));
  assert.equal(bad.code, "format");
  const net: any = await chatCompletion(cfg, KEY, REQ, io(async () => { throw new Error(`connect failed with ${KEY}`); }));
  assert.equal(net.code, "network"); assert.ok(!JSON.stringify(net).includes(KEY));
});

test("chatCompletion: times out and reports it", async () => {
  const r: any = await chatCompletion({ provider: "custom", base_url: "https://api.example.com/v1", model: "m" }, KEY, REQ,
    io((_u, init) => new Promise((_ok, no) => init.signal.addEventListener("abort", () => no(new Error("aborted")))), undefined, 30));
  assert.equal(r.ok, false); assert.equal(r.code, "timeout");
});

// Production 2026-10-19 (two Playground turns, both about 33s): OpenRouter sent
// the headers, then held the body past the 30s timer, so the abort surfaced in
// r.json() and was reported as "not JSON". It is a timeout, and it says so.
test("chatCompletion: a body that stalls past the timeout is a timeout, not a format error", async () => {
  const r: any = await chatCompletion({ provider: "custom", base_url: "https://api.example.com/v1", model: "m" }, KEY, REQ,
    io(async (_u, init) => ({ ok: true, status: 200, headers: { get: () => null },
      json: () => new Promise((_ok, no) => init.signal.addEventListener("abort", () => no(new DOMException("aborted", "AbortError")))) }), undefined, 30));
  assert.equal(r.ok, false); assert.equal(r.code, "timeout");
  assert.doesNotMatch(r.error, /not JSON/);
});

test("chatCompletion: a body that really is not JSON is a format error and shows the content type, not the body", async () => {
  const r: any = await chatCompletion({ provider: "custom", base_url: "https://api.example.com/v1", model: "m" }, KEY, REQ,
    io(async () => ({ ok: true, status: 200, headers: { get: (k: string) => (k === "content-type" ? "text/html" : null) },
      json: async () => { throw new SyntaxError(`Unexpected token < in <html>${KEY}`); } })));
  assert.equal(r.code, "format");
  assert.match(r.error, /text\/html/);
  assert.ok(!JSON.stringify(r).includes(KEY));
});

test("chatCompletion: refuses a public name that resolves to a private address, before any request", async () => {
  let called = false;
  const r: any = await chatCompletion({ provider: "custom", base_url: "https://rebind.example.com/v1", model: "m" }, KEY, REQ,
    io(async () => { called = true; return res(200, {}); }, ["10.0.0.5"]));
  assert.equal(r.code, "config"); assert.equal(called, false);
  const e: any = await chatCompletion({ provider: "custom", base_url: "https://nx.example.com/v1", model: "m" }, KEY, REQ, io(async () => res(200, {}), []));
  assert.equal(e.code, "dns");
  let sent = false;
  const d: any = await chatCompletion({ provider: "custom", base_url: "https://api.example.com/v1", model: "m" }, KEY, REQ,
    { fetch: async () => { sent = true; return res(200, {}); }, resolve: async () => { throw new Error("dns unavailable"); } });
  assert.equal(d.code, "dns"); assert.equal(sent, false, "no request when the host cannot be checked");
});

test("chatCompletion: OpenRouter and OpenAI are pinned to their hosts and need no DNS lookup", async () => {
  for (const provider of ["openrouter", "openai"] as const) {
    const r = await chatCompletion({ provider, base_url: "", model: "m" } as any, KEY, REQ,
      { fetch: async () => res(200, { choices: [{ message: { content: "OK" } }] }), resolve: async () => { throw new Error("not called"); } });
    assert.equal(r.ok, true, provider);
  }
});

test("validateConfig: normalises the base URL so the key-bound host compares exactly", () => {
  const r = validateConfig({ provider: "custom", base_url: "https://API.Example.com:443/v1/", model: "m" });
  assert.ok(r.ok); assert.equal((r as any).value.base_url, "https://api.example.com/v1");
});

test("key helpers: mask shows only the last 4, validation rejects whitespace and short keys", () => {
  assert.equal(maskKey("1234"), "••••1234");
  assert.equal(maskKey(null), null);
  assert.equal(validKey("short"), false);
  assert.equal(validKey("has space in it"), false);
  assert.equal(validKey(KEY), true);
});

import { embedRequest } from "./trainer-model.ts";
test("embeddings: a 200 with a numeric vector is ok; errors are safe codes; the key never leaks", async () => {
  let seen: any;
  const f: any = async (url: string, init: any) => { seen = { url, init }; return res(200, { data: [{ embedding: [0.1, 0.2, 0.3] }], usage: { prompt_tokens: 4 } }); };
  const r = await embedRequest("https://openrouter.ai/api/v1", KEY, "text-embedding-3-small", "Alpha has a pool", { fetch: f });
  assert.deepEqual(r, { ok: true, vector: [0.1, 0.2, 0.3], tokens: 4 });
  assert.equal(seen.url, "https://openrouter.ai/api/v1/embeddings"); assert.equal(seen.init.redirect, "manual");
  for (const [status, code] of [[401, "auth"], [429, "rate_limited"], [503, "provider"]] as const) {
    const e: any = await embedRequest("https://openrouter.ai/api/v1", KEY, "m", "x", { fetch: async () => res(status, { error: KEY }) });
    assert.equal(e.ok, false); assert.match(e.error, new RegExp(String(status))); assert.ok(!JSON.stringify(e).includes(KEY));
  }
  const bad: any = await embedRequest("https://openrouter.ai/api/v1", KEY, "m", "x", { fetch: async () => res(200, { data: [{ embedding: ["a"] }] }) });
  assert.equal(bad.ok, false);
});

import { embedWithConfig } from "./trainer-model.ts";
test("embedWithConfig: custom hosts are resolved first; private targets are refused before any request", async () => {
  let sent = false;
  const io = (addrs: string[]) => ({ fetch: (async () => { sent = true; return res(200, { data: [{ embedding: [1, 2, 3] }] }); }) as any, resolve: async () => addrs });
  const bad: any = await embedWithConfig({ provider: "custom", base_url: "https://rebind.example.com/v1", model: "e" }, KEY, "x", io(["10.0.0.5"]));
  assert.equal(bad.ok, false); assert.match(bad.error, /private/); assert.equal(sent, false);
  const invalid: any = await embedWithConfig({ provider: "custom", base_url: "http://api.example.com/v1", model: "e" }, KEY, "x", io(["8.8.8.8"]));
  assert.equal(invalid.ok, false); assert.equal(sent, false);
  const good: any = await embedWithConfig({ provider: "custom", base_url: "https://api.example.com/v1", model: "e" }, KEY, "x", io(["93.184.216.34"]));
  assert.deepEqual(good, { ok: true, vector: [1, 2, 3], tokens: 0 });
  const pinned: any = await embedWithConfig({ provider: "openai", base_url: "", model: "e" } as any, KEY, "x", { fetch: (async () => res(200, { data: [{ embedding: [1] }] })) as any, resolve: async () => { throw new Error("not called"); } });
  assert.equal(pinned.ok, true, "fixed-host providers need no DNS lookup");
});

// Production 2026-10-19 20:15 and 20:16 (Playground, about 21 s each):
// "Provider response has no choices[0].message.content". OpenRouter answers
// HTTP 200 with an error object, or with content null and finish_reason
// "length" when the reasoning used the budget. The error must name which.
test("chatCompletion: a 200 with an error object, or with no content, names the cause and never leaks the body", async () => {
  const cfg = { provider: "custom" as const, base_url: "https://api.example.com/v1", model: "m" };
  const shapes: [object, string, RegExp][] = [
    [{ error: { code: 502, message: `upstream ${KEY} failed` } }, "provider", /HTTP 502.*inside an HTTP 200/],
    [{ choices: [{ finish_reason: "length", message: { content: null, reasoning: "thinking..." } }] }, "length", /token limit/],
    [{ choices: [{ finish_reason: "content_filter", message: { content: null } }] }, "refused", /content filter/],
    [{ choices: [] }, "format", /no choices/],
    [{ choices: [{ finish_reason: "stop", message: { content: "" } }] }, "empty", /empty reply/],
  ];
  for (const [body, code, msg] of shapes) {
    const r: any = await chatCompletion(cfg, KEY, REQ, io(async () => res(200, body)));
    assert.equal(r.ok, false, JSON.stringify(body)); assert.equal(r.code, code, JSON.stringify(body)); assert.match(r.error, msg);
    assert.ok(!JSON.stringify(r).includes(KEY) && !JSON.stringify(r).includes("thinking"), "nothing from the body leaks");
  }
});

// Playground 2026-10-31: deepseek/deepseek-v4-flash-0731 spent the whole
// budget thinking. An OpenRouter "length" is retried once with reasoning off.
test("chatCompletion: an OpenRouter reply empty on the token limit is retried once with reasoning off", async () => {
  const cfg = { provider: "openrouter" as const, model: "deepseek/x" };
  const big = { ...REQ, max_tokens: 2000 };
  const bodies: any[] = [];
  const empty = { choices: [{ finish_reason: "length", message: { content: null } }], usage: { prompt_tokens: 100, completion_tokens: 2000 } };
  const r: any = await chatCompletion(cfg, KEY, big, io(async (_u, i: any) => {
    bodies.push(JSON.parse(i.body));
    return res(200, bodies.length === 1 ? empty : { choices: [{ finish_reason: "stop", message: { content: "OK" } }], usage: { prompt_tokens: 100, completion_tokens: 10 } });
  }));
  assert.equal(r.ok, true); assert.equal(r.text, "OK"); assert.equal(bodies.length, 2);
  // Both passes are billed.
  assert.equal(r.prompt_tokens, 200); assert.equal(r.completion_tokens, 2010);
  assert.deepEqual(bodies[0].reasoning, { effort: "low" }); assert.deepEqual(bodies[1].reasoning, { enabled: false });
  // A model that refuses reasoning off keeps the first "length" result.
  let n = 0;
  const r2: any = await chatCompletion(cfg, KEY, big, io(async () => (++n === 1 ? res(200, empty) : res(400))));
  assert.equal(r2.code, "length"); assert.equal(n, 2); assert.equal(r2.completion_tokens, 2000, "a billed failure keeps its usage");
  // Any other failure is not retried here.
  let m = 0;
  await chatCompletion(cfg, KEY, big, io(async () => { m++; return res(500); }));
  assert.equal(m, 1);
});

test("review2: an error inside an HTTP 200 keeps its meaning: 401/403 auth, 402 billing, 429 rate limit, 4xx request, 5xx provider", async () => {
  const cfg = { provider: "custom" as const, base_url: "https://api.example.com/v1", model: "m" };
  for (const [c, code] of [[401, "auth"], [403, "auth"], [402, "billing"], [429, "rate_limited"], [400, "request"], [404, "model"], [503, "provider"], ["x", "provider"]] as const) {
    const r: any = await chatCompletion(cfg, KEY, REQ, io(async () => res(200, { error: { code: c, message: "m" } })));
    assert.equal(r.code, code, String(c));
  }
});
