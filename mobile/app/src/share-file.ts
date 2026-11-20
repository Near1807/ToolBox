// « Enregistrer sous » / « Partager » on the phone (ctx.files.saveAs): the file
// is written in the app's cache, given to Android's share sheet, then
// DELETED (v0.44.0): nothing stays on the phone after a share (the app it went
// to — WhatsApp, Drive, Fichiers… — keeps its own copy). The app it goes to
// may read the file after the sheet closed: it is deleted when Thomas comes
// back to ToolBox, or 5 minutes later at the latest; a cancelled sheet:
// at once. What a closed app left is swept at the next start.
// The Capacitor plugins are given (page-host.ts), so this is tested without them.

export const EXPORTS = 'exports';
/** At the latest, the shared file is deleted this long after the sheet closed. */
export const KEEP_MS = 5 * 60_000;

export interface ShareDeps {
  write(path: string, data: { base64: string } | { text: string }): Promise<void>;
  uri(path: string): Promise<string>;
  /** The share sheet; rejects with a « cancel » message when closed without choosing. */
  share(options: { title: string; files: string[] }): Promise<void>;
  remove(path: string): Promise<void>;
  list(folder: string): Promise<string[]>;
  /** Runs `then` when the page comes back after having been hidden, or after `ms`. */
  later(then: () => void, ms: number): void;
  toBase64(data: Uint8Array): string;
}

/** A file name Android accepts (no folder separators, nothing invisible). */
export function safeFileName(name: string): string {
  const clean = [...name]
    .map((c) => (c.charCodeAt(0) < 32 ? '-' : c))
    .join('')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return clean || 'export';
}

/** The share sheet was closed without choosing (Capacitor's message). */
const cancelled = (error: unknown) =>
  /cancel/i.test(error instanceof Error ? error.message : String(error));

/** Shares a file through Android's sheet; its name, or null when cancelled. The copy is deleted after. */
export async function shareFile(
  deps: ShareDeps,
  call: { title: string; defaultName: string; data: string | Uint8Array },
): Promise<string | null> {
  const name = safeFileName(call.defaultName);
  const path = `${EXPORTS}/${name}`;
  await deps.write(
    path,
    typeof call.data === 'string' ? { text: call.data } : { base64: deps.toBase64(call.data) },
  );
  const forget = () => void deps.remove(path).catch(() => undefined);
  try {
    await deps.share({ title: call.title, files: [await deps.uri(path)] });
  } catch (error) {
    forget();
    if (cancelled(error)) return null;
    throw error;
  }
  deps.later(forget, KEEP_MS);
  return name;
}

/** At the start: the copies a closed app could not delete. */
export async function sweepExports(deps: Pick<ShareDeps, 'list' | 'remove'>): Promise<number> {
  let names: string[];
  try {
    names = await deps.list(EXPORTS);
  } catch {
    return 0; // no folder yet
  }
  for (const name of names) await deps.remove(`${EXPORTS}/${name}`).catch(() => undefined);
  return names.length;
}
