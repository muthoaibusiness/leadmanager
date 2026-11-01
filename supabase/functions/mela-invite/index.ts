// Sends the Mela invitation card to a Citizen Avenue lead the moment the CRM moves
// it to Contacted. The browser calls this after the status change; the follow-up
// cron calls the same code as a safety net (see _shared/mela-invite.ts).
//
// Deploy:  npx supabase functions deploy mela-invite --no-verify-jwt
// Every call needs the caller's Supabase Auth session (the same check wa-send uses).

import { CORS, json, sbSelect } from "../_shared/wa.ts";
import { verifiedActor, actorDepsFromEnv } from "../_shared/actor.ts";
import { inviteLead } from "../_shared/mela-invite.ts";

const actorDeps = actorDepsFromEnv((k) => Deno.env.get(k));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let actor;
  try { actor = await verifiedActor(req, actorDeps); }
  catch (e: any) { return json({ error: e?.message || "Sign in required" }, typeof e?.status === "number" ? e.status : 401); }
  let body: { leadId?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const leadId = String(body?.leadId || "");
  if (!leadId) return json({ error: "leadId is required" }, 400);
  // The caller's company must own the lead (Master: any).
  const lead = (await sbSelect(`leads?id=eq.${encodeURIComponent(leadId)}&select=company_id`))[0];
  if (!lead) return json({ error: "No such lead" }, 404);
  if (actor.role !== "MASTER" && lead.company_id && lead.company_id !== actor.company_id) return json({ error: "This lead belongs to another company" }, 403);
  // The browser calls this the instant it changes the status, a moment before its own
  // save reaches the database, so "not Contacted yet" is retried for a few seconds.
  let res = await inviteLead(leadId);
  for (let i = 0; i < 4 && res.status === "skipped" && res.reason === "status is not Contacted"; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    res = await inviteLead(leadId);
  }
  return json(res);
});
