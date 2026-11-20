export const DAY = 1440;

/** "HH:MM" → minutes from midnight. */
export function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** minutes → "HH:MM", with "+1 " prefix past midnight. */
export function fmt(min: number): string {
  const day = Math.floor(min / DAY);
  const r = ((min % DAY) + DAY) % DAY;
  const s = `${String(Math.floor(r / 60)).padStart(2, '0')}:${String(r % 60).padStart(2, '0')}`;
  return day > 0 ? `+${day} ${s}` : s;
}

/** minutes → "1h 30m" style duration. */
export function dur(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
