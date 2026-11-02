// fb-leads: receives Facebook Lead Ads webhooks and turns each submitted form into
// a CRM lead (rules in _shared/fb-leads-core.ts, I/O in _shared/fb-leads.ts,
// settings in Admin > Facebook Leads). Replaces the n8n "Facebook Lead Ads Trigger".
//
// Deploy:  npx supabase functions deploy fb-leads --no-verify-jwt
// Secrets: FB_VERIFY_TOKEN, FB_APP_SECRET, FB_PAGE_ACCESS_TOKEN
//
// --no-verify-jwt because Meta sends no Supabase token. Instead GET answers only
// Meta's handshake (the verify token) and POST is accepted only with a valid
// X-Hub-Signature-256 made with the app secret; without the secret set, every
// request is refused.

import { CORS, json } from "../_shared/wa.ts";
import { verifySignature, leadgenChanges } from "../_shared/fb-leads-core.ts";
import { processLeadgen, type Outcome } from "../_shared/fb-leads.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // Meta's one-time check when the webhook is saved.
  if (req.method === "GET") {
    const q = new URL(req.url).searchParams;
    const want = Deno.env.get("FB_VERIFY_TOKEN") ?? "";
    if (!want) return json({ error: "FB_VERIFY_TOKEN is not set" }, 503);
    if (q.get("hub.mode") === "subscribe" && q.get("hub.verify_token") === want) return new Response(q.get("hub.challenge") ?? "", { status: 200 });
    return json({ error: "Verification failed" }, 403);
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const secret = Deno.env.get("FB_APP_SECRET") ?? "";
  if (!secret) return json({ error: "FB_APP_SECRET is not set" }, 503);
  const raw = await req.text();
  if (!(await verifySignature(raw, req.headers.get("x-hub-signature-256"), secret))) return json({ error: "Bad signature" }, 401);

  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return json({ error: "Invalid JSON" }, 400); }

  // Always answer 200 once the request is genuine: what became of each lead is
  // on its fb_lead_events row, and Meta resending a failed one would only repeat it.
  const results: Outcome[] = [];
  for (const change of leadgenChanges(body)) {
    try { results.push(await processLeadgen(change)); }
    catch (e) { console.error("fb-leads: unexpected error", change.leadgen_id, e instanceof Error ? e.message : e); results.push({ leadgen_id: change.leadgen_id, status: "failed", error: "unexpected error" }); }
  }
  return json({ ok: true, results });
});
