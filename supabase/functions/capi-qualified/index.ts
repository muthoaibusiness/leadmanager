// Reports a lead the CRM just moved to Interested to Meta as QualifiedLead
// (_shared/capi-qualified.ts). The browser calls this right after the status
// change; the follow-up cron calls the same code as a safety net.
//
// Deploy:  npx supabase functions deploy capi-qualified --no-verify-jwt
// Needs the META_CAPI_ACCESS_TOKEN secret. Every call needs the caller's session.

import { CORS, json, sbSelect } from "../_shared/wa.ts";
import { verifiedActor, actorDepsFromEnv } from "../_shared/actor.ts";
import { sendQualifiedLead } from "../_shared/capi-qualified.ts";

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
  const lead = (await sbSelect(`leads?id=eq.${encodeURIComponent(leadId)}&select=company_id`))[0];
  if (!lead) return json({ error: "No such lead" }, 404);
  if (actor.role !== "MASTER" && lead.company_id && lead.company_id !== actor.company_id) return json({ error: "This lead belongs to another company" }, 403);
  // The browser calls this a moment before its own save reaches the database.
  let res = await sendQualifiedLead(leadId);
  for (let i = 0; i < 4 && res.status === "skipped" && res.reason === "not_interested"; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    res = await sendQualifiedLead(leadId);
  }
  return json(res);
});
