export const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
export const usdCents = (c: number) => usd(c / 100);
export const pct = (n: number | null) => (n === null ? 'n/a' : `${Math.round(n * 100)}%`);
export function dur(sec: number | null) {
  if (sec === null) return 'n/a';
  if (sec < 90) return `${sec}s`;
  if (sec < 5400) return `${Math.round(sec / 60)} min`;
  return `${(sec / 3600).toFixed(1)} h`;
}
