// Existing command mappings that must not change (spec §10.5). Checked
// against production wa_agents and wa_projects on 2026-10-18.
export const FORWARD = [
  ["/fdh", "Dhaka pool", "Dhaka", true, true], ["/faz", "Md.Azizul Haque", "Dhaka", false, true],
  ["/fmj", "Mehjabeen Mumtaha Rahman", "Dhaka", false, true], ["/fk", "Kamrul Shikder", "Dhaka", false, true],
  ["/fl", "Mainul", "Dhaka", false, false], ["/fctg", "Chittagong pool", "Chattogram", true, true],
  ["/fm", "Masud Chowdhury", "Chattogram", false, true], ["/fs", "Shabbir Newaz", "Chattogram", false, true],
  ["/fmr", "Maruf Alam", "Chattogram", false, true], ["/fh", "Hillol Chowdhury", "Chattogram", false, true],
  ["/fsn", "Shahin", "Cumilla", false, true], ["/fcml", "Cumilla pool", "Cumilla", true, true],
  ["/fdp", "Deep", "Cumilla", false, true], ["/fkl", "Kamal", "Cumilla", false, true],
  ["/fdu", "Dubai (Jaber Hossain)", "Dubai", false, true], ["/fmkt", "Marketing pool", "Marketing", true, true],
  ["/frahat", "Mr Rahat", "Marketing", false, true],
] as const;

export const SEND = [
  ["/sendca", "Wecon Chowdhury Arcade"], ["/senddk", "Wecon Dakshinayan"], ["/sendio", "Wecon Iqbal Orchid"],
  ["/sendjm", "Wecon JM Heritage Mall"], ["/sendmm", "Momtaz Manor"], ["/sendnz", "Wecon Nuznan"],
  ["/sendos", "Wecon Osman Bellevue"], ["/sendphc", "P2P Helthcare"], ["/sendsb", "Wecon Summer Breeze"],
  ["/sendsd", "Wecon South Dale"], ["/sendss", "Shafiq Sapphire"],
] as const;

export const ALL_ON = { manualForwardEnabled: true, takeoverEnabled: true, notesEnabled: true, docsCommandEnabled: true,
  customerNotifyEnabled: true, metaCapiEnabled: true };

// A Wasender messages.upsert payload. fromMe/remote/text vary per case.
export const payload = (o: { fromMe: boolean; text: string; remote?: string; pn?: string | null }) => ({
  event: "messages.upsert",
  data: { messages: {
    key: { id: "m1", fromMe: o.fromMe, remoteJid: o.remote ?? "8801700000000@s.whatsapp.net", ...(o.pn === null ? {} : { cleanedSenderPn: o.pn ?? "8801700000000" }) },
    pushName: "Test", messageBody: o.text, message: { conversation: o.text },
  } },
});
