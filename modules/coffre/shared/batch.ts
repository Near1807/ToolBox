// v0.48.0 (Expérimental): « Pour tous » — one setting for a batch of files
// (in the rangement window, or « Modifier la sélection » of files already
// stored; v0.50.0: labels). The rename template ({nom} without its extension, {n}, {date},
// {dossier}), valid Windows names, collisions numbered « (2) », the values
// shown « mixte » while they differ and are not changed. Pure (tested).
import { freeName, safeName, splitExtension } from './names';

/** The label families « Pour tous » sets to one value (its other values replaced). */
export const BATCH_KEYS = ['nature', 'origin', 'year'] as const;
export type BatchKey = (typeof BATCH_KEYS)[number];

/** The fields of « Pour tous » (an exception is per field). */
export type BatchField = 'route' | BatchKey | 'free' | 'rename' | 'set';

/** The template's words. */
export const TEMPLATE_TOKENS = ['{nom}', '{n}', '{date}', '{dossier}'] as const;

/** « 2026-11-24 » (the local date). */
export function isoDay(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * One name from the template: « Thermo - {nom} » and « labo.pdf » →
 * « Thermo - labo.pdf ». The extension is always kept (never typed); {n}
 * is padded to the batch's size (« 01 » … « 12 »). An empty template keeps
 * the name.
 */
export function renderName(
  template: string,
  original: string,
  v: { n: number; total: number; date: string; folder: string | null },
): string {
  const { base, ext } = splitExtension(original);
  const t = template.trim();
  if (!t) return original;
  const width = String(Math.max(1, v.total)).length;
  const out = t
    .replace(/\{nom\}/gi, base)
    .replace(/\{n\}/gi, String(v.n).padStart(width, '0'))
    .replace(/\{date\}/gi, v.date)
    .replace(/\{dossier\}/gi, v.folder ?? 'À ranger');
  // A template that already ends with the extension does not get it twice.
  const stem =
    ext && out.toLowerCase().endsWith(ext.toLowerCase()) ? out.slice(0, -ext.length) : out;
  return safeName(`${stem}${ext}`);
}

/**
 * The batch's names, in order: the template applied, Windows-valid, the
 * collisions inside the batch numbered « (2) » (a collision with a file
 * already in the folder is numbered the same way when it is written).
 */
export function batchNames(
  files: readonly { key: string; name: string; folder: string | null }[],
  template: string,
  date = isoDay(),
): Map<string, string> {
  const out = new Map<string, string>();
  const taken = new Set<string>();
  files.forEach((f, i) => {
    const wanted = renderName(template, f.name, {
      n: i + 1,
      total: files.length,
      date,
      folder: f.folder,
    });
    // Collisions per destination folder.
    const where = (f.folder ?? '').toLowerCase();
    const name = freeName(wanted, (c) => taken.has(`${where}\u0000${c.toLowerCase()}`));
    taken.add(`${where}\u0000${name.toLowerCase()}`);
    out.set(f.key, name);
  });
  return out;
}

/** The common value of a field among the files, or « mixte ». */
export function common<T>(
  values: readonly T[],
  same: (a: T, b: T) => boolean = (a, b) => a === b,
): { mixed: false; value: T | undefined } | { mixed: true } {
  if (!values.length) return { mixed: false, value: undefined };
  const first = values[0]!;
  return values.every((v) => same(v, first)) ? { mixed: false, value: first } : { mixed: true };
}

/** Free labels after « Pour tous »: those added, minus those removed (case ignored), in order. */
export function batchFree(
  current: readonly string[],
  add: readonly string[],
  remove: readonly string[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const gone = new Set(remove.map((t) => t.trim().toLowerCase()));
  for (const t of [...current, ...add]) {
    const v = t.trim();
    const k = v.toLowerCase();
    if (!v || seen.has(k) || gone.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}
