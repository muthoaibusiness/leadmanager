// Conversations sender tag for a message. The bot writes its sender as
// "AI Agent" (and older rows as "AI Trainer"); both should display as one
// brand tag "AI AGENT". Everything else keeps its stored name.
export function senderDisplayTag(name) {
  const n = String(name || '').toLowerCase();
  if (n === 'ai agent' || n === 'ai trainer') return 'AI AGENT';
  return name;
}
