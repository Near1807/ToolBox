// v0.45.0: names the Coffre writes on the disk — always valid on Windows, so
// that the folder stays readable without ToolBox (règle 2 du cahier des
// charges). Pure (tested).

/** Characters Windows refuses in a name (and every control character, below). */
const FORBIDDEN = /[<>:"/\\|?*]/g;
const controlsOut = (text: string) =>
  [...text].map((c) => (c.charCodeAt(0) < 32 ? '_' : c)).join('');
/** Names Windows reserves, with or without an extension (« CON », « nul.txt »). */
const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

/** The longest name kept (the whole path must stay under Windows' 260 characters). */
export const MAX_NAME = 100;
/** A context's folder: shorter. */
export const MAX_FOLDER = 60;

/** Splits « rapport.final.pdf » into « rapport.final » and « .pdf » (a leading dot is not an extension). */
export function splitExtension(name: string): { base: string; ext: string } {
  const at = name.lastIndexOf('.');
  if (at <= 0 || at === name.length - 1) return { base: name, ext: '' };
  const ext = name.slice(at);
  // « .tar.gz », not « .gz » alone, when the base also ends with « .tar ».
  if (/^\.(gz|bz2|xz|zst)$/i.test(ext) && /\.tar$/i.test(name.slice(0, at)))
    return { base: name.slice(0, at - 4), ext: name.slice(at - 4) };
  return /^\.[\w-]{1,12}$/.test(ext) ? { base: name.slice(0, at), ext } : { base: name, ext: '' };
}

/**
 * A name Windows accepts: forbidden characters replaced, no trailing dot or
 * space, not a reserved name, at most `max` characters (the extension kept).
 */
export function safeName(name: string, max = MAX_NAME): string {
  let clean = controlsOut(name.normalize('NFC'))
    .replace(FORBIDDEN, '_')
    .replace(/\s+/g, ' ')
    .trim();
  clean = clean.replace(/[. ]+$/, '');
  if (!clean || /^_+$/.test(clean)) clean = 'Sans nom';
  if (RESERVED.test(clean)) clean = `_${clean}`;
  if (clean.length > max) {
    const { base, ext } = splitExtension(clean);
    const room = Math.max(1, max - ext.length);
    clean = `${base.slice(0, room).trimEnd()}${ext}`;
  }
  return clean;
}

/** « rapport.pdf », 2 → « rapport (2).pdf ». */
export function withNumber(name: string, n: number): string {
  if (n <= 1) return name;
  const { base, ext } = splitExtension(name);
  return `${base} (${n})${ext}`;
}

/**
 * The first free name among « name », « name (2) », « name (3) »… — a
 * collision never replaces a file. `taken` is case-insensitive (Windows).
 */
export function freeName(name: string, taken: (candidate: string) => boolean): string {
  for (let n = 1; n < 10_000; n++) {
    const candidate = withNumber(name, n);
    if (!taken(candidate)) return candidate;
  }
  throw new Error(`Aucun nom libre pour « ${name} »`);
}

/** Folders of the Coffre that are not contexts. */
export const ARRIVAL_FOLDER = '_Arrivée';
export const TRASH_FOLDER = '_Corbeille';
/** v0.46.0: ToolBox's own folder on the disk (history, disk Recycle Bin, database copy). */
export const DISK_SYSTEM_FOLDER = '_ToolBox';
const RESERVED_FOLDERS = new Set(
  [ARRIVAL_FOLDER, TRASH_FOLDER, DISK_SYSTEM_FOLDER].map((n) => n.toLowerCase()),
);

/** A context's folder name: valid on Windows, never one of the Coffre's own folders. */
export function folderName(name: string): string {
  const safe = safeName(name, MAX_FOLDER);
  return RESERVED_FOLDERS.has(safe.toLowerCase()) ? `${safe}_` : safe;
}
