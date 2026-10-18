// Playground model configuration (migration 0043): which provider, base URL,
// model and API key the AI Trainer Playground calls. Deno-free so the Node
// tests cover it. Only the Playground uses it; test runs, the judge, test
// numbers and the live FAQ agent keep the OPENROUTER_* environment secrets.

export const PROVIDERS = {
  openrouter: { label: "OpenRouter", defaultBase: "https://openrouter.ai/api/v1", fixedHost: "openrouter.ai" },
  openai: { label: "OpenAI", defaultBase: "https://api.openai.com/v1", fixedHost: "api.openai.com" },
  custom: { label: "Custom (OpenAI-compatible)", defaultBase: "", fixedHost: null },
} as const;
export type Provider = keyof typeof PROVIDERS;

export type ModelConfig = { provider: Provider; base_url: string; model: string };
export type ChatReq = { model: string; max_tokens: number; system: string; messages: { role: string; content: string }[] };
export type ChatRes = { ok: true; text: string; prompt_tokens: number; completion_tokens: number } | { ok: false; error: string; code?: string };
export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal; redirect: "manual" }) =>
  Promise<{ ok: boolean; status: number; headers: { get(k: string): string | null }; json(): Promise<any> }>;
// Resolves a host name to its addresses, so a public name that points at a
// private address is refused too. Injected because DNS needs Deno.
export type Resolve = (host: string) => Promise<string[]>;

const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:\/@+-]{0,127}$/;
const KEY_RE = /^[\x21-\x7e]{8,512}$/;

// IPv4/IPv6 literals that must never be called: loopback, private, link-local
// (169.254.169.254 is the cloud metadata address), CGNAT, multicast, reserved.
export function isBlockedAddress(ip: string): boolean {
  const a = ip.toLowerCase().replace(/^\[|\]$/g, "");
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a.replace(/^::ffff:/, ""));
  if (v4) {
    const [p, q] = [Number(v4[1]), Number(v4[2])];
    return p === 0 || p === 10 || p === 127 || p >= 224 || (p === 100 && q >= 64 && q <= 127) || (p === 169 && q === 254)
      || (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168) || (p === 192 && q === 0) || (p === 198 && (q === 18 || q === 19));
  }
  // IPv6: allow only global unicast (2000::/3), minus ranges that tunnel or
  // translate to IPv4 (6to4, Teredo, NAT64) and documentation. Every other
  // form, including IPv4-mapped and IPv4-compatible, is refused.
  if (a.includes(":")) return !/^[23][0-9a-f]{0,3}:/.test(a) || /^2002:|^2001:0?:|^2001:0*db8:|^64:ff9b:/.test(a);
  return false;
}

const BLOCKED_HOSTS = /(^|\.)(localhost|local|internal|localdomain|home\.arpa)$|^metadata(\.google\.internal)?$/;

export function validateConfig(c: any): { ok: true; value: ModelConfig } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const provider = c?.provider;
  if (!Object.hasOwn(PROVIDERS, provider)) return { ok: false, errors: ["provider must be openrouter, openai or custom"] };
  const def = PROVIDERS[provider as Provider];
  const base = String(c?.base_url ?? "").trim().replace(/\/+$/, "") || def.defaultBase;
  const model = String(c?.model ?? "").trim();
  let u: URL | null = null;
  try { u = new URL(base); } catch { errors.push("base_url is not a valid URL"); }
  if (u) {
    if (u.protocol !== "https:") errors.push("base_url must use https");
    if (u.username || u.password) errors.push("base_url must not contain credentials");
    if (u.search || u.hash) errors.push("base_url must not contain a query or fragment");
    // A trailing dot names the same host ("localhost." is localhost).
    const host = u.hostname.toLowerCase().replace(/\.+$/, "");
    if (BLOCKED_HOSTS.test(host) || isBlockedAddress(host)) errors.push("base_url points at a local or private address");
    if (def.fixedHost && host !== def.fixedHost) errors.push(`${def.label} base_url must be on ${def.fixedHost}`);
    if (u.port && u.port !== "443") errors.push("base_url must use the default https port");
  }
  if (!MODEL_RE.test(model)) errors.push("model must be 1-128 characters: letters, digits and . _ : / @ + -");
  // Stored normalised (lowercase punycode host, no default port), so the host
  // the key is bound to compares the same in SQL and here.
  return errors.length ? { ok: false, errors } : { ok: true, value: { provider, base_url: `${u!.origin}${u!.pathname}`.replace(/\/+$/, ""), model } };
}

// The host a stored key belongs to. A key is only ever sent to this host.
export const hostOf = (baseUrl: string) => { try { return new URL(baseUrl).hostname.toLowerCase().replace(/\.+$/, ""); } catch { return ""; } };

export const validKey = (k: unknown): k is string => typeof k === "string" && KEY_RE.test(k);
// What the browser may see of a key: whether one is set and its last 4 characters.
export const maskKey = (k: string | null | undefined) => (k ? `••••${k.slice(-4)}` : null);

// A provider error, reduced to a code and a message that is safe to show and
// store. Never includes the key, the response body or request headers.
function providerError(status: number): { code: string; error: string } {
  if (status === 401 || status === 403) return { code: "auth", error: `Provider rejected the API key (HTTP ${status})` };
  if (status === 404) return { code: "model", error: "Provider does not know this model or endpoint (HTTP 404)" };
  if (status === 400 || status === 422) return { code: "request", error: `Provider refused the request; check the model ID (HTTP ${status})` };
  if (status === 402) return { code: "billing", error: "Provider account has no credit (HTTP 402)" };
  if (status === 429) return { code: "rate_limited", error: "Provider rate limit reached (HTTP 429)" };
  if (status >= 300 && status < 400) return { code: "redirect", error: `Provider redirected the request (HTTP ${status}); redirects are not followed` };
  return { code: "provider", error: `Provider error (HTTP ${status})` };
}

// One chat completion against an OpenAI-compatible endpoint. Resolves the host
// before every call and refuses private targets; does not follow redirects.
export async function chatCompletion(cfg: ModelConfig, key: string, req: ChatReq, io: { fetch: Fetch; resolve: Resolve; timeoutMs?: number }): Promise<ChatRes> {
  const v = validateConfig(cfg);
  if (!v.ok) return { ok: false, code: "config", error: v.errors.join("; ") };
  // OpenRouter and OpenAI are pinned to their public hosts; only a custom host
  // is resolved, so a public name pointing at a private address is refused.
  if (!PROVIDERS[v.value.provider].fixedHost) {
    let addrs: string[];
    try { addrs = await io.resolve(hostOf(v.value.base_url)); } catch { return { ok: false, code: "dns", error: "Could not resolve the base_url host" }; }
    if (!addrs.length) return { ok: false, code: "dns", error: "The base_url host has no address records" };
    if (addrs.some(isBlockedAddress)) return { ok: false, code: "config", error: "base_url resolves to a local or private address" };
  }
  const headers: Record<string, string> = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  if (v.value.provider === "openrouter") Object.assign(headers, { "HTTP-Referer": "https://wepro.app", "X-Title": "WEPRO AI Trainer" });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), io.timeoutMs ?? 30_000);
  try {
    const r = await io.fetch(`${v.value.base_url}/chat/completions`, {
      method: "POST", headers, signal: ctl.signal, redirect: "manual",
      body: JSON.stringify({ model: req.model, max_tokens: req.max_tokens, messages: [{ role: "system", content: req.system }, ...req.messages] }),
    });
    if (!r.ok) return { ok: false, ...providerError(r.status) };
    let j: any;
    try { j = await r.json(); } catch { return { ok: false, code: "format", error: "Provider returned a response that is not JSON" }; }
    const text = j?.choices?.[0]?.message?.content;
    if (typeof text !== "string") return { ok: false, code: "format", error: "Provider response has no choices[0].message.content; it may not be OpenAI-compatible" };
    return { ok: true, text, prompt_tokens: Number(j?.usage?.prompt_tokens) || 0, completion_tokens: Number(j?.usage?.completion_tokens) || 0 };
  } catch (e) {
    if (ctl.signal.aborted) return { ok: false, code: "timeout", error: `Provider did not answer within ${Math.round((io.timeoutMs ?? 30_000) / 1000)}s` };
    return { ok: false, code: "network", error: "Could not reach the provider" };
  } finally {
    clearTimeout(timer);
  }
}
