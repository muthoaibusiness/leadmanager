import { useState, useEffect } from 'react';

// Time-of-day phrase from local hour.
function phrase(h) {
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 21) return 'Good evening';
  return 'Good night';
}

// Live greeting that updates across the day (and on tab refocus), even if the
// dashboard stays open. Uses the browser's local time zone.
export function useGreeting() {
  const [hour, setHour] = useState(() => new Date().getHours());
  useEffect(() => {
    const tick = () => setHour(new Date().getHours());
    const t = setInterval(tick, 60000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', tick); };
  }, []);
  return phrase(hour);
}
