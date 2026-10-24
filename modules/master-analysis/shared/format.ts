// French formatting of the measures (interface, assistant, export).

/** −9,1 · +0,3 (with a sign when asked). */
export function fr(value: number | null | undefined, digits = 1, sign = false): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const text = Math.abs(value).toFixed(digits).replace('.', ',');
  if (value < 0 && Number(text.replace(',', '.')) !== 0) return `−${text}`;
  return sign && value > 0 && Number(text.replace(',', '.')) !== 0 ? `+${text}` : text;
}

/** 83.4 → « 1:23,4 » (or « 1:23 » with digits = 0). */
export function clock(seconds: number, digits = 1): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  const text = s.toFixed(digits).replace('.', ',');
  return `${m}:${(s < 10 ? '0' : '') + text}`;
}

export const pct = (value: number | null | undefined, digits = 0) =>
  value === null || value === undefined ? '—' : `${fr(value * 100, digits)} %`;
