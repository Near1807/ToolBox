// Downloads with progress, resume and checks, and archive extraction. Only
// used for the first installation of the engines, models and voices.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  type Dirent,
} from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import yauzl from 'yauzl';

const run = promisify(execFile);

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Downloads `url` to `target` (through `target.part`, resumed when possible).
 * `onProgress(fraction)` is called while bytes arrive.
 */
export async function download(options: {
  url: string;
  target: string;
  expectedSize?: number;
  sha1?: string;
  signal?: AbortSignal;
  fetchFn?: Fetch;
  onProgress?: (fraction: number | null, received: number) => void;
}): Promise<void> {
  const fetchFn = options.fetchFn ?? fetch;
  mkdirSync(path.dirname(options.target), { recursive: true });
  const part = `${options.target}.part`;
  const already = existsSync(part) ? statSync(part).size : 0;
  const response = await fetchFn(options.url, {
    headers: already > 0 ? { Range: `bytes=${already}-` } : {},
    signal: options.signal,
    redirect: 'follow',
  });
  if (!response.ok || !response.body) {
    throw new Error(`Téléchargement impossible (${response.status}) : ${options.url}`);
  }
  const resumed = response.status === 206;
  const start = resumed ? already : 0;
  const length = Number(response.headers.get('content-length') ?? 0);
  const total = length > 0 ? start + length : (options.expectedSize ?? 0);
  let received = start;
  const reader = response.body.getReader();
  const out = createWriteStream(part, { flags: resumed ? 'a' : 'w' });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!out.write(value))
        await new Promise<void>((resolve) => out.once('drain', () => resolve()));
      received += value.byteLength;
      options.onProgress?.(total > 0 ? Math.min(1, received / total) : null, received);
    }
  } finally {
    await new Promise<void>((resolve) => out.end(resolve));
  }
  if (length > 0 && received !== start + length) {
    throw new Error('Téléchargement interrompu : relance-le, il reprendra là où il s’est arrêté.');
  }
  if (options.sha1) {
    const actual = await sha1Of(part);
    if (actual !== options.sha1) {
      rmSync(part, { force: true });
      throw new Error(
        `Fichier abîmé (empreinte ${actual} au lieu de ${options.sha1}) : supprimé, relance le téléchargement.`,
      );
    }
  }
  renameSync(part, options.target);
}

export async function sha1Of(file: string): Promise<string> {
  const hash = createHash('sha1');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

/** Extracts a .zip (yauzl) or a .tar.gz (system tar) into `dir`. */
export async function extract(archive: string, dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true });
  if (archive.endsWith('.tar.gz') || archive.endsWith('.tgz')) {
    await run('tar', ['-xzf', archive, '-C', dir], { windowsHide: true });
    return;
  }
  await new Promise<void>((resolve, reject) => {
    yauzl.open(archive, { lazyEntries: true, autoClose: true }, (error, zip) => {
      if (error || !zip) return reject(error ?? new Error('Archive illisible'));
      zip.on('error', reject);
      zip.on('end', () => resolve());
      zip.on('entry', (entry: yauzl.Entry) => {
        const target = path.resolve(dir, entry.fileName);
        // Never write outside the target folder (« ../ » in an archive).
        if (!target.startsWith(path.resolve(dir) + path.sep)) return zip.readEntry();
        if (/\/$/.test(entry.fileName)) {
          mkdirSync(target, { recursive: true });
          return zip.readEntry();
        }
        mkdirSync(path.dirname(target), { recursive: true });
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) return reject(streamError ?? new Error('Archive illisible'));
          pipeline(stream, createWriteStream(target))
            .then(() => zip.readEntry())
            .catch(reject);
        });
      });
      zip.readEntry();
    });
  });
}

/** First file named `name` (or `name.exe`) under `dir`, searched recursively. */
export function findExecutable(dir: string, name: string): string | null {
  if (!existsSync(dir)) return null;
  const wanted = new Set([name, `${name}.exe`]);
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop()!;
    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (wanted.has(entry.name)) return full;
    }
  }
  return null;
}
