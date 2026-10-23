/** Reads a design token (CSS custom property) at runtime, e.g. for three.js and uPlot. */
export function cssVar(name: string, fallback = '#000000'): string {
  if (typeof window === 'undefined' || typeof getComputedStyle === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function cssNumber(name: string, fallback: number): number {
  const n = parseFloat(cssVar(name, String(fallback)));
  return Number.isFinite(n) ? n : fallback;
}

/** "#rrggbb" + alpha -> "rgba(...)". */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
