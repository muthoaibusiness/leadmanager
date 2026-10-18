// The two WhatsApp bots, as WA Relay and the AI Trainer list them.
export const BOTS = [
  { bot: 'eyad', name: 'Eyad Bot', blurb: 'Wecon Properties WhatsApp number' },
  { bot: 'dubai', name: 'Dubai Bot', blurb: 'Dubai WhatsApp number' },
];

// Testing numbers (migration 0035) are stored as digits with the country code.
// A Bangladeshi number typed as 01XXXXXXXXX, +880 1XXX… or with a stray 0
// after 880 all become 8801XXXXXXXXX; anything else keeps its digits.
export const normTestNumber = (v) => {
  const d = String(v || '').replace(/\D/g, '');
  const bd = d.match(/^(?:880|0)*(1\d{9})$/);
  return bd ? '880' + bd[1] : d;
};
