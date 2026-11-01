// The Citizen Avenue "Mela" (sales festival, 4-8 Nov 2026) invitation. Deno-free so
// the Node tests cover it. When a Citizen Avenue lead's status becomes Contacted
// the lead gets the invitation card on WhatsApp, with the contact line showing the
// team lead of whoever holds the lead right now.

export const MELA_CARD_URL = "https://i.postimg.cc/wTWtXwLz/invitation-card-citizen-2.png";
// The marker row (activities.id) that says a lead was invited; also what the
// dashboard counts as "invited". One per lead, so a lead is never invited twice.
export const MELA_INVITE_ID = (leadId: string) => `mela-invite-${leadId}`;
export const MELA_SENT_PREFIX = "Mela invitation sent";

export const isCitizenLead = (l: { property_interest?: string | null } | null | undefined) => /citizen/i.test(String(l?.property_interest || ""));

const BN = "০১২৩৪৫৬৭৮৯";
export const bnDigits = (s: string | number) => String(s).replace(/\d/g, (d) => BN[+d]);

// Display form of a phone number: a Bangladeshi number as 01XXXXXXXXX, anything
// else as +<country code><number>.
export function displayPhone(raw: string | null | undefined): string {
  let d = String(raw || "").replace(/[^\d]/g, "");
  if (!d) return "";
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("880") && d.length >= 12) return "0" + d.slice(3);
  if (d.length === 10 && d.startsWith("1")) return "0" + d;
  if (d.startsWith("0")) return d;
  return "+" + d;
}

export type Contact = { name: string; phone: string };
type UserRow = { id: string; name: string; role: string; team_id?: string | null; phone?: string | null; is_active?: boolean | null };

// Who the customer is told to call: the team lead of the lead's team (the lead's
// own team, else the holder's), the holder themself when they lead a team, else
// the holder. Null when nobody has a phone number.
export function pickContact(lead: { team_id?: string | null; assigned_to?: string | null }, users: UserRow[]): Contact | null {
  const active = users.filter((u) => u.is_active !== false);
  const holder = active.find((u) => u.id === lead.assigned_to);
  const teamId = lead.team_id || holder?.team_id || null;
  const withPhone = (u: UserRow | undefined) => (u && displayPhone(u.phone) ? { name: u.name, phone: displayPhone(u.phone) } : null);
  const lead_ = teamId ? active.find((u) => u.role === "TEAM_LEAD" && u.team_id === teamId) : undefined;
  return withPhone(lead_) ?? withPhone(holder?.role === "TEAM_LEAD" ? holder : undefined) ?? withPhone(holder) ?? null;
}

// The company line shown when no personal contact can be named.
export const MELA_FALLBACK_LINE = "📞 ০৯৬ ৬৬৭ ৯৩২৬৬ | ০১৭০৯৬৬৫০৬০";

export function melaInviteText(c: Contact | null): string {
  const line = c ? `📞 ${c.name}: ${bnDigits(c.phone)}` : MELA_FALLBACK_LINE;
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
    line,
    "",
    "আপনার উপস্থিতি কামনা করছি।",
  ].join("\n");
}
