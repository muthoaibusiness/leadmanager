// The Citizen Avenue "Mela" (sales festival, 4-8 Nov 2026) invitation. Deno-free so
// the Node tests cover it. When a Citizen Avenue lead's status becomes Contacted
// the lead gets the invitation card on WhatsApp, with the contact line showing the
// team lead of whoever holds the lead right now.

export const MELA_CARD_URL = "https://i.postimg.cc/XYV8ypwm/invitation-card-citizen-2.png";
// The marker row (activities.id) that says a lead was invited; also what the
// dashboard counts as "invited". One per lead, so a lead is never invited twice.
export const MELA_INVITE_ID = (leadId: string) => `mela-invite-${leadId}`;
export const MELA_SENT_PREFIX = "Mela invitation sent";

export const isCitizenLead = (l: { property_interest?: string | null } | null | undefined) => /citizen/i.test(String(l?.property_interest || ""));

const BN = "০১২৩৪৫৬৭৮৯";
export const bnDigits = (s: string | number) => String(s).replace(/\d/g, (d) => BN[+d]);

// A phone number as digits with the country code (8801896100270), the way the
// "expert assigned" message shows it. A Bangladeshi 01XXXXXXXXX or 1XXXXXXXXX is
// given 880; any other country's number is kept as it was saved.
export function intlPhone(raw: string | null | undefined): string {
  let d = String(raw || "").replace(/[^\d]/g, "");
  if (!d) return "";
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("880")) return d;
  if (d.length === 11 && d.startsWith("01")) return "880" + d.slice(1);
  if (d.length === 10 && d.startsWith("1")) return "880" + d;
  return d;
}

export type Contact = { name: string; phone: string };
type UserRow = { id: string; name: string; role: string; team_id?: string | null; phone?: string | null; is_active?: boolean | null };

// The Marketing / Brand team has no team lead the customer should call: its agents
// answer for themselves.
const AGENT_OWN_TEAM = /marketing|brand/i;

// Who the customer is told to call. Whoever holds the lead right now decides: the
// team lead of the holder's team. For the Marketing / Brand team it is the agent
// who holds the lead. A holder who leads the team is themself; if the one wanted
// has no phone number the other is used. Null when neither has one.
//
// A lead's own team_id is only a fallback: some leads carry the team lead's user id
// there instead of a team id, so it is matched both ways.
export function pickContact(
  lead: { team_id?: string | null; assigned_to?: string | null },
  users: UserRow[],
  teams: { id: string; name: string }[] = [],
): Contact | null {
  const active = users.filter((u) => u.is_active !== false);
  const holder = active.find((u) => u.id === lead.assigned_to);
  const withPhone = (u: UserRow | undefined) => (u && intlPhone(u.phone) ? { name: u.name, phone: intlPhone(u.phone) } : null);
  const teamId = holder?.team_id || lead.team_id || null;
  const leader = active.find((u) => u.role === "TEAM_LEAD" && ((teamId && u.team_id === teamId) || (lead.team_id && u.id === lead.team_id && !holder?.team_id)));
  const teamName = teams.find((t) => t.id === teamId)?.name || "";
  const ownTeam = AGENT_OWN_TEAM.test(teamName) || (!!leader && /^brand$/i.test(leader.name));
  const self = holder?.role === "TEAM_LEAD" ? holder : undefined;
  return ownTeam
    ? withPhone(self ?? holder) ?? withPhone(leader)
    : withPhone(leader) ?? withPhone(self) ?? withPhone(holder);
}

// The company line shown when no personal contact can be named.
export const MELA_FALLBACK_LINE = "📞 ০৯৬ ৬৬৭ ৯৩২৬৬ | ০১৭০৯৬৬৫০৬০";

export function melaInviteText(c: Contact | null): string {
  // With a named agent: his name and number, then a line saying he is the customer's
  // agent. Without one, the company's own numbers.
  const contact = c
    ? [`👨‍💼 ${c.name}`, `📞 ${c.phone}`, "", "তিনিই আপনার এজেন্ট। যেকোনো প্রয়োজনে তাঁর সাথে যোগাযোগ রাখুন।"]
    : [MELA_FALLBACK_LINE];
  return [
    "সম্মানিত শুভাকাঙ্ক্ষী,",
    "",
    "WECON Properties-এর পক্ষ থেকে আপনাকে আমন্ত্রণ জানাচ্ছি উইকন রিটেইল ও ফ্ল্যাগশিপ শোরুম বিক্রয় উৎসব ২০২৬-এ।",
    "",
    "WECON Citizen Avenue Mall, আমিরাবাদ, লোহাগাড়ায় আধুনিক কমার্শিয়াল স্পেস, রিটেইল শপ ও ফ্ল্যাগশিপ শোরুমে বিনিয়োগের সুযোগ। সঙ্গে থাকছে বিশেষ অফার:",
    "",
    "🎁 ১ কোটি টাকা বিনিয়োগে ই-বাইক",
    "✈️ ২ কোটি টাকা বিনিয়োগে কাপল উমরাহ",
    "",
    "📅 ৪–৮ নভেম্বর ২০২৬ | 🕙 সকাল ১০টা – রাত ৯টা",
    "📍 সিটিজেন পার্ক, আমিরাবাদ, লোহাগাড়া, চট্টগ্রাম",
    "",
    ...contact,
    "",
    "আপনার উপস্থিতি কামনা করছি।",
  ].join("\n");
}
