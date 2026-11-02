// Auto-forward: the rules, with no I/O so the Node tests cover them. A contact
// (or a Facebook form lead) is put in front of a sales agent without a human
// typing the /f… tag; forward.ts does the work, this file decides who is due.

// Eyad's rule: a brand-new contact that has had no human for 5 minutes goes to the
// Chattogram pool (/fctg). The window's far end is what keeps the switch safe: the
// day it is turned on, only contacts from the last half hour are looked at, never the
// back catalogue of preleads.
export const EYAD_TAG = "/fctg";
export const EYAD_REGION = "Chattogram";
export const AFTER_MIN = 5;
export const WINDOW_MIN = 30;
export const BATCH = 10;   // Wasender takes one message per 5 s; a run must fit in the function's time

// What a customer is told when an agent is assigned (Bangla; the manual /f tags use this text too).
export const assignedText = (firstName: string, agentName: string, agentPhone: string) =>
  `প্রিয় ${firstName || "there"},\n\nআপনার জন্য একজন ডেডিকেটেড এক্সপার্ট নির্ধারণ করা হয়েছে।\n\n👨‍💼 ${agentName}\n📞 ${agentPhone}\n\nতিনি শীঘ্রই আপনার সাথে যোগাযোগ করে সব কিছু বুঝিয়ে দেবেন।`;

// Eyad contacts due now, oldest first: tagged Eyad, never forwarded, no human has
// taken over, first heard from between WINDOW_MIN and AFTER_MIN minutes ago, and in
// Chattogram or not yet placed. A Dhaka or Cumilla contact stays with the agents who
// own those pools.
export function dueQuery(nowMs: number): string {
  const at = (minAgo: number) => encodeURIComponent(new Date(nowMs - minAgo * 60_000).toISOString());
  return "preleads?WA=eq.Eyad&forwarded=not.is.true&takeover=not.is.true"
    + `&created_at=gte.${at(WINDOW_MIN)}&created_at=lte.${at(AFTER_MIN)}`
    + `&or=(region.is.null,region.eq.${EYAD_REGION})`
    + `&select=id,phone,region&order=created_at.asc&limit=${BATCH}`;
}

// A hidden-number ("@lid") thread has no dialable phone: the digits are only an id,
// and a lead made from them could never be called. Those stay for a human.
const BD_MOBILE = /^(?:880)?1[3-9]\d{8}$/;
export function hasDialableNumber(phone: string, remote: string | null): boolean {
  if (BD_MOBILE.test(String(phone || "").replace(/\D/g, ""))) return true;
  return !!remote && remote.endsWith("@s.whatsapp.net");
}

// The message to the customer: only for a lead this call really created, and only when
// the agent's row says to (wa_agents.notify_client). A lead that already existed was
// assigned long ago; saying so again would be noise.
export function shouldTell(lead: { status?: string; notify?: boolean } | null, switchedOn: boolean): boolean {
  return switchedOn && lead?.status === "created" && lead.notify === true;
}
