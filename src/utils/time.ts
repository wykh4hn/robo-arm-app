/** "0.1", "4.2", "12", "3:05" — compact elapsed time. */
export function formatAge(ms: number): string {
  const s = ms / 1000;
  if (s < 10) return s.toFixed(1);
  if (s < 60) return String(Math.floor(s));
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

/** Task duration, e.g. "12 s" or "2:05". */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour12: false });
}
